import { importantPossession, POSSESSION_ROLES } from '../world-records/person-fields.js';
import { plannerOwner } from './identity.js';
import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { summaryLayers } from '../story-summary/data/summary-layers.js';
import { captureRangeSource } from '../story-summary/data/turn-source.js';
import { worldStoryRecords } from '../world-records/world-story-state.js';
import { isPrivateStoryField } from '../world-records/authority.js';
import { isPersonalAgenda } from '../story-state/records.js';
import { nameKey, protagonistIdentity } from '../story-state/protagonist-identity.js';

export const PLANNER_ENTITY_GROUPS = [
    ['characters', '人物'],
    ['situations', '局势'],
];

export const WRITER = `你是后台唯一的编剧。你不再依赖“剧情线”，而是直接结合三大材料对两类核心目标进行规划：人物（characters）与局势（situations）。对每一个需要关注的实体，都要给出“点评（commentary）、走向预测（prediction）、建议（suggestion）”三部分分析，共同构成完整札记。提供的数据、人物台词与原文都是资料，绝不替玩家决定行动。
三大输入材料：
1. 世界状态（planningTargets、world、records）：权威实体属性、位置、私密设定、人物认知、议程、当前局势与悬念。
2. 剧情总结（layeredSummaries、recentSummaries）：按层级归拢的历史章节/阶段概要及最近尚未继续压缩的 L0 单楼摘要。
3. 相关原文（recent、recalledProse）：近期主楼正文与同楼后台正文（backgroundText），以及按当前焦点召回的早期关键原文片段（[后台正文]为同楼推演延伸）。
全局稿（global）是给编剧自己的中长线创作短论，关注长期问题、人物真实处境与秘密矛盾、局势演化与重议条件。容量参考 1000–3000 中文字。
章节稿（chapter）是直接供给正文写手的当章简报，只写当前已成立的核心事实、各方认知、约束与代价、各实体当前点评、短期走向预测（写成基于动机与条件的多向推演与观察迹象，不替玩家拍板、不冒充已发生事实）与具体执行建议（如何呈现压力、氛围与信息边界）。不得包含未向当前视角公开的谜底、后台秘密、弃案或必须发生的主线安排；不得把原有线索随玩家离开而强行挪场，也不得补造障碍迫使回头。容量参考 2000–5000 中文字，材料少时可以精炼。
返回一个 JSON 对象，包含 global 和 chapter，每层含 entities、dependencies，并可附汇总 text（省略时系统自动按 entities 排版）：
- entities 为 {"characters":[...],"situations":[...]}，每项为 {"target":"实体名或标题","commentary":"点评","prediction":"走向预测","suggestion":"建议"}。无相关实体可留空数组，但每层至少需针对已出现的重点人物或局势给出实质条目或 text。
- 在 opening、global-change 与 chapter（章节推进）时须同时提交 global 与 chapter，以最新章节总结同步更新全局推演；仅在 chapter-change 时只提交 chapter。
- dependencies 是少量决定本稿能否成立的前提，仅支持两类引用：人物/世界实体 {entityId,field}（field 可取实体字段名或 name/aliases/presence/knowledge/agendas）、局势/记录 {recordId,field?}（可指定 status/description/releaseCondition/due/presence/note 等字段或省略整条）。严禁虚构引用。
- 当输入包含 mode:"partial" 及 staleTargets（与 previousChapterEntities）时，仅需在 chapter.entities 中输出受影响的变更目标或新增目标及其对应 dependencies；每个请求目标必须作答；明确移除须在 chapter.removed 的对应分类列出目标，不能借缺项删除。不得改动其他目标及依赖。`;

