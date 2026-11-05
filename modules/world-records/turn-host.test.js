import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory } from 'fake-indexeddb';
import { createWorldArchive } from './host.js';
import { getWorldBridge } from './bridge.js';
import { prepareMemorySources, assertMemorySources, validateMemorySources } from './turn-runtime.js';
import { currentTurns, turnProgress } from './turn-ledger.js';
import { storyIdentityKey, notifyWorldSourcesChanged } from './sources.js';
import { captureStoryIdentity } from '../xiaobai-os/host/story-identity.js';
import { registerSummarySourceBoundary } from '../story-summary/generate/source-boundary.js';
import { prepareWorldUpdate } from './update-result.js';
import { worldUpdates } from './update-context.js';
import { authorityStoryStore, authorityMemoryStoryStore } from './authority-context.js';

function setup(t) {
    const previousDB = globalThis.indexedDB; globalThis.indexedDB = new IDBFactory();
    const context = { chatId: 'story', characterId: 0, characters: [{ avatar: 'hero.png' }],
        chat: [{ is_user: true, mes: '买剑', send_date: 'user' }, { name: '铁匠', mes: '支付五金币。', send_date: 'reply' }] };
    let snapshot = { enabled: true, store: { summaryHistory: [], json: {} } }, account = 'account-a';
    const errors = [];
    const archive = createWorldArchive({ getContext: () => context, getAccountId: () => account, getMemorySnapshot: () => snapshot,
        getMount: () => assert.fail('no UI expected'), isVisible: () => false, navigate() {}, onError: error => errors.push(error) });
    t.after(async () => { archive.dispose(); await setImmediate(); globalThis.indexedDB = previousDB; });
    return { context, archive, errors, bridge: () => getWorldBridge(storyIdentityKey(captureStoryIdentity(context))),
        setSnapshot(value) { snapshot = value; }, setAccount(value) { account = value; } };
}

test('confirmed memory delivery automatically commits clear same-turn proposals before importing summary sources', async t => {
    const f = setup(t); f.context.chat[1].mes = '主角到达铁匠铺。主角相信信使。远方可能起火。';
    const prepared = await prepareMemorySources(0, 1, { unified: true }), context = prepared.updateContext;
    const update = prepareWorldUpdate({ basis: { worldId: context.basis.worldId, branchId: context.basis.branchId, version: context.basis.version }, proposals: [
        { type: 'entity', name: '铁匠铺', kind: 'place', aliases: [], nature: 'established_fact', groupId: 'arrival', certainty: 'explicit', evidence: { floor: 1, quote: '主角到达铁匠铺' } },
        { type: 'story', record: { id: 'belief', kind: 'knowledge', person: '主角', certainty: 'believed', content: '信使可信', evidence: '听取信使自述' },
            before: { present: false }, nature: 'belief', groupId: 'belief', certainty: 'explicit', evidence: { floor: 1, quote: '主角相信信使' } },
        { type: 'entity', name: '远方火场', kind: 'place', aliases: [], nature: 'unclassified', groupId: 'fire', certainty: 'uncertain', evidence: { floor: 1, quote: '远方可能起火' } },
    ], acknowledgedReceipts: context.executionReceipts.map(item => item.commandId), conflicts: [] }, context);
    const store = { lastSummarizedMesId: 1, json: { storyRecords: [], characters: { main: [{ name: '主角', identity: '旅人' }] } },
        summaryHistory: [{ summary: '主角到达铁匠铺并听取信使自述。', endMesId: 1, worldUpdate: update, sourceReceipt: prepared.receipt }] };
    f.setSnapshot({ enabled: true, store }); const delivered = await prepared.deliver();
    assert.equal(delivered.reviews.length, 2); assert.ok(delivered.reviews.every(review => review.mode === 'automatic'));
    assert.equal(new Set(delivered.reviews.map(review => review.commandId)).size, 1);
    const service = f.bridge().service, state = await service.read();
    assert.ok(state.entities.some(entity => entity.name === '主角' && entity.bindings.includes('["memory","person:主角"]')));
    assert.ok(state.entities.some(entity => entity.name === '铁匠铺')); assert.equal(state.entities.some(entity => entity.name === '远方火场'), false);
    assert.match(await f.archive.prepare('主角'), /信使可信/); assert.deepEqual(store.json.storyRecords, []);
    notifyWorldSourcesChanged(); notifyWorldSourcesChanged(); await f.archive.prepare('主角'); await prepared.deliver();
    assert.equal(worldUpdates(await service.read())[0].reviews.length, 2);
    assert.equal((await service.read()).version, state.version);
    const next = await prepareMemorySources(0, 1, { unified: true });
    assert.ok(next.updateContext.executionReceipts.some(receipt => receipt.commandId === delivered.reviews[0].commandId));
    assert.equal(next.updateContext.world.storyRecords[0].certainty, 'believed'); assert.deepEqual(f.errors, []);
});

