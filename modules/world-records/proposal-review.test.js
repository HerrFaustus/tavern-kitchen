import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { buildUpdateContext, worldUpdates } from './update-context.js';
import { prepareWorldUpdate } from './update-result.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { worldStoryRecords } from './world-story-state.js';
import { currentTurns, turnEffectConflicts } from './turn-ledger.js';

const proof = { floor: 1, quote: '支付五金币' };
const source = { module: 'manual', key: 'seed', label: '开局' };
const set = (entityId, field, value) => ({ type: 'set', entityId, field, value, source });
async function fixture(t, extra = [], baseline = []) {
    const indexedDB = new IDBFactory(), storage = createWorldStorage({ indexedDB }); t.after(() => storage.close());
    let sequence = 0, identity = 'story';
    const chat = [{ mes: '买下铁剑。', is_user: true, send_date: 'user' }, { mes: '你支付五金币，买到铁剑，并相信了信使。', send_date: 'reply' }];
    const history = [];
    const service = createWorldService({ storage, getIdentity: () => identity, id: () => `review-${++sequence}`,
        isSourceCurrent: turn => !!turn && isRangeSourceCurrent(turn.source, chat),
        isUpdateSourceCurrent: update => !!update && isRangeSourceCurrent(update.source, chat),
        getReviewContext: () => ({ available: true, storyRecords: baseline, history }) });
    let state = await service.syncTurns(chat);
    state = (await service.commit(service.command(state, [{ type: 'create', id: 'hero', name: '主角', kind: 'person', source },
        set('hero', 'coins', 10)], '开局'))).state;
    const receipt = service.memorySourceReceipt(state, chat, 0, 1);
    const context = buildUpdateContext(state, { json: { storyRecords: baseline }, summaryHistory: [] }, chat, receipt);
    const update = prepareWorldUpdate({ basis: { worldId: state.worldId, branchId: state.branchId, version: state.version },
        proposals: [{ type: 'field', entityId: 'hero', field: 'coins', before: { present: true, value: 10 }, value: 5, nature: 'established_fact', evidence: proof }, ...extra],
        acknowledgedReceipts: context.executionReceipts.map(item => item.commandId), conflicts: [] }, context);
    history.push({ summary: '买下铁剑。', endMesId: 1, sourceReceipt: receipt, worldUpdate: update });
    state = await service.syncTurns(chat, { history });
    return { service, storage, state, chat, baseline, history, requestId: receipt.id,
        readReview: state => worldUpdates(state)[0].reviews || [], setIdentity: value => { identity = value; } };
}

test('confirm writes a field and its durable review together; retries and reload never repeat the effect', async t => {
    const f = await fixture(t), command = f.service.proposalCommand(f.state, f.requestId, 0, 'accepted');
    const applied = await f.service.commit(command);
    assert.equal(applied.state.entities[0].fields.coins.value, 5);
    assert.equal(f.readReview(applied.state)[0].outcome, 'applied');
    assert.ok(applied.receipt.origin.sourceId); assert.equal(applied.receipt.eventId, f.readReview(applied.state)[0].eventId);
    assert.equal((await f.service.commit(command)).repeated, true);
    const retry = f.service.proposalCommand(applied.state, f.requestId, 0, 'accepted');
    assert.notEqual(retry.id, command.id); assert.equal((await f.service.commit(retry)).repeated, true);
    const reconciled = await f.service.syncTurns(f.chat, { history: f.history });
    assert.deepEqual(f.readReview(reconciled), f.readReview(applied.state));
    assert.equal(reconciled.version, applied.state.version);
    const fresh = createWorldService({ storage: f.storage, getIdentity: () => 'story' });
    assert.equal((await fresh.read()).entities[0].fields.coins.value, 5);
    assert.equal((await fresh.commit(command)).repeated, true);
    const updated = structuredClone(retry); updated.operations[0].proposal.value = 0;
    await assert.rejects(f.service.commit(updated), /不能提交不同结果/);
});

