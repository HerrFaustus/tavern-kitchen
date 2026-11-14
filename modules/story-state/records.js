import { nameKey } from './protagonist-identity.js';
// Structured observations share the summary's transaction, provenance and undo.
// This projection never predicts events, advances time, or calls a model.
export const STORY_KINDS = { clock: '故事时钟', person: '人物', knowledge: '认知', plan: '计划', goal: '目标', suspense: '悬念', situation: '局势' };
export const isPersonalAgenda = record => record.kind === 'plan' || record.kind === 'goal';
export const PRESENCE = { present: '在场', nearby: '附近', away: '离场', unknown: '未知' };
export const BELIEFS = { known: '已知', believed: '相信／误解', uncertain: '怀疑' };
export const THREAD_STATUS = { open: '未结', done: '已完成', cancelled: '已取消', failed: '已失败' };
export const SITUATION_FIELDS = { parties: '涉及方', scope: '影响范围', impact: '当前影响', releaseCondition: '解除条件' };
export const STORY_FIELDS = { ...SITUATION_FIELDS, holders:'持有人', conditions:'条件约束', statusNote:'当前进展', label: '故事时间', date: '可计算日期', name: '人物', presence: '在场度', note: '在场依据', person: '获知者', content: '认知内容', certainty: '认知性质', evidence: '获知依据', learnedAt: '获知时间', title: '标题', description: '描述', status: '结案状态', reason: '结案原因', due: '期限' };
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
// Project only an explicitly named grammatical subject in old plans. The source record stays intact.
export function legacyPlanHolders(record, knownNames) {
    if (record.kind !== 'plan' || record.holders) return record.holders || [];
    for (const value of [record.title, record.description]) {
        const subject = value?.match(/^(.{1,200}?)(?:共同|一起)?(?:计划|打算|决定|约定|准备)/u)?.[1]?.trim();
        if (!subject) continue;
        if (knownNames.has(subject)) return [subject];
        const names = subject.split(/[、和与]/u).map(name => name.trim());
        if (names.every(name => knownNames.has(name))) return [...new Set(names)];
    }
    return [];
}
export function projectPersonalAgendas(records, knownNames) {
    return records.map(record => {
        if (record.kind !== 'plan' || record.holders) return record;
        const holders = legacyPlanHolders(record, knownNames);
        return holders.length ? {...record, holders} : record;
    });
}
function requireValue(condition, message) { if (!condition) throw new Error(`场景状态：${message}`); }
function text(value, name, required = false, max = 2000) {
    requireValue(typeof value === 'string' && value.length <= max && (!required || value.trim()), `${name}须为${required ? '非空' : ''}文本（最多 ${max} 字）`);
    return value.trim();
}
function choice(value, choices, name) { requireValue(Object.hasOwn(choices, value), `${name}无效`); return value; }
export function storyDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? date.valueOf() : null;
}
export function latestStoryTimeFromStore(store, records = null) {
    const list = Array.isArray(records) ? records : (store?.json?.storyRecords || []);
    const clock = list.filter(record => record?.kind === 'clock').at(-1);
    return clock ? String(clock.date || clock.label || '').trim() : '';
}
export function relativeStoryTime(value, now) {
    const then = storyDate(value), current = storyDate(now);
    if (then === null || current === null) return '';
    const days = Math.round((then - current) / 86400000);
    return days === 0 ? '今天' : days === -1 ? '昨天' : days === 1 ? '明天' : days < 0 ? `${-days} 天前` : `${days} 天后`;
}
export function parseStoryUpdates(value = [], { requireHolders = false, archived = false } = {}) {
    requireValue(Array.isArray(value) && value.length <= 300, '每批更新须为数组且不超过 300 条');
    const ids = new Set();
    return value.map(raw => {
        requireValue(raw && typeof raw === 'object' && !Array.isArray(raw), '记录须为对象');
        const kind = archived && raw.kind === 'scene' ? 'scene' : choice(raw.kind, STORY_KINDS, '记录类型');
        const id = text(raw.id, '标识', true, 200);
        requireValue(!reserved.has(id) && !ids.has(id), '标识无效或重复'); ids.add(id);
        requireValue(!['scene', 'clock'].includes(kind) || id === kind, '场景和时钟须使用固定标识');
        if (raw.remove === true) return { id, kind, remove: true };
        const record = { id, kind };
        if (kind === 'scene') {
            for (const field of ['location', 'situation', 'tension', 'pendingBeat']) record[field] = text(raw[field] ?? '', field);
            requireValue(Array.isArray(raw.participants) && raw.participants.length <= 100, '在场人物须为数组');
            record.participants = [...new Set(raw.participants.map(name => text(name, '人物名', true, 200)))];
        } else if (kind === 'clock') {
            record.label = text(raw.label, '故事时间', true, 200);
            record.date = text(raw.date ?? '', '可计算日期', false, 10);
            requireValue(!record.date || storyDate(record.date) !== null, '可计算日期须为有效 YYYY-MM-DD；架空历法请留空');
        } else if (kind === 'person') {
            record.name = text(raw.name, '人物名', true, 200);
            record.presence = choice(raw.presence, PRESENCE, '在场度');
            record.note = text(raw.note ?? '', '在场依据');
        } else if (kind === 'knowledge') {
            record.person = text(raw.person, '认知归属', true, 200);
            record.content = text(raw.content, '认知内容', true);
            record.certainty = choice(raw.certainty, BELIEFS, '认知性质');
            record.evidence = text(raw.evidence, '获知依据', true);
            record.learnedAt = text(raw.learnedAt ?? '', '获知时间', false, 200);
        } else {
            record.title = text(raw.title, '标题', true, 200);
            record.description = text(raw.description ?? '', '描述');
            if (isPersonalAgenda(record) && (kind === 'goal' || requireHolders || raw.holders !== undefined)) {
                requireValue(Array.isArray(raw.holders) && raw.holders.length > 0 && raw.holders.length <= 100, '计划和目标须有一位或多位持有人');
                record.holders = [...new Set(raw.holders.map(name => text(name, '持有人', true, 200)))];
                requireValue(record.description, '须填写具体内容');
                record.conditions = text(raw.conditions ?? '', '条件约束');
                if (raw.statusNote !== undefined) record.statusNote = text(raw.statusNote, '当前进展');
            }
            if (kind === 'situation' && raw.flavor === 'scenery') {
                record.flavor = 'scenery';
                for (const key of ['phase', 'period', 'category', 'relatedId']) if (raw[key]) record[key] = text(raw[key], key, false, 200);
            }
            if (kind === 'situation') for (const field of Object.keys(SITUATION_FIELDS)) {
                if (raw[field] !== undefined) record[field] = text(raw[field], SITUATION_FIELDS[field]);
            }
            record.status = choice(raw.status, THREAD_STATUS, '结案状态');
            record.reason = text(raw.reason ?? '', '结案原因');
            requireValue(record.status === 'open' || record.reason, '结案须填写原因');
            record.due = text(raw.due ?? '', '期限', false, 200);
        }
        return record;
    });
}
export function mergeStoryRecords(previous = [], updates = [], floor, start = floor) {
    const records = new Map(previous.filter(record => record.kind !== 'scene').map(record => [record.id, structuredClone(record)]));
    for (const update of updates) {
        if (update.kind === 'scene') continue; // Old floor replays can carry retired records.
        const old = records.get(update.id);
        requireValue(!old || old.kind === update.kind, '同一标识不能改变记录类型');
        if (update.remove) { records.delete(update.id); continue; }
        records.set(update.id, { ...update, _addedAt: floor, _sourceStart: start });
    }
    requireValue(records.size <= 20000, '记录数量超过上限');
    return [...records.values()];
}
export function availableStoryRecords(store, invalidFrom) {
    if (!store || store.summaryInvalid || invalidFrom != null || store.sourceInvalidFromFloor != null) return [];
    return (store.json?.storyRecords || []).filter(record => record.kind !== 'scene' && (record._addedAt == null || record._addedAt <= store.lastSummarizedMesId));
}
export function characterStoryState(records = [], name, resolveName = value => value) {
    const same = value => resolveName(value) === resolveName(name);
    const person = records.filter(record => record.kind === 'person' && same(record.name)).at(-1);
    const presence = person?.presence || 'unknown';
    return { presence, note: person?.note || '', knowledge: records.filter(record => record.kind === 'knowledge' && same(record.person)) };
}
export function storyRecordText(record) {
    if (!Object.hasOwn(STORY_KINDS,record.kind)) return '';
    if (record.kind === 'clock') return record.label;
    if (record.kind === 'person') return `${record.name} · ${PRESENCE[record.presence]}${record.note ? `：${record.note}` : ''}`;
    if (record.kind === 'knowledge') return `${record.person} · ${BELIEFS[record.certainty]}：${record.content}（依据：${record.evidence}）${record.learnedAt ? ` · ${record.learnedAt}` : ''}`;
    if (record.kind === 'situation') return [record.title, THREAD_STATUS[record.status], record.description,
        ...Object.entries(SITUATION_FIELDS).filter(([key]) => record[key]).map(([key, label]) => label + '：' + record[key]),
        record.due && '期限：' + record.due, record.reason && '结案原因：' + record.reason].filter(Boolean).join('；');
    return [`${record.title} · ${THREAD_STATUS[record.status]}${record.description ? `：${record.description}` : ''}`,record.holders?.length && '持有人：' + record.holders.join('、'),
        record.conditions && '条件约束：' + record.conditions, record.statusNote && '当前进展：' + record.statusNote, record.due && '期限：' + record.due, record.reason && '原因：' + record.reason].filter(Boolean).join('；');
}
export function storyContextLines(records = [], focus = []) {
    const names = new Set(focus);
    for (const record of records) if (record.kind === 'person' && characterStoryState(records, record.name).presence === 'present') names.add(record.name);
    const holderNames = new Set([...names].map(nameKey));
    const selected = records.filter(record => record.kind === 'clock'
        || (['suspense', 'situation'].includes(record.kind) && record.flavor !== 'scenery')
        || isPersonalAgenda(record) && (!record.holders?.length || record.holders.some(holder => holderNames.has(nameKey(holder))))
        || record.kind === 'person' && (names.has(record.name) || record.presence === 'nearby')
        || record.kind === 'knowledge' && names.has(record.person));
    // Recent closure remains visible to prevent a resolved hook being resurrected.
    selected.sort((a, b) => (Number(b.kind === 'clock') - Number(a.kind === 'clock')) || (b._addedAt || 0) - (a._addedAt || 0));
    return selected.map(record => `[${STORY_KINDS[record.kind]}] ${storyRecordText(record.kind === 'person' ? { ...record, presence: characterStoryState(records, record.name).presence } : record)}`);
}
export const CHARACTER_RECORD_RULES = `人物按后续剧情需要建档。先问：下次认错此人、忘记他做过什么或忘记东西在他手上，会不会造成剧情错误？
一次性叫卖、路过、围观或无后续的一句应答，有叙事价值时只写进本轮总结。同场、同区域、有名字或被召回本身都不是建档理由。勿为此单发 newCharacters、人物实体、人物状态、事实或牵涉提案。
出现须跨轮追踪的后果时当轮建档，例如保管关键物件、欠债、约定、持续阻碍或协助、掌握后续关键消息；能明确辨认且再次产生实质影响也可建档。没有姓名可用能区分此人的稳定称呼。以北门守卫代管银钥匙为例，先记可辨身份、银钥匙由谁保管、何时须归还；有原文依据才记地点，勿凭职业补写性格、相貌、能力或动机。
后续关系加深时复用原档和编号，得知真名时保留旧称作别名。同名或同职业而身份不明时保留不确定。暂未出现、离开本地或约定结清，只更新相关状态，保留已建立的来源和经历。近远景控制已记录对象的复查频率，人物词条的详略由已知事实决定。`;

