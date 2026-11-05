import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { currentTurns, turnRecords, turnProgress, turnEffectConflicts } from './turn-ledger.js';
import { captureRangeSource, isRangeSourceCurrent, firstInvalidMemorySource } from '../story-summary/data/turn-source.js';
import { canonical } from './domain.js';

const chatFixture = () => [{ is_user: true, name: '玩家', mes: '买这把剑。', send_date: 'user-1' },
    { is_user: false, name: '铁匠', mes: '收下五金币，把剑交给你。', send_date: 'reply-1' }];
const source = { module: 'manual', key: 'seed', label: '初始世界' };
const create = (id, kind = 'person') => ({ type: 'create', id, name: id, kind, source });
const set = (entityId, field, value) => ({ type: 'set', entityId, field, value, source });
const field = (state, id, key) => state.entities.find(item => item.id === id).fields[key].value;
function fixture(t, getChat) {
    const indexedDB = new IDBFactory(), storage = createWorldStorage({ indexedDB });
    let serial = 0, owner = 'chat-a';
    const options = { storage, getIdentity: () => owner, id: () => `id-${++serial}`,
        ...(getChat ? { isSourceCurrent: turn => isRangeSourceCurrent(turn?.source, getChat()) } : {}) };
    const service = createWorldService(options);
    t.after(() => storage.close());
    return { indexedDB, storage, service, options, switchOwner(value) { owner = value; service.invalidate(); } };
}
const batch = (service, state, chat, start = 0, end = chat.length - 1) => ({ endMesId: end,
    sourceReceipt: service.memorySourceReceipt(state, chat, start, end) });

test('durable turn IDs survive reload and repeated notifications add no events', async t => {
    const f = fixture(t), chat = chatFixture();
    const initial = await f.service.syncTurns(chat), turn = currentTurns(initial)[0];
    assert.equal(turn.identity, 'anchored'); assert.deepEqual(turn.source.messages.map(item => item.text), chat.map(item => item.mes));
    const again = await f.service.syncTurns(structuredClone(chat));
    assert.equal(again.version, initial.version); assert.equal(currentTurns(again)[0].id, turn.id);
    await f.storage.close();
    const storage = createWorldStorage({ indexedDB: f.indexedDB }); t.after(() => storage.close());
    const fresh = createWorldService({ storage, getIdentity: () => 'chat-a' });
    assert.deepEqual(currentTurns(await fresh.syncTurns(structuredClone(chat))), currentTurns(initial));
});

test('hiding prose preserves turn identity, world version and already-executed effect receipts', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    const turn = currentTurns(state)[0], ops = [create('hidden-owner'), set('hidden-owner', 'coins', 5)];
    const execution = await f.service.commit(f.service.effectCommand(state, turn.id, 'hidden-effect', ops, '已执行'));
    state = execution.state;
    for (const message of chat) message.is_system = true;
    const hidden = await f.service.syncTurns(chat);
    assert.equal(hidden.version, state.version);
    assert.equal(currentTurns(hidden)[0].id, turn.id);
    assert.deepEqual(f.service.executionReceipts(hidden, turn.id), [execution.receipt]);
    const repeated = await f.service.commit(f.service.effectCommand(hidden, turn.id, 'hidden-effect', ops, '重复通知'));
    assert.equal(repeated.repeated, true); assert.equal(field(repeated.state, 'hidden-owner', 'coins'), 5);
    chat.push({ mes: '系统通知', is_system: true, extra: { type: 'comment' } });
    assert.equal((await f.service.syncTurns(chat)).version, state.version);
});

test('reply and player edits create source revisions while preserving message and candidate identity', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    const first = currentTurns(state)[0]; chat[1].mes = '收下八金币。';
    state = await f.service.syncTurns(chat); const second = currentTurns(state)[0];
    assert.notEqual(second.id, first.id); assert.equal(second.messageId, first.messageId); assert.equal(second.candidateId, first.candidateId);
    assert.equal(second.revision, 2); assert.equal(turnRecords(state).find(item => item.id === first.id).status, 'superseded');
    chat[0].mes = '我要的是另一把剑。'; state = await f.service.syncTurns(chat);
    assert.equal(currentTurns(state)[0].revision, 3); assert.equal(turnRecords(state).length, 3);
    assert.equal(turnRecords(state)[0].source.messages[0].text, '买这把剑。');
});

