import { reviewedRounds } from './data/summary-layers.js';
import { summaryBatchChanges } from './data/summary-undo.js';
import { getUpdateAndSimulationBounds } from './data/turn-bounds.js';
import { floorSource, isNarrativeReply } from './inline/protocol.js';
import { floorChangeText } from '../story-state/view.js';

let activePanels = null;
export function refreshFloorSummaries() { activePanels?.schedule(); }

function findBatchForFloor(history, floor) {
    return (history || []).find(item => item?.kind === 'batch'
        && floor > (item.previousEndMesId ?? -1)
        && floor <= item.endMesId
        && (!item.floorEntry || item.floorEntry.floor === floor));
}

export function projectFloorSummary(store, floor, invalidFrom = null) {
    if (!store || store.summaryInvalid || (invalidFrom != null && floor >= invalidFrom)) return null;
    const batch = findBatchForFloor(reviewedRounds(store.summaryHistory), floor);
    if (!batch || batch.endMesId > (store.lastSummarizedMesId ?? -1)
        || (invalidFrom != null && batch.endMesId >= invalidFrom)) return null;
    if (typeof batch.summary === 'string' && batch.summary.trim()) {
        return { start: (batch.previousEndMesId ?? -1) + 1, end: batch.endMesId, text: batch.summary.trim(), batch };
    }
    return null;
}

export function projectFloorChanges(store, floor, invalidFrom = null) {
    if (!store || store.summaryInvalid || store.sourceInvalidFromFloor != null) return null;
    const batch = findBatchForFloor(store.summaryHistory, floor);
    if (!batch || batch.endMesId > (store.lastSummarizedMesId ?? -1)
        || (invalidFrom != null && batch.endMesId >= invalidFrom)) return null;
    const changes = summaryBatchChanges(batch.undo).filter(change => change.collection !== 'keywords').map(floorChangeText).filter(Boolean);
    return { start: (batch.previousEndMesId ?? -1) + 1, end: batch.endMesId, changes };
}

export function projectFloorSimulation(store, chat, floor, bounds = getUpdateAndSimulationBounds(chat)) {
    const message = chat?.[floor];
    if (!isNarrativeReply(message)) return { status: 'none' };
    const sim = store?.floorSimulations?.[floor];
    const source = floorSource(chat, floor);
    if (sim && source && sim.digest === source.digest && typeof sim.text === 'string' && sim.text.trim()) {
        return {
            status: 'ready',
            floor,
            text: sim.text.trim(),
            tag: typeof sim.tag === 'string' ? sim.tag.trim() : '',
            isLatest: floor === bounds.simulationEnd,
        };
    }
    const settled = Boolean(projectFloorSummary(store, floor))
        || (bounds.updateEnd >= 0 && floor <= (store?.lastSummarizedMesId ?? -1));
    // WHY: Pre-0.2.36 settled historical floors have no floorSimulations data; hide simulation box smoothly without retro-backfill.
    if (!sim && settled) return { status: 'none' };
    if (sim && source && sim.digest !== source.digest) {
        return { status: 'pending', floor, text: '本楼候选已切换，正在等待推演 Agent 重新生成后台正文…', tag: '', isLatest: floor === bounds.simulationEnd };
    }
    if (floor <= bounds.simulationEnd) {
        return { status: 'pending', floor, text: '等待推演 Agent 生成本楼后台正文…', tag: '', isLatest: floor === bounds.simulationEnd };
    }
    return { status: 'none' };
}

