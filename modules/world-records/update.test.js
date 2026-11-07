import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { buildUpdateContext, worldUpdates, UPDATE_INPUT_LIMIT } from './update-context.js';
import { prepareWorldUpdate, validateStoredUpdate } from './update-result.js';
import { currentTurns } from './turn-ledger.js';

const source = { module: 'manual', key: 'initial', label: '已确认设定' };
const create = (id, kind = 'person') => ({ type: 'create', id, name: id, kind, source });
const set = (entityId, field, value) => ({ type: 'set', entityId, field, value, source });
const chat = () => [{ mes: '我支付五金币。', is_user: true, send_date: 'user' }, { mes: '铁匠收钱后，把剑交给你。', send_date: 'reply' }];
async function setup(t) {
    const storage = createWorldStorage({ indexedDB: new IDBFactory() }); t.after(() => storage.close());
    let counter = 0; const service = createWorldService({ storage, getIdentity: () => 'story', id: () => `test-${++counter}` });
    const messages = chat(); let state = await service.syncTurns(messages);
    state = (await service.commit(service.command(state, [create('hero'), create('smith'), create('far-away'), create('sword', 'item'),
        set('hero', 'coins', 10), set('smith', 'coins', 0), set('sword', 'owner', { entityId: 'smith' }), set('far-away', '秘密', '地下室里藏着一封密信'),
        { type: 'claim', id: 'belief', entityId: 'far-away', field: '认知', value: '误以为剑仍在店里', nature: 'belief', source }], '开局'))).state;
    const receipt = service.memorySourceReceipt(state, messages, 0, 1);
    const store = { lastSummarizedMesId: -1, json: { storyRecords: [{ id: 'secret-plan', kind: 'plan', title: '幕后计划', description: '明晚行动', status: 'open', due: '', reason: '' }] }, summaryHistory: [] };
    const context = buildUpdateContext(state, store, messages, receipt);
    const raw = { basis: { worldId: state.worldId, branchId: state.branchId, version: state.version }, proposals: [],
        acknowledgedReceipts: context.executionReceipts.map(item => item.commandId), conflicts: [] };
    return { service, state, messages, receipt, store, context, raw };
}
const fieldProposal = (f, overrides = {}) => ({ type: 'field', entityId: 'hero', field: 'coins', before: { present: true, value: 10 }, value: 5,
    nature: 'established_fact', evidence: { floor: 1, quote: '铁匠收钱后' }, ...overrides });
const history = (f, update) => [{ sourceReceipt: f.receipt, worldUpdate: update, endMesId: 1, summary: '主角支付金币后获得了铁剑。' }];

test('custody and use can change without transferring ownership; relationship identities use one direction', async t => {
    const f = await setup(t);
    const proposal = (entityId,field,value) => fieldProposal(f,{entityId,field,value,before:{present:false}});
    const prepare = proposals => prepareWorldUpdate({...f.raw,proposals},f.context);
    const custody = proposal('sword','保管人',{entityId:'hero'});
    const use = proposal('sword','使用人',{entityId:'far-away'});
    const teacher = proposal('smith','关系身份/hero',{entityId:'hero',role:'师父'});
    const inverse = proposal('hero','关系身份/smith',{entityId:'smith',role:'徒弟'});
    const batch = prepare([custody,use,teacher]);
    assert.throws(() => prepare([teacher,inverse]),/重复/);
    assert.throws(() => prepare([{...teacher,value:{entityId:'sword',role:'师父'}}]),/引用/);
    assert.throws(() => prepare([{...custody,value:{entityId:'sword'}}]),/人物或组织/);
    const ops = batch.proposals.map(p => set(p.entityId,p.field,p.value));
    const committed = (await f.service.commit(f.service.command(f.state,ops,'保管与使用'))).state;
    const sword = committed.entities.find(entity => entity.id === 'sword');
    assert.equal(sword.fields.owner.value.entityId,'smith');
    assert.equal(sword.fields['保管人'].value.entityId,'hero');
    assert.equal(sword.fields['使用人'].value.entityId,'far-away');
    await assert.rejects(f.service.commit(f.service.command(committed,[set('hero',inverse.field,inverse.value)],'反向重复')),/原方向/);
    const returned = (await f.service.commit(f.service.command(committed,[set('sword','保管人',null)],'卸下保管职责'))).state;
    assert.equal(returned.entities.find(entity => entity.id === 'sword').fields['使用人'].value.entityId,'far-away');
});

