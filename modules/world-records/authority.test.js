import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { applyCommand, emptyWorld, canonical } from './domain.js';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createAuthorityRuntime } from './authority-runtime.js';
import { authorityIndex, buildAuthorityContext, projectAuthorityFacts, projectAuthorityMap } from './authority.js';
import { registerWorldAuthority, readWorldAuthority } from './sources.js';
import { authorityMemoryFacts, authorityMap } from './authority-context.js';
import { buildMapPromptBlock } from '../xiaobai-os/domains/map/projection.js';

const source = { module: 'manual', key: 'fixture', label: '已确认的世界状态' };
const make = (id, name, kind) => ({ type: 'create', id, name, kind, source });
const bind = (entityId, module, key) => ({ type: 'bind', entityId, binding: JSON.stringify([module, key]) });
const set = (entityId, field, value) => ({ type: 'set', entityId, field, value, source });
function update(state, operations, id = `c${state.version}`) {
    return applyCommand(state, { id, title: '状态更新', at: '2026-10-30', worldId: state.worldId, branchId: state.branchId,
        expectedVersion: state.version, operations }).state;
}
function world() {
    return update(emptyWorld('w', 'b', '白桦镇'), [make('alan', '阿伦', 'person'), make('old', '旧渡口', 'place'), make('new', '新渡口', 'place'),
        bind('alan', 'memory', 'person:阿伦'), bind('alan', 'map', 'actor:alan'), bind('old', 'map', 'place:old'), bind('new', 'map', 'place:new'),
        set('alan', 'coins', 70), set('alan', 'location', { entityId: 'new' }), set('new', 'description', '守卫已解除封锁'),
        { type: 'claim', id: 'rumor', entityId: 'alan', field: '职业', value: '国王', nature: 'rumor', source },
        { type: 'source', module: 'memory', snapshot: { records: [{ key: 'person:阿伦', name: '阿伦', aliases: ['铁匠'] }] } }]);
}
const facts = [{ s: '铁匠', p: '金币', o: '100' }, { s: '阿伦', p: '所在地', o: '旧渡口' }, { s: '阿伦', p: '性格', o: '耐心' }, { s: '陌生人', p: '金币', o: '10' }];
const map = { atlas: { locations: [{ key: 'old', name: '旧渡口' }, { key: 'new', name: '新渡口', brief: '仍然封锁' }],
    actors: [{ actorKey: 'alan', displayName: '铁匠', locationKey: 'old' }], links: [] }, scenes: [] };

test('confirmed world fields supersede only explicitly bound memory facts; rumours and histories stay separate', () => {
    const state = world(), before = canonical(state);
    assert.deepEqual(projectAuthorityFacts(facts, state), facts.slice(2));
    const text = buildAuthorityContext(state, '铁匠有多少钱');
    assert.match(text, /70/); assert.match(text, /新渡口/); assert.doesNotMatch(text, /国王|100/);
    assert.equal(canonical(state), before);
    const renamed = update(state, [{ type: 'rename', entityId: 'alan', name: '阿伦先生' }]);
    assert.equal(authorityIndex(renamed).bindings.get(JSON.stringify(['map', 'actor:alan'])).id, 'alan');
    assert.deepEqual(projectAuthorityFacts(facts, renamed), facts.slice(2));
    assert.match(buildAuthorityContext(renamed), /阿伦先生/);
});
test('same-name unrelated entities and ambiguous source names never suppress another person’s facts', () => {
    const state = world(); state.sources.memory.records.push({ key: 'other', name: '铁匠', aliases: [] });
    const other = update(state, [make('other', '另一个铁匠', 'person'), bind('other', 'memory', 'other')]);
    assert.ok(projectAuthorityFacts(facts, other).includes(facts[0]));
    const manualOnly = update(emptyWorld('w', 'b', '世界'), [make('manual', '铁匠', 'person'), set('manual', 'coins', 5)]);
    assert.deepEqual(projectAuthorityFacts(facts, manualOnly), facts);
});
test('bounded world context skips whole oversized values and keeps confirmed data out of unrelated source ownership', () => {
    const state = update(world(), [set('alan', 'description', '长'.repeat(6000))]);
    const text = buildAuthorityContext(state, '阿伦', 600);
    assert.ok(text.length <= 600); assert.match(text, /70/); assert.doesNotMatch(text, /长/);
    assert.equal(buildAuthorityContext(state, '', 1), '');
    assert.deepEqual(projectAuthorityFacts(facts, state), facts.slice(2));
});
test('map prompt projection follows world IDs after rename and location change without rewriting stored geometry', () => {
    const state = world(), original = structuredClone(map);
    const projected = projectAuthorityMap(map, state);
    assert.equal(projected.atlas.actors[0].locationKey, 'new'); assert.equal(projected.atlas.actors[0].displayName, '阿伦');
    assert.equal(projected.atlas.locations[1].brief, '守卫已解除封锁'); assert.deepEqual(map, original);
    const unmapped = update(state, [make('remote', '远方城堡', 'place'), set('alan', 'location', { entityId: 'remote' })]);
    assert.equal(projectAuthorityMap(map, unmapped).atlas.actors.length, 0);
    assert.match(buildAuthorityContext(unmapped, '阿伦'), /远方城堡/);
});

