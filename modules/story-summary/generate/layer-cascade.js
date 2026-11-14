import { createIdentifier } from '../../../shared/common/identifier.js';
import { DEFAULT_LEAF_KEEP_RECENT, planNextCompression } from '../data/summary-layers.js';

/**
 * Recursively roll up uncompressed summary roots across L0 -> L1 -> L2 -> L3+
 * without deleting any underlying L0 leaves. Stops when no level meets
 * `thresholdForLevel(level) + (level === 0 ? leafKeepRecent : 0)` or `maxNodes` is hit.
 */
export async function runRecursiveCompressionCascade(store, {
    chat = null,
    isLeafCurrent = null,
    leafKeepRecent = DEFAULT_LEAF_KEEP_RECENT,
    summarizeLayer,
    maxNodes = 16,
    signal = null,
} = {}) {
    if (!store?.summaryHistory?.length || typeof summarizeLayer !== 'function') return [];
    const staged = [];
    for (let step = 0; step < maxNodes; step++) {
        if (signal?.aborted) break;
        const plan = planNextCompression(store.summaryHistory, {
            chat,
            staged,
            isLeafCurrent,
            leafKeepRecent,
        });
        if (!plan) break;
        const reason = `自动层叠压缩(${plan.sourceLevel === 0 ? '本轮摘要' : plan.nodes[0].level}→${plan.level})`;
        const text = String(await summarizeLayer({
            level: plan.level,
            depth: plan.depth,
            children: plan.nodes,
            reason,
            signal,
        }) || '').trim();
        if (!text) break;
        staged.push({
            id: `layer-${createIdentifier()}`,
            level: plan.level,
            depth: plan.depth,
            start: plan.start,
            end: plan.end,
            text,
            sourceId: plan.sourceId,
            childIds: plan.childIds,
            timeStart: plan.timeStart,
            timeEnd: plan.timeEnd,
            reason,
            createdAt: Date.now(),
        });
    }
    return staged;
}
