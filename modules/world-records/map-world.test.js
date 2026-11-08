import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { registerWorldBridge, publishWorldBridgeState } from './bridge.js';
import { createWorldMapStore, readMapBeforeOpening } from './map-store.js';
import { createMapService } from '../xiaobai-os/apps/map/application/service.js';
import { createEmptyMapDomain } from '../xiaobai-os/domains/map/state.js';
import { readWorldMap } from './map-commands.js';
import { mapRecords } from './imports.js';

const evidence = { module: 'manual', key: 'world-editor', label: '世界管理确认修改' };
function initialMap() {
    return { ...createEmptyMapDomain(), atlas: { links: [], locations: [
        { key: 'smithy', name: '铁匠铺', scale: 'building', status: 'visited', brief: '炉火旁的小铺' },
        { key: 'port', name: '渡口', scale: 'outdoor', status: 'visited' },
    ], actors: [{ actorKey: 'player', displayName: '旅人', locationKey: 'smithy' }] } };
}
async function fixture(t, original = initialMap()) {
    let scope = 'account:chat-a', sequence = 0, legacyReads = 0;
    const indexedDB = new IDBFactory();
    const storage = createWorldStorage({ indexedDB });
    const service = createWorldService({ storage, getIdentity: () => scope, id: () => `world-${++sequence}`,
        onChanged: (state, identity) => publishWorldBridgeState('story', identity, state) });
    const unregister = registerWorldBridge(() => ({ storyIdentity: 'story', identity: scope, service }));
    const legacy = { readRaw: async () => { legacyReads++; return { value: structuredClone(original) }; } };
    const files = { getFileState: () => 'ready', retryPending: async () => ({ status: 'none' }), adoptServerState: async () => ({ status: 'adopted' }) };
    const adapter = createWorldMapStore({ legacyStore: legacy, legacyFiles: files, getStoryIdentity: () => 'story' });
    const map = createMapService(adapter.store, adapter.files);
    t.after(async () => { map.dispose(); adapter.dispose(); unregister(); await storage.close(); });
    return { service, storage, adapter, map, legacy, files, reads: () => legacyReads,
        select(identity) { scope = identity; service.invalidate(); } };
}
const binding = (state, key) => state.entities.find(entity => entity.bindings.includes(JSON.stringify(['map', key]))).id;
const move = (state, target) => ({ type: 'set', entityId: binding(state, 'actor:player'), field: 'location', value: { entityId: binding(state, `place:${target}`) }, source: evidence });

test('legacy map is adopted once; geometry and established semantic fields share a durable world commit', async t => {
    const f = await fixture(t); const view = await f.map.refreshCurrent();
    const state = await f.service.read();
    assert.deepEqual(state.modules.map.atlas, initialMap().atlas);
    assert.equal(state.events.length, 1);
    assert.equal(state.entities.find(entity => entity.id === binding(state, 'actor:player')).fields.location.value.entityId, binding(state, 'place:smithy'));
    assert.ok(state.events[0].effects.some(effect => effect.type === 'module'));
    assert.equal(state.claims.filter(claim => claim.source.module === 'map' && claim.status === 'pending').length, 0);
    assert.equal(view.writeState, 'ready');
    f.legacy.readRaw = async () => { assert.fail('adopted world map must never reread a stale sidecar'); };
    assert.equal((await f.map.refreshCurrent()).map.atlas.locations[0].name, '铁匠铺');
});

test('map editing renames and moves the same entities together with the map snapshot', async t => {
    const f = await fixture(t); const before = await f.map.refreshCurrent(); const state = await f.service.read();
    const personId = binding(state, 'actor:player'), next = structuredClone(before.map);
    next.atlas.actors[0].locationKey = 'port'; next.atlas.locations[1].name = '北渡口';
    await f.map.replaceCurrent(next, { expectedRevision: before.map.revision });
    const saved = await f.service.read();
    assert.equal(saved.entities.find(entity => entity.id === personId).fields.location.value.entityId, binding(saved, 'place:port'));
    assert.equal(saved.entities.find(entity => entity.id === binding(saved, 'place:port')).name, '北渡口');
    assert.equal(saved.modules.map.atlas.actors[0].locationKey, 'port');
    assert.equal(saved.version, state.version + 1);
    assert.equal(binding(saved, 'actor:player'), personId);
});