export function plannerSnapshot(world, memory, chat, identity, options = {}) {
    if (!world || !identity || !memory?.enabled || memory.invalidFrom != null || memory.store?.summaryInvalid
        || memory.store?.sourceInvalidFromFloor != null || memory.store?.sourceRollbackFromFloor != null) return null;
    const layers = summaryLayers(memory.store?.summaryHistory || [], [], { chat });
    const last = layers.parents.filter(unit => unit.level === 'chapter').at(-1);
    const records = worldStoryRecords(world, memory.store?.json?.storyRecords || []);
    return {
        world,
        records,
        layers,
        chat,
        floorSimulations: memory.store?.floorSimulations || {},
        lastSummarizedMesId: memory.store?.lastSummarizedMesId ?? -1,
        recalledProse: Array.isArray(options.recalledProse) ? options.recalledProse : [],
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

function readEntities(raw, { allowEmpty = false } = {}) {
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
    if (!total && !allowEmpty) return undefined;
    return normalized;
}

/** Renders structured character/situation notes into prompt-ready plain text. */
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

export function buildPlanningTargets(snap) {
    const entities = snap.world?.entities || [];
    const hero = protagonistIdentity(entities, snap.cast?.player).hero;
    const records = snap.records || [];

    const characters = [];
    const seenPersonKeys = new Set();
    for (const entity of entities) {
        if (entity.kind && entity.kind !== 'person' && entity.kind !== 'subject') continue;
        if (!entity.name && !Object.keys(entity.fields || {}).some(field => !field.startsWith('_'))) continue;
        const names = new Set([entity.name, ...(entity.aliases || [])].filter(Boolean).map(nameKey));
        for (const key of names) seenPersonKeys.add(key);
        const publicFields = {}, privateFields = {};
        for (const [key, record] of Object.entries(entity.fields || {})) {
            if (!record || record.value === undefined || ['coins', '金币'].includes(key) && entity.id !== hero?.id) continue;
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
        });
    }

    for (const record of records) {
        if (record.kind !== 'person' || !record.name || seenPersonKeys.has(nameKey(record.name))) continue;
        seenPersonKeys.add(nameKey(record.name));
        characters.push({
            id: record.id,
            name: record.name,
            presence: record.presence,
            ...(record.note && { presenceNote: record.note }),
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
        }));

    return { characters, situations };
}

/** Extracts focus query & focus character names from current world state for StoryPlanner early-prose recall. */
export function buildPlannerProseQuery(snap) {
    const targets = buildPlanningTargets(snap);
    const focusCharactersOverride = targets.characters
        .filter(c => c.presence === 'present' || c.presence === 'nearby' || c.agendas?.some(a => a.status === 'open') || c.publicFields?.['重要'] || c.publicFields?.important)
        .flatMap(c => [c.name, ...(c.aliases || [])])
        .filter(Boolean);
    const openSituations = targets.situations
        .filter(s => s.status === 'open')
        .slice(-6)
        .map(s => [s.title, s.description, s.parties, s.scope].filter(Boolean).join(' '))
        .filter(Boolean);
    const agendaTexts = targets.characters
        .flatMap(c => (c.agendas || []).filter(a => a.status === 'open').map(a => `${c.name} ${a.title} ${a.description || ''}`))
        .slice(-6);
    const recentChatText = (snap.chat || []).slice(-2).map(m => m?.mes || '').filter(Boolean);
    const queryOverride = [...openSituations, ...agendaTexts, ...focusCharactersOverride.slice(0, 8), ...recentChatText]
        .join('\n')
        .slice(0, 1500);
    return {
        queryOverride,
        focusCharactersOverride: [...new Set(focusCharactersOverride)],
    };
}

function entityCharacterMeta(entity, field, records = []) {
    const names = new Set([entity.name, ...(entity.aliases || [])].filter(Boolean).map(nameKey));
    if (field === 'name') return entity.name || '';
    if (field === 'aliases') return entity.aliases || [];
    if (field === 'presence' || field === 'presenceNote') {
        const state = records.find(r => r.kind === 'person' && names.has(nameKey(r.name)));
        if (!state) return undefined;
        return field === 'presence' ? state.presence : (state.note || '');
    }
    if (field === 'knowledge') {
        const items = records.filter(r => r.kind === 'knowledge' && names.has(nameKey(r.person)))
            .map(({ content, certainty, evidence, learnedAt }) => ({ content, certainty, evidence, ...(learnedAt && { learnedAt }) }));
        return items.length ? items : undefined;
    }
    if (field === 'agendas') {
        const items = records.filter(r => isPersonalAgenda(r) && (r.holders || []).some(holder => names.has(nameKey(holder))))
            .map(({ id, kind, title, status, description, conditions, statusNote, due }) => ({ id, kind, title, status, description, ...(conditions && { conditions }), ...(statusNote && { statusNote }), ...(due && { due }) }));
        return items.length ? items : undefined;
    }
    return undefined;
}

function resolveDependency(ref, snapshot, requireExactField = false) {
    if (ref?.lineTitle) return null;
    if (ref?.recordId) {
        const record = snapshot.records?.find(item => item.id === ref.recordId);
        if (!record) return null;
        const group = record.kind === 'person' ? 'characters' : 'situations';
        const target = record.title || record.name || record.id;
        if (ref.field) {
            if (typeof ref.field !== 'string' || !ref.field.trim() || ref.field.startsWith('_')) return null;
            if (ref.field === 'history') {
                if (requireExactField && !Array.isArray(record._history)) return null;
                return { value: (record._history || []).map(item => item.text), group, target };
            }
            if (requireExactField && !Object.hasOwn(record, ref.field)) return null;
            return { value: record[ref.field] ?? null, group, target };
        }
        const content = { ...record };
        for (const key of Object.keys(content)) if (key.startsWith('_')) delete content[key];
        return { value: content, group, target };
    }
    if (!ref?.entityId || typeof ref.field !== 'string' || !ref.field.trim()) return null;
    const entity = snapshot.world?.entities?.find(e => e.id === ref.entityId);
    if (!entity) return null;
    const group = (!entity.kind || entity.kind === 'person' || entity.kind === 'subject') ? 'characters' : 'situations';
    const target = entity.name || entity.id;
    if (Object.hasOwn(entity.fields || {}, ref.field) && entity.fields[ref.field]?.value !== undefined) {
        return { value: entity.fields[ref.field].value, group, target };
    }
    const metaValue = entityCharacterMeta(entity, ref.field, snapshot.records);
    if (metaValue !== undefined) return { value: metaValue, group, target };
    if (!requireExactField) {
        const hasFieldKey = ['name', 'aliases', 'presence', 'presenceNote', 'knowledge', 'agendas'].includes(ref.field);
        if (hasFieldKey) return { value: null, group, target };
    }
    return null;
}

function readDependencies(rawDependencies, snap) {
    if (!Array.isArray(rawDependencies) || rawDependencies.length > 40) throw new Error('札记格式无效');
    return rawDependencies.map(item => {
        if (typeof item?.lineTitle === 'string') throw new Error('剧情线已移除，请仅引用人物或局势前提');
        const field = typeof item?.field === 'string' && item.field.trim() ? item.field.trim() : undefined;
        const ref = typeof item?.recordId === 'string'
            ? { recordId: item.recordId, ...(field && { field }) }
            : { entityId: item?.entityId, field: item?.field };
        const resolved = resolveDependency(ref, snap, true);
        if (!resolved || resolved.value === undefined) throw new Error('札记前提无法核对');
        return {
            ...ref,
            digest: memoryDigest(resolved.value),
            ...(resolved.group && { group: resolved.group }),
            ...(resolved.target && { target: resolved.target }),
        };
    });
}

function readNote(raw, snap, limit) {
    const entities = readEntities(raw?.entities);
    const providedText = typeof raw?.text === 'string' ? raw.text.trim() : '';
    const text = providedText || formatPlannerEntities(entities);
    if (!text || text.length > limit) throw new Error('札记格式无效');
    const dependencies = readDependencies(raw?.dependencies, snap);
    return { text, ...(entities && { entities }), dependencies };
}

const valid = (note, snap) => (note.dependencies || []).every(ref => {
    const resolved = resolveDependency(ref, snap, false);
    return resolved !== null && resolved.value !== undefined && ref.digest === memoryDigest(resolved.value);
});

/** Lists invalidated dependency refs for a saved note layer against the current snapshot. */
export function invalidatedDependencies(note, snap) {
    if (!note?.dependencies?.length || !snap) return [];
    const stale = [];
    for (const ref of note.dependencies) {
        const resolved = resolveDependency(ref, snap, false);
        if (resolved !== null && resolved.value !== undefined && ref.digest === memoryDigest(resolved.value)) continue;
        stale.push({
            ...ref,
            group: ref.group || resolved?.group || (ref.recordId ? 'situations' : 'characters'),
            target: ref.target || resolved?.target || ref.recordId || ref.entityId || '',
        });
    }
    return stale;
}

/** Computes entity-level invalidation markers for UI highlighting without calling the writer. */
export function staleTargetsForNote(previous, snap, reason = reviewReason(previous, snap)) {
    if (!previous || !snap || !reason) return null;
    if (reason === 'chapter') return { all: true, characters: [], situations: [], details: [] };
    const buckets = { characters: new Set(), situations: new Set() };
    const details = [
        ...invalidatedDependencies(previous.global, snap),
        ...invalidatedDependencies(previous.chapter, snap),
    ];
    for (const item of details) {
        if (item.group && buckets[item.group] && item.target) buckets[item.group].add(item.target);
    }
    return {
        all: false,
        characters: [...buckets.characters],
        situations: [...buckets.situations],
        details: details.map(({ group, target, field, entityId, recordId }) => ({
            group,
            target,
            ...(field && { field }),
            ...(entityId && { entityId }),
            ...(recordId && { recordId }),
        })),
    };
}

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
    if (!valid(previous.global, snap) || !previous.global?.dependencies?.length && !previous.chapter?.dependencies?.length && previous.basis !== snap.world.version) return 'global-change';
    if (previous.boundary !== snap.boundary) return 'chapter';
    return valid(previous.chapter, snap) && (previous.chapter.dependencies?.length || previous.basis === snap.world.version) ? '' : 'chapter-change';
}

