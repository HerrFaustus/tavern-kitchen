import { rollbackSummaryIfNeeded } from './store.js';
import { retireSummaryMemorySources, getPublishedSummaryMemory } from './memory-commit.js';
import { deleteChunksAtFloor, deleteChunksFromFloor } from '../vector/storage/chunk-store.js';
import { firstInvalidMemorySource } from './turn-source.js';

// Source retirement belongs to the consistency writer, not completion/UI events.
// New batches with exact source receipts also undo ordinary prose edits. Legacy
// batches keep their established edit policy; no provenance is inferred for them.
export function retainSourceChange(tracker, context, { kind = 'observed', floor = null } = {}) {
    tracker.retain(context, { kind, floor });
    const change = tracker.inspect(context);
    const receiptFloor = firstInvalidMemorySource(getPublishedSummaryMemory().storySummary, context.chat);
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
