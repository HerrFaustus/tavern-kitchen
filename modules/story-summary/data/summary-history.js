import { normalizeSummaryUndo } from './summary-undo.js';
import { validateMaintenanceReceipt, upgradeMaintenanceReceipt } from '../maintenance/history.js';
import { isMemoryPolicy } from './memory-policy.js';
import { validateMemorySourceReceipt, validateRangeSource } from './turn-source.js';
import { validateStoredUpdate } from '../../world-records/update-result.js';
import { validateMemoryTags } from './memory-tags.js';

function valid(condition) {
    if (!condition) throw Object.assign(new Error('summary_history_invalid'), { code: 'summary_history_invalid' });
}

export function createSummaryBaseline(endMesId) {
    valid(Number.isInteger(endMesId) && endMesId >= 0);
    return { format: 2, kind: 'baseline', endMesId, maintenance: [] };
}

export function createSummaryBatch(previousEndMesId, endMesId, undo, policy) {
    const normalized = normalizeSummaryUndo(undo);
    valid(normalized && Number.isInteger(previousEndMesId) && previousEndMesId >= -1
        && Number.isInteger(endMesId) && previousEndMesId < endMesId);
    valid(policy === undefined || isMemoryPolicy(policy));
    return { format: 2, kind: 'batch', previousEndMesId, endMesId, undo: normalized, maintenance: [], ...(policy ? { policy: structuredClone(policy) } : {}) };
}

/**
 * Upstream boundary-only history and v1 exact batches are converted once on metadata load.
 * Boundary-only entries have no inverse: retain only their latest starting boundary, never guess undo.
 * Remove these adapters when those upstream file formats are no longer supported.
 */
export function upgradeSummaryHistory(history) {
    if (history == null) return { value: [], changed: false };
    valid(Array.isArray(history));
    const value = [];
    for (const entry of history) {
        valid(entry && Number.isInteger(entry.endMesId) && entry.endMesId >= 0);
        if (entry.format == null) {
            valid(!Object.hasOwn(entry, 'undo') && !Object.hasOwn(entry, 'previousEndMesId'));
            value.length = 0;
            value.push(createSummaryBaseline(entry.endMesId));
        } else if (entry.format === 1) {
            value.push(createSummaryBatch(entry.previousEndMesId, entry.endMesId, entry.undo));
        } else {
            valid(entry.format === 2 && ['baseline', 'batch'].includes(entry.kind) && Array.isArray(entry.maintenance));
            if (entry.kind === 'baseline') valid(!value.length && entry.undo == null && entry.previousEndMesId == null);
            else createSummaryBatch(entry.previousEndMesId, entry.endMesId, entry.undo, entry.policy);
            if (entry.roundVersion !== undefined) valid(Number.isSafeInteger(entry.roundVersion) && entry.roundVersion >= 0);
            if (entry.roundSource) {
                validateRangeSource(entry.roundSource);
                valid(entry.kind === 'batch' && entry.roundSource.end === entry.endMesId);
            }
            if (entry.roundRevisions) valid(Array.isArray(entry.roundRevisions) && entry.roundRevisions.every(change =>
                change?.version === 1 && Number.isSafeInteger(change.baseVersion) && change.baseVersion >= 0 && Number.isSafeInteger(change.end) && change.end <= entry.endMesId
                && typeof change.sourceId === 'string' && typeof change.previous === 'string'
                && typeof change.text === 'string' && change.text.trim() && change.text.length <= 12000
                && Number.isSafeInteger(change.evidence?.floor) && typeof change.evidence.quote === 'string' && change.evidence.quote.trim()));
            for (const revision of entry.roundRevisions || []) if (revision.memoryTags) validateMemoryTags(revision.memoryTags);
            if (entry.sourceReceipt) {
                validateMemorySourceReceipt(entry.sourceReceipt);
                valid(entry.kind === 'batch' && entry.sourceReceipt.source.end === entry.endMesId);
            }
            if (entry.worldUpdate) {
                validateStoredUpdate(entry.worldUpdate);
                const receipt = entry.sourceReceipt, update = entry.worldUpdate;
                valid(receipt?.id === update.requestId && update.source.end === entry.endMesId
                    && receipt.worldId === update.basis.worldId && receipt.branchId === update.basis.branchId
                    && receipt.basisVersion === update.basis.version && receipt.source.digest === update.source.digest
                    && receipt.source.start === update.source.start);
            }
            if (entry.memoryTags) {
                validateMemoryTags(entry.memoryTags);
                valid(entry.kind === 'batch' && (entry.sourceReceipt || entry.roundSource) && typeof entry.summary === 'string');
            }
            value.push({ ...entry, maintenance: entry.maintenance.map(upgradeMaintenanceReceipt) });
        }
    }
    // An exact imported/truncated history can name an earlier boundary without
    // carrying its batches. That named starting state is not itself reversible.
    if (value[0]?.kind === 'batch' && value[0].previousEndMesId >= 0) value.unshift(createSummaryBaseline(value[0].previousEndMesId));
    for (let i = 1; i < value.length; i++) {
        valid(value[i].kind === 'batch' && value[i].previousEndMesId === value[i - 1].endMesId);
    }
    return { value, changed: JSON.stringify(value) !== JSON.stringify(history) };
}

export function appendMaintenanceReceipt(store, receipt, boundary = store.lastSummarizedMesId) {
    validateMaintenanceReceipt(receipt);
    const batch = store.summaryHistory?.find(entry => entry.endMesId === boundary);
    valid(batch);
    batch.maintenance.push(receipt);
}

export function getRollbackOnceTargetEndMesId(store) {
    if (store?.summaryInvalid) return null;
    const current = store?.summaryHistory?.find(entry => entry.endMesId === store.lastSummarizedMesId);
    if (!current) return null;
    if (current.kind === 'baseline') return current.maintenance.length ? current.endMesId : null;
    valid(current.kind === 'batch' && normalizeSummaryUndo(current.undo));
    return current.previousEndMesId;
}