test('adopting an already imported map retires its pending legacy suggestions without changing entity identities', async t => {
    const f = await fixture(t); await f.service.ensure();
    const imported = await f.service.sync([{ module: 'map', label: '世界地图', records: mapRecords(initialMap()) }]);
    assert.ok(imported.claims.some(claim => claim.status === 'pending'));
    const personId = binding(imported, 'actor:player');
    await f.map.refreshCurrent();
    const adopted = await f.service.read();
    assert.equal(binding(adopted, 'actor:player'), personId);
    assert.equal(adopted.claims.filter(claim => claim.source.module === 'map' && claim.status === 'pending').length, 0);
    assert.equal(adopted.entities.find(entity => entity.id === personId).fields.location.value.entityId, binding(adopted, 'place:smithy'));
});

test('world-management edits immediately project into map pages and reject an editor with the old revision', async t => {
    const f = await fixture(t); const old = await f.map.refreshCurrent(); const state = await f.service.read();
    await f.service.commit(f.service.command(state, [move(state, 'port'), { type: 'rename', entityId: binding(state, 'place:port'), name: '新渡口' }], '编辑世界'));
    assert.equal(f.map.readCurrent().map.atlas.actors[0].locationKey, 'port');
    assert.equal(f.map.readCurrent().map.atlas.locations[1].name, '新渡口');
    await assert.rejects(f.map.replaceCurrent(old.map, { expectedRevision: old.map.revision }), /map_revision_conflict/);
    assert.equal((await f.service.read()).entities.find(entity => entity.id === binding(state, 'actor:player')).fields.location.value.entityId, binding(state, 'place:port'));
});

test('failed IDB publication keeps prior map and facts; retry reuses one prepared command', async t => {
    const f = await fixture(t); const old = await f.map.refreshCurrent(); const before = await f.service.read();
    const next = structuredClone(old.map); next.atlas.actors[0].locationKey = 'port';
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'bindings') throw new Error('injected map disk failure'); return put.apply(this, args); };
    try { await assert.rejects(f.map.replaceCurrent(next, { expectedRevision: old.map.revision }), /injected map disk failure/); }
    finally { IDBObjectStore.prototype.put = put; }
    assert.deepEqual(await f.service.read(), before);
    assert.equal(f.map.readCurrent().map.atlas.actors[0].locationKey, 'smithy');
    assert.equal(f.adapter.files.hasPendingCommit(), true);
    assert.equal((await f.map.confirmPending()).status, 'confirmed');
    assert.equal((await f.service.read()).version, before.version + 1);
    await f.map.confirmPending();
    assert.equal((await f.service.read()).version, before.version + 1);
});

test('fork, branch selection, export and restoration include map data and detect module tampering', async t => {
    const f = await fixture(t); const first = await f.map.refreshCurrent(); const original = await f.service.read();
    const next = structuredClone(first.map); next.atlas.actors[0].locationKey = 'port';
    await f.map.replaceCurrent(next, { expectedRevision: first.map.revision });
    const later = await f.service.read(); const branch = await f.service.fork(later, original.version);
    assert.equal(f.map.readCurrent().map.atlas.actors[0].locationKey, 'smithy');
    await f.service.selectBranch(later.branchId, branch);
    assert.equal(f.map.readCurrent().map.atlas.actors[0].locationKey, 'port');
    const backup = structuredClone(await f.service.read()); backup.modules.map.atlas.locations[0].name = '伪造存档';
    await assert.rejects(f.service.restore(backup, later), /历史不一致/);
    const restored = await f.service.restore(later, later);
    assert.notEqual(restored.branchId, later.branchId);
    assert.equal(readWorldMap(restored).atlas.actors[0].locationKey, 'port');
});