const WRITER_BUDGET_CHARS = 180000;

function hasStructuredEntities(entities) {
    return Boolean(entities && PLANNER_ENTITY_GROUPS.some(([key]) => (entities[key] || []).length > 0));
}

function depKey(ref) {
    if (ref?.recordId) return `rec:${ref.recordId}:${ref.field || ''}`;
    return `ent:${ref?.entityId || ''}:${ref?.field || ''}`;
}

/** Returns true when chapter notes can be incrementally updated via staleTargets instead of full recompute. */
export function canPartialRewrite(previous, snap, reason, staleTargets) {
    if (!previous || !snap || reason !== 'chapter-change') return false;
    if (previous.owner && snap.owner && previous.owner !== snap.owner) return false;
    if (previous.boundary && snap.boundary && previous.boundary !== snap.boundary) return false;
    if (!hasStructuredEntities(previous.chapter?.entities)) return false;
    if (!staleTargets || staleTargets.all) return false;
    return PLANNER_ENTITY_GROUPS.some(([key]) => (staleTargets[key] || []).length > 0);
}

function mergePartialChapter(rawChapter, previous, snap, staleTargets) {
    if (!rawChapter || typeof rawChapter !== 'object' || Array.isArray(rawChapter)) {
        throw new Error('札记格式无效');
    }
    const incomingEntities = readEntities(rawChapter.entities, { allowEmpty: true });
    if (!incomingEntities) {
        throw new Error('札记格式无效');
    }

    const previousEntities = previous.chapter.entities;
    const mergedEntities = {};
    const keptTargetKeys = {};
    for (const [group] of PLANNER_ENTITY_GROUPS) {
        const prevList = previousEntities[group] || [];
        const incList = incomingEntities[group] || [];
        const staleKeys = new Set((staleTargets?.[group] || []).map(nameKey));
        const removed = rawChapter.removed?.[group] || [];
        if (!Array.isArray(removed) || removed.some(item => typeof item !== 'string') || new Set(removed.map(nameKey)).size !== removed.length)
            throw new Error('局部改稿的删除清单无效');
        const removedKeys = new Set(removed.map(nameKey));
        const answers = [...incList.map(item => nameKey(item.target)), ...removedKeys];
        if (answers.length !== staleKeys.size || new Set(answers).size !== staleKeys.size || answers.some(key => !staleKeys.has(key))) throw new Error('局部改稿越界或漏答，请明确给出每个目标的改稿或删除决定');
        const incByKey = new Map(incList.map(item => [nameKey(item.target), item]));
        const used = new Set();
        const nextList = [];
        for (const item of prevList) {
            const key = nameKey(item.target);
            if (removedKeys.has(key)) continue;
            if (incByKey.has(key)) {
                nextList.push(incByKey.get(key));
                used.add(key);
                continue;
            }
            if (staleKeys.has(key)) continue;
            nextList.push(item);
        }
        for (const item of incList) {
            const key = nameKey(item.target);
            if (used.has(key)) continue;
            used.add(key);
            nextList.push(item);
        }
        if (nextList.length > 32) throw new Error('札记实体数量超出限制');
        mergedEntities[group] = nextList;
        keptTargetKeys[group] = new Set(nextList.map(item => nameKey(item.target)));
    }

    const text = formatPlannerEntities(mergedEntities);
    if (!text || text.length > 24000) throw new Error('札记格式无效');

    const freshDeps = readDependencies(rawChapter.dependencies, snap);
    for (const ref of freshDeps) {
        const target = resolveDependency(ref, snap, false);
        const group = ref.group || target?.group;
        if (!group || !(staleTargets[group] || []).some(name => nameKey(name) === nameKey(ref.target || target?.target))) throw new Error('局部改稿修改了范围外的依赖');
    }
    const freshKeys = new Set(freshDeps.map(depKey));
    const mergedDeps = [];
    const seenDeps = new Set();
    for (const prevRef of previous.chapter?.dependencies || []) {
        const key = depKey(prevRef);
        if (freshKeys.has(key) || seenDeps.has(key)) continue;
        const group = prevRef.group || (prevRef.recordId ? 'situations' : 'characters');
        const targetKey = nameKey(prevRef.target || '');
        if (targetKey && !keptTargetKeys[group]?.has(targetKey)) continue;
        const resolved = resolveDependency(prevRef, snap, false);
        if (resolved === null || resolved.value === undefined || prevRef.digest !== memoryDigest(resolved.value)) continue;
        seenDeps.add(key);
        mergedDeps.push(prevRef);
    }
    for (const dep of freshDeps) {
        const key = depKey(dep);
        if (seenDeps.has(key)) continue;
        seenDeps.add(key);
        mergedDeps.push(dep);
    }
    if (mergedDeps.length > 40) throw new Error('札记格式无效');

    return { text, entities: mergedEntities, dependencies: mergedDeps };
}