test('generation timing updates do not rename a dated candidate, while continuation creates a content revision', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    const original = currentTurns(state)[0]; Object.assign(chat[1], { gen_started: 'later-start', gen_finished: 'later-finish', extra: { gen_id: 42 } });
    assert.equal((await f.service.syncTurns(chat)).version, state.version);
    chat[1].mes += '随后继续讲述。'; state = await f.service.syncTurns(chat); const revised = currentTurns(state)[0];
    assert.equal(revised.messageId, original.messageId); assert.equal(revised.candidateId, original.candidateId); assert.equal(revised.revision, 2);
});

test('moving an unchanged executed turn does not invalidate its effect because of its new floor number', async t => {
    const f = fixture(t), chat = chatFixture(); chat.unshift({ mes: '较早的开场', send_date: 'opening' });
    let state = await f.service.syncTurns(chat); const turn = currentTurns(state)[1];
    state = (await f.service.commit(f.service.effectCommand(state, turn.id, 'item', [create('sword', 'item')], '收到剑'))).state;
    chat.shift(); state = await f.service.syncTurns(chat);
    assert.equal(currentTurns(state)[0].id, turn.id); assert.equal(currentTurns(state)[0].source.end, 1);
    assert.deepEqual(turnEffectConflicts(state), []); assert.equal(state.entities[0].id, 'sword');
});

test('same-text swipes are distinct candidates; deleting an unselected swipe only renumbers', async t => {
    const f = fixture(t), chat = chatFixture();
    Object.assign(chat[1], { swipe_id: 0, swipes: ['相同正文', '相同正文'],
        swipe_info: [{ send_date: 'candidate-a' }, { send_date: 'candidate-b' }], mes: '相同正文' });
    let state = await f.service.syncTurns(chat); const first = currentTurns(state)[0];
    chat[1].swipe_id = 1; state = await f.service.syncTurns(chat); const second = currentTurns(state)[0];
    assert.equal(second.messageId, first.messageId); assert.notEqual(second.candidateId, first.candidateId); assert.notEqual(second.id, first.id);
    chat[1].swipes.splice(0, 1); chat[1].swipe_info.splice(0, 1); chat[1].swipe_id = 0;
    const renumbered = await f.service.syncTurns(structuredClone(chat));
    assert.equal(currentTurns(renumbered)[0].id, second.id); assert.equal(renumbered.version, state.version);
});

test('deletion and floor movement retain the original source and do not merge two messages', async t => {
    const f = fixture(t), chat = chatFixture();
    chat.push({ is_user: true, mes: '离开。', send_date: 'user-2' }, { name: '铁匠', mes: '明天见。', send_date: 'reply-2' });
    let state = await f.service.syncTurns(chat); const [first, second] = currentTurns(state);
    chat.splice(0, 2); state = await f.service.syncTurns(chat); const moved = currentTurns(state)[0];
    assert.equal(moved.messageId, second.messageId); assert.equal(moved.candidateId, second.candidateId);
    assert.equal(moved.source.end, 1); assert.equal(moved.id, second.id);
    assert.equal(turnRecords(state).find(item => item.id === first.id).status, 'removed');
    assert.equal(second.source.end, 3); // The historical state retains its original position.
});

for (const mode of ['unanchored', 'duplicate-message', 'duplicate-candidate']) test(`uncertain identities retain source records but cannot execute effects: ${mode}`, async t => {
    const f = fixture(t), chat = chatFixture();
    if (mode === 'unanchored') delete chat[1].send_date;
    if (mode === 'duplicate-message') chat.push(structuredClone(chat[1]));
    if (mode === 'duplicate-candidate') Object.assign(chat[1], { swipes: [chat[1].mes, chat[1].mes], swipe_id: 0,
        swipe_info: [{ send_date: 'same' }, { send_date: 'same' }] });
    const state = await f.service.syncTurns(chat), turns = currentTurns(state);
    assert.equal(new Set(turns.map(item => item.messageId)).size, turns.length);
    assert.throws(() => f.service.effectCommand(state, turns[0].id, 'effect', [create('a')], '变更'), /身份不明确/);
    assert.equal((await f.service.syncTurns(structuredClone(chat))).version, state.version);
});

