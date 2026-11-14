import { projectLayers, reviewedRounds, summaryLayers } from '../data/summary-layers.js';
import { firstInvalidMemorySource, isRangeSourceCurrent } from '../data/turn-source.js';
import { isFloorEntryCurrent } from '../inline/ledger.js';

// The chronological backbone is independent of retrieval hits. This consumes
// source-linked summaries. Only a complete group behind the visibility boundary
// can replace its children.
export function plotBackgroundItems(store, chat, hiddenThrough) {
    if (store?.summaryInvalid || store?.sourceInvalidFromFloor != null || firstInvalidMemorySource(store, chat) != null) return [];
    const items = [];
    for (const batch of reviewedRounds(store?.summaryHistory)) {
        if (batch.floorEntry?.omitted || batch.floorEntry?.deleted) continue;
        const source = batch.sourceReceipt?.source || batch.roundSource;
        if (source && !isRangeSourceCurrent(source, chat)) continue;
        if (batch.floorEntry && !isFloorEntryCurrent(batch.floorEntry, chat)) continue;
        const start = source?.start ?? batch.floorEntry?.source?.start ?? (batch.previousEndMesId ?? -1) + 1;
        const end = source?.end ?? batch.endMesId;
        const text = [batch.summary, ...(batch.importedRounds || []).map(row => row.timeLabel + ' ' + row.summary)].filter(Boolean).join('\n');
        if (!text || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end > hiddenThrough) continue;
        const timeStart = String(batch.timeStart || batch.storyTimeStart || batch.importedRounds?.[0]?.timeLabel || batch.storyTime || '').trim();
        const timeEnd = String(batch.timeEnd || batch.storyTimeEnd || batch.memoryTags?.times?.at(-1) || batch.storyTime || timeStart).trim();
        items.push({
            start,
            end,
            text: String(text),
            sourceId: batch.sourceReceipt?.id || null,
            level: 'round',
            depth: 0,
            timeStart,
            timeEnd,
            storyTime: String(batch.storyTime || timeEnd || timeStart).trim(),
        });
    }
    const { parents } = summaryLayers(store?.summaryHistory, [], { chat, isLeafCurrent: isFloorEntryCurrent });
    return projectLayers(items.sort((a, b) => a.start - b.start || a.end - b.end), parents, hiddenThrough);
}
