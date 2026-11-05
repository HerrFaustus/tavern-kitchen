import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { uiEntry } from './helpers/story-summary-entry.js';

test('the real settings page presents raw retrieval without an anchor prerequisite', () => {
    const { document } = parseHTML(readFileSync(new URL('../story-summary.html', import.meta.url), 'utf8'));
    assert.equal(document.querySelector('[data-workspace-page="tab-l0-api"]'), null);
    assert.ok(document.getElementById('legacy-anchor-card').classList.contains('hidden'));
    assert.ok(document.getElementById('vector-atom-count').closest('.vector-stat-col').classList.contains('hidden'));
    assert.ok(document.getElementById('vector-event-count').closest('.vector-stat-col').classList.contains('hidden'));
    assert.equal(document.getElementById('vector-chunk-count').closest('.vector-stat-col').classList.contains('hidden'), false);
    const ui = uiEntry(['updateAnchorStats'], { $: id => document.getElementById(id) });
    ui.updateAnchorStats({ extracted: 0, total: 100, pending: 100 });
    assert.ok(document.getElementById('vector-empty-l0-warning').classList.contains('hidden'));
    assert.match(document.querySelector('[data-workspace-page="tab-rerank-api"]').textContent, /可选/);
});
