import { clearProposal as isClearLifecycleProposal } from './proposal-policy.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { buildUpdateContext, worldUpdates } from './update-context.js';
import { prepareWorldUpdate } from './update-result.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { worldStoryRecords } from './world-story-state.js';
import { turnEffectConflicts } from './turn-ledger.js';

const source = { module: 'manual', key: 'seed', label: '开局' };
const quote = '主角支付五金币，铁匠收到五金币，铁剑交给主角';
const proof = { floor: 1, quote };
const set = (entityId, field, value) => ({ type: 'set', entityId, field, value, source });
const field = (entityId, name, before, value, groupId = 'trade', certainty = 'explicit') => ({ type: 'field', entityId, field: name,
    before: { present: true, value: before }, value, nature: 'established_fact', evidence: proof, groupId, certainty });
async function fixture(t, { transform = value => value, text = `${quote}。主角相信信使，并决定寻找矿洞。远处似乎出现火光。`, extra = [], conflicts = [] } = {}) {
    const storage = createWorldStorage({ indexedDB: new IDBFactory() }); t.after(() => storage.close());
    const chat = [{ mes: '买下铁剑。', is_user: true, send_date: 'u' }, { mes: text, send_date: 'a' }];
    const history = []; let sequence = 0, identity = 'batch', available = true;
    const context = () => ({ available, history, storyRecords: [] });
    const service = createWorldService({ storage, getIdentity: () => identity, id: () => `batch-${++sequence}`,
        isSourceCurrent: turn => !!turn && isRangeSourceCurrent(turn.source, chat),
        isUpdateSourceCurrent: update => !!update && isRangeSourceCurrent(update.source, chat), getReviewContext: context });
    let state = await service.syncTurns(chat);
    state = (await service.commit(service.command(state, [
        ...[['hero', '主角', 'person'], ['smith', '铁匠', 'person'], ['sword', '铁剑', 'item']].map(([id, name, kind]) => ({ type: 'create', id, name, kind, source })),
        set('hero', 'coins', 10), set('smith', 'coins', 0), set('sword', 'owner', { entityId: 'smith' }),
    ], '开局'))).state;
    const receipt = service.memorySourceReceipt(state, chat, 0, 1);
    const updateContext = buildUpdateContext(state, { json: {}, summaryHistory: [] }, chat, receipt);
    const proposals = transform([field('hero', 'coins', 10, 5), field('smith', 'coins', 0, 5),
        field('sword', 'owner', { entityId: 'smith' }, { entityId: 'hero' }), ...extra]);
    const update = prepareWorldUpdate({ basis: { worldId: state.worldId, branchId: state.branchId, version: state.version }, proposals,
        conflicts, acknowledgedReceipts: updateContext.executionReceipts.map(item => item.commandId) }, updateContext);
    history.push({ summary: '买下铁剑。', endMesId: 1, sourceReceipt: receipt, worldUpdate: update });
    state = await service.syncTurns(chat, { history });
    return { service, storage, state, chat, history, requestId: receipt.id, context,
        setIdentity: value => { identity = value; }, setAvailable: value => { available = value; } };
}
const reviews = state => worldUpdates(state)[0].reviews || [];
test('an evidenced loan automatically changes who holds the sword without transferring title or use', async t => {
    const quote = '铁匠把自己的铁剑暂时交给主角保管。';
    const loan = {type:'field',entityId:'sword',field:'保管人',before:{present:false},value:{entityId:'hero'},
        nature:'established_fact',certainty:'explicit',groupId:'loan',evidence:{floor:1,quote}};
    const f = await fixture(t,{text:quote,transform:() => [loan]});
    const state = await f.service.autoConfirm();
    const sword = state.entities.find(entity => entity.id === 'sword');
    assert.equal(sword.fields.owner.value.entityId,'smith');
    assert.equal(sword.fields['保管人'].value.entityId,'hero');
    assert.equal(sword.fields['使用人'],undefined);
    assert.equal(reviews(state).length,1);
    assert.equal((await f.service.autoConfirm()).version,state.version);
});
function assertTrade(state, applied) {
    assert.equal(state.entities.find(item => item.id === 'hero').fields.coins.value, applied ? 5 : 10);
    assert.equal(state.entities.find(item => item.id === 'smith').fields.coins.value, applied ? 5 : 0);
    assert.equal(state.entities.find(item => item.id === 'sword').fields.owner.value.entityId, applied ? 'hero' : 'smith');
}

