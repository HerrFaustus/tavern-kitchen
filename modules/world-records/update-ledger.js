import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { UPDATE_PREFIX, worldUpdates, worldSnapshotDigest } from './update-context.js';
import { validateStoredUpdate } from './update-result.js';

export function validateUpdateRecord(key, record) {
    if (record?.kind !== 'independent_world_update' || key !== `${UPDATE_PREFIX}${record.update?.requestId}`
        || !['ready', 'stale', 'retracted'].includes(record.status) || typeof record.fingerprint !== 'string'
        || record.fingerprint !== memoryDigest(record.update)) throw new Error('统一世界提案记录无效');
    validateStoredUpdate(record.update); return record;
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
        const record = { kind: 'independent_world_update', status, fingerprint, update: structuredClone(update) };
        retained.add(update.requestId);
        if (!previous || memoryDigest(previous) !== memoryDigest(record)) operations.push({ type: 'source', module: key, snapshot: record });
    }
    for (const record of worldUpdates(state)) if (!retained.has(record.update.requestId) && record.status !== 'retracted') {
        operations.push({ type: 'source', module: `${UPDATE_PREFIX}${record.update.requestId}`, snapshot: { ...record, status: 'retracted' } });
    }
    return operations;
}