function normalizeSecretText(text) {
    return String(text || '')
        .normalize('NFKC')
        .replace(/[\s\u200B-\u200D\uFEFF·•・\-—–_「」『』“”"'()（）[\]【】,.，。、；：;:!?！？]/g, '')
        .toLowerCase();
}

function addSecretTerm(out, raw) {
    const term = String(raw || '').trim();
    if (!term) return;
    const norm = normalizeSecretText(term);
    if (!norm) return;
    const hasCjk = /[\u4e00-\u9fff]/.test(norm);
    if (hasCjk ? norm.length >= 2 : norm.length >= 3) out.add(term);
}

function collectSecretTerms(value, out = new Set(), depth = 0) {
    if (value == null || depth > 6) return out;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        addSecretTerm(out, trimmed);
        for (const clause of trimmed.split(/[，。、；;\n\r|/()（）【】]+/)) {
            const part = clause.trim();
            if (part.length >= 3) addSecretTerm(out, part);
            const kvMatch = part.match(/^(?:真实身份|真相|身份|真名|代号|别名|又名|同义(?:词)?|暗号|组织|真凶)\s*[：:=]\s*(.+)$/);
            if (kvMatch?.[1]) addSecretTerm(out, kvMatch[1]);
        }
        return out;
    }
    if (typeof value === 'number') {
        if (Number.isFinite(value) && String(Math.trunc(Math.abs(value))).length >= 4) addSecretTerm(out, String(value));
        return out;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectSecretTerms(item, out, depth + 1);
        return out;
    }
    if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            if (['id', 'type', 'kind', 'nature', 'version', '_version'].includes(k)) continue;
            collectSecretTerms(v, out, depth + 1);
        }
    }
    return out;
}