test('same-turn batch commits resource transfer, ownership, versions and per-target receipts exactly once', async t => {
    const f = await fixture(t), command = f.service.proposalBatchCommand(f.state, f.requestId, [2, 0, 1], 'accepted');
    const applied = await f.service.commit(command); assertTrade(applied.state, true);
    assert.equal(applied.state.version, f.state.version + 1); assert.equal(reviews(applied.state).length, 3);
    assert.equal(new Set(reviews(applied.state).map(review => review.eventId)).size, 1);
    assert.equal(applied.receipt.origins.length, 3);
    assert.deepEqual(applied.receipt.origins.map(origin => origin.sourceId), Array(3).fill(applied.receipt.origin.sourceId));
    assert.equal((await f.service.commit(command)).repeated, true);
    const retry = f.service.proposalBatchCommand(applied.state, f.requestId, [0, 1, 2], 'accepted');
    assert.equal((await f.service.commit(retry)).repeated, true);
    await assert.rejects(f.service.commit(f.service.proposalCommand(applied.state, f.requestId, 0, 'accepted')), /提交范围/);
    const fresh = createWorldService({ storage: f.storage, getIdentity: () => 'batch' });
    assert.equal((await fresh.commit(command)).repeated, true); assertTrade(await fresh.read(), true);
});

test('a transaction failure rolls back the entire batch and every review; the same command recovers', async t => {
    const f = await fixture(t), command = f.service.proposalBatchCommand(f.state, f.requestId, [0, 1, 2], 'accepted');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'owners') throw new Error('写盘失败'); return put.apply(this, args); };
    try { await assert.rejects(f.service.commit(command), /写盘失败/); } finally { IDBObjectStore.prototype.put = put; }
    const unchanged = await f.service.read(); assertTrade(unchanged, false); assert.equal(unchanged.version, f.state.version); assert.equal(reviews(unchanged).length, 0);
    assertTrade((await f.service.commit(command)).state, true);
});

test('dependency groups cannot be split even when a model assigns different transaction group IDs', async t => {
    const f = await fixture(t, { transform: proposals => proposals.map((proposal, index) => ({ ...proposal, groupId: `part-${index}` })) });
    assert.deepEqual(f.service.proposalGroup(f.state, f.requestId, 0), [0, 1, 2]);
    await assert.rejects(f.service.commit(f.service.proposalCommand(f.state, f.requestId, 0, 'accepted')), /关联变化/);
    await assert.rejects(f.service.commit(f.service.proposalBatchCommand(f.state, f.requestId, [0, 1], 'rejected')), /关联变化/);
    assertTrade(await f.service.read(), false);
});

test('automatic confirmation submits clear changes together and leaves unrelated uncertainty for editable manual review', async t => {
    const uncertain = { type: 'field', entityId: 'hero', field: '远方消息', before: { present: false }, value: '火光', nature: 'unclassified',
        evidence: { floor: 1, quote: '远处似乎出现火光' }, groupId: 'distant', certainty: 'uncertain' };
    const f = await fixture(t, { extra: [uncertain] });
    const state = await f.service.autoConfirm(); assertTrade(state, true);
    assert.equal(state.version, f.state.version + 1); assert.equal(reviews(state).length, 3);
    assert.ok(reviews(state).every(review => review.mode === 'automatic'));
    assert.equal(state.entities[0].fields['远方消息'], undefined);
    assert.equal((await f.service.autoConfirm()).version, state.version);
    const view = f.service.proposalView(state, f.requestId, 3);
    const edited = await f.service.commit(f.service.proposalCommand(state, f.requestId, 3, 'accepted', { view, rechecked: true,
        edit: { value: '尚待核实的火光', nature: 'rumor' } }));
    assert.equal(edited.state.claims[0].nature, 'rumor'); assert.equal(edited.state.entities[0].fields['远方消息'], undefined);
});

