export const SUMMARY_WORKFLOW_VERSION = 1;
export const DEFAULT_SUMMARY_TRIGGER = { enabled: true, timing: 'after_ai', interval: 1, delayFloors: 0 };

// Migrate the previous main-reply workflow once. Later scheduling edits, including
// disabling automatic summaries, remain user choices across saves and reloads.
export function normalizeSummaryWorkflow(raw = {}) {
    const migrated = raw.summaryWorkflowVersion === SUMMARY_WORKFLOW_VERSION;
    return {
        summaryWorkflowVersion: SUMMARY_WORKFLOW_VERSION,
        inlineSummary: { enabled: false, review: raw.inlineSummary?.review === true },
        trigger: { ...(raw.trigger || {}), ...(!migrated ? DEFAULT_SUMMARY_TRIGGER : {}) },
    };
}
