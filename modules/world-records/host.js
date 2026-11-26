import {historicalWorld} from './historical.js';
import { createNoteStore } from '../story-planner/storage.js';
import { createWorldCardData } from '../kitchen-data/world.js';
import { createWorldRecoveryPanel } from './recovery-panel.js';
import { plannerSnapshot } from '../story-planner/notes.js';
import { ambientControl, ambientPrompt, mapLocalConditions } from '../story-state/ambient.js';
import { readInvolvement } from '../story-state/involvement.js';
import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { registerInvolvement, registerMapActors, registerMapConditions, registerSituationCatalog } from '../story-state/situation-links.js';
import { availableStoryRecords } from '../story-state/records.js';
import { resolveStateInjectionDepth } from './authority.js';
import { worldStoryRecords } from './world-story-state.js';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createProtagonistView, createSuspenseBook } from '../story-state/view.js';
import { memoryRecords } from './imports.js';
import { readWorldSources, registerWorldSource, registerWorldAuthority, storyIdentityKey, subscribeWorldSources } from './sources.js';
import { createAuthorityRuntime } from './authority-runtime.js';
import { captureStoryIdentity } from '../xiaobai-os/host/story-identity.js';
import { registerWorldBridge, publishWorldBridgeState } from './bridge.js';
import { registerTurnRuntime } from './turn-runtime.js';
import { prepareTurnOperations, turnById } from './turn-ledger.js';
import { getSummarySourceEnd } from '../story-summary/generate/source-boundary.js';
import { captureRangeSource, isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { buildUpdateContext, UPDATE_PREFIX } from './update-context.js';

export function createWorldArchive({ getContext, createOpening, getAccountId = () => 'default-user', getMemorySnapshot, getAmbientPreferences, active = () => true, ordered = false, recoverMemory, getMount, isVisible, onError, onAuthorityChange = () => {}, openModal = null, onNavigate = null }) {
    const sourceIdentity = () => storyIdentityKey(captureStoryIdentity(getContext()));
    const identity = (branch = getMemorySnapshot()?.store?.dataBranch) => { const story = sourceIdentity(); return story ? JSON.stringify([getAccountId(), story, ...(branch ? [branch] : [])]) : ''; };
    const storage = createWorldStorage();
    let authority, recoveryPanel, latestState = null, views;
    const service = createWorldService({ storage, getIdentity: identity, isSourceCurrent: turn => !!turn
        && isRangeSourceCurrent(turn.source, getContext().chat || [])
        && getSummarySourceEnd(getContext().chat, turn.source.end) >= turn.source.end,
        isUpdateSourceCurrent: update => !!update && isRangeSourceCurrent(update.source, getContext().chat || [])
            && getSummarySourceEnd(getContext().chat, update.source.end) >= update.source.end,
        getReviewContext: () => {
            const snapshot = getMemorySnapshot();
            return { heroId: protagonistIdentity(latestState?.entities || [],getContext().name1).hero?.id, available: !!snapshot?.enabled && snapshot.invalidFrom === undefined && !snapshot.store?.summaryInvalid,
                history: snapshot?.store?.summaryHistory || [], storyRecords: snapshot?.store?.json?.storyRecords || [] };
        }, onChanged: (state, owner) => {
        if (owner === identity()) {
            latestState = state;
            if (isVisible('data')) recoveryPanel?.noteChange(state);
            // WHY: the workspace keeps these read-only pages open while a send
            // settlement commits a new world version; redraw them in place.
            refreshVisibleViews(state);
        }
        authority?.publish(state, owner);
        publishWorldBridgeState(sourceIdentity(), owner, state);
    } });
    const recoveryStamp=()=>{
        const chat=getContext().chat || [], memory=getMemorySnapshot();
        return memoryDigest({chat:chat.length ? captureRangeSource(chat,0,chat.length-1) : null,
            end:getSummarySourceEnd(chat,chat.length-1),enabled:!!memory?.enabled,invalidFrom:memory?.invalidFrom ?? null,
            history:memory?.store?.summaryHistory || [],data:memory?.store?.json || null});
    };
    recoveryPanel = createWorldRecoveryPanel({service,getIdentity:identity,getStamp:recoveryStamp,
        previewMemory:()=>recoverMemory?.()?.summaryRecoveryPreview(),
        restoreMemory:async plan=>{const owner=identity(); await recoverMemory().recoverSummaryTail(getContext().chatId,plan.token,()=>{if(owner!==identity()) throw new Error('聊天已切换');});
            globalThis.window?.dispatchEvent?.(new Event('tavernKitchen:floor-settings'));},
        onRestored:()=>{ globalThis.window?.dispatchEvent?.(new Event('tavernKitchen:floor-settings')); },readState:async()=>{
        const owner=identity(),token=epoch,scope=service.scopeVersion(),stamp=recoveryStamp(),input=observation();
        const current=()=>!disposed && token===epoch && owner===identity() && scope===service.scopeVersion() && stamp===recoveryStamp();
        const existing=await service.read();
        if (!current()) throw new Error('聊天、总结或世界版本已变化，请重试');
        if (!existing) return null;
        if (!input.snapshot?.enabled || !input.snapshot.store) throw new Error('剧情资料尚未就绪，请稍后重新读取');
        if (ordered) {
            // Reconciliation for a preview must not append receipts to an imported archive.
            let sequence = 0;
            const operations = prepareTurnOperations(existing,input.chat,{end:input.end,history:input.snapshot.store.summaryHistory || [],
                id:() => 'preview:' + ++sequence});
            const sources = {...existing.sources};
            for (const op of operations) sources[op.module] = op.snapshot;
            return {...existing,sources};
        }
        const state=await service.syncTurns(input.chat,{end:input.end,history:input.snapshot?.store?.summaryHistory || [],
            memoryAvailable:!!input.snapshot?.enabled,guard:current});
        if (!current()) throw new Error('聊天、总结或世界版本已变化，请重试');
        return state;
    }});
    const initialize = createOpening?.({getContext,identity,service});
    const unregisterBridge = registerWorldBridge(() => ({ storyIdentity: sourceIdentity(), identity: identity(), service }));
    authority = createAuthorityRuntime({ getIdentity: identity, getStoryIdentity: sourceIdentity, sync: async () => {
        const state = await sync(); if (state) service.assertSourcesConsistent(state); return state;
    }, onChange: onAuthorityChange });
    const unregisterAuthority = registerWorldAuthority('world-records', authority.read);
    const unregisterConditions = registerMapConditions((key, atlas) => key && key === captureStoryIdentity(getContext())?.key
        ? mapLocalConditions(authority.read()?.state, getMemorySnapshot(), atlas) : []);
    const unregisterActors = registerMapActors((key, atlas) => {
        if (!key || key !== captureStoryIdentity(getContext())?.key || !atlas?.locations?.length) return [];
        const world = authority.read()?.state;
        const locations = atlas.locations || [];
        const locByKey = new Map(locations.map(loc => [loc.key, loc]));
        const locByName = new Map(locations.map(loc => [String(loc.name || '').trim().toLowerCase(), loc]));
        const out = [];
        const seen = new Set();
        const heroId = protagonistIdentity(world?.entities || [], getContext().name1).hero?.id || '';
        for (const entity of world?.entities || []) {
            if (entity.kind !== 'person') continue;
            const locField = entity.fields?.['当前位置'] || entity.fields?.location;
            if (locField?.nature !== 'established_fact') continue;
            const raw = locField.value;
            const candidateKey = raw?.entityId || '';
            const candidateName = raw?.entityId
                ? (world.entities.find(item => item.id === raw.entityId)?.name || '')
                : (typeof raw === 'string' ? raw.trim() : '');
            const matched = (candidateKey && locByKey.get(candidateKey))
                || (candidateName && locByName.get(candidateName.toLowerCase()));
            if (!matched) continue;
            const dedupe = `${entity.id}:${matched.key}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            out.push({ id: entity.id, name: entity.name, locationKey: matched.key, locationName: matched.name, isPlayer: entity.id === heroId });
        }
        return out;
    });
    const unregisterCatalog = registerSituationCatalog(key => {
        if (!key || captureStoryIdentity(getContext())?.key !== key) return [];
        const memory = getMemorySnapshot();
        const baseline = memory?.enabled ? availableStoryRecords(memory.store, memory.invalidFrom) : [];
        return worldStoryRecords(authority.read()?.state, baseline).filter(record => record.kind === 'situation')
            .map(({ id, title }) => ({ id, title }));
    });
    const involvementFor = (world, options) => readInvolvement(world, getMemorySnapshot(), getContext().name1, options);
    const disconnectFocus = registerInvolvement(key => key && captureStoryIdentity(getContext())?.key === key ? involvementFor(authority.read()?.state, {includeAgendas:true}) : []);
    const protagonist = createProtagonistView({
        getInvolvement: involvementFor,
        getSnapshot: getMemorySnapshot,
        getPlayerName: () => getContext().name1,
        onOpenPlace: onNavigate ? target => onNavigate('map', { placeKey: target.key, placeName: target.name }) : null,
        onOpenPerson: onNavigate ? target => onNavigate('people', { personId: target.id, personName: target.name }) : null,
    });
    const bookOptions = {getSnapshot:getMemorySnapshot, openSource(floor) {
        const context = getContext(), message = context.chat?.[floor], snapshot = getMemorySnapshot();
        const available = message && snapshot?.enabled && snapshot.invalidFrom == null && !snapshot.store?.summaryInvalid && snapshot.store?.sourceInvalidFromFloor == null;
        const bodyText = available ? String(message.mes || '') : '当前聊天无法核对这条原文。';
        if (typeof openModal === 'function') {
            openModal({
                title: `第 ${floor + 1} 楼原文`,
                subtitle: available && message.name ? `${message.name} · 第 ${floor + 1} 楼` : '',
                text: bodyText,
            });
            return;
        }
        const content = document.createElement('div'), title = document.createElement('h3'), text = document.createElement('p');
        title.textContent = '第 ' + (floor + 1) + ' 楼' + (available && message.name ? ' · ' + message.name : '');
        text.style.whiteSpace = 'pre-wrap';
        text.textContent = bodyText;
        content.append(title, text);
        return new context.Popup(content, context.POPUP_TYPE.TEXT).show().catch(onError);
    }};
    views = { overview: protagonist, suspense: createSuspenseBook(bookOptions) };
    let disposed = false, scheduled = false, epoch = 0;
    const surfaceBindings = new Map();
    function attachSurfaceMount(key, surfaceHost, mount) {
        if (!surfaceHost || disposed) return;
        const previous = surfaceBindings.get(key);
        if (previous?.host !== surfaceHost) {
            if (previous?.onReady) {
                previous.host.removeEventListener?.('tk-surface-ready', previous.onReady);
                previous.host.removeEventListener?.('load', previous.onReady);
            }
            surfaceBindings.set(key, { host: surfaceHost, onReady: mount });
            surfaceHost.addEventListener?.('tk-surface-ready', mount);
            surfaceHost.addEventListener?.('load', mount);
        }
        mount();
    }
    function showRecovery(surfaceHost) {
        attachSurfaceMount('recovery', surfaceHost, () => {
            if (disposed || !isVisible('data')) return;
            const target = surfaceHost.shadowRoot?.getElementById?.('world-recovery')
                || surfaceHost.querySelector?.('#world-recovery')
                || surfaceHost.contentDocument?.getElementById?.('world-recovery');
            if (!target) return;
            recoveryPanel.mount(target);
            recoveryPanel.refresh().catch(onError);
        });
    }
    const observation = () => {
        const context = getContext(), chat = context.chat || [], snapshot = getMemorySnapshot();
        return { chat, snapshot, end: getSummarySourceEnd(chat, chat.length - 1) };
    };
    // Read-only pages redraw from the committed projection; a page may already be
    // the active workspace route before its frame mount has run once.
    function refreshVisibleViews(state) {
        for (const [route, view] of Object.entries(views || {})) {
            if (!isVisible(route) || view.isEditing()) continue;
            const mount = typeof getMount === 'function' ? getMount(route) : null;
            if (!mount) continue;
            view.mount(mount);
            if (state) view.show(state); else view.empty();
        }
    }
    const observationDigest = value => memoryDigest({ source: value.end >= 0 ? captureRangeSource(value.chat, 0, value.end) : null, length: value.chat.length,
        end: value.end, enabled: !!value.snapshot?.enabled, invalidFrom: value.snapshot?.invalidFrom ?? null, history: value.snapshot?.store?.summaryHistory || [] });
    async function sync() {
        const key = identity(), token = epoch; if (!key || disposed) return null;
        if (ordered) return service.read();
        for (let attempt = 0; attempt < 3; attempt++) {
            const input = observation(), digest = observationDigest(input);
            try {
                await service.syncTurns(input.chat, { end: input.end, history: input.snapshot?.store?.summaryHistory || [],
                    memoryAvailable: !!input.snapshot?.enabled,
                    guard: () => token === epoch && key === identity() && !disposed && observationDigest(observation()) === digest });
                await service.autoConfirm({ guard: () => token === epoch && key === identity() && !disposed && observationDigest(observation()) === digest });
            } catch (error) {
                if (token === epoch && key === identity() && !disposed && observationDigest(observation()) !== digest) continue;
                throw error;
            }
            if (token !== epoch || key !== identity() || disposed) throw new Error('正文来源读取期间对话已切换');
            if (observationDigest(observation()) !== digest) continue;
            const state = await service.sync(readWorldSources().filter(s => s.identity === sourceIdentity()));
            return token === epoch && key === identity() && !disposed ? state : null;
        }
        throw new Error('正文来源仍在变化，请稍后重试');
    }
    function recoveryScope() {
        return JSON.stringify([identity(), epoch, service.scopeVersion(), latestState?.branchId ?? null]);
    }
    async function prepareRecovery(scope) {
        const owner = identity(), token = epoch, generation = service.scopeVersion();
        const changed = () => new Error('聊天或世界版本已变化，请重新核对恢复范围。');
        if (!owner || disposed || scope !== recoveryScope()) throw changed();
        const state = await service.read();
        if (scope !== recoveryScope()) throw changed();
        function assertCurrent() {
            if (disposed || owner !== identity() || token !== epoch || generation !== service.scopeVersion()
                || state && state.branchId !== latestState?.branchId) throw changed();
            const chat = getContext().chat || [];
            for (const receipt of latestState?.receipts || []) if (receipt.origin) {
                const turn = turnById(latestState, receipt.origin.sourceId);
                if (turn?.status !== 'current' || !isRangeSourceCurrent(turn.source, chat)
                    || getSummarySourceEnd(chat, turn.source.end) < turn.source.end) {
                    throw new Error('已确认的世界效果关联了变动的原文，请先到「数据 → 世界版本与恢复」核对。');
                }
            }
        }
        assertCurrent();
        return assertCurrent;
    }
    const unregisterTurns = registerTurnRuntime({ recoveryScope, prepareRecovery, async prepare(start, end, { unified = false } = {}) {
        const owner = identity(), token = epoch, scope = service.scopeVersion();
        if (!owner || disposed) throw new Error('请先选择对话后整理记忆');
        const state = await sync();
        if (!state) throw new Error('世界来源尚未就绪');
        const receipt = service.memorySourceReceipt(state, getContext().chat, start, end);
        if (unified) service.assertSourcesConsistent(state);
        const memorySnapshot = getMemorySnapshot(), store = memorySnapshot?.store;
        if (unified && (!memorySnapshot?.enabled || !store || memorySnapshot.invalidFrom !== undefined)) throw new Error('剧情记忆或原文来源尚未就绪，不能读取完整更新基线，请先完成恢复');
        const memoryVersion = snapshot => memoryDigest([snapshot?.json || {}, (snapshot?.summaryHistory || []).map(batch =>
            [batch.endMesId, batch.summary, batch.roundRevisions, batch.layers, batch.reviewLayers, batch.memoryTags,
                batch.floorEntry?.omitted, batch.floorEntry?.deleted, batch.legacyRoundChanges, batch.legacyRoundBase, batch.importedRounds,
                batch.involvement, batch.ambient])]);
        const memoryBasis = unified ? memoryVersion(store) : '';
        const prefs = getAmbientPreferences?.();
        const updateContext = unified ? buildUpdateContext(state, store, getContext().chat, receipt, memorySnapshot.keepVisibleTurns, {
            involvementContext: involvementFor(state),
            playerNames: [...protagonistIdentity(state.entities,getContext().name1).names],
            ...(prefs && { ambientControl: ambientControl(store, state, receipt, prefs) }),
        }) : null;
        const assertCurrent = () => {
            if (disposed || owner !== identity() || token !== epoch || scope !== service.scopeVersion()
                || latestState?.worldId !== state.worldId || latestState?.branchId !== state.branchId
                || !isRangeSourceCurrent(receipt.source, getContext().chat || [])
                || getSummarySourceEnd(getContext().chat, end) < end) throw new Error('聊天、世界版本或正文来源已变化，本次记忆未写入');
            if (unified && (latestState?.version !== state.version || memoryVersion(getMemorySnapshot()?.store) !== memoryBasis)) {
                throw new Error('完整世界或记忆基线已更新，本次整理结果未保存，请重新整理');
            }
        };
        assertCurrent();
        return { receipt, updateContext, getAmbientPreferences, assertCurrent, async validate() { await service.read(); assertCurrent(); },
            async deliver() {
                if (disposed || owner !== identity() || token !== epoch || scope !== service.scopeVersion()) throw new Error('当前世界已变化，提案仍保留在原摘要批次中');
                const delivered = await sync();
                return delivered?.sources[`${UPDATE_PREFIX}${receipt.id}`] || null;
            } };
    } });
    const unregisterMemory = registerWorldSource('memory', () => {
        const snapshot = getMemorySnapshot();
        return { available: !!snapshot?.enabled, identity: sourceIdentity(), label: '剧情记忆', records: snapshot?.invalidFrom === undefined ? memoryRecords(snapshot?.store) : [] };
    });
    const unsubscribe = subscribeWorldSources(() => {
        if (scheduled || disposed || !active()) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            sync().then(state => refreshVisibleViews(state)).catch(error => onError(error));
        });
    });
    const noteStore = createNoteStore();
    return {
        service,
        storage,
        noteStore,
        cardData: createWorldCardData({ identity, storage, service, noteStore }),
        showRecovery,
        initialize,
        plannerSnapshot(end) {
            const ctx = getContext(), chat = ctx.chat || [], memory = getMemorySnapshot();
            let world = authority.read()?.state, view = memory, evidence = chat;
            if (world && Number.isInteger(end)) {
                world = historicalWorld(world,end); evidence = chat.slice(0,end+1);
                const store = memory?.store || {};
                view = {...memory,store:{...store,summaryHistory:(store.summaryHistory || []).filter(row=>row.endMesId<=end),
                    floorSimulations: Object.fromEntries(Object.entries(store.floorSimulations || {}).filter(([k]) => Number(k) <= end)),
                    lastSummarizedMesId: Math.min(store.lastSummarizedMesId ?? -1, end),
                    json:{...store.json,storyRecords:(store.json?.storyRecords || []).filter(row=>Number.isInteger(row._addedAt) && row._addedAt<=end)}}};
            }
            const snap = plannerSnapshot(world, view, evidence, identity());
            if (snap) {
                const card = ctx.characters?.[ctx.characterId];
                snap.cast = { player: ctx.name1, character: ctx.name2, description: card?.description,
                    personality: card?.personality, scenario: card?.scenario };
            }
            return snap;
        },
        async loadPlannerSnapshot(create = false) {
            if (!identity() || disposed || authority.read()) return;
            if (create) await service.ensure(); else await service.read();
        },
        async prepare(query, tasks) {
            const factText = await authority.prepare(query, getContext().name1, state => involvementFor(state), {tasks});
            const state = authority.read()?.state, memory = getMemorySnapshot();
            const local = (!tasks || tasks.some(key=>['peopleEvolution','subscribed','sceneryEvolution','encounter','simulation'].includes(key))) && state && memory?.enabled && memory.invalidFrom == null
                ? ambientPrompt(memory.store, state, worldStoryRecords(state, availableStoryRecords(memory.store)), getAmbientPreferences?.() || {})
                : '';
            const raw = [factText, local].filter(Boolean).join('\n');
            if (!raw) return '';
            return `[以下为只读当前状态简报，仅帮你对齐事实与角色知情范围，严禁在正文中复述或仿写状态格式]\n${raw}\n[简报结束：请作为已了解上述前情的叙述者自然续写]`;
        },
        async prepareInjection(query, type, tasks) {
            const value = await this.prepare(query,tasks);
            if (!value) return '';
            return { value, depth: resolveStateInjectionDepth(getContext().chat, getMemorySnapshot(), type) };
        },
        async open(route = 'overview') {
            const view = views[route]; if (!view) return;
            view.mount(getMount(route));
            if (!identity()) { view.empty(); return; }
            const state = active() ? await sync() : await service.read(); if (isVisible(route) && !disposed) { if (state) view.show(state); else view.empty(); }
        },
        reset() { epoch++; latestState = null; recoveryPanel.reset(); service.invalidate(); authority.reset(); for (const view of Object.values(views)) view.reset(); },
        dispose() { disposed = true; for (const binding of surfaceBindings.values()) { binding.host.removeEventListener?.('tk-surface-ready', binding.onReady); binding.host.removeEventListener?.('load', binding.onReady); } surfaceBindings.clear(); recoveryPanel.reset(); service.invalidate(); authority.reset(); disconnectFocus(); unregisterConditions(); unregisterActors(); unregisterCatalog(); unregisterTurns(); unregisterBridge(); unregisterAuthority(); unsubscribe(); unregisterMemory(); for (const view of Object.values(views)) view.reset(); storage.close().catch(error => onError(error)); },
    };
}