for (const [name, options] of [
    ['an uncertain member', { transform: proposals => proposals.map((proposal, index) => index === 2 ? { ...proposal, certainty: 'uncertain' } : proposal) }],
    ['a split uncertain transaction', { transform: proposals => proposals.map((proposal, index) => ({ ...proposal, groupId: `p${index}`, certainty: index === 2 ? 'uncertain' : 'explicit' })) }],
    ['legacy metadata', { transform: proposals => proposals.map(({ groupId: _groupId, certainty: _certainty, ...proposal }) => proposal) }],
    ['an inferred fact', { transform: proposals => proposals.map(proposal => ({ ...proposal, certainty: 'inferred' })) }],
    ['an unclassified member', { transform: proposals => proposals.map((proposal, index) => index === 1 ? { ...proposal, nature: 'unclassified' } : proposal) }],
    ['a source conflict', { conflicts: [{ description: '交易与原文存在冲突', evidence: proof }] }],
    ['qualified evidence with a shortened quote', { text: `如果${quote}，交易才算完成。` }],
]) test(`automatic confirmation leaves the whole transaction manual for ${name}`, async t => {
    const f = await fixture(t, options), state = await f.service.autoConfirm();
    assertTrade(state, false); assert.equal(state.version, f.state.version); assert.equal(reviews(state).length, 0);
    const command = f.service.proposalBatchCommand(state, f.requestId, [0, 1, 2], 'accepted'); command.reviewMode = 'automatic';
    await assert.rejects(f.service.commit(command), /自动确认/);
});

test('automatic confirmation refuses stale world, unavailable memory and unsaved or changed raw sources', async t => {
    const f = await fixture(t);
    f.setAvailable(false); assertTrade(await f.service.autoConfirm(), false); f.setAvailable(true);
    const saved = f.chat[0].mes; f.chat[0].mes = '不要买剑'; assertTrade(await f.service.autoConfirm(), false); f.chat[0].mes = saved;
    const batch = f.history.pop(); assertTrade(await f.service.autoConfirm(), false); f.history.push(batch);
    const newer = (await f.service.commit(f.service.command(f.state, [set('hero', 'description', '另一项变更')], '并发写入'))).state;
    assert.equal((await f.service.autoConfirm()).version, newer.version); assertTrade(await f.service.read(), false);
});

test('automatic clear beliefs and intentions keep their nature; multiple story changes merge in one event', async t => {
    const extra = [{ type: 'story', record: { id: 'belief', kind: 'knowledge', person: '主角', content: '信使可信', certainty: 'believed', evidence: '信使的自述' },
        before: { present: false }, nature: 'belief', evidence: { floor: 1, quote: '主角相信信使' }, groupId: 'belief', certainty: 'explicit' },
    { type: 'story', record: { id: 'plan', kind: 'plan', holders:['主角'], title: '主角寻找矿洞', description: '寻找矿洞', status: 'open', due: '' },
        before: { present: false }, nature: 'intention', evidence: { floor: 1, quote: '决定寻找矿洞' }, groupId: 'plan', certainty: 'explicit' }];
    const f = await fixture(t, { extra }), state = await f.service.autoConfirm();
    assertTrade(state, true); assert.equal(reviews(state).length, 5);
    assert.deepEqual(worldStoryRecords(state).map(record => record._nature), ['belief', 'intention']);
    assert.equal(state.events.at(-1).effects.filter(effect => effect.type === 'module').length, 1);
    assert.equal(new Set(state.modules.story.records.map(record => record.eventId)).size, 1);
    const restored = await f.service.restore(state, state); assertTrade(restored, true); assert.equal(restored.modules.story.records.length, 2);
    const before = await f.service.fork(restored, f.state.version); assertTrade(before, false); assert.equal(reviews(before).length, 0);
});

