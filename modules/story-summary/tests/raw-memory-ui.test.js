import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { uiEntry } from './helpers/story-summary-entry.js';
import { normalizeRecallTimeoutSec, MAX_RECALL_TIMEOUT_SEC } from '../data/recall-settings.js';

test('the real settings page presents raw retrieval without an anchor prerequisite', () => {
    const { document } = parseHTML(readFileSync(new URL('../story-summary.html', import.meta.url), 'utf8'));
    assert.equal(document.querySelector('[data-workspace-page="tab-l0-api"]'), null);
    assert.ok(document.getElementById('legacy-anchor-card').classList.contains('hidden'));
    assert.ok(document.getElementById('vector-atom-count').closest('.vector-stat-col').classList.contains('hidden'));
    assert.equal(document.getElementById('vector-event-count'), null);
    assert.equal(document.getElementById('vector-chunk-count').closest('.vector-stat-col').classList.contains('hidden'), false);
    const ui = uiEntry(['updateAnchorStats'], { $: id => document.getElementById(id) });
    ui.updateAnchorStats({ extracted: 0, total: 100, pending: 100 });
    assert.ok(document.getElementById('vector-empty-l0-warning').classList.contains('hidden'));
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

test('plot settings offers three independently folded summary prompts', () => {
    const { document } = parseHTML(readFileSync(new URL('../story-summary.html', import.meta.url), 'utf8'));
    const $ = id => document.getElementById(id);
    const page = $('tab-summary-prompts');
    assert.equal(page.tagName, 'DETAILS');
    assert.equal(document.querySelector('.settings-tab, #tab-agent-api, #summary-text-api'), null);
    for (const level of ['round', 'stage', 'chapter']) {
        assert.equal(page.querySelector('textarea#prompt-' + level).closest('details').hasAttribute('open'), false);
        assert.ok(page.querySelector('[data-save-layer="' + level + '"]'));
        assert.equal(page.querySelector('#reset-' + level).textContent, '恢复默认并保存');
    }
    assert.equal($('settings-save').parentElement.hidden, false);
    assert.equal($('update-messages'), null);
});

test('a layer save submits only its prompt and preserves a sibling draft through save and reset failures', async () => {
    const { document } = parseHTML(readFileSync(new URL('../story-summary.html', import.meta.url), 'utf8'));
    const $ = id => document.getElementById(id);
    const round = $('prompt-round'), stage = $('prompt-stage');
    round.value = '新本轮'; stage.value = '篇目草稿';
    const config = { prompts: { round: '旧本轮', stage: '旧篇目' } };
    const writes = [], dirtyFields = new Set([stage, round]);
    let success = true;
    const ui = uiEntry(['saveLayerPrompt'], { $, settingsSaving: false, settingsOpenedWithServerConfig: true,
        config, settingsSnapshot: structuredClone(config), settingsDirty: true, dirtyFields,
        LAYER_PROMPTS: { round: '默认本轮' }, WORKSPACE_COPY: { dirty: '待保存' },
        saveConfig: async ({ promptChange }) => { writes.push(JSON.stringify(promptChange)); return success; } });
    await ui.saveLayerPrompt('round');
    assert.deepEqual(JSON.parse(writes[0]), { level: 'round', value: '新本轮' });
    assert.equal(stage.value, '篇目草稿');
    assert.equal(config.prompts.stage, '旧篇目');
    assert.deepEqual([...dirtyFields], [stage]);
    success = false;
    await ui.saveLayerPrompt('round', true);
    assert.equal(round.value, '新本轮');
    success = true;
    await ui.saveLayerPrompt('round', true);
    assert.equal(config.prompts.round, '');
    assert.equal(round.value, '默认本轮');
});
