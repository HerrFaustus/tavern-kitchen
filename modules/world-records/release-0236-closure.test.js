import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createFloorProcessing } from './turn-processing.js';
import { createChapterProcessing } from '../../core/chapter-processing.js';
import { getUpdateAndSimulationBounds } from '../story-summary/data/turn-bounds.js';
import { captureRangeSource, firstInvalidMemorySource } from '../story-summary/data/turn-source.js';

function makeChat() {
    return [
        { is_user: true, name: '旅人', mes: '走进客栈。', send_date: 'u0' },
        { is_user: false, name: '店主', mes: '东桥灯火昏暗。', swipe_id: 0, swipes: ['东桥灯火昏暗。'], swipe_info: [{ send_date: 'a1-0' }] },
        { is_user: true, name: '旅人', mes: '打听消息。', send_date: 'u2' },
        { is_user: false, name: '店主', mes: '店主擦拭木桌。', swipe_id: 0, swipes: ['店主擦拭木桌。', '店主低声叹息。'], swipe_info: [{ send_date: 'a3-0' }, { send_date: 'a3-1' }] },
    ];
}

async function setupWorld(t, chat, seed = []) {
    const indexedDB = new IDBFactory();
    const storage = createWorldStorage({ indexedDB });
    t.after(() => storage.close());
    let seq = 0;
    const service = createWorldService({ storage, getIdentity: () => 'story-0236', id: () => `id-${++seq}` });
    let state = await service.syncTurns(chat);
    if (seed.length) {
        state = (await service.commit(service.command(state, seed, '初始世界'))).state;
    }
    return { service, state };
}

function extractBriefJson(messages) {
    const msg = (messages || []).findLast(m => m?.role === 'user' && typeof m?.content === 'string' && m.content.includes('"increment"'));
    return JSON.parse(msg.content.slice(msg.content.indexOf('{')));
}

test('0.2.36: lag-1 updateEnd exempts latest simulation floor, swipe avoids rollback conflict, and pre-upgrade floors are not retro-backfilled', async t => {
    const chat = makeChat();
    const { service } = await setupWorld(t, chat);

    // Pre-0.2.36 settled floor 1 without floorSimulations.
    const settledSource1 = captureRangeSource(chat, 0, 1);
    const store = {
        lastSummarizedMesId: 1,
        json: { storyRecords: [] },
        summaryHistory: [{
            kind: 'batch',
            startMesId: 0,
            endMesId: 1,
            summary: '旧版本已结算 1 楼。',
            sourceReceipt: service.memorySourceReceipt(await service.read(), chat, 0, 1),
        }],
        floorWork: {
            1: {
                source: settledSource1,
                digest: settledSource1.digest,
                done: ['memory', 'overview', 'people', 'places', 'situation', 'suspense'],
            },
        },
    };

    const bounds = getUpdateAndSimulationBounds(chat);
    assert.equal(bounds.updateEnd, 1);
    assert.equal(bounds.simulationEnd, 3);
    assert.equal(bounds.stableEnd, 3);
    assert.equal(firstInvalidMemorySource(store, chat), null);

    const calls = [];
    const queue = createFloorProcessing({
        read: () => {
            const b = getUpdateAndSimulationBounds(chat);
            return { owner: 'story-0236', playerName: '旅人', chat, end: b.stableEnd, updateEnd: b.updateEnd, simulationEnd: b.simulationEnd };
        },
        tasks: () => [
            { key: 'memory', group: 'update', label: '总结' },
            { key: 'overview', group: 'update', label: '总览' },
            { key: 'people', group: 'update', label: '人物' },
            { key: 'places', group: 'update', label: '地点' },
            { key: 'situation', group: 'update', label: '局势' },
            { key: 'suspense', group: 'update', label: '悬念' },
            { key: 'simulation', group: 'simulation', label: '推演', frequency: 'off' },
        ],
        store: () => store,
        save: async (source, _check, updater) => {
            const entry = (store.floorWork ??= {})[source.end] ??= { source, digest: source.digest, done: [] };
            updater(entry, store);
        },
        saveSim: async (source, _check, updater) => {
            (store.floorSimulations ??= {})[source.end] = updater(store.floorSimulations?.[source.end], store);
        },
        getService: () => service,
        requireAgent: async task => ({ agent: task }),
        generate: async (feature, payload) => {
            const serialized = JSON.stringify(payload.messages || []);
            calls.push({ feature, serialized });
            return { text: JSON.stringify({ text: '茶摊老板在门外张望。', kind: 'world_flavor' }) };
        },
    });

    await queue.settle();
    // Even with frequency === 'off', simulation runs once on latest floor 3 and NEVER retro-backfills floor 1.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].feature, 'world');
    assert.match(calls[0].serialized, /店主擦拭木桌/);
    assert.equal(store.floorSimulations[1], undefined);
    assert.equal(store.floorSimulations[3].candidate, 0);
    assert.equal(store.floorSimulations[3].text, '茶摊老板在门外张望。');
    assert.equal(firstInvalidMemorySource(store, chat), null);

    // Swiping latest floor 3 creates zero rollback conflict on settled floor 1 and re-simulates candidate 1.
    chat[3].swipe_id = 1;
    chat[3].mes = chat[3].swipes[1];
    assert.equal(firstInvalidMemorySource(store, chat), null);
    queue.invalidate();
    await queue.settle();
    assert.equal(calls.length, 2);
    assert.equal(store.floorSimulations[3].candidate, 1);
});

