import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { uiEntry } from './helpers/story-summary-entry.js';
import { normalizeRecallTimeoutSec, MAX_RECALL_TIMEOUT_SEC } from '../data/recall-settings.js';

test('the real settings page presents raw retrieval and drops legacy summary/anchor controls', () => {
    const { document } = parseHTML(readFileSync(new URL('../story-summary.html', import.meta.url), 'utf8'));
    assert.equal(document.querySelector('[data-workspace-page="tab-l0-api"]'), null);
    for (const removedId of ['legacy-anchor-card', 'vector-atom-count', 'vector-event-count', 'vector-empty-l0-warning',
        'trigger-enabled', 'trigger-interval', 'trigger-timing', 'trigger-notify-on-complete', 'use-vector-boundary',
        'trigger-role', 'trigger-insert-at-end', 'filter-rules-collapse', 'tab-agent', 'recall-log-content',
        'proofreading-settings-host', 'proofreading-page']) {
        assert.equal(document.getElementById(removedId), null, `${removedId} should be removed`);
    }
    assert.equal(document.getElementById('vector-chunk-count').closest('.vector-stat-col').classList.contains('hidden'), false);
    assert.ok(document.getElementById('recall-page'));
    assert.ok(document.getElementById('recall-round-select'));
    assert.ok(document.getElementById('recall-detail'));
    assert.equal(document.querySelector('[data-workspace-page]'), null);
});

test('summary and vector settings need no activation or range controls', () => {
    const { document } = parseHTML(readFileSync(new URL('../story-summary.html', import.meta.url), 'utf8'));
    for (const id of ['current-chat-enabled', 'vector-enabled', 'trigger-delay-floors', 'trigger-max-per-run']) assert.equal(document.getElementById(id), null);
    assert.equal([...document.querySelectorAll('summary')].some(element => element.textContent.includes('总结范围')), false);
    assert.equal(document.getElementById('vector-config-area').classList.contains('hidden'), false);
    assert.ok(document.getElementById('keep-visible-count')); // Recent prose visibility is independent of summarization.
    const config = { ui: { hideSummarized: true }, vector: { enabled: true, recallTimeoutSec: 30, l0Api: {}, embeddingApi: {}, rerankApi: {} } };
    const ui = uiEntry(['normalizeVectorConfigUI', 'getVectorConfig', 'getVectorApiConfig', 'loadVectorConfig', 'syncVectorBoundaryControl'], {
        $: id => document.getElementById(id), config, structuredClone, normalizeProviderProfiles: () => ({}), normalizeRecallTimeoutSec, MAX_RECALL_TIMEOUT_SEC,
    });
    Object.assign(config.vector, ui.normalizeVectorConfigUI({ enabled: false, recallTimeoutSec: 42, embeddingApi: { key: 'fixture-only' } }));
    ui.loadVectorConfig(config.vector);
    const collected = ui.getVectorConfig(); assert.equal(collected.enabled, true); assert.equal(collected.recallTimeoutSec, 42);
    assert.equal(collected.embeddingApi.key, 'fixture-only');
});

test('story-summary page exposes zero prompt configuration forms while keeping save controls intact', () => {
    const { document } = parseHTML(readFileSync(new URL('../story-summary.html', import.meta.url), 'utf8'));
    assert.equal(document.querySelector('.settings-tab, #tab-agent-api, #summary-text-api'), null);
    for (const selector of ['#tab-summary-prompts', '#tab-prompts', '#summary-style', '#btn-reset-summary-style', '#prompt-round', '#prompt-stage', '#prompt-chapter', '[data-save-layer]']) {
        assert.equal(document.querySelector(selector), null);
    }
    assert.equal($id(document, 'settings-save').parentElement.hidden, false);
    assert.equal($id(document, 'update-messages'), null);
});
function $id(document, id) { return document.getElementById(id); }
