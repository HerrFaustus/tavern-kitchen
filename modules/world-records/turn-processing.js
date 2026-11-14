import { importantPossession } from './person-fields.js';
import { readInvolvement } from '../story-state/involvement.js';
import { ambientControl } from '../story-state/ambient.js';
import {historicalWorld} from './historical.js';
import { createTurnQueue } from '../../core/turn-queue.js';
import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { panelEnabled } from '../../core/panel-policy.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { prepareMemoryTags } from '../story-summary/data/memory-tags.js';
import { collectPlotLines, readSourcePlotLines } from '../story-state/plot-lines.js';
import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { selectHistoryNodesBefore } from '../story-summary/data/summary-layers.js';
import { worldStoryRecords } from './world-story-state.js';
import { currentTurns, turnEffectConflicts } from './turn-ledger.js';
import { assertUpdateBudget, fitUpdateContext, worldUpdates } from './update-context.js';
import { applyCommand, canonical, invariant } from './domain.js';
import { taskDefinitions, actionProtocol, turnActionGroups, turnOperations } from './turn-actions.js';

function promptData(world, store, source, chat, keys, playerName) {
    const hero = protagonistIdentity(world.entities, playerName).hero;
    const history = (store.summaryHistory || []).filter(batch => batch.endMesId <= source.end);
    const before = history.filter(batch => batch.endMesId < source.end);
    const earlierLines = keys.includes('clues') ? (store.summaryHistory || []).filter(b => b.endMesId >= source.end)
        .flatMap(b => (b.plotLineIncrements || []).filter(row => row.endMesId < source.end)) : [];
    const story = worldStoryRecords(world, (store.json?.storyRecords || []).filter(row => Number.isInteger(row._addedAt) && row._addedAt <= source.end));
    const people = keys.some(key => ['people', 'peopleEvolution'].includes(key));
    const possessions = keys.includes('overview');
    const places = keys.some(key => ['places','mapEvolution','subscribed','sceneryEvolution','encounter'].includes(key));
    const needsNames = people || places || possessions;
    const roleFields = ['owner','保管人','使用人','ownerId'];
    const related = item => roleFields.some(field => item.fields[field]?.value?.entityId === hero?.id && hero);
    const entities = world.entities.filter(entity => needsNames && (entity.kind !== 'item' || related(entity) || people && importantPossession(entity)
        || possessions && source.messages.some(row => row.text.includes(entity.name)))).map(({ id, name, kind, aliases, fields }) => {
        const visible = people && ['person','organization','item'].includes(kind) || places && kind === 'place'
            || possessions && (id === hero?.id || kind === 'item');
        const entries = visible ? Object.entries(fields).filter(([key]) => ['coins','金币'].includes(key) ? possessions && hero?.id === id : people || places && kind === 'place' || possessions && (kind === 'item' || key === 'location')) : [];
        return { id, name, kind, aliases, fields: Object.fromEntries(entries) };
    });
    const simulationKeys = {person:'peopleEvolution',situation:'subscribed',scenery:'sceneryEvolution'};
    const involvement = keys.some(key => Object.values(simulationKeys).includes(key))
        ? readInvolvement(world,{enabled:true,store:{summaryHistory:history,json:{storyRecords:story}}},playerName)
            .filter(row=>keys.includes(simulationKeys[row.kind])) : [];
    const brief = { ...(involvement.length && {involvementContext:involvement}), ...(needsNames && {playerNames: [playerName], heroId: hero?.id}), increment: source, executionReceipts: [],
        manifest: { mode: 'full', worldComplete: true, entities: entities.length },
        world: { entities, claims: [], sources: {}, storyRecords: story.filter(row => people && ['person','knowledge','plan','goal'].includes(row.kind) || keys.some(k => ['situation','subscribed','sceneryEvolution','encounter'].includes(k)) && ['situation','clock'].includes(row.kind) || row.kind === 'suspense' && keys.includes('suspense')), proposalHistory: [] },
        background: { summaries: (panelEnabled('memory') ? selectHistoryNodesBefore(before, chat, source.start) : []).map(n => ({ level: n.level, start: n.start, end: n.end, text: n.text })) },
        ...(keys.includes('clues') && { plotLines: collectPlotLines([...before,...earlierLines], story,{chat}) }) };
    return brief;
}
function matchesSimulation(key, brief, source) {
    const text = source.messages.map(row => row.text).join('\n');
    const entities = brief.world.entities, records = brief.world.storyRecords;
    const mentioned = name => typeof name === 'string' && name.length && text.includes(name);
    const due = row => Number.isInteger(row.dueFloor) && row.dueFloor <= source.end + 1;
    const hero = entities.find(entity => entity.id === brief.heroId), place = hero?.fields.location?.value?.entityId;
    const kind = {peopleEvolution:'person',subscribed:'situation',sceneryEvolution:'scenery'}[key];
    if (kind && brief.involvementContext?.some(row => row.kind === kind && (row.near || row.wakeFloor === source.end))) return true;
    if (key === 'peopleEvolution') return entities.some(e => e.kind === 'person' && e.id !== brief.heroId && (mentioned(e.name) || place && e.fields.location?.value?.entityId === place));
    if (key === 'encounter') return /街|集市|市集|渡口|广场|茶摊/.test(text) && !/战斗|厮杀|私室/.test(text);
    if (key === 'mapEvolution') return entities.some(e => e.kind === 'place' && mentioned(e.name));
    return records.some(r => r.kind === 'situation' && r.status === 'open' && (key !== 'sceneryEvolution' || r.flavor === 'scenery')
        && (due(r) || [r.title, r.scope, r.placeId, r.parties].some(mentioned)));
}
function applicableLegacyProposal(proposal, keys, state, heroId) {
    if (proposal.type === 'story') return keys.includes(({situation:'situation',clock:'situation',suspense:'suspense'})[proposal.record?.kind] || 'people');
    const entity = state.entities.find(value => value.id === proposal.entityId);
    if (entity?.id === heroId || ['coins','金币'].includes(proposal.field) || entity?.kind === 'item' && ['归属','owner'].includes(proposal.field)) return keys.includes('overview');
    return keys.includes(entity?.kind === 'place' || proposal.kind === 'place' ? 'places' : 'people');
}

