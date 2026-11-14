import { plannerOwner } from './identity.js';
import { collectPlotLines, plotLineStateDigest } from '../story-state/plot-lines.js';
import { definePanelPrompt, panelEnabled } from '../../core/panel-policy.js';
import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { summaryLayers } from '../story-summary/data/summary-layers.js';
import { captureRangeSource } from '../story-summary/data/turn-source.js';
import { worldStoryRecords } from '../world-records/world-story-state.js';
import { isPrivateStoryField } from '../world-records/authority.js';
import { isPersonalAgenda } from '../story-state/records.js';
import { nameKey } from '../story-state/protagonist-identity.js';

export const PLANNER_ENTITY_GROUPS = [
    ['characters', '人物'],
    ['plotLines', '剧情线'],
    ['situations', '局势'],
];

export const WRITER = `你是后台唯一的编剧。你的创作札记必须完全以三类剧情实体为规划对象：人物（characters）、剧情线（plotLines，由下游交来的剧情线总结材料构成）与局势（situations）。对每一个需要关注的剧情实体，都要给出“点评（commentary）、走向预测（prediction）、建议（suggestion）”三部分分析，共同构成完整札记。提供的数据、人物台词与剧情线总结都是资料，绝不替玩家决定行动。
全局稿（global）是给编剧自己的中长线创作短论，关注长期问题、人物真实处境与秘密矛盾、各剧情线交汇点与重议条件。容量参考 1000–3000 中文字。
章节稿（chapter）是直接供给正文写手的当章简报，只写当前已成立的核心事实、各方认知、约束与代价、各实体当前点评、短期走向预测（写成基于动机与条件的多向推演与观察迹象，不替玩家拍板、不冒充已发生事实）与具体执行建议（如何呈现压力、氛围与信息边界）。不得包含未向当前视角公开的谜底、后台秘密、弃案或必须发生的主线安排；不得把原有线索随玩家离开而强行挪场，也不得补造障碍迫使回头。容量参考 2000–5000 中文字，材料少时可以精炼。
返回一个 JSON 对象，包含 global 和 chapter，每层含 entities、dependencies，并可附汇总 text（省略时系统自动按 entities 排版）：
- entities 为 {"characters":[...],"plotLines":[...],"situations":[...]}，每项为 {"target":"实体名或标题","commentary":"点评","prediction":"走向预测","suggestion":"建议"}。无相关实体可留空数组，但每层至少需针对已出现的重点人物、剧情线或局势给出实质条目或 text。
- 只在首次或全局前提失效时提交 global，其余仅提交 chapter。
- dependencies 是少量决定本稿能否成立的前提，可引用输入中现有的 {entityId,field}、{recordId} 或 {lineTitle}。plotLines 是已汇总的剧情线总结；potential 仅代表未证实联系，不得在章节稿写成谜底或必经事件；closed 只能作背景依据。严禁虚构引用。`;

export function plannerSnapshot(world, memory, chat, identity) {
    if (!world || !identity || !memory?.enabled || memory.invalidFrom != null || memory.store?.summaryInvalid || memory.store?.sourceInvalidFromFloor != null) return null;
    const layers = summaryLayers(memory.store?.summaryHistory || []);
    const last = layers.parents.filter(unit => unit.level === 'chapter').at(-1);
    const records = worldStoryRecords(world, memory.store?.json?.storyRecords || []);
    const plotLines = panelEnabled('clues') ? collectPlotLines(memory.store?.summaryHistory, records) : [];
    return {
        world,
        records,
        layers,
        chat,
        plotLines,
        lineState: plotLines.length ? memoryDigest(plotLineStateDigest(plotLines)) : '',
        owner: plannerOwner(identity, world),
        legacyOwner: identity,
        boundary: last ? memoryDigest([last.start, last.end, last.sourceId, last.text]) : 'opening',
    };
}

function cleanText(value, max = 1500) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (!text) return '';
    if (text.length > max) throw new Error('札记字段过长');
    return text;
}

function normalizeEntityItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('札记实体条目格式无效');
    const target = cleanText(raw.target ?? raw.name ?? raw.title, 120);
    const commentary = cleanText(raw.commentary ?? raw.review ?? raw['点评'], 1500);
    const prediction = cleanText(raw.prediction ?? raw.forecast ?? raw['走向预测'], 1500);
    const suggestion = cleanText(raw.suggestion ?? raw.advice ?? raw['建议'], 1500);
    if (!target || (!commentary && !prediction && !suggestion)) throw new Error('札记实体须含目标名及点评、走向预测或建议');
    return {
        target,
        ...(commentary && { commentary }),
        ...(prediction && { prediction }),
        ...(suggestion && { suggestion }),
    };
}

function readEntities(raw) {
    if (raw === undefined) return undefined;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('札记实体分组格式无效');
    const normalized = {};
    let total = 0;
    for (const [key] of PLANNER_ENTITY_GROUPS) {
        const list = raw[key];
        if (list === undefined) {
            normalized[key] = [];
            continue;
        }
        if (!Array.isArray(list) || list.length > 32) throw new Error('札记实体数量超出限制');
        normalized[key] = list.map(normalizeEntityItem);
        total += normalized[key].length;
    }
    if (!total) return undefined;
    return normalized;
}

