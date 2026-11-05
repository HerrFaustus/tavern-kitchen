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