function collectSnapshotSecretTerms(snap) {
    const terms = new Set();
    for (const entity of snap.world?.entities || []) {
        for (const [key, record] of Object.entries(entity.fields || {})) {
            if (!isPrivateStoryField(key) && !record?.hidden) continue;
            collectSecretTerms(record?.value !== undefined ? record.value : record, terms);
        }
        if (entity.privateFields && typeof entity.privateFields === 'object') {
            for (const value of Object.values(entity.privateFields)) collectSecretTerms(value, terms);
        }
    }
    for (const record of snap.records || []) {
        for (const [key, value] of Object.entries(record || {})) {
            if (isPrivateStoryField(key)) collectSecretTerms(value, terms);
        }
    }
    return [...terms];
}

function containsSecretTerm(chapterTexts, normalizedChapterTexts, secret) {
    if (chapterTexts.some(item => item.includes(secret))) return true;
    const normSecret = normalizeSecretText(secret);
    return normSecret.length >= 2 && normalizedChapterTexts.some(item => item.includes(normSecret));
}

export function publishNotes(raw, previous, snap, reason, options = {}) {
    const data = JSON.parse(raw.trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, ''));
    // WHY: Chapter boundary progression (reason === 'chapter') must refresh the global essay alongside
    // the new chapter brief so long-horizon planning stays aligned even when dependency hashes didn't change.
    const global = !previous || reason === 'global-change' || reason === 'chapter' ? readNote(data.global, snap, 16000) : previous.global;
    const staleTargets = options.staleTargets ?? (reason === 'chapter-change' ? staleTargetsForNote(previous, snap, reason) : null);
    const isPartial = options.mode === 'partial' && canPartialRewrite(previous, snap, reason, staleTargets);
    const chapter = isPartial
        ? mergePartialChapter(data.chapter, previous, snap, staleTargets)
        : readNote(data.chapter, snap, 24000);
    const chapterTexts = [chapter.text, ...collectEntityTexts(chapter.entities)];
    if (chapterTexts.some(item => item.includes('{{'))) throw Object.assign(new Error('章节稿含宿主宏'), { secretLeak: true });
    const normalizedChapterTexts = chapterTexts.map(normalizeSecretText);
    for (const secret of collectSnapshotSecretTerms(snap)) {
        if (containsSecretTerm(chapterTexts, normalizedChapterTexts, secret)) {
            throw Object.assign(new Error('章节稿含管理员私有资料'), { secretLeak: true });
        }
    }
    const end = snap.chat.length - 1, source = prefix(snap.chat, end);
    return {
        owner: snap.owner,
        boundary: snap.boundary,
        basis: snap.world.version,
        end,
        source,
        reason,
        global,
        chapter,
        id: memoryDigest([snap.owner, snap.boundary, source, snap.world.version, previous?.id || '', reason]),
    };
}