test('memory is linked only after a confirmed receipt is supplied; retry does not apply world effects', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    state = (await f.service.commit(f.service.command(state, [create('buyer'), create('seller'), create('sword', 'item'),
        set('buyer', 'coins', 10), set('seller', 'coins', 0), set('sword', 'owner', { entityId: 'seller' })], '登记'))).state;
    const turn = currentTurns(state)[0];
    const ops = [{ type: 'purchase', buyerId: 'buyer', sellerId: 'seller', itemId: 'sword', price: 5, source }];
    const execution = await f.service.commit(f.service.effectCommand(state, turn.id, 'purchase-sword', ops, '买剑'));
    state = execution.state; const history = [batch(f.service, state, chat)];
    assert.equal(turnProgress(state).memoryThroughFloor, -1);
    state = await f.service.syncTurns(chat, { history: [] }); assert.equal(currentTurns(state)[0].memory.length, 0);
    state = await f.service.syncTurns(chat, { history }); assert.equal(turnProgress(state).memoryThroughFloor, 1);
    assert.equal(field(state, 'buyer', 'coins'), 5); assert.equal(field(state, 'seller', 'coins'), 5);
    const retry = await f.service.commit(f.service.effectCommand(state, turn.id, 'purchase-sword', ops, '换一次请求编号'));
    assert.equal(retry.repeated, true); assert.equal(retry.receipt.commandId, execution.receipt.commandId);
    assert.equal(field(retry.state, 'buyer', 'coins'), 5);
    assert.equal((await f.service.syncTurns(chat, { history })).version, state.version);
    assert.deepEqual(f.service.executionReceipts(state, turn.id), [execution.receipt]);
    await assert.rejects(f.service.commit(f.service.effectCommand(state, turn.id, 'purchase-sword', [{ ...ops[0], price: 6 }], '改金额')), /不能提交不同内容/);
});

test('source progress cannot skip a failed earlier turn or advance for a legacy summary boundary', async t => {
    const f = fixture(t), chat = chatFixture();
    chat.push({ is_user: true, mes: '继续。', send_date: 'user-2' }, { mes: '离开铁匠铺。', send_date: 'reply-2' });
    let state = await f.service.syncTurns(chat); const first = batch(f.service, state, chat, 0, 1), second = batch(f.service, state, chat, 2, 3);
    state = await f.service.syncTurns(chat, { history: [{ endMesId: 1 }, second] });
    assert.equal(turnProgress(state).memoryThroughFloor, -1); assert.equal(turnProgress(state).confirmed.length, 1);
    state = await f.service.syncTurns(chat, { history: [first, second] });
    assert.equal(turnProgress(state).memoryThroughFloor, 3); assert.deepEqual(turnProgress(state).pending, []);
});

test('a batch split between player and reply needs both confirmed ranges', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    const player = batch(f.service, state, chat, 0, 0), reply = batch(f.service, state, chat, 1, 1);
    state = await f.service.syncTurns(chat, { history: [reply] }); assert.equal(currentTurns(state)[0].memory.length, 0);
    state = await f.service.syncTurns(chat, { history: [player, reply] }); assert.equal(currentTurns(state)[0].memory.length, 2);
});

test('editing an executed source identifies its receipt and blocks new automatic effects', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    const original = currentTurns(state)[0];
    state = (await f.service.commit(f.service.effectCommand(state, original.id, 'resource-change', [create('a'), set('a', 'coins', 5)], '执行'))).state;
    const receipt = state.receipts.at(-1); chat[1].mes = '正文改为支付八金币。';
    state = await f.service.syncTurns(chat);
    assert.deepEqual(turnEffectConflicts(state), [receipt]); assert.deepEqual(turnProgress(state).conflicts, [receipt.eventId]);
    assert.throws(() => f.service.assertSourcesConsistent(state), /关联的世界效果/);
    assert.throws(() => f.service.effectCommand(state, currentTurns(state)[0].id, 'new-change', [set('a', 'coins', 2)], '执行'), /待核对/);
    assert.equal(field(state, 'a', 'coins'), 5);
    // An explicit historical fork is recoverable; the old effect branch stays on disk.
    state = await f.service.fork(state, receipt.version - 1); state = await f.service.syncTurns(chat);
    f.service.assertSourcesConsistent(state); assert.equal(state.entities.length, 0);
    assert.equal((await f.service.branches()).length, 2);
});