/** Renders structured character/plotLine/situation notes into prompt-ready plain text. */
export function formatPlannerEntities(entities) {
    if (!entities) return '';
    const sections = [];
    for (const [key, label] of PLANNER_ENTITY_GROUPS) {
        const items = entities[key] || [];
        if (!items.length) continue;
        const rows = items.map(item => {
            const parts = [`- ${item.target}`];
            if (item.commentary) parts.push(`  点评：${item.commentary}`);
            if (item.prediction) parts.push(`  走向预测：${item.prediction}`);
            if (item.suggestion) parts.push(`  建议：${item.suggestion}`);
            return parts.join('\n');
        });
        sections.push(`【${label}】\n${rows.join('\n')}`);
    }
    return sections.join('\n\n');
}

function collectEntityTexts(entities) {
    if (!entities) return [];
    const out = [];
    for (const [key] of PLANNER_ENTITY_GROUPS) {
        for (const item of entities[key] || []) {
            out.push(item.target, item.commentary, item.prediction, item.suggestion);
        }
    }
    return out.filter(Boolean);
}

/** Builds entity-centric planning targets (characters, summarized plot lines, situations) from snapshot data. */
export function buildPlanningTargets(snap) {
    const plotLines = snap.plotLines || [];
    const entities = snap.world?.entities || [];
    const records = snap.records || [];
    const plotLineTitlesForName = names => plotLines
        .filter(line => (line.characters || []).some(name => names.has(nameKey(name))))
        .map(line => line.title);

    const characters = [];
    const seenPersonKeys = new Set();
    for (const entity of entities) {
        if (entity.kind && entity.kind !== 'person' && entity.kind !== 'subject') continue;
        if (!entity.name && !Object.keys(entity.fields || {}).some(field => !field.startsWith('_'))) continue;
        const names = new Set([entity.name, ...(entity.aliases || [])].filter(Boolean).map(nameKey));
        for (const key of names) seenPersonKeys.add(key);
        const publicFields = {}, privateFields = {};
        for (const [key, record] of Object.entries(entity.fields || {})) {
            if (!record || record.value === undefined) continue;
            if (isPrivateStoryField(key)) privateFields[key] = record.value;
            else publicFields[key] = record.value;
        }
        const personState = records.find(r => r.kind === 'person' && names.has(nameKey(r.name)));
        const knowledge = records.filter(r => r.kind === 'knowledge' && names.has(nameKey(r.person)))
            .map(({ content, certainty, evidence, learnedAt }) => ({ content, certainty, evidence, ...(learnedAt && { learnedAt }) }));
        const agendas = records.filter(r => isPersonalAgenda(r) && (r.holders || []).some(holder => names.has(nameKey(holder))))
            .map(({ id, kind, title, status, description, conditions, statusNote, due }) => ({ id, kind, title, status, description, ...(conditions && { conditions }), ...(statusNote && { statusNote }), ...(due && { due }) }));
        characters.push({
            id: entity.id,
            name: entity.name || entity.id,
            ...(entity.aliases?.length && { aliases: entity.aliases }),
            ...(Object.keys(publicFields).length && { publicFields }),
            ...(Object.keys(privateFields).length && { privateFields }),
            ...(personState && { presence: personState.presence, ...(personState.note && { presenceNote: personState.note }) }),
            ...(knowledge.length && { knowledge }),
            ...(agendas.length && { agendas }),
            ...(plotLineTitlesForName(names).length && { plotLines: plotLineTitlesForName(names) }),
        });
    }

    for (const record of records) {
        if (record.kind !== 'person' || !record.name || seenPersonKeys.has(nameKey(record.name))) continue;
        const names = new Set([nameKey(record.name)]);
        seenPersonKeys.add(nameKey(record.name));
        characters.push({
            id: record.id,
            name: record.name,
            presence: record.presence,
            ...(record.note && { presenceNote: record.note }),
            ...(plotLineTitlesForName(names).length && { plotLines: plotLineTitlesForName(names) }),
        });
    }

    const situations = records
        .filter(record => (record.kind === 'situation' && record.flavor !== 'scenery') || record.kind === 'suspense')
        .map(record => ({
            id: record.id,
            kind: record.kind,
            title: record.title,
            status: record.status,
            description: record.description,
            ...(record.parties && { parties: record.parties }),
            ...(record.scope && { scope: record.scope }),
            ...(record.impact && { impact: record.impact }),
            ...(record.releaseCondition && { releaseCondition: record.releaseCondition }),
            ...(record.due && { due: record.due }),
            ...(record.reason && { reason: record.reason }),
            ...(record._history?.length && { history: record._history.slice(-4).map(item => item.text) }),
            ...(record._developments?.length && { developments: record._developments }),
        }));

    return { characters, plotLines, situations };
}