test('chat/account changes while a map edit is being prepared cannot commit into another world', async t => {
    const f = await fixture(t); const first = await f.map.refreshCurrent(); const before = await f.service.read();
    const next = structuredClone(first.map); next.atlas.actors[0].locationKey = 'port';
    await assert.rejects(f.map.replaceCurrent(next, { expectedRevision: first.map.revision,
        beforeCommit: () => { f.select('other-account:chat-a'); } }), /对话已切换/);
    assert.equal(f.map.readCurrent().map, null);
    f.select('account:chat-a'); assert.deepEqual(await f.service.read(), before);
});

test('invalid legacy maps are not silently replaced; the document repair path can explicitly adopt a valid correction', async t => {
    const f = await fixture(t, { damaged: true });
    await assert.rejects(f.map.refreshCurrent());
    assert.equal((await f.service.read()).modules.map, undefined);
    const document = await f.map.document.read(); assert.equal(document.validation.valid, false);
    const corrected = initialMap();
    const result = await f.map.document.replace(document.snapshot, corrected, () => true);
    assert.equal(result.status, 'confirmed');
    assert.equal(f.map.readCurrent().map.atlas.locations[0].name, '铁匠铺');
});

test('a rejected or throwing commit guard keeps both semantic fields and geometry unchanged', async t => {
    const f = await fixture(t); const old = await f.map.refreshCurrent(); const state = await f.service.read();
    const next = structuredClone(old.map); next.atlas.locations[0].brief = '修改后的描述';
    const result = await f.adapter.store.transact(transaction => { transaction.replace(next); }, { commitGuard: () => false });
    assert.equal(result.status, 'failed'); assert.deepEqual(await f.service.read(), state);
    assert.equal(f.adapter.files.hasPendingCommit(), false);
});

test('a branch before map adoption stays empty instead of importing a future sidecar', async t => {
    const f = await fixture(t); await f.map.refreshCurrent();
    const state = await f.service.read(); await f.service.fork(state, 0);
    const reads = f.reads();
    assert.equal((await f.map.refreshCurrent()).map.atlas.actors.length, 0);
    assert.equal(f.reads(), reads);
});

test('old schema archives remain readable and map adoption upgrades the archive format', async t => {
    const f = await fixture(t); const state = await f.service.ensure();
    const legacy = { ...state, schema: 1 }; delete legacy.modules;
    await f.storage.update('account:chat-a', () => ({ state: legacy, result: legacy }));
    await f.map.refreshCurrent(); assert.equal((await f.service.read()).schema, 3);
});

test('moved or unmapped world actors retire stale scene drawings while unrelated saves retain hidden source records', async t => {
    const original = initialMap(); original.atlas.locations[0].sceneKey = 'shop';
    original.scenes.shop = { key: 'shop', name: '铁匠铺', status: 'active', viewBox: [0, 0, 10, 10], elements: [
        { id: 'player-shape', category: 'actor', actorKey: 'player', label: '旅人', shape: 'rect', geometry: { x: 1, y: 1, width: 1, height: 1 } },
    ] };
    const f = await fixture(t, original); await f.map.refreshCurrent();
    let state = await f.service.read();
    await f.service.commit(f.service.command(state, [
        { type: 'create', id: 'far-away', kind: 'place', name: '未绘制的山谷', source: evidence },
        { type: 'set', entityId: binding(state, 'actor:player'), field: 'location', value: { entityId: 'far-away' }, source: evidence },
    ], '前往地图外地点'));
    const view = f.map.readCurrent().map;
    assert.equal(view.atlas.actors.length, 0); assert.equal(view.scenes.shop.elements.length, 0);
    const edit = structuredClone(view); edit.atlas.locations[1].brief = '补记渡口说明';
    await f.map.replaceCurrent(edit, { expectedRevision: view.revision });
    state = await f.service.read();
    assert.equal(state.entities.find(entity => entity.id === binding(state, 'actor:player')).fields.location.value.entityId, 'far-away');
    assert.equal(state.modules.map.atlas.actors.length, 1);
    await f.service.commit(f.service.command(state, [move(state, 'smithy')], '返回铁匠铺'));
    assert.equal(f.map.readCurrent().map.scenes.shop.elements[0].actorKey, 'player');
});

