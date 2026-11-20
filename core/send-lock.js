/**
 * Capture-phase DOM send lock for SillyTavern & TauriTavern.
 *
 * WHY: Relying solely on `manifest.generate_interceptor` is not enough when a host
 * pushes the user message before running interceptors, ignores `abort(true)` on UI
 * clicks, or lets the user trigger another send while a summary is running or failed.
 * Intercepting `#send_but` click, `#send_form` submit, and `#send_textarea` Enter in
 * capture phase ensures foreground sends cannot bypass startup, opening, or summary gates.
 */

function sendButtons(doc) {
    if (!doc?.querySelector) return [];
    const primary = doc.querySelector('#send_but');
    if (primary) return [primary];
    const fallback = doc.querySelector('#send_form button[type="submit"]');
    return fallback ? [fallback] : [];
}

function isSlashInput(doc) {
    const value = doc?.querySelector?.('#send_textarea')?.value;
    return typeof value === 'string' && value.trim().startsWith('/');
}

function matchesSendButton(target) {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(target.closest('#send_but') || target.closest('#send_form button[type="submit"]'));
}

function matchesSendForm(target) {
    if (!target) return false;
    if (target.id === 'send_form') return true;
    return typeof target.closest === 'function' && Boolean(target.closest('#send_form'));
}

function matchesSendTextarea(target) {
    if (!target) return false;
    if (target.id === 'send_textarea') return true;
    return typeof target.closest === 'function' && Boolean(target.closest('#send_textarea'));
}

export function installSendLock({
    documentTarget = globalThis.document,
    getState,
    onBlocked = null,
    onPreSend = null,
} = {}) {
    const doc = documentTarget;
    if (!doc || typeof doc.addEventListener !== 'function') {
        return { sync() {}, triggerSend() {}, dispose() {} };
    }

    let bypassDepth = 0;
    let disposed = false;
    let syncing = false;

    const applyVisualLock = (locked, reason) => {
        for (const button of sendButtons(doc)) {
            if (locked) {
                if (button.dataset.tkSendLocked !== 'true') {
                    button.dataset.tkSendPrevTitle = button.getAttribute('title') ?? '';
                    button.dataset.tkSendLocked = 'true';
                }
                if (button.getAttribute('aria-disabled') !== 'true') {
                    button.setAttribute('aria-disabled', 'true');
                }
                if (reason && button.getAttribute('title') !== reason) {
                    button.setAttribute('title', reason);
                }
            } else if (button.dataset.tkSendLocked === 'true') {
                delete button.dataset.tkSendLocked;
                if (button.hasAttribute('aria-disabled')) button.removeAttribute('aria-disabled');
                const prev = button.dataset.tkSendPrevTitle ?? '';
                delete button.dataset.tkSendPrevTitle;
                if (prev) {
                    if (button.getAttribute('title') !== prev) button.setAttribute('title', prev);
                } else if (button.hasAttribute('title')) {
                    button.removeAttribute('title');
                }
            }
        }
    };

    const sync = () => {
        if (disposed || syncing) return;
        syncing = true;
        try {
            const state = getState?.() || { locked: false, reason: '' };
            applyVisualLock(Boolean(state.locked), String(state.reason || ''));
        } finally {
            syncing = false;
        }
    };

    const triggerSend = () => {
        if (disposed) return false;
        const button = sendButtons(doc)[0];
        const form = doc.querySelector?.('#send_form');
        bypassDepth += 1;
        try {
            if (button && typeof button.click === 'function') {
                button.click();
                return true;
            }
            if (form && typeof form.requestSubmit === 'function') {
                form.requestSubmit();
                return true;
            }
            if (form && typeof form.dispatchEvent === 'function' && typeof Event === 'function') {
                form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                return true;
            }
            return false;
        } finally {
            bypassDepth -= 1;
        }
    };

    const intercept = event => {
        if (disposed || bypassDepth > 0) return;
        if (isSlashInput(doc)) return;
        const state = getState?.() || { locked: false, needsGate: false, isGenerating: false };
        if (state.isGenerating) return;
        if (state.locked) {
            event.preventDefault();
            event.stopImmediatePropagation?.();
            event.stopPropagation?.();
            applyVisualLock(true, state.reason);
            onBlocked?.(state);
            return;
        }
        if (state.needsGate && typeof onPreSend === 'function') {
            event.preventDefault();
            event.stopImmediatePropagation?.();
            event.stopPropagation?.();
            Promise.resolve(onPreSend(() => triggerSend())).catch(error => {
                console.warn('[TavernKitchen] send-lock pre-send gate failed', error);
            });
        }
    };

    const onClick = event => {
        if (!matchesSendButton(event.target)) return;
        intercept(event);
    };

    const onSubmit = event => {
        if (!matchesSendForm(event.target)) return;
        intercept(event);
    };

    const onKeyDown = event => {
        if (!matchesSendTextarea(event.target)) return;
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        const state = getState?.() || {};
        if (state.enterSends === false) return;
        intercept(event);
    };

    doc.addEventListener('click', onClick, true);
    doc.addEventListener('submit', onSubmit, true);
    doc.addEventListener('keydown', onKeyDown, true);

    let observer = null;
    const MutationObserverCtor = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (MutationObserverCtor && doc.body) {
        observer = new MutationObserverCtor(() => sync());
        observer.observe(doc.body, { childList: true, subtree: true });
    }
    sync();

    return {
        sync,
        triggerSend,
        dispose() {
            if (disposed) return;
            disposed = true;
            observer?.disconnect();
            doc.removeEventListener('click', onClick, true);
            doc.removeEventListener('submit', onSubmit, true);
            doc.removeEventListener('keydown', onKeyDown, true);
            applyVisualLock(false, '');
        },
    };
}