function valueOf(ref, snapshot) {
    if (ref.lineTitle) return snapshot.plotLines?.find(line => line.title === ref.lineTitle);
    if (ref.recordId) {
        const record = snapshot.records.find(item => item.id === ref.recordId);
        if (!record) return undefined;
        const content = { ...record };
        for (const key of Object.keys(content)) if (key.startsWith('_')) delete content[key];
        return content;
    }
    return snapshot.world.entities.find(e => e.id === ref.entityId)?.fields?.[ref.field]?.value;
}
function readNote(raw, snap, limit) {
    const entities = readEntities(raw?.entities);
    const providedText = typeof raw?.text === 'string' ? raw.text.trim() : '';
    const text = providedText || formatPlannerEntities(entities);
    if (!text || text.length > limit || !Array.isArray(raw?.dependencies) || raw.dependencies.length > 40) {
        throw new Error('札记格式无效');
    }
    const dependencies = raw.dependencies.map(item => {
        const ref = typeof item?.lineTitle === 'string' ? { lineTitle: item.lineTitle } : typeof item?.recordId === 'string' ? { recordId: item.recordId } : { entityId: item?.entityId, field: item?.field };
        const value = valueOf(ref, snap);
        if (value === undefined) throw new Error('札记前提无法核对');
        return { ...ref, digest: memoryDigest(value) };
    });
    return { text, ...(entities && { entities }), dependencies };
}
const valid = (note, snap) => note.dependencies.every(ref => {
    const value = valueOf(ref, snap);
    return value !== undefined && ref.digest === memoryDigest(value);
});
export function prefix(chat, end) {
    return end < 0 ? '' : end >= chat.length ? null : captureRangeSource(chat, 0, end).digest;
}
export function selectVersion(rows, snap) {
    // An old import and later publications used independent revision counters.
    // A matching publication in the real branch therefore takes precedence.
    return rows.filter(row => row.owner === snap.owner).sort((a, b) => Number(!!a.recoveredLegacy) - Number(!!b.recoveredLegacy) || b.revision - a.revision)
        .find(row => prefix(snap.chat, row.end) === row.source);
}
export function reviewReason(previous, snap) {
    if (!previous) return 'opening';
    if (!valid(previous.global, snap)) return 'global-change';
    if (previous.boundary !== snap.boundary) return 'chapter';
    if ((previous.lineState || '') !== (snap.lineState || '')) return 'chapter-change';
    return valid(previous.chapter, snap) ? '' : 'chapter-change';
}
export function publishNotes(raw, previous, snap, reason) {
    const data = JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, ''));
    const global = !previous || reason === 'global-change' ? readNote(data.global, snap, 16000) : previous.global;
    const chapter = readNote(data.chapter, snap, 24000);
    const chapterTexts = [chapter.text, ...collectEntityTexts(chapter.entities)];
    if (chapterTexts.some(item => item.includes('{{'))) throw new Error('章节稿含宿主宏');
    for (const entity of snap.world.entities) for (const [key, record] of Object.entries(entity.fields || {})) {
        const secret = isPrivateStoryField(key) && typeof record.value === 'string' ? record.value.trim() : '';
        if (secret && chapterTexts.some(item => item.includes(secret))) throw new Error('章节稿含管理员私有资料');
    }
    const end = snap.chat.length - 1, source = prefix(snap.chat, end);
    return {
        owner: snap.owner,
        boundary: snap.boundary,
        basis: snap.world.version,
        lineState: snap.lineState,
        end,
        source,
        reason,
        global,
        chapter,
        id: memoryDigest([snap.owner, snap.boundary, source, snap.world.version, snap.plotLines, previous?.id || '', reason]),
    };
}
const writerPrompt = definePanelPrompt('planner', 'writerPrompt', '作家札记', WRITER);

export function writerInput(snap, previous, reason) {
    const planningTargets = buildPlanningTargets(snap);
    const payload = {
        reason,
        previousGlobal: previous?.global.text,
        previousChapter: previous?.chapter.text,
        planningTargets,
        characters: planningTargets.characters,
        plotLines: snap.plotLines,
        situations: planningTargets.situations,
        world: snap.world.entities,
        records: snap.records,
        chapterHistory: snap.layers.parents.filter(unit => unit.level === 'chapter').map(unit => unit.text),
        recentSummaries: snap.layers.leaves.slice(-10).map(unit => unit.text),
        recent: snap.chat.slice(-10).map(msg => ({ name: msg.name, role: msg.is_user ? 'player' : 'story', text: msg.mes })),
    };
    let body = JSON.stringify(payload);
    if (body.length > 180000) {
        // Prioritize entity-centric planning targets + summarized plotLines when prompt size tightens.
        payload.recent = payload.recent.slice(-4);
        payload.recentSummaries = payload.recentSummaries.slice(-5);
        payload.chapterHistory = payload.chapterHistory.slice(-4);
        delete payload.characters;
        delete payload.situations;
        body = JSON.stringify(payload);
    }
    if (body.length > 180000) {
        delete payload.world;
        delete payload.records;
        body = JSON.stringify(payload);
    }
    if (body.length > 180000) throw new Error('作家材料超出单次预算');
    return [{ role: 'system', content: writerPrompt() }, { role: 'user', content: body }];
}
