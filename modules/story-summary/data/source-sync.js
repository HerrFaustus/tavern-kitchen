import { rollbackSummaryIfNeeded } from './store.js';
import { retireSummaryMemorySources, getPublishedSummaryMemory } from './memory-commit.js';
import { deleteChunksAtFloor, deleteChunksFromFloor } from '../vector/storage/chunk-store.js';
import { firstInvalidMemorySource } from './turn-source.js';

// Source retirement belongs to the consistency writer, not completion/UI events.
// A host edit names its exact floor, even for old imports without fingerprints.
// Passive observation can only invalidate summaries when their receipts prove a text change.
export function retainSourceChange(tracker, context, { kind = 'observed', floor = null } = {}) {
    const store = getPublishedSummaryMemory().storySummary;
    tracker.retain(context, { kind, floor, summarizedThrough: store.lastSummarizedMesId ?? -1 });
    const change = tracker.inspect(context);
    const receiptFloor = firstInvalidMemorySource(store, context.chat);
    if (change && receiptFloor !== null) change.rollbackFromFloor = Math.min(change.rollbackFromFloor ?? Infinity, receiptFloor);
    if (change) retireSummaryMemorySources(context.chatId, {
        fromFloor: change.rollbackFromFloor == null ? change.fromFloor : Math.min(change.fromFloor ?? Infinity, change.rollbackFromFloor),
        floors: change.anchorFloors,
    });
    return change;
}

export function synchronizeSourceCaches(tracker, context, {
    kind = 'observed', floor = null, isCurrent = () => true, getCurrentContext = () => context,
} = {}) {
    if (!isCurrent()) return Promise.resolve({ status: 'stale' });
    const retained = retainSourceChange(tracker, context, { kind, floor });
    const invalid = firstInvalidMemorySource(getPublishedSummaryMemory().storySummary, context.chat);
    if (!retained && invalid !== null) return rollbackSummaryIfNeeded({ changedFromFloor: invalid });
    return tracker.synchronize(context, change => {
        const rollbackFloor = Math.min(change.rollbackFromFloor ?? Infinity, firstInvalidMemorySource(getPublishedSummaryMemory().storySummary, context.chat) ?? Infinity);
        return rollbackSummaryIfNeeded({
            ...(Number.isFinite(rollbackFloor) ? { changedFromFloor: rollbackFloor } : {}),
            ...(change.fromFloor === null ? { invalidateFloors: change.anchorFloors } : { invalidateFromFloor: change.fromFloor }),
            invalidateSourceCache: async () => {
                if (change.fromFloor !== null) await deleteChunksFromFloor(context.chatId, change.fromFloor);
                else for (const editedFloor of change.editedFloors) await deleteChunksAtFloor(context.chatId, editedFloor);
            },
        });
    }, () => isCurrent() ? getCurrentContext() : null);
}
