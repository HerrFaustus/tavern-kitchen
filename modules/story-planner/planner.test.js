import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createNoteStore } from './storage.js';
import { createPlanner } from './runtime.js';
import { plannerSnapshot, publishNotes } from './notes.js';

test('one writer publishes once, full chapter only; change, rollback and chat isolation', async () => {
    globalThis.indexedDB = new IDBFactory();
    const store = createNoteStore();
    const world = {worldId:'w',branchId:'b',version:1, entities:[{id:'bridge',fields:{status:{value:'封闭'}}}]};
    const chat = [{mes:'进镇',is_user:true}];
    let scope = 'chat', boundary = 'opening', calls = 0;
    const snapshot = () => ({ ...plannerSnapshot(world,{enabled:true},chat,scope), boundary });
    const runtime = createPlanner({snapshot,store, preference:()=>'日常',status:()=>{},write:async messages=>{
        calls++;
        const {reason} = JSON.parse(messages[1].content);
        return JSON.stringify({global:{text:'后台方向',dependencies:[]},
            chapter:{text:'完整章节稿'+calls,dependencies:[{entityId:'bridge',field:'status'}]},reason});
    }});
    const run = () => runtime.prepare();
    assert.equal(await run(),'完整章节稿1');
    chat.push({mes:'去河边'});
    assert.equal(await run(),'完整章节稿1');
    world.entities[0].fields.status.value='通行'; world.version++;
    assert.equal(await run(),'完整章节稿2');
    boundary='closed-1';
    assert.equal(await run(),'完整章节稿3');
    const rows = await store.list(snapshot().owner);
    assert.equal(rows.length,3);
    assert.equal(rows[2].global.text,'后台方向');
    chat.pop(); boundary='opening'; world.entities[0].fields.status.value='封闭';
    assert.equal(await run(),'完整章节稿1');
    scope='other';
    assert.equal(await run(),'完整章节稿4');
    assert.deepEqual(chat,[{mes:'进镇',is_user:true}]);
});

test('invalid private text, stale completion and failed draft never reach a reply', async () => {
    const snap=plannerSnapshot({worldId:'w',branchId:'b',entities:[{id:'p',fields:{'管理员私有/身份':{value:'苍鹰密探'}}}]},{enabled:true},[],'who');
    const note={text:'苍鹰密探',dependencies:[]};
    assert.throws(()=>publishNotes(JSON.stringify({global:note,chapter:note}),null,snap,'opening'),/私有/);
    let resolve, started, calls=0;
    const running = new Promise(r=>{started=r;});
    const runtime=createPlanner({snapshot:()=>snap,status:()=>{},preference:()=>'',store:{list:async()=>[],put:()=>assert.fail()},
        write:async()=>{calls++; if(calls===1){started(); return new Promise(r=>{resolve=r;});} throw new Error('offline');}});
    const pending=runtime.prepare();
    await running; runtime.cancel(); resolve('stale');
    assert.equal(await pending,'');
    assert.equal(await runtime.prepare(),'');
    assert.equal(await runtime.prepare(),'');
    assert.equal(calls,2);
    runtime.retry(); await runtime.prepare(); assert.equal(calls,3);
});