export const STORY_UPDATE_PROTOCOL = `
${CHARACTER_RECORD_RULES}
在同一份 JSON 中增加可选 storyUpdates 数组，维护已发生剧情的当前状态。不要另作预测，不要把规划候选写成事实。
每项是完整记录替换；未提及的记录保持不变，空文本表示清空对应内容；删除用 {id,kind,remove:true}。复用已有 id，同一计划改期/结案、同一认知纠正不得另造重复 id。id 最多200字。只更新本批有证据的内容。
支持以下记录（示例仅说明结构，不能照抄内容）：
{id:"clock",kind:"clock",label:"剧情里的时间",date:""}：date 仅在明确公历日期时填 YYYY-MM-DD；架空历法留空。不得按现实时间推进或自行推测日期。
{id:"person-固定标识",kind:"person",name:"人物",presence:"present|nearby|away|unknown",note:"在场度依据"}：四值分别表示在场、附近、离场、未知，选择其中一个。不要把回忆中提及等同于在场。根据正文明确的换场、同行、离开更新已建档人物的在场度；同区域和过往同场不能单独证明当前在场或知情。
{id:"knowledge-固定标识",kind:"knowledge",person:"获知者",content:"知道/误以为的内容",certainty:"known|believed|uncertain",evidence:"从何人/何事获知",learnedAt:"故事时间或空"}：选择一种认知性质；保留错误信念，不把秘密传播给未获知者。认知单独记，不同时写成该角色已确认的世界事实。
{id:"固定标识",kind:"plan|goal",holders:["人物规范名"],title:"简介（名称）",description:"具体内容",conditions:"条件约束，无则留空",statusNote:"目前做到哪一步，缺少依据留空",status:"open|done|cancelled|failed",reason:"结案原因或空",due:"故事期限或空"}：计划是已有明确行动的当下项目，例如明早两人合力把药送出城；目标是长期追求或议程，例如让城里人都能看得起病。仅在原文分别支持时记录两者。一人或多人共同持有，同一条目只用一个 id；受益人、知情者不自动成为持有人。主角的意图须由玩家明确表达或确认。到期、条件满足或某个计划完成，都不可自动判定目标完成。改期、进展、成员变化复用原 id，结案必须写明依据和原因。
{id:"固定标识",kind:"suspense|situation",title:"标题",description:"内容",status:"open|done|cancelled|failed",reason:"结案原因或空",due:"故事期限或空"}：分别为悬念、局势。结案必须有依据和原因；未解决保持 open。不要为一次情绪自动建立永久局势。
局势（situation）的 description 写局势概况，可补充文本 parties（涉及方及各方角色）、scope（影响范围）、impact（当前实际影响）、releaseCondition（正文明确的解除条件）。更新时沿用同一 id 并保留仍有效的词条；缺乏依据可留空。期限或解除条件满足不等于结案。
人物名遵循已有规范名称；重要状态缺乏依据时保留未知，不补写故事。`;