test('a late invalid combined graph rolls back all automatic and manual changes', async t => {
    const extra = [field('hero', 'owner', null, { entityId: 'sword' }, 'trade')];
    const f = await fixture(t, { extra, transform: proposals => proposals.map(proposal => proposal.entityId === 'hero' && proposal.field === 'owner'
        ? { ...proposal, before: { present: false } } : proposal) });
    assertTrade(await f.service.autoConfirm(), false);
    const command = f.service.proposalBatchCommand(f.state, f.requestId, [0, 1, 2, 3], 'accepted');
    await assert.rejects(f.service.commit(command), /循环/);
    assert.equal((await f.service.read()).version, f.state.version); assert.equal(reviews(await f.service.read()).length, 0);
});

test('concurrent automatic and manual submission cannot duplicate a transaction', async t => {
    const f = await fixture(t), command = f.service.proposalBatchCommand(f.state, f.requestId, [0, 1, 2], 'accepted');
    const results = await Promise.allSettled([f.service.autoConfirm(), f.service.autoConfirm(), f.service.commit(command)]);
    const state = await f.service.read(); assertTrade(state, true); assert.equal(state.version, f.state.version + 1);
    assert.equal(reviews(state).length, 3); assert.equal(results.filter(result => result.status === 'fulfilled').length >= 2, true);
});

test('a new request cannot reuse per-target origins; source edits retain receipts and block future effects', async t => {
    const f = await fixture(t), state = await f.service.autoConfirm(), origin = state.receipts.at(-1).origins[0];
    const spoof = f.service.effectCommand(state, origin.sourceId, origin.effectId, [set('hero', 'coins', 0)], '重复扣款');
    await assert.rejects(f.service.commit(spoof), /不能提交不同内容/);
    f.chat[1].mes = '没有买剑。'; const updated = await f.service.syncTurns(f.chat, { history: f.history });
    assertTrade(updated, true); assert.equal(turnEffectConflicts(updated).length, 1);
    assert.throws(() => f.service.assertSourcesConsistent(updated), /来源已变化/);
});

test('manual group edits and rejection preserve every original proposal and source', async t => {
    const f = await fixture(t);
    const command = f.service.proposalBatchCommand(f.state, f.requestId, [0, 1, 2], 'accepted', {
        reason: '实际成交四金币', items: { 0: { edit: { value: 6 } }, 1: { edit: { value: 4 } } } });
    const { state } = await f.service.commit(command); assert.equal(state.entities[0].fields.coins.value, 6);
    assert.equal(worldUpdates(state)[0].update.proposals[0].value, 5);
    assert.deepEqual(reviews(state).map(review => review.edited), [true, true, false]);
    const before = await f.service.fork(state, f.state.version);
    const rejected = (await f.service.commit(f.service.proposalBatchCommand(before, f.requestId, [0, 1, 2], 'rejected', { reason: '不予采纳' }))).state;
    assertTrade(rejected, false); assert.ok(reviews(rejected).every(review => review.action === 'rejected'));
    assert.equal(rejected.receipts.at(-1).origin, undefined);
});

test('batch backup validation rejects modified origin scopes and review modes', async t => {
    const f = await fixture(t), state = await f.service.autoConfirm();
    for (const change of [backup => { backup.receipts.at(-1).origins[0].effectId = 'forged'; },
        backup => { worldUpdates(backup)[0].reviews[0].mode = 'manual'; }]) {
        const backup = structuredClone(state); change(backup); await assert.rejects(f.service.restore(backup, state), /回执|来源|不一致/);
    }
    assertTrade(await f.service.read(), true);
});