test('concurrent first readers adopt one map without duplicating identities or overwriting the winner', async t => {
    const f = await fixture(t);
    const views = await Promise.all([f.map.refreshCurrent(), f.map.refreshCurrent()]);
    assert.equal(views[0].map.atlas.actors[0].actorKey, 'player');
    assert.equal((await f.service.read()).entities.length, 3);
    assert.equal((await f.service.read()).events.filter(event => event.title === '接管地图存档').length, 1);
});

test('a lost acknowledgement recovers the saved map receipt instead of applying the operation twice', async t => {
    const f = await fixture(t); const before = await f.map.refreshCurrent(); const state = await f.service.read();
    const original = f.service.commit;
    let lost = false;
    f.service.commit = async command => { const result = await original(command); if (!lost) { lost = true; throw new Error('lost acknowledgement'); } return result; };
    const next = structuredClone(before.map); next.atlas.actors[0].locationKey = 'port';
    await assert.rejects(f.map.replaceCurrent(next, { expectedRevision: before.map.revision }), /lost acknowledgement/);
    assert.equal((await f.service.read()).version, state.version + 1);
    await f.map.confirmPending();
    assert.equal((await f.service.read()).version, state.version + 1);
    assert.equal(f.adapter.files.hasPendingCommit(), false);
});

test('a failed old map command cannot overwrite another writer; explicit reload abandons its candidate', async t => {
    const f = await fixture(t); const before = await f.map.refreshCurrent(); const state = await f.service.read();
    const next = structuredClone(before.map); next.atlas.actors[0].locationKey = 'port';
    const result = await f.adapter.store.transact(transaction => { transaction.replace(next); }, { commitGuard: async () => {
        await f.service.commit(f.service.command(state, [{ type: 'rename', entityId: binding(state, 'place:port'), name: '另一作者命名的渡口' }], '另一作者更新'));
        return true;
    } });
    assert.equal(result.status, 'failed');
    assert.equal((await f.map.confirmPending()).status, 'failed');
    assert.equal((await f.map.adoptServerState()).status, 'confirmed');
    assert.equal(f.map.readCurrent().map.atlas.actors[0].locationKey, 'smithy');
    assert.equal(f.map.readCurrent().map.atlas.locations[1].name, '另一作者命名的渡口');
    assert.equal(f.adapter.files.hasPendingCommit(), false);
});

test('equal world versions on different branches cannot revive stale map editors or documents', async t => {
    const f = await fixture(t); const old = await f.map.refreshCurrent(); const original = await f.service.read();
    const document = await f.map.document.read();
    const branch = await f.service.fork(original, original.version);
    assert.equal(branch.version, original.version);
    assert.notEqual(f.map.readCurrent().map.revision, old.map.revision);
    const edit = structuredClone(old.map); edit.atlas.locations[0].brief = '旧分支编辑';
    await assert.rejects(f.map.replaceCurrent(edit, { expectedRevision: old.map.revision }), /map_revision_conflict/);
    await assert.rejects(f.map.document.replace(document.snapshot, edit, () => true), /management_context_changed/);
    await f.service.selectBranch(original.branchId, branch);
    assert.notEqual(f.map.readCurrent().map.revision, old.map.revision);
    await assert.rejects(f.map.replaceCurrent(edit, { expectedRevision: old.map.revision }), /map_revision_conflict/);
});