test('a proposed player agenda inferred from narration requires review; an NPC agenda can remain explicit', async t => {
    const f = await setup(t);
    f.context.playerNames = ['hero'];
    const propose = holders => prepareWorldUpdate({...f.raw,proposals:[{type:'story',nature:'intention',groupId:'goal',certainty:'explicit',
        before:{present:false},evidence:{floor:1,quote:'铁匠收钱后'},record:{id:'future',kind:'goal',holders,title:'复兴工坊',
            description:'让乡里的学徒都能学到手艺',status:'open'}}]},f.context).proposals[0];
    assert.equal(propose(['hero','铁匠']).certainty,'uncertain');
    assert.equal(propose(['铁匠']).certainty,'explicit');
});

test('full context includes distant secrets, beliefs, plans and map semantics without a narration relevance limit', async t => {
    const f = await setup(t); f.state.modules.map = { atlas: { locations: [{ key: 'cellar', name: '秘密地窖' }] } };
    f.state.modules.variables = { raw: 'retired-module-secret' }; f.state.sources.variables = { raw: 'retired-source-secret' };
    const context = buildUpdateContext(f.state, f.store, f.messages, f.receipt), encoded = JSON.stringify(context);
    assert.equal(context.manifest.mode, 'full'); assert.equal(context.manifest.worldComplete, true);
    assert.equal(context.world.entities.length, f.state.entities.length); assert.equal(context.world.claims[0].nature, 'belief');
    assert.match(encoded, /地下室里藏着一封密信/); assert.match(encoded, /幕后计划/); assert.match(encoded, /秘密地窖/);
    assert.doesNotMatch(encoded, /retired-(module|source)-secret/);
    assert.equal(context.background.hierarchyAvailable, false); assert.equal(context.manifest.historicalHierarchyAvailable, false);
    f.state.entities[0].name = 'changed later'; assert.equal(context.world.entities[0].name, 'hero');
});

test('world proposals keep exact old values, raw quotes and natures while leaving current facts untouched', async t => {
    const f = await setup(t); f.raw.proposals = [fieldProposal(f), { type: 'entity', name: '信使', kind: 'person', aliases: ['跑腿人'], nature: 'unclassified', evidence: { floor: 1, quote: '把剑交给你' } }];
    const update = prepareWorldUpdate(f.raw, f.context); validateStoredUpdate(update);
    const state = await f.service.syncTurns(f.messages, { history: history(f, update) });
    assert.equal(worldUpdates(state)[0].status, 'ready'); assert.equal(state.entities.find(entity => entity.id === 'hero').fields.coins.value, 10);
    assert.equal(state.entities.some(entity => entity.name === '信使'), false); assert.equal(state.claims.find(claim => claim.id === 'belief').nature, 'belief');
    assert.equal(worldUpdates(state)[0].update.proposals.length, 2);
    assert.equal((await f.service.syncTurns(f.messages, { history: history(f, update) })).version, state.version);
});