test('edits keep original evidence and values while recording exactly the approved result', async t => {
    const f = await fixture(t);
    const command = f.service.proposalCommand(f.state, f.requestId, 0, 'accepted', { edit: { value: 4 }, reason: '核对后修正' });
    const { state } = await f.service.commit(command), record = worldUpdates(state)[0];
    assert.equal(state.entities[0].fields.coins.value, 4);
    assert.equal(record.update.proposals[0].value, 5);
    assert.equal(record.reviews[0].proposal.value, 4); assert.equal(record.reviews[0].edited, true);
    assert.deepEqual(record.reviews[0].proposal.evidence, proof);
    assert.throws(() => f.service.proposalCommand(f.state, f.requestId, 0, 'accepted', { edit: { entityId: 'other' } }), /不允许/);
    assert.throws(() => f.service.proposalCommand(f.state, f.requestId, 0, 'accepted', { edit: { value: -1 } }), /金币/);
});

test('rejection persists once without changing facts or creating an executable source effect', async t => {
    const f = await fixture(t), command = f.service.proposalCommand(f.state, f.requestId, 0, 'rejected', { reason: '正文未明确成交' });
    const result = await f.service.commit(command);
    assert.equal(result.state.entities[0].fields.coins.value, 10);
    assert.equal(result.receipt.origin, undefined);
    assert.equal(f.readReview(result.state)[0].action, 'rejected');
    assert.equal((await f.service.commit(f.service.proposalCommand(result.state, f.requestId, 0, 'rejected'))).repeated, true);
    await assert.rejects(f.service.commit(f.service.proposalCommand(result.state, f.requestId, 0, 'accepted')), /已处理/);
});

test('stale proposals require explicit rechecking and use the current before value without losing manual edits silently', async t => {
    const f = await fixture(t);
    const state = (await f.service.commit(f.service.command(f.state, [set('hero', 'coins', 12)], '人工修改'))).state;
    const view = f.service.proposalView(state, f.requestId, 0); assert.ok(view.stale); assert.equal(view.before.value, 12);
    assert.throws(() => f.service.proposalCommand(state, f.requestId, 0, 'accepted'), /旧值/);
    const command = f.service.proposalCommand(state, f.requestId, 0, 'accepted', { view, rechecked: true, edit: { value: 7 } });
    const result = await f.service.commit(command);
    assert.equal(result.state.entities[0].fields.coins.value, 7);
    assert.equal(f.readReview(result.state)[0].proposal.before.value, 12);
});

test('a late source edit, another world write, a branch round trip and a chat switch reject old submissions', async t => {
    const f = await fixture(t), command = f.service.proposalCommand(f.state, f.requestId, 0, 'accepted');
    f.chat[0].mes = '不要买剑'; await assert.rejects(f.service.commit(command), /来源已变化/);
    f.chat[0].mes = '买下铁剑。';
    const newer = (await f.service.commit(f.service.command(f.state, [set('hero', 'description', 'changed')], '并发修改'))).state;
    await assert.rejects(f.service.commit(command), /档案已更新/);
    const fresh = f.service.proposalCommand(newer, f.requestId, 0, 'accepted', { rechecked: true });
    const fork = await f.service.fork(newer, newer.version); await f.service.selectBranch(newer.branchId, fork);
    await assert.rejects(f.service.commit(fresh), /世界分支已变化/);
    f.setIdentity('other'); await assert.rejects(f.service.commit(command));
});

test('a failed IndexedDB transaction leaves both facts and review pending, and the same command can recover', async t => {
    const f = await fixture(t), command = f.service.proposalCommand(f.state, f.requestId, 0, 'accepted');
    const put = IDBObjectStore.prototype.put;
    const mock = t.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
        if (this.name === 'branches' && args[0]?.version === f.state.version + 1) throw Error('disk unavailable');
        return put.apply(this, args);
    });
    await assert.rejects(f.service.commit(command), /disk unavailable/);
    const unchanged = await f.service.read(); assert.equal(unchanged.version, f.state.version); assert.deepEqual(f.readReview(unchanged), []);
    mock.mock.restore(); assert.equal((await f.service.commit(command)).state.entities[0].fields.coins.value, 5);
});