function el(doc, tag, className, text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function buildUpdateBox(doc, state, { floor, openMemory, existingOpen }) {
    const details = el(doc, 'details', 'tk-fp tk-floor-box tk-floor-update-box');
    details.dataset.tkBox = 'update';
    details.open = existingOpen;

    const summary = el(doc, 'summary', 'tk-fp-head');
    const headTop = el(doc, 'span', 'tk-fp-head-top');
    const badge = el(doc, 'span', `tk-fp-floor${state.status === 'settled' ? '' : ' is-pending'}`, `更新 · 第 ${floor + 1} 楼`);
    const statusLabel = el(doc, 'span', 'tk-fp-status', state.statusLabel);
    headTop.append(badge, statusLabel);
    if (openMemory && state.status === 'settled') {
        const openBtn = el(doc, 'button', 'tk-fp-button tk-fp-head-action', '详情');
        openBtn.type = 'button';
        openBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openMemory(floor);
        });
        headTop.append(openBtn);
    }
    const toggleCol = el(doc, 'span', 'tk-fp-toggle');
    const preview = el(doc, 'span', 'tk-fp-preview', state.preview);
    toggleCol.append(headTop, preview);
    summary.append(toggleCol);

    const body = el(doc, 'div', 'tk-fp-body');
    if (state.status === 'settled') {
        body.append(el(doc, 'div', 'tk-fp-summary', state.summaryText));
        if (state.chips.length) {
            const chips = el(doc, 'div', 'tk-fp-chips');
            for (const label of state.chips) chips.append(el(doc, 'span', 'tk-fp-chip', label));
            body.append(chips);
        }
        if (state.changes.length) {
            const group = el(doc, 'div', 'tk-fp-group');
            group.append(el(doc, 'h4', '', `本楼变更（${state.changes.length}）`));
            const list = el(doc, 'div', 'tk-fp-tags');
            for (const line of state.changes) {
                const row = el(doc, 'div', 'tk-fp-tagline');
                row.append(el(doc, 'span', 'tk-fp-tagmain', line));
                list.append(row);
            }
            group.append(list);
            body.append(group);
        }
        if (state.warnings.length) {
            body.append(el(doc, 'p', 'tk-fp-notice', `已自动跳过 ${state.warnings.length} 条存在歧义的变化并记入日志。`));
        }
    } else {
        body.append(el(doc, 'p', 'tk-fp-notice', state.bodyNotice));
    }

    details.append(summary, body);
    return details;
}

function buildSimulationBox(doc, sim, { existingOpen, onUserToggle }) {
    const details = el(doc, 'details', 'tk-fp tk-floor-box tk-floor-sim-box');
    details.dataset.tkBox = 'simulation';
    details.open = existingOpen;
    details.addEventListener('toggle', () => onUserToggle(details.open));

    const summary = el(doc, 'summary', 'tk-fp-head');
    const headTop = el(doc, 'span', 'tk-fp-head-top');
    const badge = el(doc, 'span', `tk-fp-floor is-sim${sim.status === 'ready' ? '' : ' is-pending'}`, '推演 · 后台正文');
    headTop.append(badge);
    if (sim.tag) headTop.append(el(doc, 'span', 'tk-fp-chip', sim.tag));
    headTop.append(el(doc, 'span', 'tk-fp-status', sim.status === 'ready' ? '已推演' : '待推演'));

    const toggleCol = el(doc, 'span', 'tk-fp-toggle');
    const preview = el(doc, 'span', 'tk-fp-preview', sim.text);
    toggleCol.append(headTop, preview);
    summary.append(toggleCol);

    const body = el(doc, 'div', 'tk-fp-body');
    if (sim.status === 'ready') {
        body.append(el(doc, 'div', 'tk-fp-sim-body', sim.text));
    } else {
        body.append(el(doc, 'p', 'tk-fp-notice', sim.text));
    }

    details.append(summary, body);
    return details;
}

function buildUpdateViewState(snapshot, floor, bounds) {
    const { store, invalidFrom } = snapshot;
    const summary = projectFloorSummary(store, floor, invalidFrom);
    if (summary) {
        const changes = projectFloorChanges(store, floor, invalidFrom)?.changes || [];
        const tags = summary.batch?.memoryTags || {};
        const chips = [
            ...(tags.times || []).slice(0, 2),
            ...(tags.locations || []).slice(0, 2),
        ].filter(Boolean);
        const warnings = store?.floorWork?.[floor]?.warnings || [];
        return {
            status: 'settled',
            statusLabel: '已更新',
            preview: summary.text,
            summaryText: summary.text,
            chips,
            changes,
            warnings,
        };
    }
    if (bounds.updateEnd < 0 || floor > bounds.updateEnd) {
        return {
            status: 'waiting',
            statusLabel: '待下一楼后总结',
            preview: '等待下一楼回复完成后总结',
            bodyNotice: '等待下一楼回复完成后总结本楼，并同步合并本楼后台正文与世界状态变化。',
        };
    }
    return {
        status: 'pending',
        statusLabel: '待补齐',
        preview: '当前楼层尚待总结更新',
        bodyNotice: '该楼层尚待更新 Agent 处理，请等待队列完成或在底部操作栏点击重试/补齐。',
    };
}

