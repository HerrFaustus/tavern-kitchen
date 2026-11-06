import { SITUATION_FIELDS, THREAD_STATUS } from './records.js';

// Project only retained changes on this branch. Never persist display history in a model proposal.
export function situationViewRecords(records, store, world, developments = []) {
    const fields = { title: '标题', description: '局势概况', phase: '风物阶段', period: '时节', category: '类别', relatedId: '关联局势', ...SITUATION_FIELDS, status: '状态', due: '期限', reason: '结案原因' };
    const tracks = new Map();
    function observe(record, end, start) {
        if (record?.kind !== 'situation') return;
        if (record.remove) { tracks.delete(record.id); return; }
        const track = tracks.get(record.id) || { steps: [], last: {} };
        const changes = [];
        for (const [key, label] of Object.entries(fields)) {
            const value = record[key] || '';
            if (value === (track.last[key] || '')) continue;
            changes.push(label + '：' + (key === 'status' ? THREAD_STATUS[value] : value || '已清空'));
        }
        if (changes.length) track.steps.push({ _addedAt: end, _sourceStart: start, text: changes.join('；') });
        track.last = record; tracks.set(record.id, track);
    }
    for (const batch of store?.summaryHistory || []) {
        for (const change of batch.undo?.storyRecordChanges || []) {
            if (change.previous) observe(change.previous, change.previous._addedAt, change.previous._sourceStart);
            if (!change.generated && change.previous) tracks.delete(change.previous.id);
            observe(change.generated, batch.endMesId, change.generated?._sourceStart);
        }
        for (const record of batch.undo?.generatedStoryRecords || []) observe(record, record._addedAt, record._sourceStart);
    }
    for (const record of store?.json?.storyRecords || []) observe(record, record._addedAt, record._sourceStart);
    for (const event of world?.events || []) for (const effect of event.effects || []) {
        if (effect.type !== 'module' || effect.id !== 'story') continue;
        for (const entry of effect.after?.records || []) if (entry.eventId === event.id) observe(entry.record, entry.end, entry.start);
    }
    return records.map(record => {
        if (record.kind !== 'situation') return record;
        observe(record, record._addedAt, record._sourceStart);
        return { ...record, _history: tracks.get(record.id)?.steps || [], _developments: developments.filter(item => item.situationId === record.id) };
    });
}