test('knowledge and plan proposals preserve holders and stay outside current story state', async t => {
    const f = await setup(t); f.raw.proposals = [{ type: 'story', record: { id: 'smith-knows', kind: 'knowledge', person: '铁匠', content: '剑已交给主角', certainty: 'known', evidence: '亲手交付', learnedAt: '' },
        before: { present: false }, nature: 'belief', evidence: { floor: 1, quote: '把剑交给你' } }];
    const update = prepareWorldUpdate(f.raw, f.context), state = await f.service.syncTurns(f.messages, { history: history(f, update) });
    assert.equal(worldUpdates(state)[0].update.proposals[0].record.person, '铁匠');
    assert.equal(f.store.json.storyRecords.length, 1);
    f.raw.proposals[0].record.evidence = ''; assert.throws(() => prepareWorldUpdate(f.raw, f.context), /获知依据/);
});

for (const mode of ['old-value', 'unknown-id', 'bad-reference', 'invalid-coins', 'invented-quote', 'outside-range', 'duplicate-field', 'wrong-version', 'unknown-receipt', 'missing-receipt', 'invalid-group', 'invalid-certainty']) {
    test(`invalid unified proposals cannot be committed: ${mode}`, async t => {
        const f = await setup(t); f.raw.proposals = [fieldProposal(f)];
        if (mode === 'old-value') f.raw.proposals[0].before.value = 12;
        if (mode === 'unknown-id') f.raw.proposals[0].entityId = 'not-an-id';
        if (mode === 'bad-reference') Object.assign(f.raw.proposals[0], { field: 'owner', before: { present: false }, value: { entityId: 'missing' } });
        if (mode === 'invalid-coins') f.raw.proposals[0].value = -1;
        if (mode === 'invented-quote') f.raw.proposals[0].evidence.quote = '并不存在的对白';
        if (mode === 'outside-range') f.raw.proposals[0].evidence.floor = 8;
        if (mode === 'duplicate-field') f.raw.proposals.push(structuredClone(f.raw.proposals[0]));
        if (mode === 'wrong-version') f.raw.basis.version++;
        if (mode === 'unknown-receipt') f.raw.acknowledgedReceipts.push('imagined');
        if (mode === 'missing-receipt') f.raw.acknowledgedReceipts = [];
        if (mode === 'invalid-group') f.raw.proposals[0].groupId = '';
        if (mode === 'invalid-certainty') f.raw.proposals[0].certainty = 'mostly-sure';
        assert.throws(() => prepareWorldUpdate(f.raw, f.context), /世界变化提案/);
        assert.equal((await f.service.read()).version, f.state.version);
    });
}

test('already executed effects require acknowledgement and never become another payment proposal', async t => {
    const f = await setup(t), turn = currentTurns(f.state)[0];
    const command = f.service.effectCommand(f.state, turn.id, 'buy', [{ type: 'purchase', buyerId: 'hero', sellerId: 'smith', itemId: 'sword', price: 5, source }], '买剑');
    f.state = (await f.service.commit(command)).state; f.receipt = f.service.memorySourceReceipt(f.state, f.messages, 0, 1);
    f.context = buildUpdateContext(f.state, f.store, f.messages, f.receipt);
    f.raw.basis.version = f.state.version; f.raw.acknowledgedReceipts = f.context.executionReceipts.map(item => item.commandId);
    f.raw.proposals = [fieldProposal(f, { before: { present: true, value: 5 }, value: 0 })];
    assert.throws(() => prepareWorldUpdate(f.raw, f.context), /已有执行回执/);
    f.raw.proposals = []; const update = prepareWorldUpdate(f.raw, f.context);
    const state = await f.service.syncTurns(f.messages, { history: history(f, update) });
    assert.equal(state.entities.find(entity => entity.id === 'hero').fields.coins.value, 5);
    assert.ok(worldUpdates(state)[0].update.acknowledgedReceipts.includes(command.id));
});