test('an already approved story target cannot execute again under a new update request', async t => {
    const story = { type: 'story', record: { id: 'clock', kind: 'clock', label: '上午', date: '' }, before: { present: false }, nature: 'established_fact',
        evidence: proof, groupId: 'clock', certainty: 'explicit' };
    const f = await fixture(t, { extra: [story] }), state = await f.service.autoConfirm();
    const receipt = f.service.memorySourceReceipt(state, f.chat, 0, 1), context = buildUpdateContext(state, { json: {}, summaryHistory: f.history }, f.chat, receipt);
    const update = prepareWorldUpdate({ basis: { worldId: state.worldId, branchId: state.branchId, version: state.version },
        proposals: [{ ...story, record: { ...story.record, label: '中午' }, before: { present: true, value: worldStoryRecords(state)[0] } }],
        conflicts: [], acknowledgedReceipts: context.executionReceipts.map(item => item.commandId) }, context);
    f.history.push({ worldUpdate: update, sourceReceipt: receipt, summary: '重复整理', endMesId: 1 });
    const delivered = await f.service.syncTurns(f.chat, { history: f.history });
    assert.equal((await f.service.autoConfirm()).version, delivered.version);
    await assert.rejects(f.service.commit(f.service.proposalBatchCommand(delivered, receipt.id, [0], 'accepted')), /已有执行回执/);
    assert.equal(worldStoryRecords(await f.service.read())[0].label, '上午');
});

test('uncompleted user instructions are never automatic world evidence', async t => {
    const f = await fixture(t, { transform: proposals => proposals.map(proposal => ({ ...proposal, evidence: { floor: 0, quote: '买下铁剑' } })) });
    assertTrade(await f.service.autoConfirm(), false); assert.equal(reviews(await f.service.read()).length, 0);
});

test('late chat, branch or world changes and an explicit host guard cancel a frozen batch', async t => {
    const f = await fixture(t), command = f.service.proposalBatchCommand(f.state, f.requestId, [0, 1, 2], 'accepted');
    await assert.rejects(f.service.autoConfirm({ guard: () => false }), /操作已取消/);
    f.setIdentity('other'); await assert.rejects(f.service.commit(command), /建立世界/); f.setIdentity('batch');
    const fork = await f.service.fork(f.state, f.state.version); await f.service.selectBranch(f.state.branchId, fork);
    await assert.rejects(f.service.commit(command), /分支已变化/);
    assertTrade(await f.service.read(), false);
});

test('regenerating the same raw range cannot automatically override a manual rejection', async t => {
    const f = await fixture(t);
    const rejected = (await f.service.commit(f.service.proposalBatchCommand(f.state, f.requestId, [0, 1, 2], 'rejected'))).state;
    const receipt = f.service.memorySourceReceipt(rejected, f.chat, 0, 1), context = buildUpdateContext(rejected, { json: {}, summaryHistory: f.history }, f.chat, receipt);
    const update = prepareWorldUpdate({ basis: { worldId: rejected.worldId, branchId: rejected.branchId, version: rejected.version },
        proposals: worldUpdates(rejected)[0].update.proposals, conflicts: [], acknowledgedReceipts: context.executionReceipts.map(item => item.commandId) }, context);
    f.history.push({ worldUpdate: update, sourceReceipt: receipt, summary: '重新整理', endMesId: 1 });
    const delivered = await f.service.syncTurns(f.chat, { history: f.history });
    assert.equal((await f.service.autoConfirm()).version, delivered.version); assertTrade(await f.service.read(), false);
    assertTrade((await f.service.commit(f.service.proposalBatchCommand(delivered, receipt.id, [0, 1, 2], 'accepted'))).state, true);
});

test('a request to end a situation cannot automatically close it', () => {
    const proof = quote => ({floor:3,quote});
    const proposal = {type:'story', groupId:'port', certainty:'explicit', nature:'established_fact',
        record:{kind:'situation',status:'done'}, evidence:proof('解封')};
    const check = text => isClearLifecycleProposal(proposal,{messages:[{floor:3,role:'assistant',text}]});
    assert.equal(check('商会请求解封。'),false);
    assert.equal(check('港务官当场宣布解封。'),true);
});