test('0.2.36: joint [main + settled background] update accepts general facts from background while rejecting background-only trade without halting queue', async t => {
    const chat = makeChat();
    const initialSource = { module: 'manual', key: 'seed', label: '开局设定' };
    const { service } = await setupWorld(t, chat, [
        { type: 'create', id: 'hero', name: '旅人', kind: 'person', source: initialSource },
        { type: 'set', entityId: 'hero', field: 'coins', value: 10, source: initialSource },
        { type: 'create', id: 'shop', name: '杂货摊', kind: 'place', source: initialSource },
        { type: 'create', id: 'bell', name: '铜铃', kind: 'item', source: initialSource },
        { type: 'create', id: 'bridge', name: '东桥', kind: 'place', source: initialSource },
    ]);

    const settledSource3 = captureRangeSource(chat, 2, 3);
    const store = {
        lastSummarizedMesId: 1,
        json: { storyRecords: [] },
        summaryHistory: [{
            kind: 'batch',
            startMesId: 0,
            endMesId: 1,
            summary: '初入客栈。',
            sourceReceipt: service.memorySourceReceipt(await service.read(), chat, 0, 1),
        }],
        floorWork: {
            1: {
                source: captureRangeSource(chat, 0, 1),
                digest: captureRangeSource(chat, 0, 1).digest,
                done: ['memory', 'overview', 'people', 'places', 'situation', 'suspense'],
            },
        },
        floorSimulations: {
            3: {
                floor: 3,
                start: 2,
                digest: settledSource3.digest,
                candidate: 0,
                text: '东桥守卫贴出木牌，旅人暗中付给杂货摊5金币买下铜铃。',
            },
        },
    };
    // Advance one more completed pair so floor 3 falls into lag-1 updateEnd!
    chat.push(
        { is_user: true, name: '旅人', mes: '出门看看。', send_date: 'u4' },
        { is_user: false, name: '叙述者', mes: '街道清晨冷清。', swipe_id: 0, swipes: ['街道清晨冷清。'], swipe_info: [{ send_date: 'a5-0' }] },
    );
    await service.syncTurns(chat);

    let updateBrief = null;
    const settledFloors = [];
    const queue = createFloorProcessing({
        read: () => {
            const b = getUpdateAndSimulationBounds(chat);
            return { owner: 'story-0236', playerName: '旅人', chat, end: b.stableEnd, updateEnd: b.updateEnd, simulationEnd: b.simulationEnd };
        },
        tasks: () => [
            { key: 'memory', group: 'update', label: '总结' },
            { key: 'overview', group: 'update', label: '总览' },
            { key: 'people', group: 'update', label: '人物' },
            { key: 'places', group: 'update', label: '地点' },
            { key: 'situation', group: 'update', label: '局势' },
            { key: 'suspense', group: 'update', label: '悬念' },
            { key: 'simulation', group: 'simulation', label: '推演', frequency: 'off' },
        ],
        store: () => store,
        save: async (source, _check, updater) => {
            const entry = (store.floorWork ??= {})[source.end] ??= { source, digest: source.digest, done: [] };
            updater(entry, store);
            store.lastSummarizedMesId = Math.max(store.lastSummarizedMesId ?? -1, source.end);
        },
        saveSim: async (source, _check, updater) => {
            (store.floorSimulations ??= {})[source.end] = updater(store.floorSimulations?.[source.end], store);
        },
        getService: () => service,
        requireAgent: async task => ({ agent: task }),
        onUpdateSettled: floor => settledFloors.push(floor),
        generate: async (feature, payload) => {
            if (feature === 'world') return { text: JSON.stringify({ text: '清晨巷口响起更鼓。', kind: 'world_flavor' }) };
            updateBrief = extractBriefJson(payload.messages);
            return {
                text: JSON.stringify({
                    summary: '第 4 楼店主擦桌，后台提及东桥贴出木牌。',
                    changes: [
                        {
                            task: 'places',
                            type: 'set',
                            target: 'bridge',
                            field: '告示',
                            value: '贴出木牌',
                            floor: 3,
                            quote: '东桥守卫贴出木牌',
                            nature: 'established_fact',
                        },
                        {
                            task: 'overview',
                            type: 'trade',
                            direction: 'buy',
                            counterparty: 'shop',
                            item: 'bell',
                            price: 5,
                            floor: 3,
                            quote: '买下铜铃',
                            paymentQuote: '付给杂货摊5金币',
                        },
                    ],
                }),
            };
        },
    });

    await queue.settle();
    // Unified Update call received the settled background prose alongside floor 3 main prose.
    assert.ok(updateBrief?.increment?.messages?.some(m => m.role === 'background' && m.text.includes('东桥守卫贴出木牌')));
    assert.deepEqual(settledFloors, [3]);

    const finalState = await service.read();
    // General `places` fact evidenced in background IS committed cleanly.
    assert.equal(finalState.entities.find(e => e.id === 'bridge').fields['告示'].value, '贴出木牌');
    // Background-only `trade` must NEVER change hero's coins and settles without halting queue!
    assert.equal(finalState.entities.find(e => e.id === 'hero').fields.coins.value, 10);
    assert.ok(store.floorWork[3].done.includes('suspense'));
});

