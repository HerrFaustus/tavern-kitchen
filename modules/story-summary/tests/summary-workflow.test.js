import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSummaryWorkflow, SUMMARY_WORKFLOW_VERSION } from '../data/summary-workflow.js';
import { getAutoSummaryPlan } from '../generate/summary-trigger.js';

test('new and migrated chats independently summarize the completed reply through the latest floor', () => {
    for (const raw of [{}, { inlineSummary: { enabled: true, review: true }, trigger: {
        enabled: false, timing: 'before_user', interval: 20, delayFloors: 2, role: 'user', maxPerRun: 50,
    } }]) {
        const workflow = normalizeSummaryWorkflow(raw);
        assert.equal(workflow.inlineSummary.enabled, false);
        assert.equal(workflow.summaryWorkflowVersion, SUMMARY_WORKFLOW_VERSION);
        const chat = [{ is_user: true, mes: '进入旅馆。' }, { is_user: false, mes: '掌柜交给你钥匙。' }];
        assert.deepEqual(getAutoSummaryPlan(chat, -1, workflow.trigger, 'after_ai'), {
            target: 1, pending: 2, interval: 1, triggered: true,
        });
        assert.equal(getAutoSummaryPlan(chat, -1, workflow.trigger, 'before_user').triggered, false);
        assert.equal(getAutoSummaryPlan(chat, 1, workflow.trigger, 'after_ai').triggered, false);
        if (raw.trigger) {
            assert.equal(workflow.trigger.role, raw.trigger.role);
            assert.equal(workflow.trigger.maxPerRun, raw.trigger.maxPerRun);
        }
    }
});

test('post-migration scheduling choices survive reload without restoring main-reply updates', () => {
    const raw = { ...normalizeSummaryWorkflow(), inlineSummary: { enabled: true },
        trigger: { enabled: false, timing: 'before_user', interval: 8, delayFloors: 4 } };
    const restored = normalizeSummaryWorkflow(JSON.parse(JSON.stringify(raw)));
    assert.deepEqual(restored.trigger, raw.trigger);
    assert.equal(restored.inlineSummary.enabled, false);
});
