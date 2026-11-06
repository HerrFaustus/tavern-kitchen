export const SUMMARY_WORKFLOW_VERSION = 1;
export const DEFAULT_SUMMARY_TRIGGER = { enabled: true, timing: 'after_ai', interval: 1, delayFloors: 0 };
export const SUMMARY_BATCH_FLOORS = 100;

// Migrate the previous main-reply workflow once. Automatic timing and pausing
// remain user choices; retired range controls always use the completed tail and
// an internal batch limit, without delaying recent replies.
export function normalizeSummaryWorkflow(raw = {}) {
    const migrated = raw.summaryWorkflowVersion === SUMMARY_WORKFLOW_VERSION;
    return {
        summaryWorkflowVersion: SUMMARY_WORKFLOW_VERSION,
        inlineSummary: { enabled: false, review: raw.inlineSummary?.review === true },
        trigger: { ...(raw.trigger || {}), ...(!migrated ? DEFAULT_SUMMARY_TRIGGER : {}), delayFloors: 0, maxPerRun: SUMMARY_BATCH_FLOORS },
    };
}
