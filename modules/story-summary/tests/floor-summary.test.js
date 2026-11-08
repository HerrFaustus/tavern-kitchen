import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { projectFloorSummary, installFloorSummaries } from '../floor-summary.js';
import { createFloorPanel } from '../inline/panel.js';

const store = { lastSummarizedMesId: 3, summaryHistory: [{ kind: 'batch', previousEndMesId: 0, endMesId: 3, summary: '抵达：<img src=x onerror=alert(1)>' }],
    json: {} };
test('floor summaries retain multi-floor provenance and reject stale or untraceable records', () => {
    assert.deepEqual(projectFloorSummary(store, 1), { start: 1, end: 3, text: '抵达：<img src=x onerror=alert(1)>' });
    assert.equal(projectFloorSummary(store, 0), null);
    assert.equal(projectFloorSummary(store, 4), null);
    assert.equal(projectFloorSummary(store, 1, 2), null);
    assert.equal(projectFloorSummary({ ...store, summaryInvalid: true }, 1), null);
    assert.equal(projectFloorSummary({ ...store, summaryHistory: [{ kind: 'baseline', endMesId: 3 }] }, 1), null);
});
test('unified narrative summaries appear even without event rows and retain their exact batch range', () => {
    const summary = { ...store, json: { events: [] }, summaryHistory: [{ kind: 'batch', previousEndMesId: 0, endMesId: 3, summary: '支付五金币，拿到铁剑。' }] };
    assert.deepEqual(projectFloorSummary(summary, 1), { start: 1, end: 3, text: '支付五金币，拿到铁剑。' });
    assert.equal(projectFloorSummary(summary, 0), null); assert.equal(projectFloorSummary(summary, 1, 2), null);
});
test('the actual floor panel previews and expands a unified narrative summary with no events as already saved', () => {
    const { document } = parseHTML('<html><body></body></html>'), opened = [];
    const panel = createFloorPanel({ doc: document, floor: 1, schedule() {}, openMemory: floor => opened.push(floor) });
    document.body.append(panel.node);
    panel.refresh({ enabled: true, chat: [{ is_user: true, mes: '买剑' }, { mes: '正文', send_date: 'reply' }], inlineConfig: { enabled: false },
        store: { lastSummarizedMesId: 1, json: { events: [] }, summaryHistory: [{ kind: 'batch', previousEndMesId: -1, endMesId: 1, summary: '支付五金币，拿到铁剑。<img src=x onerror=alert(1)>' }] } });
    assert.match(panel.node.querySelector('.tk-fp-head').textContent, /支付五金币，拿到铁剑/);
    assert.match(panel.node.textContent, /已写入/); assert.equal(panel.node.querySelector('img'), null);
    panel.node.querySelector('.tk-fp-toggle').click();
    assert.match(panel.node.querySelector('.tk-fp-content').textContent, /区间摘要 · 第 1–2 楼/);
    assert.match(panel.node.querySelector('.tk-fp-content').textContent, /支付五金币，拿到铁剑/);
    [...panel.node.querySelectorAll('button')].find(button => button.textContent === '查看剧情资料').click(); assert.deepEqual(opened, [1]);
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
    assert.match(document.querySelector('.tk-floor-summary').textContent, /<img/);
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

test('a failed model call retries the same floor', async () => {
    const { document } = parseHTML('<html><body></body></html>');
    const attempts = [];
    const panel = createFloorPanel({ doc: document, floor: 1, schedule() {},
        summarizeFloor: async floor => {
            attempts.push(floor);
            if (attempts.length === 1) throw Object.assign(new Error('接口未返回正文'), { summaryModelFailure: true });
        } });
    panel.refresh({ enabled: true, chat: [{ is_user: true, mes: '问' }, { mes: '答' }], store: null });
    const find = text => [...panel.node.querySelectorAll('button')].find(b => b.textContent === text);
    find('总结本楼').click(); await setTimeout(0);
    assert.match(panel.node.querySelector('[role=status]').textContent, /接口未返回正文/);
    assert.equal(find('查看总结模型'), undefined);
    find('重试').click(); await setTimeout(0);
    assert.deepEqual(attempts, [1, 1]); assert.equal(find('重试'), undefined);
});