test('the actual map prompt uses the authoritative player location and refuses ambiguous map bindings', () => {
    let state = update(world(), [bind('alan', 'map', 'actor:player')]);
    const playerMap = { schemaVersion: 1, revision: 0, scenes: {}, atlas: { ...map.atlas,
        locations: map.atlas.locations.map(place => ({ ...place, scale: 'outdoor', status: 'visited' })),
        actors: [{ actorKey: 'player', displayName: '旅人', locationKey: 'old' }] } };
    const prompt = buildMapPromptBlock(projectAuthorityMap(playerMap, state));
    assert.match(prompt, /当前位置：新渡口/); assert.doesNotMatch(prompt, /当前位置：旧渡口/);
    playerMap.atlas.locations.push({ key: 'new-copy', name: '另一张旧地图中的新渡口', scale: 'outdoor', status: 'visited' });
    state = update(state, [bind('new', 'map', 'place:new-copy')]);
    assert.equal(projectAuthorityMap(playerMap, state).atlas.actors.length, 0);
});
test('authority adapters require the exact story, account and current confirmed snapshot', async t => {
    const context = { chatId: 'story', characterId: 0, characters: [{ avatar: 'alan.png' }] };
    const story = JSON.stringify(['character', 'alan.png', 'story']); let owner = 'account-a';
    const runtime = createAuthorityRuntime({ getIdentity: () => owner, getStoryIdentity: () => story, sync: async () => {} });
    const remove = registerWorldAuthority('fixture', runtime.read); t.after(remove);
    runtime.publish(world(), owner);
    assert.deepEqual(authorityMemoryFacts(facts, context), facts.slice(2));
    assert.equal(authorityMap(map, { kind: 'character', ownerId: 'alan.png', chatId: 'story' }).atlas.actors[0].locationKey, 'new');
    assert.deepEqual(authorityMemoryFacts(facts, { ...context, chatId: 'other' }), facts);
    owner = 'account-b'; assert.equal(readWorldAuthority(story), null);
    assert.equal(await runtime.prepare(), ''); runtime.publish(world(), 'account-a'); assert.equal(readWorldAuthority(story), null);
});
test('a failed sync clears the published authority, a delayed chat read cannot publish into another owner', async () => {
    let owner = 'a', changes = 0, rejectSync = false, release;
    const runtime = createAuthorityRuntime({ getIdentity: () => owner, getStoryIdentity: () => owner, onChange: () => { changes++; },
        sync: async () => { if (rejectSync) throw Error('read failed'); await new Promise(resolve => { release = resolve; }); } });
    runtime.publish(world(), owner); const preparing = runtime.prepare(); owner = 'b'; runtime.reset(); release();
    await assert.rejects(preparing, /切换/); assert.equal(runtime.read(), null);
    runtime.publish(world(), owner); rejectSync = true;
    await assert.rejects(runtime.prepare(), /read failed/); assert.equal(runtime.read(), null); assert.ok(changes >= 3);
});
test('real IDB publication waits for durable commit; other-tab updates are read before the next generation', async t => {
    const indexedDB = new IDBFactory(), storage = createWorldStorage({ indexedDB }); t.after(() => storage.close());
    let runtime, sequence = 0, owner = 'a';
    const service = createWorldService({ storage, getIdentity: () => owner, id: () => `id${sequence++}`,
        onChanged: (state, identity) => runtime.publish(state, identity) });
    runtime = createAuthorityRuntime({ getIdentity: () => owner, getStoryIdentity: () => owner, sync: () => service.sync([]) });
    assert.equal(await runtime.prepare(), ''); assert.equal((await service.branches()).length, 0);
    let state = await service.ensure();
    state = (await service.commit(service.command(state, [make('a', '阿伦', 'person'), set('a', 'coins', 5)], '登记'))).state;
    assert.match(await runtime.prepare(), /5/);
    await assert.rejects(service.commit(service.command(state, [set('a', 'coins', -1)], '非法更新')));
    assert.equal(runtime.read().state.entities[0].fields.coins.value, 5);
    const second = createWorldStorage({ indexedDB }); t.after(() => second.close());
    const another = createWorldService({ storage: second, getIdentity: () => owner });
    await another.commit(another.command(await another.read(), [set('a', 'coins', 9)], '其他标签更新'));
    assert.equal(runtime.read().state.entities[0].fields.coins.value, 5);
    assert.match(await runtime.prepare(), /9/);
    const branch = await service.fork(await service.read(), 1); assert.equal(runtime.read().state.branchId, branch.branchId);
    owner = 'b'; service.invalidate(); assert.equal(runtime.read(), null);
});
