import { xbLog } from '../../core/debug-core.js';
import { clearAgentNotice, showAgentNotice } from '../../core/agent-status.js';
import { SUMMARY_FEEDBACK_COPY } from './feedback-copy.js';

const MODULE_ID = 'story-summary-feedback';
let embeddingNotice = null;
let recallFailureNotice = null;

// The foreground run owns its notice. Cleanup never dismisses a newer notice.
export function createRecallRetryNotice() {
    let id = null;
    let shown = false;
    return {
        show() {
            if (shown) return;
            shown = true;
            id = showAgentNotice({ message: SUMMARY_FEEDBACK_COPY.recallRetrying, pinned: true });
        },
        clear() {
            clearAgentNotice(id);
            id = null;
        },
    };
}

// An unknown save outcome is not evidence of failure. Keep diagnostics and
// on-demand status, but do not interrupt the chat with a speculative alert.
export function shouldNotifyMemoryFailure(error, state) {
    return state !== 'unconfirmed' && !error?.uncertain
        && !['metadata_unconfirmed', 'metadata_save_unconfirmed'].includes(error?.code);
}

export function notifySummaryStartupFailure(error, shouldNotify = true) {
    console.error(SUMMARY_FEEDBACK_COPY.startupFailed, error);
    xbLog.error(MODULE_ID, SUMMARY_FEEDBACK_COPY.startupFailed, error);
    if (shouldNotify) showAgentNotice({ level: 'error', message: SUMMARY_FEEDBACK_COPY.startupFailed, error, pinned: true });
}

export function clearEmbeddingFailureNotice() {
    clearAgentNotice(embeddingNotice);
    embeddingNotice = null;
}

export function clearRecallFailureNotice() {
    clearEmbeddingFailureNotice();
    clearAgentNotice(recallFailureNotice);
    recallFailureNotice = null;
}

export function notifyRecallFailure({ issueCode, notice }) {
    const embedding = issueCode === 'recall_embedding_failed';
    clearRecallFailureNotice();
    const params = { level: 'warning', message: notice?.notice || notice?.message || String(notice), error: notice?.error || null, pinned: true };
    const id = showAgentNotice(params);
    if (embedding) embeddingNotice = id;
    else recallFailureNotice = id;
}

/** One receipt for a user-requested clear; a cancelled queued action returns false. */
export async function runClearWithFeedback({ kind, clear, refresh, isCurrent, getMemoryState }) {
    const copy = SUMMARY_FEEDBACK_COPY[kind];
    let cleared = false;
    try {
        if (!await clear()) return;
        cleared = true;
        if (!isCurrent()) return;
        await refresh();
        if (!isCurrent()) return;
        showAgentNotice({ level: 'success', message: copy.success });
    } catch (error) {
        const message = cleared ? copy.refreshFailed : copy.failed;
        console.error(message, error);
        xbLog.error(MODULE_ID, message, error);
        if (!isCurrent() || !shouldNotifyMemoryFailure(error, getMemoryState())) return;
        showAgentNotice({ level: cleared ? 'warning' : 'error', message, error, pinned: true });
    }
}