test('non-fact fields stay claims and new objects receive stable identities without promoting rumors', async t => {
    const f = await fixture(t, [{ type: 'entity', kind: 'person', name: '信使', aliases: ['来客'], nature: 'rumor', evidence: proof }]);
    let state = (await f.service.commit(f.service.proposalCommand(f.state, f.requestId, 0, 'accepted', { edit: { nature: 'rumor' } }))).state;
    assert.equal(state.entities[0].fields.coins.value, 10); assert.equal(state.claims[0].nature, 'rumor');
    state = (await f.service.commit(f.service.proposalCommand(state, f.requestId, 1, 'accepted', { rechecked: true }))).state;
    assert.equal(state.entities[1].name, '信使'); assert.deepEqual(state.entities[1].fields, {});
    assert.ok(state.claims.some(item => item.entityId === state.entities[1].id && item.nature === 'rumor'));
    const restored = await f.service.restore(state, state); assert.deepEqual(restored.entities, state.entities); assert.deepEqual(f.readReview(restored), f.readReview(state));
});

test('knowledge and plans are written to authoritative story state while creative scenes remain candidates', async t => {
    const proposals = [
        { type: 'story', record: { id: 'belief', kind: 'knowledge', person: '主角', content: '信使可信', certainty: 'believed', evidence: '听到信使介绍', learnedAt: '' }, before: { present: false }, nature: 'belief', evidence: proof },
        { type: 'story', record: { id: 'scene', kind: 'scene', location: '月球', participants: [], situation: '', tension: '', pendingBeat: '' }, before: { present: false }, nature: 'creative_proposal', evidence: proof },
        { type: 'story', record: { id: 'return', kind: 'plan', title: '返城', description: '之后返城', status: 'open', reason: '', due: '明天' }, before: { present: false }, nature: 'intention', evidence: proof },
    ];
    const f = await fixture(t, proposals);
    let state = (await f.service.commit(f.service.proposalCommand(f.state, f.requestId, 1, 'accepted'))).state;
    const knowledge = worldStoryRecords(state)[0]; assert.equal(knowledge.person, '主角'); assert.equal(knowledge.certainty, 'believed');
    assert.equal(knowledge._nature, 'belief'); assert.equal(knowledge._worldVersion, state.version);
    state = (await f.service.commit(f.service.proposalCommand(state, f.requestId, 2, 'accepted', { rechecked: true }))).state;
    assert.equal(worldStoryRecords(state).some(record => record.id === 'scene'), false); assert.equal(state.modules.story.candidates[0].record.location, '月球');
    state = (await f.service.commit(f.service.proposalCommand(state, f.requestId, 3, 'accepted', { rechecked: true }))).state;
    assert.equal(worldStoryRecords(state).find(record => record.id === 'return').status, 'open');
    assert.equal(worldStoryRecords(state).find(record => record.id === 'return').due, '明天');
    const context = buildUpdateContext(state, { json: {}, summaryHistory: f.history }, f.chat, f.service.memorySourceReceipt(state, f.chat, 0, 1));
    assert.equal(context.world.storyRecords[0].person, '主角'); assert.equal(context.world.storyCandidates[0].nature, 'creative_proposal');
    const fork = await f.service.fork(state, f.state.version); assert.equal(fork.modules.story, undefined); assert.equal(f.readReview(fork).length, 0);
});

