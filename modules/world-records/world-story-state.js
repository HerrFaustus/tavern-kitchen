import { isPersonalAgenda, parseStoryUpdates } from '../story-state/records.js';
import { memoryDigest } from '../story-summary/data/memory-policy.js';

const check = (ok, message) => { if (!ok) throw new Error(`世界剧情状态：${message}`); };
export const isCurrentStoryProposal = proposal => proposal.nature === 'established_fact' || !proposal.record.remove
    && (proposal.record.kind === 'knowledge' && ['belief', 'rumor', 'hypothesis'].includes(proposal.nature)
        || isPersonalAgenda(proposal.record) && proposal.nature === 'intention');
export function validateWorldStoryState(value) {
    check(value?.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 1
        && Array.isArray(value.records) && Array.isArray(value.candidates) && value.records.length + value.candidates.length <= 20000, '结构无效');
    check(new Set(value.records.map(item => item.record?.id)).size === value.records.length, '记录身份重复');
    check(new Set(value.candidates.map(item => item.key)).size === value.candidates.length, '候选身份重复');
    for (const entry of [...value.records, ...value.candidates]) {
        check(memoryDigest(parseStoryUpdates([entry.record])[0]) === memoryDigest(entry.record), '记录内容无效');
        check(Number.isSafeInteger(entry.version) && entry.version > 0 && entry.version <= value.revision
            && Number.isSafeInteger(entry.start) && entry.start >= 0 && Number.isSafeInteger(entry.end) && entry.end >= entry.start
            && ['module', 'key', 'label'].every(key => typeof entry.source?.[key] === 'string' && entry.source[key].trim())
            && ['established_fact', 'rumor', 'belief', 'intention', 'hypothesis', 'creative_proposal', 'unclassified'].includes(entry.nature)
            && typeof entry.eventId === 'string', '来源或版本无效');
    }
    check(value.records.every(entry => isCurrentStoryProposal(entry)) && value.candidates.every(entry => !isCurrentStoryProposal(entry)), '候选不能混入当前剧情状态');
    return value;
}

export function worldStoryRecords(state, baseline = []) {
    const records = new Map(baseline.map(record => [record.id, structuredClone(record)]));
    for (const entry of state?.modules?.story?.records || []) {
        if (entry.record.remove) records.delete(entry.record.id);
        else records.set(entry.record.id, { ...structuredClone(entry.record), _addedAt: entry.end, _sourceStart: entry.start,
            _worldVersion: entry.version, _nature: entry.nature });
    }
    return [...records.values()];
}

export function worldStoryStore(store, state) {
    if (!store?.json || !state?.modules?.story) return store;
    return { ...store, json: { ...store.json, storyRecords: worldStoryRecords(state, store.json.storyRecords || []) } };
}

export function applyWorldStoryProposal(state, proposal, source, version, eventId, key, range) {
    const value = structuredClone(state.modules?.story || { version: 1, records: [], candidates: [] });
    value.revision = version;
    const record = proposal.record;
    const current = isCurrentStoryProposal(proposal);
    const entry = { key, record: structuredClone(record), nature: proposal.nature, source, version, eventId, start: range.start, end: range.end };
    if (current) value.records = [...value.records.filter(item => item.record.id !== record.id), entry];
    else value.candidates.push(entry);
    return { value: validateWorldStoryState(value), outcome: current ? 'applied' : 'candidate' };
}
