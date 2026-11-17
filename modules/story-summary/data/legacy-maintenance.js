import { isMemoryPolicy } from './memory-policy.js';
import { LEGACY_MEMORY_COLLECTIONS, memoryItems, memoryKey, sameMemory, setMemoryItems } from './memory-json.js';

// WHY: Story proofreading (maintenance/) is retired in 0.2.36. These pure compatibility
// functions exist solely so 0.2.32-0.2.35 archives containing legacy `batch.maintenance`
// receipts can still load, validate, and roll back cleanly without loss.

function requireValidHistory(condition, code = 'invalid_history') {
    if (!condition) throw Object.assign(new Error(code), { code });
}

const overlaps = (a, b) => a.from <= b.to && b.from <= a.to;

function unionRanges(ranges) {
    const result = [];
    for (const range of [...ranges].sort((a, b) => a.from - b.from || a.to - b.to)) {
        if (range.to < range.from) continue;
        const last = result.at(-1);
        if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
        else result.push({ from: range.from, to: range.to });
    }
    return result;
}

export function activeLegacyMaintenanceChanges(operations) {
    return operations.flatMap(operation => operation.changes).filter(change => !change.retired);
}

export function legacyMaintenanceImpact(operations) {
    const changes = activeLegacyMaintenanceChanges(operations);
    return {
        eventIds: [...new Set(changes.filter(change => change.collection === 'events').map(change => change.key))],
        atomIds: [...new Set(changes.filter(change => change.collection === 'anchors').map(change => change.key))],
        floors: [...new Set(changes.filter(change => change.collection === 'anchors').flatMap(change => [change.before?.floor, change.after?.floor]).filter(Number.isInteger))],
        summary: changes.some(change => change.collection !== 'anchors'),
    };
}

export function restoreLegacyMaintenance(memory, receipts, { discardChanged = false } = {}) {
    const draft = structuredClone(memory);
    for (const receipt of [...receipts].reverse()) {
        for (const operation of [...receipt.operations].reverse()) {
            const groups = new Map();
            for (const change of activeLegacyMaintenanceChanges([operation])) {
                const items = memoryItems(draft, change.collection);
                const found = items.find(item => memoryKey(change.collection, item) === change.key) ?? null;
                if (!discardChanged) requireValidHistory(sameMemory(found, change.after), 'conflict');
                if (!groups.has(change.collection)) groups.set(change.collection, []);
                groups.get(change.collection).push(change);
            }
            for (const [collection, changes] of groups) {
                const keys = new Set(changes.map(change => change.key));
                const restored = memoryItems(draft, collection).filter(item => !keys.has(memoryKey(collection, item)));
                for (const change of changes.filter(change => change.before !== null).sort((a, b) => a.index - b.index)) {
                    restored.splice(change.index, 0, structuredClone(change.before));
                }
                setMemoryItems(draft, collection, restored);
            }
        }
    }
    return draft;
}

export function invalidateLegacyReceiptCompletion(receipt, ranges) {
    if (!receipt.completion) return receipt;
    const affected = ranges.filter(range => range.from <= range.to && overlaps(range, receipt.completion)).map(range => ({
        from: Math.max(range.from, receipt.completion.from),
        to: Math.min(range.to, receipt.completion.to),
    }));
    if (!affected.length) return receipt;
    const invalidated = unionRanges([...(receipt.invalidated || []), ...affected]);
    return sameMemory(invalidated, receipt.invalidated || []) ? receipt : { ...receipt, invalidated };
}

export function validateLegacyMaintenanceReceipt(receipt) {
    requireValidHistory(receipt?.version === 2 && typeof receipt.id === 'string' && typeof receipt.runId === 'string'
        && Array.isArray(receipt.operations) && Array.isArray(receipt.coverage?.supplied)
        && Array.isArray(receipt.coverage?.missingAnchors));
    requireValidHistory(isMemoryPolicy(receipt.policy));
    if (receipt.roundRevisionCount !== undefined) {
        requireValidHistory(Number.isSafeInteger(receipt.roundRevisionCount) && receipt.roundRevisionCount > 0);
    }
    if (receipt.outcome) {
        requireValidHistory(['completed', 'partial', 'cancelled', 'failed', 'turn_limit', 'input_limit', 'interrupted'].includes(receipt.outcome.status));
    }
    if (receipt.completion) {
        const validRange = range => Number.isInteger(range?.from) && Number.isInteger(range?.to)
            && range.from >= 1 && range.to >= range.from && range.to <= receipt.cutoff;
        requireValidHistory(validRange(receipt.completion) && receipt.operations.length === 0 && !receipt.outcome);
        requireValidHistory(receipt.invalidated === undefined || (Array.isArray(receipt.invalidated) && receipt.invalidated.every(range =>
            validRange(range) && range.from >= receipt.completion.from && range.to <= receipt.completion.to)));
    } else {
        requireValidHistory(receipt.invalidated === undefined);
    }
    for (const operation of receipt.operations) {
        requireValidHistory(['edit', 'delete', 'merge'].includes(operation.kind) && Array.isArray(operation.changes));
        for (const change of operation.changes) {
            requireValidHistory(LEGACY_MEMORY_COLLECTIONS.includes(change.collection) && typeof change.key === 'string'
                && Number.isInteger(change.index) && Object.hasOwn(change, 'before') && Object.hasOwn(change, 'after'));
            if (change.retired) {
                requireValidHistory(change.collection === 'anchors'
                    && ['source_changed', 'anchors_cleared'].includes(change.retired.reason) && Number.isFinite(change.retired.at));
            }
        }
    }
    return receipt;
}

export function upgradeLegacyMaintenanceReceipt(receipt) {
    const current = { ...receipt };
    delete current.mode;
    if (current.version === 2) return validateLegacyMaintenanceReceipt(current);
    requireValidHistory(receipt?.version === 1 && Array.isArray(receipt.coverage?.scope)
        && Array.isArray(receipt.coverage?.targets) && Array.isArray(receipt.coverage?.unfinished));
    const { coverage, calls, ...kept } = current;
    delete kept.part;
    delete kept.completion;
    return validateLegacyMaintenanceReceipt({
        ...kept,
        version: 2,
        coverage: { supplied: coverage.supplied, missingAnchors: coverage.missingAnchors },
        ...(calls ? { calls: calls.map(({ package: _package, ...call }) => call) } : {}),
    });
}
