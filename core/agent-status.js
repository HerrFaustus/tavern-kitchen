const HOST_ID = 'tk-agent-status';
const STATUS_ID = 'tk-floor-status';
const DEFAULT_IDLE_MESSAGE = '后厨待命 · 发送下一轮前自动总结并更新世界';

let actions = { onOpenAgent: () => {}, onOpenRecovery: () => {} };
let currentNotice = null;
let noticeSequence = 0;
let dismissedSequence = 0;
let idleStatus = { message: DEFAULT_IDLE_MESSAGE, actions: [] };
let idleVersion = 0;
const documents = new Set();

export function configureAgentStatusActions(next = {}) {
    actions = { ...actions, ...next };
}

/** Update the permanent standby bar shown whenever no alert/running notice owns the strip. */
export function setAgentIdleStatus({ message = DEFAULT_IDLE_MESSAGE, actions: idleActions = [] } = {}) {
    idleStatus = {
        message: String(message || DEFAULT_IDLE_MESSAGE),
        actions: Array.isArray(idleActions) ? idleActions.filter(item => item && typeof item.callback === 'function' && item.label) : [],
    };
    idleVersion++;
    if (!currentNotice || dismissedSequence === currentNotice.id) publish();
}

/** Mount a single full-width strip immediately above the host chat form. */
export function installAgentStatus(documentTarget = document) {
    const doc = documentTarget;
    documents.add(doc);
    const mount = () => {
        const form = doc.querySelector('#send_form');
        if (!form) return null;
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
    mount();
    const observer = new doc.defaultView.MutationObserver(mount);
    observer.observe(doc.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); documents.delete(doc); doc.getElementById(HOST_ID)?.remove(); };
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
    node.append(indicator, title, controls);

    if (notice.retry) appendButton(doc, controls, '重试', notice.retry);
    if (notice.agent || notice.error?.agent) {
        const agent = notice.agent || notice.error.agent;
        appendButton(doc, controls, '前往设置', () => actions.onOpenAgent(agent));
    } else if (notice.error) {
        appendButton(doc, controls, '查看恢复', () => actions.onOpenRecovery(notice.recoveryRoute || errorRoute(notice.error)));
    }
    appendButton(doc, controls, '收起', () => {
        dismissedSequence = notice.id;
        renderIdle(doc, host);
    }, 'tk-agent-strip-dismiss');
    host.replaceChildren(node);
    if (host.hidden) host.hidden = false;
}

function renderCurrent(doc, host) {
    if (currentNotice && dismissedSequence !== currentNotice.id) renderNotice(doc, host, currentNotice);
    else renderIdle(doc, host);
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
export function showAgentNotice({ message = '', level = 'info', agent = null, error = null, retry = null, pinned = level === 'error', recoveryRoute = null, timeoutMs = pinned ? 0 : 6000 } = {}) {
    // A hard-block error owns the strip until the user retries/resolves it or
    // explicitly dismisses it. Background info notices must not replace it.
    const blocking = currentNotice?.pinned && currentNotice.level === 'error' && dismissedSequence !== currentNotice.id;
    if (blocking && !pinned && level === 'info') return null;
    const id = ++noticeSequence;
    currentNotice = { id, message: String(message || '后厨正在处理'), level, agent, error, retry, pinned, recoveryRoute };
    if (dismissedSequence !== id) dismissedSequence = 0;
    publish();
    if (timeoutMs > 0) {
        setTimeout(() => { if (currentNotice?.id === id) clearAgentNotice(id); }, timeoutMs);
    }
    return id;
}

export function clearAgentNotice(id = currentNotice?.id) {
    if (!currentNotice || id !== currentNotice.id) return;
    currentNotice = null;
    publish();
}
