import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { applyCommand, emptyWorld, fieldValue, forkWorld, canonical } from './domain.js';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { memoryRecords, mapRecords, prepareSourceOperations } from './imports.js';

const source = { module: 'manual', key: 'fixture', label: '测试世界已确认设定' };
const create = (id, kind = 'person') => ({ type: 'create', id, name: id, kind, source });
const set = (entityId, field, value) => ({ type: 'set', entityId, field, value, source });
const command = (state, operations, id = `cmd-${state.version}`) => ({ id, worldId: state.worldId, branchId: state.branchId, expectedVersion: state.version, at: '2026-10-30T00:00:00Z', title: '测试变更', operations });
function setup() {
    const empty = emptyWorld('world', 'main', '白桦镇');
    return applyCommand(empty, command(empty, [create('旅人'), create('铁匠'), create('长剑', 'item'), create('铁匠铺', 'place'),
        set('旅人', 'coins', 100), set('铁匠', 'coins', 10), set('长剑', 'owner', { entityId: '铁匠' }), set('铁匠', 'location', { entityId: '铁匠铺' })])).state;
}
const buy = { type: 'purchase', buyerId: '旅人', sellerId: '铁匠', itemId: '长剑', price: 30, source };
const value = (state, id, field) => fieldValue(state.entities.find(e => e.id === id), field);

test('purchase commits coins, ownership, derived inventory and history together', () => {
    const before = setup(), next = applyCommand(before, command(before, [buy])).state;
    assert.equal(value(next, '旅人', 'coins'), 70); assert.equal(value(next, '铁匠', 'coins'), 40);
    assert.equal(value(next, '长剑', 'owner').entityId, '旅人'); assert.equal(value(before, '旅人', 'coins'), 100);
    assert.equal(next.entities.filter(e => value(next, e.id, 'owner')?.entityId === '铁匠').length, 0);
    assert.equal(next.events.at(-1).effects.length, 3); assert.equal(next.events.at(-1).version, 2);
    assert.equal(next.entities[0].fields.coins.source.label, source.label);
});
test('retry returns the persisted receipt; changed payload under same key is rejected', () => {
    const before = setup(), cmd = command(before, [buy]); const first = applyCommand(before, cmd);
    const retry = applyCommand(first.state, structuredClone(cmd)); assert.equal(retry.repeated, true); assert.deepEqual(retry.receipt, first.receipt);
    assert.equal(retry.state.version, 2); assert.throws(() => applyCommand(first.state, { ...cmd, operations: [{ ...buy, price: 31 }] }), /同一命令/);
});
test('failed batch leaves no partial coins, fields or history', () => {
    const before = setup(), original = canonical(before);
    assert.throws(() => applyCommand(before, command(before, [set('旅人', 'coins', 5), buy])), /余额不足/);
    assert.equal(canonical(before), original);
    assert.throws(() => applyCommand(before, command(before, [{ ...buy, sellerId: '旅人' }])), /参与者/);
    assert.throws(() => applyCommand(before, command(before, [{ ...buy, price: -1 }])), /价格/);
});
test('references, cycles, unsupported commands and invalid numeric fields are rejected', () => {
    const state = setup();
    for (const op of [set('旅人', 'owner', { entityId: 'missing' }), set('旅人', 'owner', { entityId: '旅人' }), set('旅人', 'coins', NaN), set('旅人', '__proto__', 'pollute'), { type: 'execute', code: 'bad' }, set('旅人', 'location', { entityId: '铁匠' })]) assert.throws(() => applyCommand(state, command(state, [op])));
    assert.equal({}.pollute, undefined);
});
test('non-factual claims cannot supply a trade balance and creative proposals remain separate', () => {
    let state = emptyWorld('w', 'b', '世界');
    state = applyCommand(state, command(state, [create('a'), create('b'), create('s', 'item'), set('b', 'coins', 0), set('s', 'owner', { entityId: 'b' }),
        { type: 'claim', id: 'c', entityId: 'a', field: 'coins', value: 100, nature: 'creative_proposal', source }])).state;
    assert.equal(value(state, 'a', 'coins'), undefined);
    assert.throws(() => applyCommand(state, command(state, [{ ...buy, buyerId: 'a', sellerId: 'b', itemId: 's' }])), /尚未确认/);
});
test('confirming a source claim retains evidence and rejects a second decision', () => {
    let state = setup(); state = applyCommand(state, command(state, [{ type: 'claim', id: 'c', entityId: '旅人', field: 'description', value: '受伤', nature: 'rumor', source }])).state;
    state = applyCommand(state, command(state, [{ type: 'resolve', claimId: 'c', status: 'accepted' }])).state;
    assert.equal(value(state, '旅人', 'description'), '受伤'); assert.equal(state.claims[0].nature, 'rumor');
    assert.match(state.entities[0].fields.description.source.label, /人工确认/);
    assert.throws(() => applyCommand(state, command(state, [{ type: 'resolve', claimId: 'c', status: 'accepted' }])), /已处理/);
});
test('historical branch preserves identities and excludes future transaction', () => {
    const initial = setup(), after = applyCommand(initial, command(initial, [buy])).state;
    const branch = forkWorld(after, 1, 'other'); assert.deepEqual(branch.entities, initial.entities);
    assert.equal(branch.worldId, initial.worldId); assert.equal(branch.version, 1); assert.equal(branch.branchId, 'other');
    assert.throws(() => applyCommand(branch, command(after, [buy])), /分支已切换/);
    const changed = applyCommand(branch, command(branch, [set('旅人', 'coins', 1)])).state;
    assert.equal(value(changed, '旅人', 'coins'), 1); assert.equal(value(after, '旅人', 'coins'), 70);
});

