import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { applyCommand, emptyWorld, canonical, forkWorld, validateWorld } from './domain.js';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';

function oldBackup() {
    const state = emptyWorld('old-world', 'old-branch', '旧存档');
    const value = { schemaVersion: 1, revision: 1, values: { '主角.金币': 20 }, metadata: { oldRule: { min: 0 } }, extension: { oldCheckpoint: { floor: 1 } } };
    const command = { id: 'old-command', worldId: state.worldId, branchId: state.branchId, expectedVersion: 0, at: '2026-11-05T07:00:00Z', title: '旧版写入', operations: [{ type: 'module', module: 'variables', value }] };
    state.schema = 3; state.version = 1; state.modules.variables = value;
    state.events = [{ id: 'event:old-command', commandId: command.id, title: command.title, at: command.at, version: 1, effects: [{ type: 'module', id: 'variables', before: null, after: structuredClone(value) }] }];
    state.receipts = [{ commandId: command.id, fingerprint: canonical(command), eventId: state.events[0].id, version: 1 }];
    return validateWorld(state);
}
const source = { module: 'manual', key: 'world-management', label: '世界管理确认' };

test('retired module JSON remains passive while new variable writes are rejected and world facts work independently', () => {
    const before = oldBackup(), archived = structuredClone(before.modules.variables);
    const command = { id: 'new-command', worldId: before.worldId, branchId: before.branchId, expectedVersion: 1, at: '2026-11-05T08:00:00Z', title: '登记当前世界', operations: [
        { type: 'create', id: 'hero', kind: 'person', name: '主角', source },
        { type: 'set', entityId: 'hero', field: 'coins', value: 50, source },
    ] };
    const saved = applyCommand(before, command).state;
    assert.equal(saved.entities[0].fields.coins.value, 50);
    assert.deepEqual(saved.modules.variables, archived);
    assert.throws(() => applyCommand(saved, { ...command, id: 'unsupported', expectedVersion: saved.version, operations: [{ type: 'module', module: 'variables', value: { ...archived, revision: saved.version + 1 } }] }), /不支持的世界模块/);
    assert.equal(saved.version, 2);
    assert.equal(saved.modules.variables.values['主角.金币'], 20);
    assert.deepEqual(forkWorld(before, 0, 'before-old-module').modules, {});
});

test('old archives survive restore, export and branches without a variable runtime; tampered history is rejected', async t => {
    const storage = createWorldStorage({ indexedDB: new IDBFactory() }); t.after(() => storage.close());
    const service = createWorldService({ storage, getIdentity: () => 'archive-chat' });
    const initial = await service.ensure(), backup = oldBackup();
    const restored = await service.restore(JSON.parse(JSON.stringify(backup)), initial);
    assert.deepEqual(restored.modules, backup.modules);
    assert.deepEqual((await service.read()).entities, []);
    const branch = await service.rewind(restored, restored.version);
    assert.deepEqual(branch.modules.variables, backup.modules.variables);
    const tampered = structuredClone(backup); tampered.modules.variables.values['主角.金币'] = 999;
    await assert.rejects(service.restore(tampered, branch), /历史不一致/);
    assert.equal((await service.read()).branchId, branch.branchId);
    assert.deepEqual((await service.read()).modules.variables, backup.modules.variables);
});

test('0.2.32 selected world survives upgrade and an ambiguous pointer needs an explicit choice from the same chat',async t=>{
    const old=JSON.parse(readFileSync(new URL('../../scripts/fixtures/chat-0.2.32.json',import.meta.url),'utf8'));
    const indexedDB=new IDBFactory(), storage=createWorldStorage({indexedDB});t.after(()=>storage.close());
    let identity=old.identity;
    const service=createWorldService({storage,getIdentity:()=>identity});
    await service.read();
    const db=await new Promise(resolve=>{const req=indexedDB.open('TavernKitchen_WorldArchive');req.onsuccess=()=>resolve(req.result);});t.after(()=>db.close());
    const change=apply=>new Promise((resolve,reject)=>{const tx=db.transaction(['owners','bindings','branches'],'readwrite');apply(tx);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    const original=()=>new Promise(resolve=>{const req=db.transaction('branches').objectStore('branches').getAll();req.onsuccess=()=>resolve(req.result);});
    await change(tx=>{
        for(const world of old.branches) {
            tx.objectStore('branches').put(world);
            tx.objectStore('owners').put({branchId:world.branchId,identity,title:world.title,version:world.version});
        }
        tx.objectStore('bindings').put(old.selected,identity);
    });
    const all=await original();
    assert.equal((await service.read()).branchId,old.selected);assert.equal((await service.branches()).length,1);
    await change(tx=>tx.objectStore('bindings').put('lost-pointer',identity));
    await assert.rejects(service.ensure(),error=>error.candidates?.length===2);
    await assert.rejects(service.recoverBinding('another-chat'),/不属于/);
    assert.deepEqual(await original(),all);
    await service.recoverBinding(old.selected);
    const a=await service.read();assert.equal(a.branchId,old.selected);
    await assert.rejects(service.recoverBinding(old.branches.find(b=>b.branchId!==old.selected).branchId),/已确认/);
    identity='新聊天';assert.equal(await service.read(),null);await service.ensure();
    identity=old.identity;assert.deepEqual(await service.read(),a);
    assert.deepEqual((await original()).filter(row=>old.branches.some(b=>b.branchId===row.branchId)),all);
});
