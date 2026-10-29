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
                const button = doc.createElement('button'); button.type = 'button'; button.className = 'menu_button'; button.textContent = '查看记忆';
                button.addEventListener('click', () => openMemory(Number(message.getAttribute('mesid'))));
                node.append(heading, content, button); text.after(node); nodes.set(message, node);
            }
            const summary = projectFloorSummary(store, floor, invalidFrom);
            const heading = summary
                ? summary.start === summary.end ? `第 ${floor} 楼总结` : `区间总结 · 第 ${summary.start}–${summary.end} 楼`
                : `第 ${floor} 楼 · ${store?.lastSummarizedMesId >= floor ? '暂无逐楼摘要' : '尚未总结'}`;
            const detail = summary?.text || '暂无可核实归属的摘要。可在记忆页生成或查看总结。';
            const signature = heading + '\n' + detail;
            if (node.dataset.signature !== signature) {
                node.querySelector('summary').textContent = heading;
                node.querySelector('p').textContent = detail;
                node.dataset.signature = signature;
                // Newly available summaries are readable immediately; preserve a user's later collapse.
                if (summary && !node.dataset.hasSummary) node.open = true;
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
