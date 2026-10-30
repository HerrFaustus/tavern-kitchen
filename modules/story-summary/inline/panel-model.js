import { extractFloorPayload, floorSource } from './protocol.js';
import { findFloorBatch, isFloorEntryCurrent } from './ledger.js';
import { STORY_FIELDS, STORY_KINDS, storyRecordText } from '../../story-state/records.js';
import { inlineAnchorInputs } from './anchors.js';

export const EMPTY_FLOOR_PAYLOAD = { summary: '', timeStart: '', timeEnd: '', date: '', location: '', updates: {} };
export const FIELD_LABELS = { summary: '摘要', title: '标题', participants: '涉及人物', causedBy: '前因事件编号', timeLabel: '故事时间', memoryRole: '记忆类型',
    s: '对象', p: '属性', o: '值', isState: '随剧情变化', retracted: '撤回事实', trend: '关系趋势',
    name: '人物', trajectory: '轨迹', progress: '进度（0–100）', newMoment: '本轮节点',
    text: '关键词', weight: '重要程度', to: '规范称呼', from: '旧称呼', evidence: '依据', ...STORY_FIELDS };
const fields = { events: ['title', 'summary', 'participants', 'causedBy', 'timeLabel', 'memoryRole'],
    factUpdates: ['s', 'p', 'o', 'isState', 'retracted', 'trend'], arcUpdates: ['name', 'trajectory', 'progress', 'newMoment'],
    newCharacters: ['name'], keywords: ['text', 'weight'], characterAliasUpdates: ['to', 'from', 'evidence'] };
const storyFields = { scene: ['location', 'situation', 'participants', 'tension', 'pendingBeat'], clock: ['label', 'date'],
    person: ['name', 'presence', 'note'], knowledge: ['person', 'content', 'certainty', 'evidence', 'learnedAt'],
    plan: ['title', 'description', 'status', 'reason', 'due'], suspense: ['title', 'description', 'status', 'reason', 'due'],
    situation: ['title', 'description', 'status', 'reason', 'due'] };
const groups = { events: '剧情', factUpdates: '世界', arcUpdates: '人物', newCharacters: '人物', keywords: '关键词', characterAliasUpdates: '人物' };

export function floorEditItems(payload, store) {
    const items = Object.entries(payload.updates || {}).flatMap(([bucket, rows]) => (rows || []).map((raw, index) => {
        const value = bucket === 'newCharacters' ? { name: raw } : raw;
        let group = groups[bucket] || '变化';
        if (bucket === 'storyUpdates') group = STORY_KINDS[value.kind] || '世界';
        if (bucket === 'factUpdates') {
            if (['数量', '持有者', '归属', '物品状态'].includes(value.p)) group = '物品';
            else if (String(value.p).startsWith('变量.')) group = '变量';
            else if (/^对.+的关系$/.test(value.p)) group = '人物';
        }
        const removed = value.remove || value.retracted;
        const known = bucket === 'storyUpdates' && store?.json?.storyRecords?.some(record => record.id === value.id);
        const operation = removed ? '撤回' : value.status && value.status !== 'open' ? '了结' : known || bucket === 'arcUpdates' ? '更新' : '新增';
        const title = value.title || value.name || value.person || value.s || value.text || value.to || STORY_KINDS[value.kind] || '变化';
        const sub = bucket === 'storyUpdates' ? storyRecordText(value)
            : bucket === 'factUpdates' ? `${value.p}${value.o ? `：${value.o}` : ''}`
                : value.summary || value.trajectory || value.evidence || '';
        const keys = bucket === 'storyUpdates' ? (removed ? [] : storyFields[value.kind] || []) : fields[bucket] || [];
        return { key: `${bucket}:${index}`, bucket, index, value, group, operation, title, sub,
            fields: keys.filter(key => !removed || !['o', 'isState', 'trend'].includes(key)) };
    }));
    for (const [index, anchor] of (payload.anchors || []).entries()) items.push({ key: `anchors:${index}`, bucket: 'anchors', index,
        group: '场景锚点', operation: '记录', title: anchor.where || '当前场景', sub: anchor.scene,
        value: anchor, fields: ['scene', 'where', 'edges'] });
    return items;
}

export function floorPanelModel(snapshot, floor) {
    const { store, chat } = snapshot;
    const source = floorSource(chat, floor);
    const batch = findFloorBatch(store, floor);
    const current = isFloorEntryCurrent(batch?.floorEntry, chat) && !store?.summaryInvalid
        && !(snapshot.invalidFrom != null && batch.endMesId >= snapshot.invalidFrom);
    const entry = current ? batch.floorEntry : null;
    const extracted = extractFloorPayload(chat[floor].mes);
    const draft = store?.floorDrafts?.[floor];
    const staged = draft?.source?.digest === source.digest;
    let payload = staged ? draft.payload : entry?.empty ? structuredClone(EMPTY_FLOOR_PAYLOAD) : entry?.payload || extracted.payload || structuredClone(EMPTY_FLOOR_PAYLOAD);
    if ((!entry || entry.anchorVersion) && payload.anchors === undefined) payload = { ...payload, anchors: inlineAnchorInputs(payload) };
    const legacy = !store?.summaryInvalid && snapshot.invalidFrom == null && !batch && store?.summaryHistory?.find(item => item.kind === 'batch' && !item.floorEntry && floor > item.previousEndMesId && floor <= item.endMesId);
    const legacyEvents = legacy ? (store?.json?.events || []).filter(event => event._addedAt === legacy.endMesId) : [];
    const status = entry?.omitted ? '番外' : entry?.deleted ? '已删除' : staged ? '待审查' : entry ? '已写入'
        : extracted.status === 'ready' ? '待审查' : extracted.status === 'incomplete' ? '输出未完成' : extracted.status === 'invalid' ? '格式有误' : legacy ? '旧区间' : '待总结';
    return { source, payload, entry, batch, legacy, legacyEvents, status, staged, pending: staged || !entry,
        error: snapshot.getError?.(floor) || (!staged && !entry ? extracted.error : '') || '',
        items: floorEditItems(payload, batch?.undo ? { json: { storyRecords: (batch.undo.storyRecordChanges || []).map(change => change.previous).filter(Boolean) } } : store) };
}
