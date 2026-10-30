import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { projectFloorSummary, installFloorSummaries } from '../floor-summary.js';

const store = { lastSummarizedMesId: 3, summaryHistory: [{ kind: 'batch', previousEndMesId: 0, endMesId: 3 }],
    json: { events: [{ title: '抵达', summary: '<img src=x onerror=alert(1)>', _addedAt: 3 }] } };
test('floor summaries retain multi-floor provenance and reject stale or untraceable records', () => {
    assert.deepEqual(projectFloorSummary(store, 1), { start: 1, end: 3, text: '抵达：<img src=x onerror=alert(1)>' });
    assert.equal(projectFloorSummary(store, 0), null);
    assert.equal(projectFloorSummary(store, 4), null);
    assert.equal(projectFloorSummary(store, 1, 2), null);
    assert.equal(projectFloorSummary({ ...store, summaryInvalid: true }, 1), null);
    assert.equal(projectFloorSummary({ ...store, summaryHistory: [{ kind: 'baseline', endMesId: 3 }] }, 1), null);
});
test('message annotations stay idempotent, render plain text and clear when changing chats', async t => {
    const { document, window } = parseHTML('<html><body><div id="chat"><div class="mes" mesid="0"><div class="mes_text">user</div></div><div class="mes" mesid="1"><div class="mes_text">reply</div></div></div></body></html>');
    let snapshot = { enabled: true, chat: [{ is_user: true, mes: 'user' }, { is_user: false, mes: 'reply' }], store };
    const opened = [];
    const panel = installFloorSummaries({ documentTarget: document, Observer: window.MutationObserver, getSnapshot: () => snapshot, openMemory: floor => opened.push(floor) });
    t.after(panel.dispose);
    await setTimeout(120);
    assert.equal(document.querySelectorAll('.tk-floor-summary').length, 1);
    assert.equal(document.querySelector('.tk-floor-summary img'), null);
    assert.match(document.querySelector('.tk-floor-summary .tk-fp-summary').textContent, /<img/);
    document.querySelector('.tk-fp-toggle').click();
    document.querySelector('.tk-fp-content button').click(); assert.deepEqual(opened, [1]);
    panel.schedule(); await setTimeout(120);
    assert.equal(document.querySelectorAll('.tk-floor-summary').length, 1);
    snapshot = { ...snapshot, store: null }; panel.reset();
    assert.equal(document.querySelectorAll('.tk-floor-summary').length, 0);
    await setTimeout(120);
    assert.match(document.querySelector('.tk-floor-summary').textContent, /待总结/);
    snapshot = { ...snapshot, enabled: false }; panel.schedule(); await setTimeout(120);
    assert.equal(document.querySelectorAll('.tk-floor-summary').length, 0);
});
