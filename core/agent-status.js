const HOST_ID = 'tk-agent-status';
const STATUS_ID = 'tk-floor-status';
const DEFAULT_IDLE_MESSAGE = '后厨待命 · 发送下一轮前自动总结并更新世界';

let actions = { onOpenAgent: () => {}, onOpenRecovery: () => {} };
let currentNotice = null;
let noticeSequence = 0;
let dismissedSequence = 0;
let collapsedLockedSequence = 0;
let idleStatus = { message: DEFAULT_IDLE_MESSAGE, actions: [] };
let idleVersion = 0;
let elapsedTimer = null;
const documents = new Set();

export function configureAgentStatusActions(next = {}) {
    actions = { ...actions, ...next };
}

function stopElapsedTimer() {
    if (elapsedTimer !== null) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
    }
}

function formatElapsed(startedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    return `已用 ${seconds}s`;
}

function syncElapsedBadges() {
    if (!currentNotice?.showElapsed || dismissedSequence === currentNotice.id) {
        stopElapsedTimer();
        return;
    }
    const text = formatElapsed(currentNotice.startedAt);
    for (const doc of documents) {
        const badge = doc.querySelector(`#${STATUS_ID} .tk-agent-strip-elapsed`);
        if (badge) badge.textContent = text;
    }
}

function ensureElapsedTimer() {
    stopElapsedTimer();
    if (!currentNotice?.showElapsed) return;
    elapsedTimer = setInterval(syncElapsedBadges, 1000);
    if (typeof elapsedTimer?.unref === 'function') elapsedTimer.unref();
}

/** Update the permanent standby bar shown whenever no alert/running notice owns the strip. */
export function setAgentIdleStatus({ message = DEFAULT_IDLE_MESSAGE, actions: idleActions = [] } = {}) {
    idleStatus = {
        message: String(message || DEFAULT_IDLE_MESSAGE),
        actions: Array.isArray(idleActions) ? idleActions.filter(item => item && typeof item.callback === 'function' && item.label) : [],
    };
    idleVersion++;
    if (!currentNotice || (dismissedSequence === currentNotice.id && collapsedLockedSequence !== currentNotice.id)) publish();
}

/** Mount a single full-width strip immediately above the host chat form. */
export function installAgentStatus(documentTarget = document) {
    const doc = documentTarget;
    documents.add(doc);
    let observer = null;
    let observedTarget = null;
    let scheduled = false;
    let disposed = false;

    const attachObserver = target => {
        if (disposed || !target || observedTarget === target) return;
        observer?.disconnect();
        observedTarget = target;
        const ObserverCtor = doc.defaultView?.MutationObserver;
        if (typeof ObserverCtor !== 'function') return;
        // WHY: Observe only #send_form's direct container once mounted instead of the entire document.body subtree
        // so streaming chat tokens inside #chat never trigger repeated mount checks.
        observer = new ObserverCtor(() => scheduleMount());
        const isNarrow = target !== doc.body;
        observer.observe(target, isNarrow ? { childList: true } : { childList: true, subtree: true });
    };

    const mount = () => {
        scheduled = false;
        if (disposed) return null;
        const form = doc.querySelector('#send_form');
        if (!form) {
            if (doc.body) attachObserver(doc.body);
            return null;
        }
        if (form.parentElement) attachObserver(form.parentElement);
        let host = doc.getElementById(HOST_ID);
        if (!host) {
            host = doc.createElement('div');
            host.id = HOST_ID;
        }
        if (host.parentElement !== form.parentElement || host.nextElementSibling !== form) {
            if (host.parentElement?.moveBefore) host.parentElement.moveBefore(host, form);
            else form.before(host);
        }
        if (host.hidden) host.hidden = false;
        if (!host.childElementCount) renderCurrent(doc, host);
        return host;
    };

    const scheduleMount = () => {
        if (disposed || scheduled) return;
        scheduled = true;
        queueMicrotask(mount);
    };

    mount();
    return () => {
        disposed = true;
        observer?.disconnect();
        documents.delete(doc);
        if (!documents.size) stopElapsedTimer();
        doc.getElementById(HOST_ID)?.remove();
    };
}