test('editing an approved source keeps its receipt and blocks new effects until explicitly resolved', async t => {
    const f = await fixture(t), turnId = currentTurns(f.state)[0].id;
    const applied = await f.service.commit(f.service.proposalCommand(f.state, f.requestId, 0, 'accepted'));
    f.chat[1].mes = '没有付款。';
    const state = await f.service.syncTurns(f.chat, { history: f.history });
    assert.equal(worldUpdates(state)[0].status, 'retracted'); assert.equal(f.readReview(state).length, 1);
    assert.equal(turnEffectConflicts(state)[0].origin.sourceId, turnId);
    assert.equal(state.entities[0].fields.coins.value, 5); assert.ok(applied.receipt);
    assert.throws(() => f.service.assertSourcesConsistent(state), /关联的世界效果/);
});

test('concurrent confirmation requests share one result instead of repeating a resource effect', async t => {
    const f = await fixture(t), first = f.service.proposalCommand(f.state, f.requestId, 0, 'accepted'), second = f.service.proposalCommand(f.state, f.requestId, 0, 'accepted');
    const results = await Promise.all([f.service.commit(first), f.service.commit(second)]);
    assert.equal(results.filter(result => result.repeated).length, 1);
    const state = await f.service.read(); assert.equal(state.version, f.state.version + 1); assert.equal(state.entities[0].fields.coins.value, 5);
    const effect = state.events.at(-1).effects.find(effect => effect.type === 'review');
    assert.equal(effect.after.action, 'accepted'); assert.equal(effect.after.update, undefined, 'the event stores a decision, not another full raw-source batch');
});

test('already-executed same-source effects cannot become another payment after manual rechecking', async t => {
    const f = await fixture(t), turn = currentTurns(f.state)[0];
    const state = (await f.service.commit(f.service.effectCommand(f.state, turn.id, 'other-purchase', [set('hero', 'coins', 5)], '已付钱'))).state;
    assert.throws(() => f.service.proposalCommand(state, f.requestId, 0, 'accepted', { rechecked: true, edit: { value: 0 } }), /已有执行回执/);
    assert.equal((await f.service.read()).entities[0].fields.coins.value, 5);
});

test('changes to published story data invalidate a frozen review even without a new world version', async t => {
    const f = await fixture(t), command = f.service.proposalCommand(f.state, f.requestId, 0, 'accepted');
    f.baseline.push({ id: 'clock', kind: 'clock', label: '次日', date: '' });
    await assert.rejects(f.service.commit(command), /剧情状态已更新/);
    assert.equal((await f.service.read()).version, f.state.version);
});

test('decision rewrites and tampered backup effects fail without replacing the saved branch', async t => {
    const f = await fixture(t), state = (await f.service.commit(f.service.proposalCommand(f.state, f.requestId, 0, 'accepted'))).state;
    const key = `update:${f.requestId}`;
    await assert.rejects(f.service.commit(f.service.command(state, [{ type: 'source', module: key, snapshot: { ...state.sources[key], reviews: [] } }], '篡改处理记录')), /处理记录只能/);
    const altered = structuredClone(state); altered.entities[0].fields.coins.value = 0;
    altered.events.at(-1).effects.find(effect => effect.type === 'entity').after.fields.coins.value = 0;
    await assert.rejects(f.service.restore(altered, state), /字段效果与确认内容不一致/);
    assert.equal((await f.service.read()).entities[0].fields.coins.value, 5);
});

test('confirmed story removal overrides legacy data while preserving the raw memory record and reversible history', async t => {
    const old = { id: 'clock', kind: 'clock', label: '旧时间', date: '' };
    const f = await fixture(t, [{ type: 'story', record: { id: 'clock', kind: 'clock', remove: true }, before: { present: true, value: old }, nature: 'established_fact', evidence: proof }], [old]);
    const { state } = await f.service.commit(f.service.proposalCommand(f.state, f.requestId, 1, 'accepted'));
    assert.equal(worldStoryRecords(state, f.baseline).length, 0); assert.deepEqual(f.baseline, [old]);
    const restored = await f.service.restore(state, state); assert.equal(worldStoryRecords(restored, f.baseline).length, 0);
    const fork = await f.service.fork(restored, f.state.version); assert.deepEqual(worldStoryRecords(fork, f.baseline), [old]);
});
