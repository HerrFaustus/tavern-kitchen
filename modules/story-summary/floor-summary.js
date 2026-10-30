import { summaryBatchChanges } from './data/summary-undo.js';
import { floorChangeText } from '../story-state/view.js';
let activePanels;
export function refreshFloorSummaries() { activePanels?.schedule(); }

/** Preserve the actual batch provenance; an event's addedAt is not its source floor. */
export function projectFloorSummary(store, floor, invalidFrom = null) {
    if (!store || store.summaryInvalid || (invalidFrom != null && floor >= invalidFrom)) return null;
    const batch = store.summaryHistory?.find(item => item.kind === 'batch'
        && floor > item.previousEndMesId && floor <= item.endMesId);
    if (!batch || batch.endMesId > store.lastSummarizedMesId
        || (invalidFrom != null && batch.endMesId >= invalidFrom)) return null;
    const events = (store.json?.events || []).filter(event => event._addedAt === batch.endMesId && event.summary?.trim());
    if (!events.length) return null;
    return { start: batch.previousEndMesId + 1, end: batch.endMesId,
        text: events.map(event => event.title ? `${event.title}：${event.summary}` : event.summary).join('\n') };
}

export function projectFloorChanges(store, floor, invalidFrom = null) {
    if (!store || store.summaryInvalid || store.sourceInvalidFromFloor != null) return null;
    const batch = store.summaryHistory?.find(item => item.kind === 'batch' && floor > item.previousEndMesId && floor <= item.endMesId);
    if (!batch || batch.endMesId > store.lastSummarizedMesId || invalidFrom != null && batch.endMesId >= invalidFrom) return null;
    const changes = summaryBatchChanges(batch.undo).filter(change => change.collection !== 'keywords').map(floorChangeText).filter(Boolean);
    return { start: batch.previousEndMesId + 1, end: batch.endMesId, changes };
}

export function installFloorSummaries({ getSnapshot, openMemory, documentTarget = document, Observer = globalThis.MutationObserver }) {
    activePanels?.dispose();
    const doc = documentTarget;
    let timer = null, observer = null;
    const nodes = new Map();
    function refresh() {
        const snapshot = getSnapshot();
        if (!snapshot?.enabled) { clear(); return; }
        const { chat, store, invalidFrom } = snapshot;
        const live = new Set();
        for (const message of doc.querySelectorAll('#chat .mes[mesid]')) {
            const floor = Number(message.getAttribute('mesid'));
            const source = chat?.[floor];
            if (!Number.isInteger(floor) || !source || source.is_user || source.is_system) continue;
            const text = message.querySelector('.mes_text');
            if (!text) continue;
            live.add(message);
            let node = nodes.get(message);
            if (!node?.isConnected) {
                node = doc.createElement('details'); node.className = 'tk-floor-summary';
                const heading = doc.createElement('summary');
                const content = doc.createElement('p');
                const button = doc.createElement('button'); button.type = 'button'; button.className = 'menu_button'; button.textContent = '查看剧情';
                button.addEventListener('click', () => openMemory(Number(message.getAttribute('mesid'))));
                const changes = doc.createElement('details'); changes.className = 'tk-floor-changes';
                node.append(heading, content, changes, button); text.after(node); nodes.set(message, node);
            }
            const summary = projectFloorSummary(store, floor, invalidFrom);
            const changes = projectFloorChanges(store, floor, invalidFrom);
            const heading = summary
                ? summary.start === summary.end ? `第 ${floor + 1} 楼总结` : `区间总结 · 第 ${summary.start + 1}–${summary.end + 1} 楼`
                : `第 ${floor + 1} 楼 · ${store?.lastSummarizedMesId >= floor ? '暂无逐楼摘要' : '尚未总结'}`;
            const detail = summary?.text || '暂无可核实归属的摘要。可在剧情页生成或查看总结。';
            const signature = heading + '\n' + detail;
            const changeNode = node.querySelector('.tk-floor-changes');
            const changeSignature = JSON.stringify(changes);
            if (changeNode.dataset.signature !== changeSignature) {
                changeNode.replaceChildren(); changeNode.dataset.signature = changeSignature;
                changeNode.hidden = !changes?.changes.length;
                if (changes?.changes.length) {
                    const title = doc.createElement('summary');
                    title.textContent = `${changes.start === changes.end ? '本楼变化' : `区间变化 · 第 ${changes.start + 1}–${changes.end + 1} 楼`} · ${changes.changes.length} 项`;
                    const list = doc.createElement('ul');
                    for (const text of changes.changes) { const row = doc.createElement('li'); row.textContent = text; list.append(row); }
                    const note = doc.createElement('small'); note.textContent = '记录总结提交时的变化；之后的修订请查看当前资料。';
                    changeNode.append(title, list, note);
                }
            }
            if (node.dataset.signature !== signature) {
                node.querySelector('summary').textContent = heading;
                node.querySelector('p').textContent = detail;
                node.dataset.signature = signature;
                // Newly available summaries are readable immediately; preserve a user's later collapse.
                if ((summary || changes?.changes.length) && !node.dataset.hasSummary) node.open = true;
                node.dataset.hasSummary = summary ? 'true' : '';
            }
        }
        for (const [message, node] of nodes) if (!live.has(message)) { node.remove(); nodes.delete(message); }
    }
    function schedule() { if (timer === null) timer = setTimeout(() => { timer = null; refresh(); }, 80); }
    function clear() { for (const node of nodes.values()) node.remove(); nodes.clear(); }
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