test('late delivery marks a changed-world proposal stale; source edits and memory undo retract it', async t => {
    const f = await setup(t); f.raw.proposals = [fieldProposal(f)]; const update = prepareWorldUpdate(f.raw, f.context);
    await f.service.commit(f.service.command(f.state, [set('hero', 'coins', 12)], '人工调整'));
    let state = await f.service.syncTurns(f.messages, { history: history(f, update) });
    assert.equal(worldUpdates(state)[0].status, 'stale'); assert.equal(state.entities.find(entity => entity.id === 'hero').fields.coins.value, 12);
    f.messages[1].mes = '改写'; state = await f.service.syncTurns(f.messages, { history: history(f, update) });
    assert.equal(worldUpdates(state)[0].status, 'retracted');
    state = await f.service.syncTurns(f.messages, { history: [] }); assert.equal(worldUpdates(state)[0].status, 'retracted');
});

test('a changed declared world source invalidates the semantic baseline', async t => {
    const f = await setup(t), update = prepareWorldUpdate(f.raw, f.context);
    const state = (await f.service.commit(f.service.command(f.state, [{ type: 'source', module: 'turn-note', snapshot: { text: 'changed bookkeeping' } }], 'other source'))).state;
    // This is a real declared source, so its content belongs to the world basis.
    assert.equal(worldUpdates(await f.service.syncTurns(f.messages, { history: history(f, update) }))[0].status, 'stale');
    assert.ok(state.version > f.state.version);
});

test('a proposal delivery survives fork and restore but never arrives late in a different branch', async t => {
    const f = await setup(t), update = prepareWorldUpdate(f.raw, f.context), basis = f.state;
    let state = await f.service.syncTurns(f.messages, { history: history(f, update) });
    const restored = await f.service.restore(state, state); assert.deepEqual(restored.sources, state.sources);
    state = await f.service.fork(restored, basis.version);
    state = await f.service.syncTurns(f.messages, { history: history(f, update) }); assert.equal(worldUpdates(state).length, 0);
});

test('oversized world data fails explicitly without truncating the distant state', async t => {
    const f = await setup(t); f.store.json.largeBackground = '原'.repeat(UPDATE_INPUT_LIMIT);
    assert.throws(() => buildUpdateContext(f.state, f.store, f.messages, f.receipt), /未调用模型或截断/);
    assert.equal(f.store.json.largeBackground.length, UPDATE_INPUT_LIMIT);
});

test('tampered proposal evidence and delivery IDs are rejected during replay', async t => {
    const f = await setup(t); f.raw.proposals = [fieldProposal(f)]; const update = prepareWorldUpdate(f.raw, f.context);
    let state = await f.service.syncTurns(f.messages, { history: history(f, update) });
    const changed = structuredClone(update); changed.proposals[0].evidence.quote = '并不存在';
    assert.throws(() => validateStoredUpdate(changed), /实际原文/);
    changed.proposals[0].evidence.quote = update.proposals[0].evidence.quote; changed.proposals[0].value = 4;
    await assert.rejects(f.service.syncTurns(f.messages, { history: history(f, changed) }), /不能交付不同内容/);
    assert.equal((await f.service.read()).version, state.version);
});

test('archived scene contents stay out of both model inputs and cannot be proposed again', async t => {
    const f = await setup(t);
    const record = {id:'scene',kind:'scene',location:'归档专用旧场地',situation:'归档专用局面',participants:[],pendingBeat:'',tension:''};
    const entry = {record};
    f.store.json.storyRecords.push(record);
    f.state.modules = {story:{records:[entry],candidates:[entry]}};
    const event = f.state.events.at(-1);
    event.effects.push({type:'module',id:'story',before:null,after:f.state.modules.story});
    const context = buildUpdateContext(f.state,f.store,f.messages,f.receipt);
    assert.doesNotMatch(JSON.stringify(context),/归档专用/);
    assert.match(JSON.stringify(context.recent),/铁匠收钱/);
    assert.ok(context.world.storyRecords.some(row=>row.id==='secret-plan'));
    assert.throws(() => prepareWorldUpdate({...f.raw,proposals:[{type:'story',record,before:{present:false},
        nature:'established_fact',evidence:{floor:1,quote:'铁匠收钱后'}}]},context));
});
