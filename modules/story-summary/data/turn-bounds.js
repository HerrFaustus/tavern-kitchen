import { getSummarySourceEnd } from '../generate/source-boundary.js';
import { beforeRecentTurns } from './narrative-window.js';
import { isNarrativeReply } from './turn-source.js';

/**
 * Compute lag-1 update boundary and independent per-floor simulation boundary.
 * WHY: `0.2.36` settles structured world state & summaries one narrative AI floor behind
 * the latest reply (`updateEnd`), while Simulation runs up to the latest completed narrative
 * AI reply (`simulationEnd`) without touching structured archives.
 */
export function getUpdateAndSimulationBounds(chat, requestedEnd = undefined) {
    if (!Array.isArray(chat) || !chat.length) {
        return { stableEnd: -1, simulationEnd: -1, updateEnd: -1 };
    }
    const maxEnd = requestedEnd === undefined ? chat.length - 1 : requestedEnd;
    const stableEnd = getSummarySourceEnd(chat, maxEnd);
    if (stableEnd < 0) {
        return { stableEnd: -1, simulationEnd: -1, updateEnd: -1 };
    }
    const simulationEnd = beforeRecentTurns(chat, stableEnd, 0);
    const updateEnd = beforeRecentTurns(chat, stableEnd, 1);
    return { stableEnd, simulationEnd, updateEnd };
}

/**
 * Build the combined message text indexed into `raw-recall` for settled floors (`<= lastSummarizedMesId`).
 * WHY: Settled floors absorb their Simulation "后台正文" into original-prose recall alongside main prose,
 * whereas un-updated tail floors remain volatile until settled at `updateEnd`.
 */
export function floorRecallMessage(floor, message, store = null) {
    if (!message || !isNarrativeReply(message)) return message;
    const settledLimit = store?.lastSummarizedMesId ?? -1;
    if (floor > settledLimit) return message;
    const sim = store?.floorSimulations?.[floor];
    const simText = typeof sim?.text === 'string' ? sim.text.trim() : '';
    if (!simText) return message;
    const candidate = message.swipe_id ?? 0;
    if (sim.candidate != null && sim.candidate !== candidate) return message;
    const mainText = typeof message.mes === 'string' ? message.mes : '';
    return { ...message, mes: mainText ? `${mainText}\n\n[后台正文]\n${simText}` : `[后台正文]\n${simText}` };
}