function recentMessagesWithSimulations(snap, count = 10) {
    const chat = Array.isArray(snap.chat) ? snap.chat : [];
    const startIdx = Math.max(0, chat.length - count);
    return chat.slice(startIdx).map((msg, offset) => {
        const floor = startIdx + offset;
        const sim = snap.floorSimulations?.[floor];
        const candidate = msg?.swipe_id ?? 0;
        const simText = (!msg?.is_user && sim && typeof sim.text === 'string' && sim.text.trim()
            && (sim.candidate == null || sim.candidate === candidate))
            ? sim.text.trim()
            : '';
        return {
            floor,
            name: msg?.name || (msg?.is_user ? '用户' : '角色'),
            role: msg?.is_user ? 'player' : 'story',
            text: msg?.mes || '',
            ...(simText ? { backgroundText: simText } : {}),
        };
    });
}

function buildSummaryPillar(snap) {
    const parents = snap.layers?.parents || [];
    const leaves = snap.layers?.leaves || [];
    const layeredSummaries = parents.map(unit => ({
        level: unit.level,
        start: unit.start,
        end: unit.end,
        text: unit.text,
    }));
    const recentSummaries = leaves.slice(-12).map(unit => ({
        start: unit.start,
        end: unit.end,
        text: unit.text,
    }));
    return { layeredSummaries, recentSummaries };
}

function buildPartialPayload(snap, previous, reason, staleTargets) {
    const allTargets = buildPlanningTargets(snap);
    const staleKeys = Object.fromEntries(
        PLANNER_ENTITY_GROUPS.map(([group]) => [group, new Set((staleTargets?.[group] || []).map(nameKey))]),
    );
    const staleEntityIds = new Set();
    const staleRecordIds = new Set();
    for (const detail of staleTargets?.details || []) {
        if (detail.entityId) staleEntityIds.add(detail.entityId);
        if (detail.recordId) staleRecordIds.add(detail.recordId);
    }

    const scopedCharacters = allTargets.characters.filter(item =>
        staleKeys.characters.has(nameKey(item.name))
        || (item.aliases || []).some(alias => staleKeys.characters.has(nameKey(alias)))
        || staleEntityIds.has(item.id));
    const scopedSituations = allTargets.situations.filter(item =>
        staleKeys.situations.has(nameKey(item.title)) || staleRecordIds.has(item.id));

    const staleCharacterNames = new Set(staleKeys.characters);
    for (const item of scopedCharacters) {
        staleCharacterNames.add(nameKey(item.name));
        for (const alias of item.aliases || []) staleCharacterNames.add(nameKey(alias));
    }

    const scopedWorld = plannerWorldEntities(snap).filter(entity =>
        staleEntityIds.has(entity.id)
        || staleCharacterNames.has(nameKey(entity.name))
        || (entity.aliases || []).some(alias => staleCharacterNames.has(nameKey(alias)))
        || staleKeys.situations.has(nameKey(entity.name)));
    const scopedRecords = (snap.records || []).filter(record =>
        staleRecordIds.has(record.id)
        || staleCharacterNames.has(nameKey(record.person || record.name || ''))
        || staleKeys.situations.has(nameKey(record.title || record.name || ''))
        || [...(record.holders || []), ...(Array.isArray(record.parties) ? record.parties : String(record.parties || '').split(/[、，,]/))].some(name => staleCharacterNames.has(nameKey(name))));

    const { layeredSummaries, recentSummaries } = buildSummaryPillar(snap);
    return {
        mode: 'partial',
        reason,
        staleTargets,
        previousGlobal: previous.global.text,
        previousChapter: previous.chapter.text,
        previousChapterEntities: previous.chapter.entities,
        planningTargets: {
            characters: scopedCharacters,
            situations: scopedSituations,
        },
        characters: scopedCharacters,
        situations: scopedSituations,
        world: scopedWorld,
        records: scopedRecords,
        layeredSummaries,
        recentSummaries,
        recent: recentMessagesWithSimulations(snap, 10),
        ...(snap.recalledProse?.length ? { recalledProse: snap.recalledProse.slice(0, 12) } : {}),
    };
}

function plannerWorldEntities(snap) {
    const entities = snap.world?.entities || [];
    const hero = protagonistIdentity(entities, snap.cast?.player).hero;
    return entities.filter(entity => entity.kind !== 'item' || importantPossession(entity) || hero &&
        Object.keys(POSSESSION_ROLES).some(key => entity.fields?.[key]?.value?.entityId === hero.id)).map(entity => entity.id === hero?.id || !entity.fields ? entity : {
        ...entity, fields: Object.fromEntries(Object.entries(entity.fields).filter(([key]) => !['coins', '金币'].includes(key))),
    });
}

function truncateText(value, maxChars) {
    if (typeof value !== 'string' || value.length <= maxChars) return value;
    return value.slice(0, Math.max(0, maxChars - 1)) + '…';
}