function fixtures() {
    let counter = 0, identity = 'chat-a'; const indexedDB = new IDBFactory();
    const storage = createWorldStorage({ indexedDB });
    const service = createWorldService({ storage, getIdentity: () => identity, id: () => `id-${++counter}`, now: () => '2026-10-30T00:00:00Z' });
    return { service, storage, indexedDB, select: next => { identity = next; service.invalidate(); } };
}
test('atomic IDB commit survives restart and deduplicates the same request', async () => {
    const f = fixtures(); let state = await f.service.ensure();
    state = (await f.service.commit(f.service.command(state, [create('a'), set('a', 'coins', 5)], '登记'))).state;
    const cmd = f.service.command(state, [set('a', 'coins', 7)], '更新'); await f.service.commit(cmd); await f.storage.close();
    const storage = createWorldStorage({ indexedDB: f.indexedDB });
    const fresh = createWorldService({ storage, getIdentity: () => 'chat-a' });
    assert.equal(value(await fresh.read(), 'a', 'coins'), 7); assert.equal((await fresh.commit(cmd)).repeated, true); await storage.close();
});
test('two independent storage connections cannot both commit from one version', async () => {
    const f = fixtures(), state = await f.service.ensure();
    const other = createWorldStorage({ indexedDB: f.indexedDB }); const service = createWorldService({ storage: other, getIdentity: () => 'chat-a' });
    const results = await Promise.allSettled([f.service.commit(f.service.command(state, [create('a')], '甲')), service.commit(service.command(state, [create('b')], '乙'))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const saved = await f.service.read(); assert.equal(saved.version, 1); assert.equal(saved.entities.length, 1);
    await f.storage.close(); await other.close();
});
test('storage transaction abort and chat switch never publish a partial world', async () => {
    const f = fixtures(); const state = await f.service.ensure();
    await assert.rejects(f.storage.update('chat-a', () => { throw new Error('injected'); }), /injected/);
    assert.deepEqual(await f.service.read(), state);
    const pending = f.service.commit(f.service.command(state, [create('a')], '切换前')); f.select('chat-b');
    await assert.rejects(pending, /对话已切换/); const other = await f.service.ensure(); assert.equal(other.version, 0);
    f.select('chat-a'); assert.equal((await f.service.read()).version, 0); await f.storage.close();
});
test('failure after branch write but before binding write aborts the entire IDB transaction', async () => {
    const f = fixtures(); const state = await f.service.ensure(); const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'bindings') throw new Error('injected binding write failure'); return original.apply(this, args); };
    try { await assert.rejects(f.service.commit(f.service.command(state, [create('a')], '登记')), /binding write failure/); }
    finally { IDBObjectStore.prototype.put = original; }
    assert.deepEqual(await f.service.read(), state); assert.equal((await f.service.branches())[0].version, 0); await f.storage.close();
});
test('same owner and chat under different account scopes cannot share archives', async () => {
    const f = fixtures(); f.select(JSON.stringify(['alice', 'same-chat'])); const a = await f.service.ensure();
    f.select(JSON.stringify(['bob', 'same-chat'])); const b = await f.service.ensure();
    assert.notEqual(a.worldId, b.worldId); assert.equal((await f.service.branches()).length, 1);
    await assert.rejects(f.service.selectBranch(a.branchId, b), /不属于/); await f.storage.close();
});
test('same names in separate chats have separate worlds; stale command cannot enter another chat', async () => {
    const f = fixtures(); const a = await f.service.ensure(); const cmd = f.service.command(a, [create('a')], '登记');
    f.select('chat-b'); const b = await f.service.ensure(); assert.notEqual(a.worldId, b.worldId);
    await assert.rejects(f.service.commit(cmd), /世界或分支/); await f.storage.close();
});
test('export restoration creates a branch, preserves provenance, and rejects corrupted history', async () => {
    const f = fixtures(); let state = await f.service.ensure(); state = (await f.service.commit(f.service.command(state, [create('a'), set('a', 'coins', 3)], '登记'))).state;
    const backup = JSON.parse(JSON.stringify(state)); const restored = await f.service.restore(backup, state);
    assert.notEqual(restored.branchId, state.branchId); assert.equal(restored.entities[0].id, state.entities[0].id);
    assert.deepEqual(restored.entities, state.entities);
    backup.entities[0].fields.coins.value = 999;
    await assert.rejects(f.service.restore(backup, restored), /历史不一致/);
    await assert.rejects(f.service.restore({ ...backup, schema: 999 }, restored), /不支持/); await f.storage.close();
});
test('old branches remain selectable and another chat cannot select them', async () => {
    const f = fixtures(); let original = await f.service.ensure();
    original = (await f.service.commit(f.service.command(original, [create('a')], '登记'))).state;
    const branch = await f.service.fork(original, 0);
    assert.equal((await f.service.branches()).length, 2);
    const selected = await f.service.selectBranch(original.branchId, branch);
    assert.equal(selected.entities[0].id, 'a');
    f.select('chat-b'); const other = await f.service.ensure();
    assert.equal((await f.service.branches()).length, 1);
    await assert.rejects(f.service.selectBranch(original.branchId, other), /不属于当前对话/); await f.storage.close();
});
test('corrupted before-images cannot be replayed into an apparently valid backup', () => {
    const state = setup(); state.events[0].effects[0].before = { id: 'invented' };
    assert.throws(() => forkWorld(state, state.version, 'next'), /历史不连续/);
});