function appendButton(doc, parent, label, callback, className = '') {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `menu_button ${className}`.trim();
    button.textContent = label;
    button.addEventListener('click', () => {
        Promise.resolve().then(callback).catch(error => {
            showAgentNotice({ level: 'error', message: error?.message || String(error), pinned: true, error });
        });
    });
    parent.append(button);
    return button;
}

function errorRoute(error) {
    const message = String(error?.message || error || '');
    if (/世界|冲突|版本|分支|后楼|conflict|version|branch/i.test(message)) return 'world';
    return 'data';
}

function renderIdle(doc, host) {
    const existing = host.querySelector(`#${STATUS_ID}`);
    if (existing?.dataset.noticeId === 'idle' && existing?.dataset.idleVersion === String(idleVersion)) {
        if (host.hidden) host.hidden = false;
        return;
    }
    const node = doc.createElement('div');
    node.id = STATUS_ID;
    node.className = 'tk-agent-strip is-idle';
    node.dataset.noticeId = 'idle';
    node.dataset.idleVersion = String(idleVersion);
    node.setAttribute('role', 'status');
    const indicator = doc.createElement('span');
    indicator.className = 'tk-agent-strip-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    const title = doc.createElement('span');
    title.className = 'tk-agent-strip-message';
    title.textContent = idleStatus.message;
    const controls = doc.createElement('span');
    controls.className = 'tk-agent-strip-actions';
    node.append(indicator, title, controls);
    for (const item of idleStatus.actions) {
        appendButton(doc, controls, item.label, item.callback, item.className || '');
    }
    host.replaceChildren(node);
    if (host.hidden) host.hidden = false;
}

function renderCollapsedLocked(doc, host, notice) {
    const existing = host.querySelector(`#${STATUS_ID}`);
    const key = `locked-collapsed:${notice.id}`;
    if (existing?.dataset.noticeId === key) return;
    const node = doc.createElement('div');
    node.id = STATUS_ID;
    node.className = 'tk-agent-strip is-error is-locked-collapsed';
    node.dataset.noticeId = key;
    node.setAttribute('role', 'alert');
    const indicator = doc.createElement('span');
    indicator.className = 'tk-agent-strip-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    const title = doc.createElement('span');
    title.className = 'tk-agent-strip-message';
    title.textContent = '发送已锁定 · 存在未解决的阻断报错（已收起）';
    const controls = doc.createElement('span');
    controls.className = 'tk-agent-strip-actions';
    node.append(indicator, title, controls);
    appendButton(doc, controls, '展开报错', () => {
        if (currentNotice?.id === notice.id) {
            collapsedLockedSequence = 0;
            publish();
        }
    });
    if (notice.retry) appendButton(doc, controls, '重试', notice.retry);
    if (notice.agent || notice.error?.agent) {
        const agent = notice.agent || notice.error.agent;
        appendButton(doc, controls, '前往设置', () => actions.onOpenAgent(agent));
    }
    host.replaceChildren(node);
    if (host.hidden) host.hidden = false;
}

