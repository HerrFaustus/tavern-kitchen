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
    let observer = null;
    let observedTarget = null;
    let syncScheduled = false;

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

    const MutationObserverCtor = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    const attachObserver = () => {
        if (disposed || typeof MutationObserverCtor !== 'function') return;
        const form = doc.querySelector?.('#send_form');
        const target = form?.parentElement || form || doc.body;
        if (!target || observedTarget === target) return;
        observer?.disconnect();
        observedTarget = target;
        // WHY: Narrow the observer to #form_sheld/#send_form once available instead of document.body
        // so streaming tokens inserted into #chat never invoke sync() or scan chat floors.
        observer = new MutationObserverCtor(() => scheduleSync());
        const isNarrow = target !== doc.body;
        observer.observe(target, isNarrow ? { childList: true, subtree: true } : { childList: true, subtree: true });
    };

    const sync = () => {
        syncScheduled = false;
        if (disposed || syncing) return;
        syncing = true;
        try {
            attachObserver();
            // WHY: Visual button lock only cares about locked/reason, never pendingCount full-chat scans.
            const state = getState?.({ visualOnly: true }) || { locked: false, reason: '' };
            applyVisualLock(Boolean(state.locked), String(state.reason || ''));
        } finally {
            syncing = false;
        }
    };

    const scheduleSync = () => {
        if (disposed || syncScheduled) return;
        syncScheduled = true;
        queueMicrotask(sync);
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
        const state = getState?.({ visualOnly: false }) || { locked: false, needsGate: false, isGenerating: false };
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
        const state = getState?.({ visualOnly: true }) || {};
        if (state.enterSends === false) return;
        intercept(event);
    };

    doc.addEventListener('click', onClick, true);
    doc.addEventListener('submit', onSubmit, true);
    doc.addEventListener('keydown', onKeyDown, true);

    sync();

    return {
        sync,
        triggerSend,
        dispose() {
            if (disposed) return;
            disposed = true;
            observer?.disconnect();
            observedTarget = null;
            doc.removeEventListener('click', onClick, true);
            doc.removeEventListener('submit', onSubmit, true);
            doc.removeEventListener('keydown', onKeyDown, true);
            applyVisualLock(false, '');
        },
    };
}
