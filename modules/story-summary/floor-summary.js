import { summaryBatchChanges } from './data/summary-undo.js';
import { floorChangeText } from '../story-state/view.js';
import { createFloorPanel } from './inline/panel.js';
import { isNarrativeReply } from './inline/protocol.js';
let activePanels;
export function refreshFloorSummaries() { activePanels?.schedule(); }

/** Preserve the actual batch provenance; an event's addedAt is not its source floor. */
export function projectFloorSummary(store, floor, invalidFrom = null) {
    if (!store || store.summaryInvalid || (invalidFrom != null && floor >= invalidFrom)) return null;
    const batch = store.summaryHistory?.find(item => item.kind === 'batch'
        && floor > item.previousEndMesId && floor <= item.endMesId && (!item.floorEntry || item.floorEntry.floor === floor));
    if (!batch || batch.endMesId > store.lastSummarizedMesId
        || (invalidFrom != null && batch.endMesId >= invalidFrom)) return null;
    const events = (store.json?.events || []).filter(event => event._addedAt === batch.endMesId && event.summary?.trim());
    if (!events.length) return null;
    return { start: batch.previousEndMesId + 1, end: batch.endMesId,
        text: events.map(event => event.title ? `${event.title}：${event.summary}` : event.summary).join('\n') };
}

export function projectFloorChanges(store, floor, invalidFrom = null) {
    if (!store || store.summaryInvalid || store.sourceInvalidFromFloor != null) return null;
    const batch = store.summaryHistory?.find(item => item.kind === 'batch' && floor > item.previousEndMesId && floor <= item.endMesId
        && (!item.floorEntry || item.floorEntry.floor === floor));
    if (!batch || batch.endMesId > store.lastSummarizedMesId || invalidFrom != null && batch.endMesId >= invalidFrom) return null;
    const changes = summaryBatchChanges(batch.undo).filter(change => change.collection !== 'keywords').map(floorChangeText).filter(Boolean);
    return { start: batch.previousEndMesId + 1, end: batch.endMesId, changes };
}

export function installFloorSummaries({ getSnapshot, openMemory, updateFloor, extractFloor, documentTarget = document, Observer = globalThis.MutationObserver }) {
    activePanels?.dispose();
    const doc = documentTarget;
    let timer = null, observer = null;
    const nodes = new Map();
    function refresh() {
        const snapshot = getSnapshot();
        if (!snapshot?.enabled) { clear(); return; }
        const live = new Set();
        for (const message of doc.querySelectorAll('#chat .mes[mesid]')) {
            const floor = Number(message.getAttribute('mesid'));
            const source = snapshot.chat?.[floor];
            if (!Number.isInteger(floor) || !isNarrativeReply(source)) continue;
            const text = message.querySelector('.mes_text');
            if (!text) continue;
            live.add(message);
            let panel = nodes.get(message);
            if (!panel?.node.isConnected || panel.floor !== floor) {
                panel?.node.remove();
                panel = createFloorPanel({ doc, floor, openMemory, updateFloor, extractFloor, schedule });
                text.after(panel.node); nodes.set(message, panel);
            }
            panel.refresh(snapshot);
        }
        for (const [message, panel] of nodes) if (!live.has(message)) { panel.node.remove(); nodes.delete(message); }
    }
    function schedule() { if (timer === null) timer = setTimeout(() => { timer = null; refresh(); }, 80); }
    function clear() { for (const panel of nodes.values()) panel.node.remove(); nodes.clear(); }
    const chatRoot = doc.getElementById('chat');
    if (chatRoot) {
        observer = new Observer(records => {
            if (records.some(record => !record.target.closest?.('.tk-floor-summary')
                && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
                    && !node.classList?.contains('tk-floor-summary')))) schedule();
        });
        observer.observe(chatRoot, { childList: true, subtree: true });
    }
    const api = { schedule, reset() { clear(); schedule(); }, dispose() {
        if (timer !== null) clearTimeout(timer);
        observer?.disconnect(); clear(); if (activePanels === api) activePanels = null;
    } };
    activePanels = api; schedule();
    return api;
}
