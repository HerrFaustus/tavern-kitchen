import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { UPDATE_PREFIX, worldUpdates, worldSnapshotDigest } from './update-context.js';
import { validateStoredUpdate } from './update-result.js';

export function validateUpdateRecord(key, record) {
    if (record?.kind !== 'independent_world_update' || key !== `${UPDATE_PREFIX}${record.update?.requestId}`
        || !['ready', 'stale', 'retracted'].includes(record.status) || typeof record.fingerprint !== 'string'
        || record.fingerprint !== memoryDigest(record.update)) throw new Error('统一世界提案记录无效');
    validateStoredUpdate(record.update);
    if (record.reviews !== undefined) {
        if (!Array.isArray(record.reviews) || new Set(record.reviews.map(review => review.index)).size !== record.reviews.length) throw new Error('提案处理记录重复或无效');
        for (const review of record.reviews) {
            if (review?.version !== 1 || !Number.isSafeInteger(review.index) || review.index < 0 || review.index >= record.update.proposals.length
                || !['accepted', 'rejected'].includes(review.action) || !['applied', 'claim', 'candidate', 'rejected'].includes(review.outcome)
                || typeof review.reason !== 'string' || review.reason.length > 1000 || typeof review.edited !== 'boolean'
                || review.mode !== undefined && !['manual', 'automatic'].includes(review.mode)
                || typeof review.commandId !== 'string' || !review.commandId || review.eventId !== `event:${review.commandId}`
                || !Number.isSafeInteger(review.worldVersion) || review.worldVersion < 1
                || review.fingerprint !== memoryDigest({ action: review.action, proposal: review.proposal, reason: review.reason })) throw new Error('提案处理记录无效');
            if (review.action === 'accepted') validateStoredUpdate({ ...record.update, proposals: [review.proposal] });
            else if (review.proposal !== null || review.outcome !== 'rejected') throw new Error('拒绝提案不能包含写入结果');
        }
    }
    return record;
}

export function prepareUpdateOperations(state, history, chat) {
    const operations = [], retained = new Set();
    for (const batch of history) {
        if (!batch.worldUpdate) continue;
        const update = validateStoredUpdate(batch.worldUpdate), key = `${UPDATE_PREFIX}${update.requestId}`, previous = state.sources[key];
        if (update.basis.worldId !== state.worldId) continue;
        // A fork inherits only deliveries that were actually on that branch.
        if (update.basis.branchId !== state.branchId && !previous) continue;
        const fingerprint = memoryDigest(update);
        if (previous && previous.fingerprint !== fingerprint) throw new Error('同一世界更新编号不能交付不同内容');
        const sourceCurrent = !batch.floorEntry?.deleted && isRangeSourceCurrent(update.source, chat);
        let status = sourceCurrent ? previous?.status || (worldSnapshotDigest(state) === update.basis.digest ? 'ready' : 'stale') : 'retracted';
        if (status === 'retracted' && sourceCurrent) status = worldSnapshotDigest(state) === update.basis.digest ? 'ready' : 'stale';
        const record = { kind: 'independent_world_update', status, fingerprint, update: structuredClone(update),
            ...(previous?.reviews ? { reviews: structuredClone(previous.reviews) } : {}) };
        retained.add(update.requestId);
        if (!previous || memoryDigest(previous) !== memoryDigest(record)) operations.push({ type: 'source', module: key, snapshot: record });
    }
    for (const record of worldUpdates(state)) if (!retained.has(record.update.requestId) && record.status !== 'retracted') {
        operations.push({ type: 'source', module: `${UPDATE_PREFIX}${record.update.requestId}`, snapshot: { ...record, status: 'retracted' } });
    }
    return operations;
}