test('0.2.36: createChapterProcessing triggers automatic minDepth=0 cascade to chapter node and invokes planner.onChapter', async () => {
    const pairCount = 77;
    const lastEnd = pairCount * 2 - 1;
    const chat = Array.from({ length: pairCount * 2 + 2 }, (_, idx) => ({
        is_user: idx % 2 === 0,
        name: idx % 2 === 0 ? '旅人' : '叙述者',
        mes: `第 ${idx} 楼消息`,
        send_date: `ch-${idx}`,
    }));
    const store = {
        summaryHistory: Array.from({ length: pairCount }, (_, idx) => ({
            kind: 'batch',
            startMesId: idx * 2,
            endMesId: idx * 2 + 1,
            roundSource: captureRangeSource(chat, idx * 2, idx * 2 + 1),
            summary: `第 ${idx + 1} 轮摘要`,
        })),
        floorWork: { [lastEnd]: { done: ['memory', 'overview', 'people', 'places', 'situation', 'suspense'], digest: `d-${lastEnd}` } },
    };

    const calls = [];
    const chapter = createChapterProcessing({
        read: () => ({ owner: 'ch-owner', chat, updateEnd: lastEnd }),
        memory: {
            getPublishedSummaryStore: () => store,
            generateReviewedLayer: async request => {
                calls.push(['layer', request.level, request.depth]);
                return `${request.level} 自动合并总结`;
            },
            saveFloorWork: async (_source, _check, updater) => {
                store.floorWork[lastEnd] ??= { done: [], digest: `d-${lastEnd}` };
                updater(store.floorWork[lastEnd], store);
            },
        },
        requireUpdate: async () => ({ agent: 'update' }),
        reviewEnabled: () => true,
        plannerEnabled: () => true,
        writeChapter: async source => {
            calls.push(['planner.onChapter', source.end]);
        },
    });

    const source = { start: lastEnd - 1, end: lastEnd, digest: `d-${lastEnd}` };
    assert.equal(chapter.pending(source, store), true);

    await chapter.run(source, new AbortController().signal, () => {});

    const targetBatch = store.summaryHistory.find(b => b.endMesId === lastEnd);
    assert.ok(targetBatch.pendingPlannerChapter, 'cascade chapter node must mark pendingPlannerChapter on latest batch');
    assert.ok((targetBatch.compressionNodes || []).some(n => n.level === 'stage'));
    assert.ok((targetBatch.compressionNodes || []).some(n => n.level === 'chapter'));
    assert.ok(calls.some(([kind]) => kind === 'planner.onChapter'));
    assert.ok(store.floorWork[lastEnd].chapter, 'writer output hash is saved after planner.onChapter finishes');
    assert.equal(chapter.pending(source, store), false);
});