const memory = { module: 'memory', label: '剧情', records: memoryRecords({ json: { characters: { main: ['阿伦'] }, characterAliases: [{ from: '铁匠', to: '阿伦' }], facts: [{ id: 'f', s: '阿伦', p: '性格', o: '耐心', _addedAt: 2 }] } }) };
const map = { module: 'map', label: '地图', records: mapRecords({ atlas: { locations: [{ key: 'smithy', name: '铁匠铺' }], actors: [{ actorKey: 'alan', displayName: '铁匠', locationKey: 'smithy' }] } }) };
test('memory and map share unambiguous identity and references, without promoting guesses', () => {
    let seq = 0; const before = emptyWorld('w', 'b', '世界');
    const operations = prepareSourceOperations(before, [memory, map], () => `e${++seq}`);
    const state = applyCommand(before, command(before, operations)).state;
    assert.equal(state.entities.length, 2); const person = state.entities.find(e => e.kind === 'person');
    assert.equal(person.bindings.length, 2); assert.equal(person.fields.location, undefined);
    assert.equal(state.claims.find(c => c.field === 'location').value.entityId, state.entities.find(e => e.kind === 'place').id);
    assert.match(state.claims.find(c => c.field === '性格').source.label, /第 3 楼/);
    assert.deepEqual(prepareSourceOperations(state, [memory, map], () => 'unused'), []);
});
test('map-first notifications still use memory aliases to bind an existing manual person', () => {
    let seq = 0; let state = emptyWorld('w', 'b', '世界');
    state = applyCommand(state, command(state, [{ ...create('alan'), name: '阿伦' }])).state;
    state = applyCommand(state, command(state, prepareSourceOperations(state, [map, memory], () => `e${++seq}`))).state;
    assert.equal(state.entities.filter(e => e.kind === 'person').length, 1);
    assert.deepEqual(state.entities[0].aliases, ['阿伦', '铁匠']);
    assert.equal(state.entities[0].bindings.length, 2);
});
test('source changes keep accepted fields and withdraw stale suggestions without renaming entities', () => {
    let seq = 0; let state = emptyWorld('w', 'b', '世界');
    state = applyCommand(state, command(state, prepareSourceOperations(state, [memory], () => `e${++seq}`))).state;
    const originalId = state.entities[0].id;
    state = applyCommand(state, command(state, [{ type: 'resolve', claimId: state.claims[0].id, status: 'accepted' }, { type: 'rename', entityId: originalId, name: '阿伦先生' }])).state;
    const revised = structuredClone(memory); revised.records[0].claims[0].value = '急躁';
    state = applyCommand(state, command(state, prepareSourceOperations(state, [revised], () => `e${++seq}`))).state;
    assert.equal(value(state, originalId, '性格'), '耐心'); assert.equal(state.entities[0].name, '阿伦先生');
    assert.equal(state.claims.at(-1).value, '急躁'); assert.equal(state.claims.at(-1).status, 'pending');
    state = applyCommand(state, command(state, prepareSourceOperations(state, [{ ...memory, records: [] }], () => `e${++seq}`))).state;
    assert.equal(state.claims.at(-1).status, 'withdrawn'); assert.equal(state.entities[0].id, originalId);
});
test('same-name distinct source keys and ambiguous aliases are not silently merged', () => {
    let seq = 0; let state = emptyWorld('w', 'b', '世界');
    const records = ['a', 'b'].map(key => ({ key, name: '守卫', kind: 'person', claims: [] }));
    state = applyCommand(state, command(state, prepareSourceOperations(state, [{ module: 'map', label: '地图', records }], () => `e${++seq}`))).state;
    assert.equal(state.entities.length, 2);
    state = applyCommand(state, command(state, prepareSourceOperations(state, [{ module: 'memory', label: '剧情', records: [records[0]] }], () => `e${++seq}`))).state;
    assert.equal(state.entities.length, 3);
});