export function installFloorSummaries({ getSnapshot, openMemory, documentTarget = document, Observer = globalThis.MutationObserver }) {
    activePanels?.dispose();
    const doc = documentTarget;
    let timer = null, observer = null;
    const nodes = new Map();
    const simUserToggles = new Map();

    function renderFloor(floor, textContainer, snapshot, bounds) {
        let holder = nodes.get(floor);
        if (!holder || !holder.node.isConnected) {
            holder = { node: el(doc, 'section', 'tk-floor-summary') };
            holder.node.dataset.floor = String(floor);
            holder.node.setAttribute('aria-label', `第 ${floor + 1} 楼后厨记录`);
            nodes.set(floor, holder);
        }
        if (holder.node.previousElementSibling !== textContainer && holder.node.parentElement !== textContainer.parentElement) {
            textContainer.after(holder.node);
        } else if (holder.node.previousElementSibling !== textContainer) {
            textContainer.after(holder.node);
        }

        const prevUpdateOpen = holder.node.querySelector('[data-tk-box="update"]')?.open === true;
        const sim = projectFloorSimulation(snapshot.store, snapshot.chat, floor, bounds);
        const existingSimEl = holder.node.querySelector('[data-tk-box="simulation"]');
        const defaultSimOpen = sim.status === 'ready' && sim.isLatest;
        const prevSimOpen = simUserToggles.has(floor)
            ? simUserToggles.get(floor)
            : (existingSimEl ? existingSimEl.open : defaultSimOpen);

        const updateState = buildUpdateViewState(snapshot, floor, bounds);
        const signature = JSON.stringify({ updateState, sim });
        if (holder.signature === signature) return;
        holder.signature = signature;

        const children = [
            buildUpdateBox(doc, updateState, { floor, openMemory, existingOpen: prevUpdateOpen }),
        ];
        if (sim.status !== 'none') {
            children.push(buildSimulationBox(doc, sim, {
                existingOpen: prevSimOpen,
                onUserToggle: open => simUserToggles.set(floor, open),
            }));
        }
        holder.node.replaceChildren(...children);
    }

    function refresh() {
        const snapshot = getSnapshot();
        if (!snapshot?.enabled) { clear(); return; }
        const bounds = snapshot.bounds || getUpdateAndSimulationBounds(snapshot.chat || []);
        const live = new Set();
        for (const message of doc.querySelectorAll('#chat .mes[mesid]')) {
            const floor = Number(message.getAttribute('mesid'));
            const source = snapshot.chat?.[floor];
            if (!Number.isInteger(floor) || !isNarrativeReply(source)) continue;
            const text = message.querySelector('.mes_text');
            if (!text) continue;
            live.add(floor);
            renderFloor(floor, text, snapshot, bounds);
        }
        for (const [floor, panel] of nodes) {
            if (!live.has(floor)) {
                panel.node.remove();
                nodes.delete(floor);
            }
        }
    }

    function schedule() { if (timer === null) timer = setTimeout(() => { timer = null; refresh(); }, 80); }
    function clear() { for (const panel of nodes.values()) panel.node.remove(); nodes.clear(); }

    const chatRoot = doc.getElementById('chat');
    if (chatRoot) {
        observer = new Observer(records => {
            if (records.some(record => !record.target.closest?.('.tk-floor-summary')
                && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
                    && !node.classList?.contains('tk-floor-summary')
                    && !node.classList?.contains('tk-floor-box')))) schedule();
        });
        observer.observe(chatRoot, { childList: true, subtree: true });
    }

    const api = {
        schedule,
        reset() { clear(); simUserToggles.clear(); schedule(); },
        dispose() {
            if (timer !== null) clearTimeout(timer);
            observer?.disconnect();
            clear();
            simUserToggles.clear();
            if (activePanels === api) activePanels = null;
        },
    };
    activePanels = api;
    schedule();
    return api;
}