test('manual world edits remain independent of prose changes', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    state = (await f.service.commit(f.service.command(state, [create('a'), set('a', 'coins', 12)], '人工调整'))).state;
    chat[1].mes = '改写对白。'; state = await f.service.syncTurns(chat);
    assert.deepEqual(turnEffectConflicts(state), []); assert.equal(field(state, 'a', 'coins'), 12);
});

test('a source changed before its notification cannot execute through a stale catalog', async t => {
    const chat = chatFixture(), f = fixture(t, () => chat); const state = await f.service.syncTurns(chat);
    const command = f.service.effectCommand(state, currentTurns(state)[0].id, 'create', [create('a')], '执行');
    chat[1].mes = '原文已变'; await assert.rejects(f.service.commit(command), /正文来源或世界分支已变化/);
    assert.equal((await f.service.read()).version, state.version);
});

test('switching away and back invalidates an in-flight effect even at the same archive version', async t => {
    const f = fixture(t), chat = chatFixture(), state = await f.service.syncTurns(chat);
    const command = f.service.effectCommand(state, currentTurns(state)[0].id, 'create', [create('a')], '执行');
    f.switchOwner('chat-b'); await f.service.ensure(); f.switchOwner('chat-a');
    await assert.rejects(f.service.commit(command), /世界分支已变化/);
    assert.equal((await f.service.read()).version, state.version);
});

test('withholding an unfinished reply never confirms its source or memory', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat, { end: 0 });
    assert.equal(currentTurns(state).length, 0); state = await f.service.syncTurns(chat);
    assert.equal(currentTurns(state).length, 1);
    state = await f.service.syncTurns(chat, { end: 0 }); assert.equal(currentTurns(state).length, 0);
});

test('failed memory delivery can reconcile after restart without model replay or double state writes', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    const history = [batch(f.service, state, chat)], before = canonical(state), put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'bindings') throw Error('delivery disk failure'); return put.apply(this, args); };
    try { await assert.rejects(f.service.syncTurns(chat, { history }), /delivery disk failure/); }
    finally { IDBObjectStore.prototype.put = put; }
    assert.equal(canonical(await f.service.read()), before); await f.storage.close();
    const storage = createWorldStorage({ indexedDB: f.indexedDB }); t.after(() => storage.close());
    const service = createWorldService({ storage, getIdentity: () => 'chat-a' }); state = await service.syncTurns(chat, { history });
    assert.equal(turnProgress(state).memoryThroughFloor, 1);
    assert.equal((await service.syncTurns(chat, { history })).version, state.version);
});

test('forks retain delivered memory but do not adopt a late delivery from another branch', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    const basis = state, history = [batch(f.service, state, chat)];
    state = await f.service.syncTurns(chat, { history }); state = await f.service.fork(state, state.version);
    state = await f.service.syncTurns(chat, { history }); assert.equal(turnProgress(state).memoryThroughFloor, 1);
    state = await f.service.fork(state, basis.version); state = await f.service.syncTurns(chat, { history });
    assert.equal(currentTurns(state)[0].memory.length, 0);
});

test('source receipts reject tampered text and expose edits even after a tracker reload', async t => {
    const f = fixture(t), chat = chatFixture(), state = await f.service.syncTurns(chat);
    const history = [batch(f.service, state, chat)], store = { summaryHistory: history };
    assert.equal(firstInvalidMemorySource(store, chat), null); chat[1].mes = '已修改';
    assert.equal(firstInvalidMemorySource(store, chat), 0);
    history[0].sourceReceipt.source.messages[0].text = '伪造来源';
    await assert.rejects(f.service.syncTurns(chat, { history }), /来源指纹/);
    assert.equal((await f.service.read()).version, state.version);
    assert.equal(isRangeSourceCurrent(captureRangeSource(chat, 0, 1), chat), true);
});

test('restoring a source-linked archive checks execution fingerprints and replays the entire ledger', async t => {
    const f = fixture(t), chat = chatFixture(); let state = await f.service.syncTurns(chat);
    state = (await f.service.commit(f.service.effectCommand(state, currentTurns(state)[0].id, 'item', [create('sword', 'item')], '收到剑'))).state;
    const restored = await f.service.restore(state, state); assert.deepEqual(restored.sources, state.sources);
    assert.deepEqual(restored.receipts, state.receipts);
    const forged = structuredClone(state); forged.receipts.at(-1).effectFingerprint = '[]';
    await assert.rejects(f.service.restore(forged, restored), /效果命令与回执/);
});