function renderNotice(doc, host, notice) {
    const existing = host.querySelector(`#${STATUS_ID}`);
    if (existing?.dataset.noticeId === String(notice.id)) return;
    const node = doc.createElement('div');
    node.id = STATUS_ID;
    node.className = `tk-agent-strip is-${notice.level || 'info'}`;
    node.dataset.noticeId = String(notice.id);
    node.setAttribute('role', notice.level === 'error' ? 'alert' : 'status');
    const indicator = doc.createElement('span');
    indicator.className = 'tk-agent-strip-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    const title = doc.createElement('span');
    title.className = 'tk-agent-strip-message';
    title.textContent = notice.message;
    const controls = doc.createElement('span');
    controls.className = 'tk-agent-strip-actions';
    node.append(indicator, title);
    if (notice.showElapsed) {
        const elapsed = doc.createElement('span');
        elapsed.className = 'tk-agent-strip-elapsed';
        elapsed.textContent = formatElapsed(notice.startedAt);
        node.append(elapsed);
    }
    node.append(controls);

    if (notice.cancel) appendButton(doc, controls, notice.cancelLabel || '取消自动发送', notice.cancel);
    if (notice.retry) appendButton(doc, controls, '重试', notice.retry);
    if (notice.agent || notice.error?.agent) {
        const agent = notice.agent || notice.error.agent;
        appendButton(doc, controls, '前往设置', () => actions.onOpenAgent(agent));
    } else if (notice.error) {
        appendButton(doc, controls, '查看恢复', () => actions.onOpenRecovery(notice.recoveryRoute || errorRoute(notice.error)));
    }
    appendButton(doc, controls, '收起', () => {
        if (notice.locked) {
            collapsedLockedSequence = notice.id;
            publish();
        } else {
            dismissedSequence = notice.id;
            stopElapsedTimer();
            renderIdle(doc, host);
        }
    }, 'tk-agent-strip-dismiss');
    host.replaceChildren(node);
    if (host.hidden) host.hidden = false;
}

function renderCurrent(doc, host) {
    if (currentNotice && collapsedLockedSequence === currentNotice.id && currentNotice.locked) {
        renderCollapsedLocked(doc, host, currentNotice);
    } else if (currentNotice && dismissedSequence !== currentNotice.id) {
        renderNotice(doc, host, currentNotice);
    } else {
        renderIdle(doc, host);
    }
}

function publish(documentsToRender = documents) {
    for (const doc of documentsToRender) {
        const host = doc.getElementById(HOST_ID);
        if (!host) continue;
        renderCurrent(doc, host);
    }
}

/**
 * Consolidate non-blocking feedback, blocking failures and the permanent standby
 * status in the same Agent strip above `#send_form`.
 */
export function showAgentNotice({
    message = '',
    level = 'info',
    agent = null,
    error = null,
    retry = null,
    cancel = null,
    cancelLabel = '取消自动发送',
    pinned = level === 'error',
    locked = false,
    showElapsed = false,
    startedAt = null,
    recoveryRoute = null,
    timeoutMs = pinned ? 0 : 6000,
} = {}) {
    // A hard-block error owns the strip until the user retries/resolves it or
    // explicitly dismisses/collapses it. Background info notices must not replace it.
    const blocking = currentNotice?.pinned && currentNotice.level === 'error'
        && dismissedSequence !== currentNotice.id
        && (currentNotice.locked || collapsedLockedSequence !== currentNotice.id);
    if (blocking && !pinned && level === 'info') return null;
    const prevStarted = showElapsed && currentNotice?.showElapsed ? currentNotice.startedAt : null;
    const id = ++noticeSequence;
    currentNotice = {
        id,
        message: String(message || '后厨正在处理'),
        level,
        agent,
        error,
        retry,
        cancel,
        cancelLabel,
        pinned,
        locked: Boolean(locked),
        showElapsed: Boolean(showElapsed),
        startedAt: Number.isFinite(startedAt) ? startedAt : (prevStarted ?? Date.now()),
        recoveryRoute,
    };
    if (dismissedSequence !== id) dismissedSequence = 0;
    collapsedLockedSequence = 0;
    publish();
    ensureElapsedTimer();
    if (timeoutMs > 0) {
        setTimeout(() => { if (currentNotice?.id === id) clearAgentNotice(id); }, timeoutMs);
    }
    return id;
}

export function clearAgentNotice(id = currentNotice?.id) {
    if (!currentNotice || id !== currentNotice.id) return;
    currentNotice = null;
    collapsedLockedSequence = 0;
    stopElapsedTimer();
    publish();
}