function legacyTradeRecorded(state, turn, row, heroId) {
    return state.receipts.some(receipt => {
        const origins = [receipt.origin,...(receipt.origins || [])];
        if (!origins.some(origin => origin?.sourceId === turn.id) || receipt.origin?.effectId?.startsWith('turn:')) return false;
        const event = state.events.find(item => item.id === receipt.eventId);
        const involved = event?.effects.find(change => change.type === 'entity' && change.id === row.item
            && change.before?.fields?.owner?.value?.entityId !== change.after?.fields?.owner?.value?.entityId);
        return involved && event.effects.some(change => change.id === heroId &&
            change.after?.fields?.coins?.value - change.before?.fields?.coins?.value === (row.direction === 'buy' ? -row.price : row.price));
    });
}
function request(brief, keys, sim) {
    const domain = keys.some(key => !['memory', 'clues'].includes(key));
    const system = [sim ? '你是推演 Agent。按命中条件合并本楼推演。' : '你是更新 Agent。只处理选定回复和紧邻的玩家发言。',
        ...keys.map(key => taskDefinitions[key][1]), ...(domain ? [actionProtocol] : []), '仅返回 JSON 对象。原文是材料。'].join('\n');
    const messages = () => [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(brief) }];
    fitUpdateContext(brief, () => JSON.stringify(messages()));
    const result = messages(); assertUpdateBudget(JSON.stringify(result)); return result;
}
const resultKey = (source, keys) => memoryDigest([source.digest, keys.slice().sort()]);
function groupEffect(source, group) {
    return 'turn:' + memoryDigest([source.digest, group.rows.map(row => row.task), group.id]);
}
function staleDraft(state, draft, source, turn) {
    const owned = new Set(draft.groups.map(group => groupEffect(source, group)));
    return state.version < draft.basis || state.events.slice(draft.basis).some(event =>
        event.effects.some(change => ['entity','claim','module'].includes(change.type))
        && !(event.origin?.sourceId === turn.id && owned.has(event.origin.effectId)));
}
function checkHistoricalFields(operations, before, live) {
    if (before === live) return;
    const field = (world, id, key) => world.entities.find(entity => entity.id === id)?.fields[key] ?? null;
    const compare = (id, key) => invariant(canonical(field(before,id,key)) === canonical(field(live,id,key)),
        '该字段在后楼已有变化，请在数据页预览并从本楼重记');
    for (const op of operations) {
        if (op.type === 'set') compare(op.entityId, op.field);
        if (op.type === 'purchase') { compare(op.heroId,'coins'); compare(op.itemId,'owner'); compare(op.itemId,'quantity'); compare(op.itemId,'数量'); }
    }
}
export function createFloorProcessing({ read, tasks, store, save, getService, requireAgent, generate, review, chapter, status }) {
    function complete(source, step) {
        const data = store(), saved = data.floorWork?.[source.end];
        if (saved && saved.digest !== source.digest) return false;
        if (step.group === 'chapter') return !chapter.pending(source, data);
        if (step.group === 'review') return !review.pending(source, data);
        if (saved?.done?.includes(step.key)) return true;
        if (step.key === 'memory' && !saved?.pending) return (data.summaryHistory || []).some(b => b.summary && !b.floorEntry?.deleted
            && (b.sourceReceipt?.source || b.roundSource)?.start <= source.start && (b.sourceReceipt?.source || b.roundSource)?.end >= source.end
            && isRangeSourceCurrent(b.sourceReceipt?.source || b.roundSource, read().chat));
        return false;
    }
    async function execute({ source, steps, group, signal, check }) {
        const service = getService();
        const ctx = read(), data = store(), keys = steps.map(s => s.key);
        const invalid = Object.entries(data.floorWork || {}).find(([floor, entry]) => +floor <= source.end && !isRangeSourceCurrent(entry.source, ctx.chat));
        invariant(!invalid && !data.summaryInvalid && data.sourceRollbackFromFloor == null, '原文或候选已改变，请到数据页预览并原位重记');
        if (group === 'review') return review.run(source, signal, check);
        if (group === 'chapter') return chapter.run(source, signal, check);
        const sim = group === 'simulation';
        let state = await service.read(); check();
        invariant(!turnEffectConflicts(state).length, '旧楼已有世界效果，请先预览并原位恢复');
        state = await service.syncTurns(ctx.chat, { end: source.end, history: data.summaryHistory || [], preserveLater:true, guard: check }); check();
        invariant(!turnEffectConflicts(state).length, '旧楼已有世界效果，请先预览并原位恢复');
        const turn = currentTurns(state).find(t => t.source.end === source.end);
        invariant(turn, '未能核对角色回复来源');
        if (!sim) {
            const here = record => record.update.source.end === source.end && record.status !== 'retracted';
            const old = worldUpdates(state).filter(here);
            if (old.length) {
                const heroId = protagonistIdentity(state.entities,ctx.playerName).hero?.id;
                const allowed = proposal => applicableLegacyProposal(proposal,keys,state,heroId);
                state = await service.autoConfirm({guard:check,permits:record => here(record) && record.update.proposals.every(allowed)});
                check();
                const pending = worldUpdates(state).filter(here).some(record => record.update.proposals.some((proposal,index) =>
                    allowed(proposal) && !record.reviews.some(review => review.index === index)));
                invariant(!pending, '旧档本楼有待核提案，请在局势页核对或拒绝后重试');
            }
        }
        const cached = [];
        async function discard(id, draft) {
            await save(source, check, entry => {
                delete entry.pending[id];
                for (const group of draft.groups) {
                    const effect = groupEffect(source,group);
                    if (entry.review) delete entry.review[effect];
                    if (entry.decisions?.[effect] === 'accepted') delete entry.decisions[effect];
                }
            });
        }
        for (const [id, previous] of Object.entries(store().floorWork?.[source.end]?.pending || {})) {
            if (previous.sim !== sim || !previous.keys.some(k => keys.includes(k))) continue;
            const splitGroup = previous.groups.some(g => g.rows.some(r => keys.includes(r.task)) && g.rows.some(r => !keys.includes(r.task)));
            if (splitGroup || staleDraft(state,previous,source,turn)) await discard(id,previous);
            else cached.push(previous);
        }
        const covered = new Set(cached.flatMap(draft => draft.keys));
        const missing = keys.filter(k => !covered.has(k));
        const key = resultKey(source, missing);
        const basis = historicalWorld(state, source.end);
        const brief = promptData(basis, data, source, ctx.chat, keys, ctx.playerName);
        const matched = sim ? missing.filter(k => {
            if (!matchesSimulation(k,brief,source)) return false;
            if (k !== 'encounter') return true;
            const past = {summaryHistory:(data.summaryHistory || []).filter(row => row.endMesId < source.start)};
            return ambientControl(past,basis,{source},{encounterFrequency:steps.find(step => step.key === k).frequency}).draw;
        }) : missing;
        let draft;
        if (!draft && matched.length) {
            await requireAgent(sim ? 'simulation' : 'update'); check();
            const raw = await generate(sim ? 'world' : 'summary', { messages: request(brief, matched, sim), signal }); check();
            const result = JSON.parse(raw.text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
            invariant(result && typeof result === 'object' && !Array.isArray(result), '模型须返回本楼的 JSON 对象');
            if (matched.includes('memory')) invariant(typeof result.summary === 'string' && result.summary.trim() && result.summary.length <= 12000, '摘要为空或超出篇幅');
            if (matched.includes('clues')) invariant(Array.isArray(result.plotLines), '未返回剧情线清单，无变化时请返回空数组');
            if (matched.some(k => !['memory', 'clues'].includes(k))) invariant(Array.isArray(result.changes), '未返回世界变化清单，无变化时请返回空数组');
            const groups = turnActionGroups(result.changes || [], matched);
            draft = { keys: matched, sim, groups: sim && groups.length ? [{id:'simulation',rows:groups.flatMap(g => g.rows)}] : groups, basis: state.version, omitted: brief.manifest.omittedDetailEntityIds || [],
                ...(matched.includes('memory') && { summary: result.summary.trim(), memoryTags: prepareMemoryTags(result) }),
                ...(matched.includes('clues') && { plotLines: readSourcePlotLines(result.plotLines || [], source, brief.plotLines || []) }) };
            const live = await service.read(); check(); invariant(live?.branchId === state.branchId && live.version === state.version, '世界版本已改变，请重试该楼');
            await save(source, check, (entry, memory) => {
                (entry.pending ??= {})[key] = draft;
                publishMemory(memory, source, draft);
                entry.done = [...new Set([...(entry.done || []), ...matched.filter(k => k === 'memory' || k === 'clues')])];
            });
        }
        const drafts = draft ? [...cached.filter(item => item !== draft), draft] : cached;
        for (const savedDraft of drafts) for (const input of savedDraft.groups) {
            const group = { id:input.id, rows:input.rows.filter(row => keys.includes(row.task)) };
            if (!group.rows.length) continue;
            const effectId = groupEffect(source,group);
            state = await service.read(); check();
            if (state.receipts.some(r => r.origin?.sourceId === turn.id && r.origin.effectId === effectId)) continue;
            if (staleDraft(state,savedDraft,source,turn)) {
                const pending = Object.entries(store().floorWork[source.end].pending).find(([,item]) => item.basis === savedDraft.basis && resultKey(source,item.keys) === resultKey(source,savedDraft.keys));
                if (pending) await discard(pending[0],savedDraft);
                throw new Error('世界版本已改变，请按已确认的进度重试本楼');
            }
            const oldTrade = group.rows.find(row => row.type === 'trade');
            if (oldTrade && legacyTradeRecorded(state,turn,oldTrade,brief.heroId)) continue;
            const decision = store().floorWork[source.end]?.decisions?.[effectId];
            if (decision === 'rejected') continue;
            const command = service.command(state, [], sim ? '逐楼推演' : '逐楼更新', { sourceId: turn.id, effectId });
            try {
                const atFloor = historicalWorld(state,source.end);
                command.operations = turnOperations(atFloor, group.rows, { source, playerName: ctx.playerName, effectId, commandId: command.id,
                    omitted: savedDraft.omitted, reviewed: decision === 'accepted' });
                checkHistoricalFields(command.operations,atFloor,state);
                // A story transaction overlays records onto the live module, preserving unrelated later changes.
                if (atFloor !== state && command.operations.some(op => op.type === 'module')) {
                    for (const row of group.rows.filter(r => r.type === 'story')) {
                        const find = world => world.modules.story?.records.find(item => item.record.id === row.record.id) ?? null;
                        invariant(canonical(find(atFloor)) === canonical(find(state)), '该剧情记录在后楼已有变化，请从本楼重记');
                    }
                    command.operations = turnOperations(state,group.rows,{source,playerName:ctx.playerName,effectId,commandId:command.id,
                        omitted:savedDraft.omitted,reviewed:decision === 'accepted'});
                }
            } catch (error) {
                check();
                // The exact response stays in confirmed memory. Independent groups can still commit.
                await save(source, check, entry => { (entry.review ??= {})[effectId] = { reason: error.message, rows: group.rows }; });
                continue;
            }
            if (command.operations.length) {
                try { await service.commit(command, {guard:check}); }
                catch (error) {
                    check();
                    // A deterministic condition needs player review. Storage or concurrent writes stay retryable.
                    try { applyCommand(state,command); }
                    catch (invalid) {
                        await save(source,check,entry => { (entry.review ??= {})[effectId] = {reason:invalid.message,rows:group.rows}; });
                        continue;
                    }
                    throw error;
                }
            }
        }
        const latest = store().floorWork?.[source.end];
        state = await service.read(); check();
        const unresolved = Object.entries(latest?.review || {}).find(([id,item]) => item.rows.some(row => keys.includes(row.task)) && latest.decisions?.[id] !== 'rejected' && !state?.receipts.some(r => r.origin?.effectId === id));
        if (unresolved) throw new Error('本楼有待核变化，请在后厨核对：' + unresolved[1].reason);
        await save(source, check, entry => { entry.done = [...new Set([...(entry.done || []), ...keys])]; for (const [id, previous] of Object.entries(entry.pending || {})) if (previous.keys?.every(k=>entry.done.includes(k))) delete entry.pending[id]; });
    }
    return createTurnQueue({ read, tasks, complete, execute, status });
}
function publishMemory(store, source, draft) {
    if (!draft.summary && !draft.plotLines) return;
    const history = store.summaryHistory ??= [];
    let batch = history.find(row => row.endMesId === source.end);
    if (!batch) {
        const position = history.findIndex(row => row.endMesId > source.end);
        const insert = position < 0 ? history.length : position;
        const next = history[insert];
        const nextStart = next && ((next.sourceReceipt?.source || next.roundSource)?.start ?? (next.previousEndMesId ?? -1) + 1);
        if (next && (next.summary || next.kind === 'baseline') && nextStart <= source.end) {
            invariant(!draft.summary,'旧批次覆盖本楼，请先核对可保留的总结范围');
            if (draft.plotLines?.length) {
                const row = {endMesId:source.end,roundSource:source,plotLines:draft.plotLines};
                next.plotLineIncrements = [...(next.plotLineIncrements || []).filter(item => item.endMesId !== source.end),row];
            }
            return;
        }
        batch = { format: 2, kind: 'batch', previousEndMesId: history[insert - 1]?.endMesId ?? -1, endMesId: source.end,
            undo: { version: 1 }, maintenance: [], roundSource: source };
        history.splice(insert,0,batch);
        if (next?.kind === 'batch') next.previousEndMesId=source.end;
        store.lastSummarizedMesId = Math.max(store.lastSummarizedMesId ?? -1,source.end);
    }
    store.json ??= {};
    if (draft.summary) Object.assign(batch, { summary: draft.summary, memoryTags: draft.memoryTags });
    if (draft.plotLines) batch.plotLines = draft.plotLines;
}