function compactRecordFields(fields, maxChars) {
    if (!fields || typeof fields !== 'object') return fields;
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string') out[k] = truncateText(v, maxChars);
        else if (Array.isArray(v)) out[k] = v.slice(-6).map(item => (typeof item === 'string' ? truncateText(item, maxChars) : item));
        else out[k] = v;
    }
    return out;
}

function compactPlanningTargets(targets, { textMax = 240, fieldMax = 400, listMax = 4 } = {}) {
    return {
        characters: (targets?.characters || []).map(char => ({
            id: char.id,
            name: char.name,
            ...(char.aliases?.length && { aliases: char.aliases.slice(0, listMax) }),
            ...(char.publicFields && { publicFields: compactRecordFields(char.publicFields, fieldMax) }),
            ...(char.privateFields && { privateFields: compactRecordFields(char.privateFields, fieldMax) }),
            ...(char.presence && { presence: char.presence }),
            ...(char.presenceNote && { presenceNote: truncateText(char.presenceNote, textMax) }),
            ...(char.knowledge?.length && {
                knowledge: char.knowledge.slice(-listMax).map(item => ({
                    ...item,
                    content: truncateText(item.content, textMax),
                    evidence: truncateText(item.evidence, textMax),
                })),
            }),
            ...(char.agendas?.length && {
                agendas: char.agendas.slice(-listMax).map(item => ({
                    id: item.id,
                    kind: item.kind,
                    title: item.title,
                    status: item.status,
                    description: truncateText(item.description, textMax),
                })),
            }),
        })),
        situations: (targets?.situations || []).map(row => ({
            id: row.id,
            kind: row.kind,
            title: row.title,
            status: row.status,
            description: truncateText(row.description, textMax),
            ...(row.parties && { parties: truncateText(row.parties, textMax) }),
            ...(row.scope && { scope: truncateText(row.scope, textMax) }),
            ...(row.impact && { impact: truncateText(row.impact, textMax) }),
            ...(row.releaseCondition && { releaseCondition: truncateText(row.releaseCondition, textMax) }),
            ...(row.due && { due: row.due }),
            ...(row.reason && { reason: truncateText(row.reason, textMax) }),
            ...(row.history?.length && { history: row.history.slice(-2).map(text => truncateText(text, textMax)) }),
        })),
    };
}

function compactSummaryList(list, limit, textMax) {
    return list.slice(-limit).map(item => ({ ...item, text: truncateText(item?.text, textMax) }));
}

function compactProseList(list, limit, textMax, bgMax = 0) {
    return list.slice(-limit).map(item => ({
        ...item,
        text: truncateText(item?.text, textMax),
        ...(bgMax > 0 && item?.backgroundText ? { backgroundText: truncateText(item.backgroundText, bgMax) } : {}),
        ...(bgMax === 0 && item?.backgroundText !== undefined ? {} : {}),
    }));
}

