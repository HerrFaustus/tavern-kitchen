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
    assert.equal((await runtime.inspect()).state,'empty');
    assert.equal(await run(),'完整章节稿1');
    let shown = await runtime.inspect();
    assert.equal(shown.state,'ready');
    assert.equal(shown.note.chapter.text,'完整章节稿1');
    assert.equal(shown.note.global.text,'后台方向');
    assert.equal(calls,1,'reading the panel must not call the writer');
    chat[0].mes = '原文已改写';
    assert.equal((await runtime.inspect()).state,'empty','a note from a different source must not be shown');
    chat[0].mes = '进镇';
    assert.equal((await runtime.inspect()).state,'ready');
    chat.push({mes:'去河边'});
    assert.equal(await run(),'完整章节稿1');
    world.entities[0].fields.status.value='通行'; world.version++;
    assert.equal((await runtime.inspect()).state,'stale');
    assert.equal(await run(),'完整章节稿2');
    boundary='closed-1';
    assert.equal((await runtime.inspect()).state,'stale');
    assert.equal(await run(),'完整章节稿3');
    const rows = await store.list(snapshot().owner);
    assert.equal(rows.length,3);
    assert.equal(rows[2].global.text,'后台方向');
    chat.pop(); boundary='opening'; world.entities[0].fields.status.value='封闭';
    assert.equal(await run(),'完整章节稿1');
    scope='other';
    assert.equal((await runtime.inspect()).state,'empty');
    assert.equal(await run(),'完整章节稿4');
    assert.deepEqual(chat,[{mes:'进镇',is_user:true}]);
});

test('a note read finishing after the world changes cannot display the earlier snapshot', async () => {
    const world = {worldId:'w',branchId:'b',version:1,entities:[]};
    const chat = [{mes:'原文',is_user:true}];
    const snap = () => plannerSnapshot(world,{enabled:true,store:{summaryHistory:[]}},chat,'chat');
    const note = publishNotes(JSON.stringify({global:{text:'全局',dependencies:[]},chapter:{text:'章节',dependencies:[]}}),null,snap(),'opening');
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const runtime = createPlanner({snapshot:snap,status:()=>{},write:()=>assert.fail('inspection must not call the writer'),
        store:{list:async()=>{started(); return new Promise(resolve=>{release=resolve;});}}});
    const reading = runtime.inspect();
    await waiting;
    world.version++;
    release([note]);
    assert.deepEqual(await reading,{state:'changed'});
});

test('an in-flight writer cannot publish after its world snapshot changes in place', async () => {
    const world = {worldId:'w',branchId:'b',version:1,entities:[]};
    const chat = [{mes:'原文',is_user:true}];
    const snap = () => plannerSnapshot(world,{enabled:true,store:{summaryHistory:[]}},chat,'chat');
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const runtime = createPlanner({snapshot:snap,status:()=>{},store:{list:async()=>[],put:()=>assert.fail('stale note must not be saved')},
        write:async()=>{started();return new Promise(resolve=>{release=resolve;});}});
    const running = runtime.prepare();
    await waiting;
    world.version++;
    release(JSON.stringify({global:{text:'全局',dependencies:[]},chapter:{text:'章节',dependencies:[]}}));
    assert.equal(await running,'');
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