test('a newly registered management reader binds the current world even when publication was deduplicated', async t => {
    const f = await fixture(t); await f.map.refreshCurrent();
    const adapter = createWorldMapStore({ legacyStore: f.legacy, legacyFiles: f.files, getStoryIdentity: () => 'story' });
    const management = createMapService(adapter.store, adapter.files);
    t.after(() => { management.dispose(); adapter.dispose(); });
    const before = await management.document.read();
    const edit = structuredClone(before.snapshot.value); edit.atlas.locations[0].brief = '通过统一管理界面修订';
    assert.equal((await management.document.replace(before.snapshot, edit, () => true)).status, 'confirmed');
    assert.equal(f.map.readCurrent().map.atlas.locations[0].brief, '通过统一管理界面修订');
});

test('switching branches abandons a failed old candidate without blocking edits in the selected branch', async t => {
    const f = await fixture(t); const old = await f.map.refreshCurrent(); const original = await f.service.read();
    const next = structuredClone(old.map); next.atlas.actors[0].locationKey = 'port';
    const commit = f.service.commit;
    f.service.commit = async () => { throw new Error('before dispatch failure'); };
    await assert.rejects(f.map.replaceCurrent(next, { expectedRevision: old.map.revision }), /before dispatch/);
    f.service.commit = commit;
    const branch = await f.service.fork(original, original.version);
    assert.equal(f.adapter.files.hasPendingCommit(), false);
    const selected = f.map.readCurrent().map;
    const edit = structuredClone(selected); edit.atlas.locations[0].brief = '仅修改新分支';
    await f.map.replaceCurrent(edit, { expectedRevision: selected.revision });
    await f.service.selectBranch(original.branchId, await f.service.read());
    assert.equal(f.map.readCurrent().map.atlas.actors[0].locationKey, 'smithy');
    assert.notEqual(f.map.readCurrent().map.atlas.locations[0].brief, '仅修改新分支');
    assert.notEqual(branch.branchId, original.branchId);
});

test('returning to an unchanged chat cannot revive an editor from before the chat switch', async t => {
    const f = await fixture(t); const before = await f.map.refreshCurrent();
    f.select('account:chat-b'); await f.map.refreshCurrent();
    f.select('account:chat-a'); const returned = await f.map.refreshCurrent();
    assert.notEqual(returned.map.revision, before.map.revision);
    const edit = structuredClone(before.map); edit.atlas.locations[0].brief = '已过期的编辑窗口';
    await assert.rejects(f.map.replaceCurrent(edit, { expectedRevision: before.map.revision }), /map_revision_conflict/);
    assert.equal((await f.service.read()).modules.map.atlas.locations[0].brief, '炉火旁的小铺');
});

test('long panoramas survive a durable map save; clearing a temporary panorama preserves stable features', async t => {
    const f = await fixture(t);
    const original = await f.map.refreshCurrent();
    const edited = structuredClone(original.map);
    const long = '渡口铺着青石。'.repeat(160);
    edited.atlas.locations[0].brief = long;
    edited.atlas.locations[0].features = [{name:'棚柱',description:long}];
    await f.map.replaceCurrent(edited,{expectedRevision:original.map.revision});
    const loaded = (await f.map.refreshCurrent()).map;
    assert.equal(loaded.atlas.locations[0].brief,long);
    delete loaded.atlas.locations[0].brief;
    await f.map.replaceCurrent(loaded,{expectedRevision:loaded.revision});
    const restored = (await f.map.refreshCurrent()).map.atlas.locations[0];
    assert.equal(restored.brief,undefined);
    assert.equal(restored.features[0].description,long);
});

test('opening initialization adopts the legacy map before adding opening geography', async t => {
    const f = await fixture(t);
    await f.service.ensure();
    assert.equal(await readMapBeforeOpening(f.service),true);
    const saved = await f.service.read();
    assert.ok(saved.modules.map.atlas.locations.some(place => place.key === 'smithy'));
    assert.equal(saved.modules.map.atlas.actors[0].locationKey,'smithy');
    await readMapBeforeOpening(f.service);
    assert.equal((await f.service.read()).version,saved.version);
});
