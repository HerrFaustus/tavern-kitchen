// Structured observations share the summary's transaction, provenance and undo.
// This projection never predicts events, advances time, or calls a model.
export const STORY_KINDS = { scene: '场景', clock: '故事时钟', person: '人物', knowledge: '认知', plan: '计划', suspense: '悬念', situation: '局面' };
export const PRESENCE = { present: '在场', nearby: '附近', away: '离场', unknown: '未知' };
export const BELIEFS = { known: '已知', believed: '相信／误解', uncertain: '怀疑' };
export const THREAD_STATUS = { open: '未结', done: '已完成', cancelled: '已取消', failed: '已失败' };
export const STORY_FIELDS = { location: '地点', situation: '局面', participants: '在场人物', tension: '张力', pendingBeat: '待兑现', label: '故事时间', date: '可计算日期', name: '人物', presence: '在场度', note: '在场依据', person: '获知者', content: '认知内容', certainty: '认知性质', evidence: '获知依据', learnedAt: '获知时间', title: '标题', description: '描述', status: '结案状态', reason: '结案原因', due: '期限' };
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
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
export function relativeStoryTime(value, now) {
    const then = storyDate(value), current = storyDate(now);
    if (then === null || current === null) return '';
    const days = Math.round((then - current) / 86400000);
    return days === 0 ? '今天' : days === -1 ? '昨天' : days === 1 ? '明天' : days < 0 ? `${-days} 天前` : `${days} 天后`;
}
export function parseStoryUpdates(value = []) {
    requireValue(Array.isArray(value) && value.length <= 300, '每批更新须为数组且不超过 300 条');
    const ids = new Set();
    return value.map(raw => {
        requireValue(raw && typeof raw === 'object' && !Array.isArray(raw), '记录须为对象');
        const kind = choice(raw.kind, STORY_KINDS, '记录类型');
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
            record.status = choice(raw.status, THREAD_STATUS, '结案状态');
            record.reason = text(raw.reason ?? '', '结案原因');
            requireValue(record.status === 'open' || record.reason, '结案须填写原因');
            record.due = text(raw.due ?? '', '期限', false, 200);
        }
        return record;
    });
}
export function mergeStoryRecords(previous = [], updates = [], floor, start = floor) {
    const records = new Map(previous.map(record => [record.id, structuredClone(record)]));
    for (const update of updates) {
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
    return (store.json?.storyRecords || []).filter(record => record._addedAt == null || record._addedAt <= store.lastSummarizedMesId);
}
export function characterStoryState(records = [], name, resolveName = value => value) {
    const same = value => resolveName(value) === resolveName(name);
    const scene = records.find(record => record.kind === 'scene');
    const person = records.filter(record => record.kind === 'person' && same(record.name)).at(-1);
    // A scene is a complete roster. An old presence observation cannot override it.
    const newerScene = scene && (!person || (scene._addedAt ?? 0) >= (person._addedAt ?? 0));
    const presence = newerScene ? scene.participants.some(same) ? 'present' : person?.presence === 'present' ? 'away' : person?.presence || 'unknown' : person?.presence || 'unknown';
    return { presence, note: person?.note || '', knowledge: records.filter(record => record.kind === 'knowledge' && same(record.person)) };
}
export function storyRecordText(record) {
    if (record.kind === 'scene') return [record.location, record.situation, record.participants.length ? `在场：${record.participants.join('、')}` : '', record.tension && `张力：${record.tension}`, record.pendingBeat && `待兑现：${record.pendingBeat}`].filter(Boolean).join('；');
    if (record.kind === 'clock') return record.label;
    if (record.kind === 'person') return `${record.name} · ${PRESENCE[record.presence]}${record.note ? `：${record.note}` : ''}`;
    if (record.kind === 'knowledge') return `${record.person} · ${BELIEFS[record.certainty]}：${record.content}（依据：${record.evidence}）`;
    return `${record.title} · ${THREAD_STATUS[record.status]}${record.description ? `：${record.description}` : ''}${record.due ? `；期限：${record.due}` : ''}${record.reason ? `；原因：${record.reason}` : ''}`;
}
export function storyContextLines(records = [], focus = []) {
    const scene = records.find(record => record.kind === 'scene');
    const names = new Set([...(scene?.participants || []), ...focus]);
    for (const record of records) if (record.kind === 'person' && characterStoryState(records, record.name).presence === 'present') names.add(record.name);
    const selected = records.filter(record => record.kind === 'scene' || record.kind === 'clock'
        || ['plan', 'suspense', 'situation'].includes(record.kind)
        || record.kind === 'person' && (names.has(record.name) || record.presence === 'nearby')
        || record.kind === 'knowledge' && names.has(record.person));
    // Recent closure remains visible to prevent a resolved hook being resurrected.
    selected.sort((a, b) => (['scene', 'clock'].includes(b.kind) - ['scene', 'clock'].includes(a.kind)) || (b._addedAt || 0) - (a._addedAt || 0));
    return selected.map(record => `[${STORY_KINDS[record.kind]}] ${storyRecordText(record.kind === 'person' ? { ...record, presence: characterStoryState(records, record.name).presence } : record)}${record.kind === 'knowledge' ? '；仅代表该人物的认知，不是世界真相。' : ''}`);
}
export const STORY_UPDATE_PROTOCOL = `
在同一份 JSON 中增加可选 storyUpdates 数组，维护已发生剧情的当前状态。不要另作预测，不要把规划候选写成事实。
每项是完整记录替换；未提及的记录保持不变，空文本表示清空对应内容；删除用 {id,kind,remove:true}。复用已有 id，同一计划改期/结案、同一认知纠正不得另造重复 id。id 最多200字。只更新本批有证据的内容。
支持以下记录（示例仅说明结构，不能照抄内容）：
{id:"scene",kind:"scene",location:"地点",situation:"当前局面",participants:["在场人物"],tension:"持续张力或空",pendingBeat:"明确正在进行/约定但尚无结果的动作或空"}
{id:"clock",kind:"clock",label:"剧情里的时间",date:""}：date 仅在明确公历日期时填 YYYY-MM-DD；架空历法留空。不得按现实时间推进或自行推测日期。
{id:"person-固定标识",kind:"person",name:"人物",presence:"present|nearby|away|unknown",note:"在场度依据"}：四值分别表示在场、附近、离场、未知，选择其中一个。不要把回忆中提及等同于在场。scene.participants 是当前完整名单。
{id:"knowledge-固定标识",kind:"knowledge",person:"获知者",content:"知道/误以为的内容",certainty:"known|believed|uncertain",evidence:"从何人/何事获知",learnedAt:"故事时间或空"}：选择一种认知性质；保留错误信念，不把秘密传播给未获知者。认知单独记，不同时写成该角色已确认的世界事实。
{id:"plan-固定标识",kind:"plan|suspense|situation",title:"标题",description:"内容",status:"open|done|cancelled|failed",reason:"结案原因或空",due:"故事期限或空"}：kind/status 各选一个值；分别为计划、悬念、局面。结案必须有依据和原因，改期复用 id；未解决保持 open。不要为一次情绪自动建立永久局面。
人物名遵循已有规范名称；重要状态缺乏依据时保留未知，不补写故事。`;