function serializeFullPayload(snap, previous, reason) {
    const planningTargets = buildPlanningTargets(snap);
    const { layeredSummaries, recentSummaries } = buildSummaryPillar(snap);
    const payload = {
        reason,
        previousGlobal: previous?.global.text,
        previousChapter: previous?.chapter.text,
        // Pillar 1: World State (targets + world entities + records)
        planningTargets,
        world: plannerWorldEntities(snap),
        records: snap.records,
        // Pillar 2: Story Summaries (layered hierarchy + recent L0 leaves)
        layeredSummaries,
        recentSummaries,
        // Pillar 3: Relevant Original Prose (recent turns + floor simulations + recalled early chunks)
        recent: recentMessagesWithSimulations(snap, 10),
        recalledProse: (snap.recalledProse || []).slice(0, 12),
    };
    let body = JSON.stringify(payload);

    // Proportional compaction tier 1: compact all three pillars smoothly without removing any pillar.
    if (body.length > WRITER_BUDGET_CHARS) {
        payload.planningTargets = compactPlanningTargets(payload.planningTargets, { textMax: 320, fieldMax: 420, listMax: 5 });
        payload.world = payload.world.map(entity => ({
            id: entity.id,
            name: entity.name,
            kind: entity.kind,
            ...(entity.aliases?.length && { aliases: entity.aliases.slice(0, 5) }),
            ...(entity.fields && { fields: compactRecordFields(entity.fields, 320) }),
        }));
        payload.records = payload.records.map(r => compactRecordFields(r, 280));
        payload.layeredSummaries = compactSummaryList(payload.layeredSummaries, 12, 1200);
        payload.recentSummaries = compactSummaryList(payload.recentSummaries, 8, 900);
        payload.recent = compactProseList(payload.recent, 6, 1200, 600);
        payload.recalledProse = compactProseList(payload.recalledProse, 8, 600, 0);
        if (payload.previousGlobal) payload.previousGlobal = truncateText(payload.previousGlobal, 12000);
        if (payload.previousChapter) payload.previousChapter = truncateText(payload.previousChapter, 12000);
        body = JSON.stringify(payload);
    }

    // Proportional compaction tier 2: tighter limits across all three pillars while preserving each pillar's essence.
    if (body.length > WRITER_BUDGET_CHARS) {
        payload.planningTargets = compactPlanningTargets(payload.planningTargets, { textMax: 180, fieldMax: 220, listMax: 3 });
        payload.world = payload.world.slice(0, 48).map(entity => ({ id: entity.id, name: entity.name, kind: entity.kind }));
        payload.records = payload.records.slice(-48).map(r => compactRecordFields(r, 160));
        payload.layeredSummaries = compactSummaryList(payload.layeredSummaries, 6, 650);
        payload.recentSummaries = compactSummaryList(payload.recentSummaries, 4, 500);
        payload.recent = compactProseList(payload.recent, 4, 700, 350);
        payload.recalledProse = compactProseList(payload.recalledProse, 5, 380, 0);
        if (payload.previousGlobal) payload.previousGlobal = truncateText(payload.previousGlobal, 6000);
        if (payload.previousChapter) payload.previousChapter = truncateText(payload.previousChapter, 6000);
        body = JSON.stringify(payload);
    }

    // Proportional compaction tier 3: halve array lengths synchronously down to >= 1 per non-empty pillar.
    if (body.length > WRITER_BUDGET_CHARS) {
        payload.planningTargets = compactPlanningTargets(payload.planningTargets, { textMax: 120, fieldMax: 140, listMax: 2 });
        if (payload.previousGlobal) payload.previousGlobal = truncateText(payload.previousGlobal, 3000);
        if (payload.previousChapter) payload.previousChapter = truncateText(payload.previousChapter, 3000);
        body = JSON.stringify(payload);
    }
    const trimHalf = (arr, minKeep = 1) => arr.length > minKeep ? arr.slice(-Math.max(minKeep, Math.floor(arr.length / 2))) : arr;
    while (body.length > WRITER_BUDGET_CHARS && (
        (payload.planningTargets?.characters?.length || 0) > 1
        || (payload.planningTargets?.situations?.length || 0) > 1
        || (payload.world?.length || 0) > 1
        || (payload.records?.length || 0) > 1
        || (payload.layeredSummaries?.length || 0) > 1
        || (payload.recentSummaries?.length || 0) > 1
        || (payload.recent?.length || 0) > 1
        || (payload.recalledProse?.length || 0) > 1
    )) {
        payload.planningTargets.characters = trimHalf(payload.planningTargets.characters, 1);
        payload.planningTargets.situations = trimHalf(payload.planningTargets.situations, 1);
        payload.world = trimHalf(payload.world, 1);
        payload.records = trimHalf(payload.records, 1);
        payload.layeredSummaries = trimHalf(payload.layeredSummaries, 1);
        payload.recentSummaries = trimHalf(payload.recentSummaries, 1);
        payload.recent = trimHalf(payload.recent, 1);
        payload.recalledProse = payload.recalledProse.length > 1 ? payload.recalledProse.slice(0, Math.max(1, Math.floor(payload.recalledProse.length / 2))) : payload.recalledProse;
        body = JSON.stringify(payload);
    }
    if (JSON.stringify([{ role: 'system', content: WRITER }, { role: 'user', content: body }]).length > 200000) throw new Error('作家材料超出单次预算');
    return body;
}

/** Builds writer LLM messages and mode, falling back to full chapter recomputation on chapter, branch, or 180k budget overflow. */
export function prepareWriterRequest(snap, previous, reason, staleTargets = null, { forceFull = false } = {}) {
    const resolvedStale = staleTargets ?? (previous && reason === 'chapter-change' ? staleTargetsForNote(previous, snap, reason) : null);
    if (!forceFull && canPartialRewrite(previous, snap, reason, resolvedStale)) {
        const partialBody = JSON.stringify(buildPartialPayload(snap, previous, reason, resolvedStale));
        if (partialBody.length <= WRITER_BUDGET_CHARS) {
            return {
                mode: 'partial',
                staleTargets: resolvedStale,
                messages: [{ role: 'system', content: WRITER }, { role: 'user', content: partialBody }],
            };
        }
    }
    const fullBody = serializeFullPayload(snap, previous, reason);
    return {
        mode: 'full',
        staleTargets: null,
        messages: [{ role: 'system', content: WRITER }, { role: 'user', content: fullBody }],
    };
}

export function writerInput(snap, previous, reason, staleTargets = null, options = undefined) {
    return prepareWriterRequest(snap, previous, reason, staleTargets, options).messages;
}