test('real host confirmation updates subsequent narration and administrator inputs without rewriting summary JSON', async t => {
    const f = setup(t);
    f.context.chat[1].mes = '支付五金币。信使可能隐瞒了消息。';
    const prepared = await prepareMemorySources(0, 1, { unified: true }), context = prepared.updateContext;
    const update = prepareWorldUpdate({ basis: { worldId: context.basis.worldId, branchId: context.basis.branchId, version: context.basis.version },
        proposals: [{ type: 'story', record: { id: 'belief', kind: 'knowledge', person: '主角', certainty: 'believed', content: '信使可能隐瞒消息', evidence: '听到信使解释', learnedAt: '' }, before: { present: false }, nature: 'belief', evidence: { floor: 1, quote: '信使可能隐瞒' } }],
        acknowledgedReceipts: context.executionReceipts.map(item => item.commandId), conflicts: [] }, context);
    const store = { lastSummarizedMesId: 1, json: { storyRecords: [] }, summaryHistory: [{ summary: '主角听到信使的消息', endMesId: 1, worldUpdate: update, sourceReceipt: prepared.receipt }] };
    f.setSnapshot({ enabled: true, store }); await prepared.deliver();
    const service = f.bridge().service, state = await service.read();
    const result = await service.commit(service.proposalCommand(state, update.requestId, 0, 'accepted'));
    assert.match(await f.archive.prepare('主角'), /信使可能隐瞒消息/); assert.deepEqual(store.json.storyRecords, []);
    const next = await prepareMemorySources(0, 1, { unified: true });
    assert.equal(next.updateContext.world.storyRecords[0].person, '主角');
    assert.equal(next.updateContext.world.storyRecords[0].certainty, 'believed');
    assert.equal(next.updateContext.world.proposalHistory[0].reviews[0].outcome, 'applied');
    assert.ok(next.updateContext.executionReceipts.some(receipt => receipt.commandId === result.receipt.commandId));
    assert.equal(worldUpdates(await service.read())[0].reviews.length, 1);
    store.json.storyRecords.push({ id: 'belief', kind: 'knowledge', person: '主角', content: '旧认知', certainty: 'believed', evidence: '旧资料', learnedAt: '' });
    assert.equal(authorityMemoryStoryStore(store, f.context).json.storyRecords.length, 0);
    assert.equal(authorityStoryStore(store, f.context).json.storyRecords[0].content, '信使可能隐瞒消息');
    assert.equal(store.json.storyRecords[0].content, '旧认知');
});

test('real host checks the whole incremental source when evidence belongs to an earlier turn', async t => {
    const f = setup(t); f.context.chat.push({ mes: '稍等', is_user: true, send_date: 'u2' }, { mes: '继续交谈', send_date: 'a2' });
    const prepared = await prepareMemorySources(0, 3, { unified: true }), context = prepared.updateContext;
    const update = prepareWorldUpdate({ basis: { worldId: context.basis.worldId, branchId: context.basis.branchId, version: context.basis.version },
        proposals: [{ type: 'entity', name: '铁剑', kind: 'item', aliases: [], nature: 'established_fact', evidence: { floor: 1, quote: '支付五金币' } }],
        acknowledgedReceipts: context.executionReceipts.map(item => item.commandId), conflicts: [] }, context);
    f.setSnapshot({ enabled: true, store: { lastSummarizedMesId: 3, json: {}, summaryHistory: [{ worldUpdate: update, sourceReceipt: prepared.receipt, summary: '买剑', endMesId: 3 }] } });
    await prepared.deliver(); const service = f.bridge().service, state = await service.read();
    const command = service.proposalCommand(state, update.requestId, 0, 'accepted');
    f.context.chat[2].mes = '撤销刚才的交易';
    await assert.rejects(service.commit(command), /正文来源已变化/);
    assert.equal((await service.read()).entities.length, 0);
});

