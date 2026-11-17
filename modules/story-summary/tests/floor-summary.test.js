import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import {
    projectFloorSummary,
    projectFloorChanges,
    projectFloorSimulation,
    installFloorSummaries,
} from '../floor-summary.js';
import { floorSource } from '../inline/protocol.js';

const store = {
    lastSummarizedMesId: 3,
    summaryHistory: [{ kind: 'batch', previousEndMesId: 0, endMesId: 3, summary: '抵达：<img src=x onerror=alert(1)>' }],
    json: {},
};

test('floor summaries retain multi-floor provenance and reject stale or untraceable records', () => {
    assert.equal(projectFloorSummary(store, 1)?.text, '抵达：<img src=x onerror=alert(1)>');
    assert.equal(projectFloorSummary(store, 1)?.start, 1);
    assert.equal(projectFloorSummary(store, 1)?.end, 3);
    assert.equal(projectFloorSummary(store, 0), null);
    assert.equal(projectFloorSummary(store, 4), null);
    assert.equal(projectFloorSummary(store, 1, 2), null);
    assert.equal(projectFloorSummary({ ...store, summaryInvalid: true }, 1), null);
    assert.equal(projectFloorSummary({ ...store, summaryHistory: [{ kind: 'baseline', endMesId: 3 }] }, 1), null);
});

test('unified narrative summaries appear even without event rows and retain their exact batch range', () => {
    const summary = {
        ...store,
        json: { events: [] },
        summaryHistory: [{ kind: 'batch', previousEndMesId: 0, endMesId: 3, summary: '支付五金币，拿到铁剑。' }],
    };
    const projected = projectFloorSummary(summary, 1);
    assert.equal(projected?.start, 1);
    assert.equal(projected?.end, 3);
    assert.equal(projected?.text, '支付五金币，拿到铁剑。');
    assert.equal(projectFloorSummary(summary, 0), null);
    assert.equal(projectFloorSummary(summary, 1, 2), null);
    assert.deepEqual(projectFloorChanges(summary, 1)?.changes, []);
});

test('projectFloorSimulation distinguishes ready, pending, candidate-switched and pre-0.2.36 settled historical floors', () => {
    const chat = [
        { is_user: true, mes: '进城' },
        { is_user: false, mes: '第一楼回复', send_date: 'a1', swipe_id: 0 },
        { is_user: true, mes: '打听' },
        { is_user: false, mes: '第二楼回复', send_date: 'a2', swipe_id: 0 },
    ];
    const source1 = floorSource(chat, 1);
    const source3 = floorSource(chat, 3);
    const mem = {
        lastSummarizedMesId: 1,
        summaryHistory: [{ kind: 'batch', previousEndMesId: -1, endMesId: 1, summary: '进城打听。' }],
        floorSimulations: {
            3: { floor: 3, digest: source3.digest, text: '码头外有人正在搬运货箱。', tag: '日常风味' },
        },
    };
    assert.equal(projectFloorSimulation(mem, chat, 1).status, 'none');
    const sim3 = projectFloorSimulation(mem, chat, 3);
    assert.equal(sim3.status, 'ready');
    assert.equal(sim3.isLatest, true);
    assert.equal(sim3.tag, '日常风味');

    assert.equal(projectFloorSimulation({ floorSimulations: {} }, chat, 3).status, 'pending');
    const switchedChat = structuredClone(chat);
    switchedChat[3].swipe_id = 1;
    switchedChat[3].mes = '新候选回复';
    assert.match(projectFloorSimulation(mem, switchedChat, 3).text, /候选已切换/);
    assert.equal(projectFloorSimulation(mem, chat, 0).status, 'none');
    assert.notEqual(source1.digest, source3.digest);
});

test('stacked read-only update & simulation floor boxes stay idempotent, XSS-safe, honor lag-1 and hide pre-upgrade sims', async t => {
    const html = '<html><body><div id="chat">'
        + '<div class="mes" mesid="0"><div class="mes_text">user1</div></div>'
        + '<div class="mes" mesid="1"><div class="mes_text">reply1</div></div>'
        + '<div class="mes" mesid="2"><div class="mes_text">user2</div></div>'
        + '<div class="mes" mesid="3"><div class="mes_text">reply2</div></div>'
        + '</div></body></html>';
    const { document, window } = parseHTML(html);
    const chat = [
        { is_user: true, mes: 'user1' },
        { is_user: false, mes: 'reply1', send_date: 'r1' },
        { is_user: true, mes: 'user2' },
        { is_user: false, mes: 'reply2', send_date: 'r2' },
    ];
    const s3 = floorSource(chat, 3);
    let snapshot = {
        enabled: true,
        chat,
        store: {
            lastSummarizedMesId: 1,
            summaryHistory: [{
                kind: 'batch', previousEndMesId: -1, endMesId: 1,
                summary: '抵达：<img src=x onerror=alert(1)>',
                memoryTags: { times: ['黄昏'], locations: ['渡口'] },
            }],
            floorWork: { 1: { warnings: [{ effectId: 'w1', reason: '歧义跳过' }] } },
            floorSimulations: {
                3: { floor: 3, digest: s3.digest, text: '风吹过码头，茶摊熄了灯。', tag: '日常风味' },
            },
        },
    };
    const opened = [];
    const panel = installFloorSummaries({
        documentTarget: document,
        Observer: window.MutationObserver,
        getSnapshot: () => snapshot,
        openMemory: floor => opened.push(floor),
    });
    t.after(panel.dispose);
    await setTimeout(120);

    const floor1 = document.querySelector('.tk-floor-summary[data-floor="1"]');
    const floor3 = document.querySelector('.tk-floor-summary[data-floor="3"]');
    assert.ok(floor1);
    assert.ok(floor3);
    assert.equal(document.querySelectorAll('.tk-floor-summary img, .tk-floor-summary form, .tk-floor-summary input, .tk-floor-summary textarea').length, 0);

    // Pre-0.2.36 settled floor 1 without floorSimulations hides simulation box smoothly
    assert.equal(floor1.querySelectorAll('[data-tk-box="update"]').length, 1);
    assert.equal(floor1.querySelectorAll('[data-tk-box="simulation"]').length, 0);
    assert.match(floor1.textContent, /抵达：/);
    assert.match(floor1.textContent, /自动跳过 1 条/);
    floor1.querySelector('.tk-fp-head-action')?.click();
    assert.deepEqual(opened, [1]);

    // Latest floor 3 waits lag-1 for update box, auto-opens ready simulation box below it
    const update3 = floor3.querySelector('[data-tk-box="update"]');
    const sim3 = floor3.querySelector('[data-tk-box="simulation"]');
    assert.ok(update3 && sim3);
    assert.match(update3.textContent, /待下一楼后总结/);
    assert.equal(sim3.open, true);
    assert.match(sim3.textContent, /风吹过码头，茶摊熄了灯/);

    // Preserves manual toggle of simulation box on re-render
    sim3.open = false;
    sim3.dispatchEvent(new window.Event('toggle'));
    panel.schedule();
    await setTimeout(120);
    assert.equal(document.querySelector('.tk-floor-summary[data-floor="3"] [data-tk-box="simulation"]').open, false);

    // Disabling hides all floor boxes cleanly
    snapshot = { ...snapshot, enabled: false };
    panel.schedule();
    await setTimeout(120);
    assert.equal(document.querySelectorAll('.tk-floor-summary').length, 0);
});