test('0.2.36: simulation checks required update agent before simulation agent and handles null uninitialized world cleanly', async t => {
    const chat = [
        { is_user: true, name: '旅人', mes: '进镇。', send_date: 'u0' },
        { is_user: false, name: '店主', mes: '东桥有守卫。', swipe_id: 0, swipes: ['东桥有守卫。'], swipe_info: [{ send_date: 'a1' }] },
    ];
    const indexedDB = new IDBFactory();
    const storage = createWorldStorage({ indexedDB });
    t.after(() => storage.close());
    const service = createWorldService({ storage, getIdentity: () => 'clean-start', id: () => 'clean-1' });
    assert.equal(await service.read(), null);

    const store = { json: {}, summaryHistory: [] };
    const checked = [];
    let requireFailOnUpdate = true;
    const queue = createFloorProcessing({
        read: () => {
            const b = getUpdateAndSimulationBounds(chat);
            return { owner: 'clean-start', playerName: '旅人', chat, end: b.stableEnd, updateEnd: b.updateEnd, simulationEnd: b.simulationEnd };
        },
        tasks: () => [{ key: 'simulation', group: 'simulation', label: '推演', frequency: 'occasional' }],
        store: () => store,
        save: async () => assert.fail('simulation must not write floorWork'),
        saveSim: async (source, _check, updater) => {
            (store.floorSimulations ??= {})[source.end] = updater(store.floorSimulations?.[source.end], store);
        },
        getService: () => service,
        requireAgent: async task => {
            checked.push(task);
            if (requireFailOnUpdate && task === 'update') throw new Error('请先在设置中配置更新agent');
            return { agent: task };
        },
        generate: async () => ({ text: JSON.stringify({ text: '东桥驿马停驻片刻。', kind: 'world_flavor' }) }),
    });

    await assert.rejects(() => queue.settle(), /请先在设置中配置更新agent/);
    assert.deepEqual(checked, ['update']);
    assert.equal(store.floorSimulations?.[1], undefined);

    requireFailOnUpdate = false;
    checked.length = 0;
    queue.invalidate();
    await queue.settle();
    assert.deepEqual(checked, ['update', 'simulation']);
    assert.equal(await service.read(), null, 'clean simulation must leave worldArchive uninitialized');
    assert.equal(store.floorSimulations[1].text, '东桥驿马停驻片刻。');
});