test('real world host pins source receipts, reconciles confirmed memory and ignores duplicate notifications', async t => {
    const f = setup(t), prepared = await prepareMemorySources(0, 1);
    assertMemorySources(prepared); await validateMemorySources(prepared);
    const service = f.bridge().service, state = await service.read();
    assert.deepEqual(prepared.receipt.turns, [currentTurns(state)[0].id]);
    f.setSnapshot({ enabled: true, store: { summaryHistory: [{ endMesId: 1, sourceReceipt: prepared.receipt }], json: {} } });
    notifyWorldSourcesChanged(); await f.archive.prepare();
    const delivered = await service.read(); assert.equal(turnProgress(delivered).memoryThroughFloor, 1);
    notifyWorldSourcesChanged(); notifyWorldSourcesChanged(); await f.archive.prepare();
    assert.equal((await service.read()).version, delivered.version); assert.deepEqual(f.errors, []);
});

test('real host guards reject source edits before a delayed edit notification', async t => {
    const f = setup(t), prepared = await prepareMemorySources(0, 1), service = f.bridge().service;
    const state = await service.read(), turn = currentTurns(state)[0];
    const command = service.effectCommand(state, turn.id, 'execute', [{ type: 'create', id: 'item', kind: 'item', name: '剑',
        source: { module: 'narrative', key: turn.id, label: '本轮' } }], '执行');
    f.context.chat[1].mes = '原文已修改';
    assert.throws(() => assertMemorySources(prepared), /正文来源已变化/);
    await assert.rejects(validateMemorySources(prepared), /正文来源已变化/);
    await assert.rejects(service.commit(command), /正文来源或世界分支/);
    assert.equal((await service.read()).entities.length, 0);
});

test('source guards detect a branch switch even after returning to the original branch', async t => {
    const f = setup(t), prepared = await prepareMemorySources(0, 1), service = f.bridge().service;
    const initial = await service.read(), fork = await service.fork(initial, initial.version);
    await service.selectBranch(initial.branchId, fork);
    assert.throws(() => assertMemorySources(prepared), /世界分支/);
    const next = await prepareMemorySources(0, 1); assertMemorySources(next);
});

test('changing accounts with the same chat ID cannot retain the old source token', async t => {
    const f = setup(t), prepared = await prepareMemorySources(0, 1), before = await f.bridge().service.read();
    f.setAccount('account-b'); assert.throws(() => assertMemorySources(prepared), /聊天、世界分支/);
    const fresh = await prepareMemorySources(0, 1); assert.notEqual(fresh.receipt.worldId, before.worldId);
});

test('unfinished producer output cannot become an independent memory source', async t => {
    const f = setup(t), remove = registerSummarySourceBoundary(() => 0); t.after(remove);
    await assert.rejects(prepareMemorySources(0, 1), /正文来源已变化/);
    assert.equal(currentTurns(await f.bridge().service.read()).length, 0);
});

test('narration stops on stale executed effects while the archive remains available for recovery', async t => {
    const f = setup(t); await prepareMemorySources(0, 1); const service = f.bridge().service;
    let state = await service.read(), turn = currentTurns(state)[0];
    state = (await service.commit(service.effectCommand(state, turn.id, 'sword', [{ type: 'create', id: 'sword', kind: 'item', name: '剑',
        source: { module: 'narrative', key: turn.id, label: '本轮' } }], '得到剑'))).state;
    f.context.chat[1].mes = '其实没有买剑。';
    await assert.rejects(f.archive.prepare(), /关联的世界效果需要核对/);
    const conflict = await service.read(); assert.equal(conflict.entities.length, 1); assert.equal(turnProgress(conflict).conflicts.length, 1);
    await service.fork(conflict, state.version - 1); await f.archive.prepare();
    assert.equal(turnProgress(await service.read()).conflicts.length, 0); assert.deepEqual(f.errors, []);
});
test('an unavailable registered world runtime fails closed instead of silently generating without a full snapshot', async t => {
    const f = setup(t); f.archive.dispose();
    await assert.rejects(prepareMemorySources(0, 1, { unified: true }), /世界内核尚未就绪/);
    assert.equal(await prepareMemorySources(0, 1), null);
});
