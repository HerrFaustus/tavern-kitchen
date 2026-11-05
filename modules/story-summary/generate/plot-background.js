import { firstInvalidMemorySource, isRangeSourceCurrent } from '../data/turn-source.js';
import { isFloorEntryCurrent } from '../inline/ledger.js';
import { parseEventRange } from '../vector/retrieval/temporal-turn-carrier.js';

// The chronological backbone is independent of retrieval hits. This consumes
// existing leaves; stage/chapter/volume compression will replace covered leaves
// through an explicit source tree, not by pretending a selected event is one.
export function plotBackgroundItems(store, chat, hiddenThrough) {
    if (store?.summaryInvalid || store?.sourceInvalidFromFloor != null || firstInvalidMemorySource(store, chat) != null) return [];
    const items = [];
    const covered = [];
    const omitted = new Set();
    for (const batch of store?.summaryHistory || []) {
        if (batch.floorEntry?.omitted) { omitted.add(batch.floorEntry.floor); continue; }
        const source = batch.sourceReceipt?.source;
        if (source && !isRangeSourceCurrent(source, chat)) continue;
        if (batch.floorEntry && !isFloorEntryCurrent(batch.floorEntry, chat)) continue;
        const start = source?.start ?? batch.floorEntry?.source?.start ?? batch.previousEndMesId + 1;
        const end = source?.end ?? batch.endMesId;
        const text = batch.summary || batch.floorEntry?.payload?.summary;
        if (!text || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end > hiddenThrough) continue;
        items.push({ start, end, text: String(text), sourceId: batch.sourceReceipt?.id || null });
        covered.push({ start, end });
    }
    for (const event of store?.json?.events || []) {
        const range = parseEventRange(event.summary);
        if (!range || range.end > hiddenThrough || omitted.has(range.end)
            || covered.some(item => item.start <= range.start && item.end >= range.end)) continue;
        items.push({ ...range, text: [event.title, String(event.summary || '').replace(/\s*\(#\d+(?:-\d+)?\)\s*$/, '')].filter(Boolean).join('：'),
            sourceId: null });
    }
    return items.sort((a, b) => a.start - b.start || a.end - b.end);
}
