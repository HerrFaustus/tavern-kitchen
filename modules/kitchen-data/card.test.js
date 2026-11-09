import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createKitchenCards, validateKitchenCard } from './card.js';
import { createWorldCardData } from './world.js';
import { createWorldStorage } from '../world-records/storage.js';
import { emptyWorld, applyCommand, forkWorld } from '../world-records/domain.js';
import { createNoteStore } from '../story-planner/storage.js';
import { plannerOwner } from '../story-planner/identity.js';
import { plannerSnapshot, publishNotes, selectVersion, reviewReason } from '../story-planner/notes.js';
import { createPlanner } from '../story-planner/runtime.js';

const memoryValue = () => ({storySummary:{json:{facts:[]},summaryHistory:[],lastSummarizedMesId:-1,hideSummarizedHistory:true,apiKey:'must-not-export',prompt:'must-not-export'},stateAtoms:[],l0Index:{version:1,byFloor:{}}});
const snapshot = () => ({identity:'chat',memory:memoryValue(),source:{digest:'digest',length:1},summary:{type:'TavernKitchenStorySummaryMemory',version:1,exportedAt:new Date().toISOString(),data:{facts:[],rounds:[]}}});
const note = {global:{text:'世界正在变冷',dependencies:[]},chapter:{text:'灯塔等待来客',dependencies:[]}};
const chat = [{mes:'灯塔的灯重新亮起。',is_user:false,send_date:'2026-11-09T10:00:00Z'}];
const plannerMemory = {enabled:true,store:{json:{},summaryHistory:[]}};

async function fixture() {
    globalThis.indexedDB = new IDBFactory();
    const storage = createWorldStorage(), notes = createNoteStore();
    let branch = '', current = snapshot(), fail = false;
    const identity = (override = branch) => 'chat' + override;
    const empty = emptyWorld('world','old','原世界');
    const original = applyCommand(empty,{id:'original-command',worldId:'world',branchId:'old',expectedVersion:0,at:'2026-11-09T00:00:00Z',title:'建立人物',operations:[{type:'create',id:'traveler',kind:'person',name:'旅人',source:{module:'manual',key:'fixture',label:'手工设定'}}]}).state;
    await storage.update(identity(), () => ({state:original}));
    const snap=plannerSnapshot(original,plannerMemory,chat,identity());
    await notes.put(publishNotes(JSON.stringify(note),null,snap,'opening'));
    const world = createWorldCardData({identity,storage,service:{read:()=>storage.read(identity())},noteStore:notes});
    const memory = {
        read:()=>structuredClone({...current,summary:{...current.summary,exportedAt:new Date().toISOString()}}),
        async write(callback) {
            return callback({assertCurrent(){}, async commit(data,namespace,guard) {
                guard(); if(fail) throw new Error('save failed');
                current={...current,memory:data.memory}; branch=namespace;
            }});
        },
    };
    return {cards:createKitchenCards({memory,world,isCurrent:id=>id==='chat'}),world,storage,notes,identity,setFail:()=>{fail=true;}};
}

test('kitchen card exports data only and tolerates newly generated export timestamps',async()=>{
    const f=await fixture(), card=await f.cards.export();
    assert.deepEqual(Object.keys(card).sort(),['createdAt','data','type','version']);
    assert.equal(card.data.memory.storySummary.hideSummarizedHistory,undefined);
    assert.equal(card.data.memory.storySummary.apiKey,undefined);
    assert.equal(card.data.memory.storySummary.prompt,undefined);
    assert.equal(card.data.notes.length,1);
    validateKitchenCard(card);
});

test('card stages world and notes, then activates the complete data together',async()=>{
    const f=await fixture(), card=await f.cards.export(), oldIdentity=f.identity();
    await f.cards.import(card);
    assert.notEqual(f.identity(),oldIdentity);
    assert.equal((await f.world.read()).world.worldId,card.data.world.worldId);
    assert.equal((await f.world.read()).notes[0].chapter.text,note.chapter.text);
    assert.deepEqual((await f.world.read()).world.events,card.data.world.events);
    assert.deepEqual((await f.world.read()).world.receipts,card.data.world.receipts);
    assert.equal((await f.world.read()).world.entities[0].name,'旅人');
    assert.equal((await f.notes.list(plannerOwner(oldIdentity,card.data.world))).length,1,'old branch remains recoverable');
    assert.equal((await f.storage.read(oldIdentity)).branchId,'old');
    await f.cards.import(card);
    assert.equal((await f.world.read()).notes.length,1,'reimport does not duplicate active notes');
});

test('failed final save leaves current world and notes intact',async()=>{
    const f=await fixture(), card=await f.cards.export(), owner=f.identity();
    f.setFail(); await assert.rejects(f.cards.import(card),/save failed/);
    assert.equal(f.identity(),owner);
    assert.equal((await f.world.read()).world.branchId,'old');
    assert.equal((await f.world.read()).notes.length,1);
});

test('invalid card rejected before staging and stale exports rejected',async()=>{
    const f=await fixture(), card=await f.cards.export();
    card.data.notes[0].chapter.text='{{unsafe}}';
    await assert.rejects(f.cards.import(card),/札记格式无效/);
    let staged=false;
    const cards=createKitchenCards({memory:{read:snapshot},world:{async read(){return {world:null,notes:[]};},stage(){staged=true;}},isCurrent:()=>false});
    await assert.rejects(cards.export(),/已变化/);
    assert.equal(staged,false);
});

test('note import aborts cleanly on invalid owner, false guard or thrown guard',async()=>{
    globalThis.indexedDB=new IDBFactory(); const store=createNoteStore();
    await assert.rejects(store.putImported('a',[{...note,id:'wrong',owner:'b'}],()=>true),/归属/);
    await assert.rejects(store.putImported('a',[],()=>false),/切换/);
    await assert.rejects(store.putImported('a',[],()=>{throw new Error('stale');}),/stale/);
    assert.deepEqual(await store.list('a'),[]);
});

test('card rejects a world whose current entities differ from its version history',async()=>{
    const f=await fixture(),card=await f.cards.export();
    card.data.world.entities[0].name='篡改的历史';
    await assert.rejects(f.cards.import(card),/世界数据与历史不一致/);
    assert.equal((await f.world.read()).world.entities[0].name,'旅人');
});


test('planner-generated notes round-trip into the actual imported world branch without another model call',async()=>{
    const f=await fixture(), card=await f.cards.export();
    assert.equal(card.data.notes.length,1);
    await f.cards.import(card);
    const imported=await f.world.read(), snap=plannerSnapshot(imported.world,plannerMemory,chat,f.identity());
    const rows=await f.notes.list(snap.owner), selected=selectVersion(rows,snap);
    assert.equal(selected.chapter.text,note.chapter.text);
    assert.equal(reviewReason(selected,snap),'');
    let calls=0;
    const planner=createPlanner({snapshot:()=>snap,store:f.notes,write:async()=>{calls++;throw Error('unexpected');},status:()=>{}});
    assert.equal(await planner.prepare(),note.chapter.text);
    assert.equal(calls,0);
    assert.equal(selected.source,card.data.notes[0].source);
    assert.equal(selected.revision,card.data.notes[0].revision);
});

test('legacy card imports are recovered once into their current world branch, without duplication or cross-branch copying',async()=>{
    const f=await fixture(), before=await f.world.read(), original=before.notes[0];
    const legacy={...structuredClone(original),id:'old-import',owner:f.identity(),chapter:{text:'旧版导入的札记',dependencies:[]}};
    await f.notes.putImported(f.identity(),[legacy],()=>true);
    const recovered=await f.world.read();
    assert.equal(recovered.notes.length,2);
    assert.ok(recovered.notes.some(row=>row.chapter.text==='旧版导入的札记'));
    assert.equal((await f.world.read()).notes.length,2);
    assert.equal((await f.notes.list(f.identity())).length,1,'legacy source remains recoverable');
    await f.storage.update(f.identity(),state=>({state:forkWorld(state,state.version,'other-branch'),result:true}));
    assert.deepEqual((await f.world.read()).notes,[],'a different world branch cannot claim legacy notes again');
});

test('legacy recovery leaves no partial claim on guard failure and can be retried',async()=>{
    globalThis.indexedDB=new IDBFactory(); const store=createNoteStore();
    await store.putImported('legacy',[{id:'old',owner:'legacy',revision:1,...note}],()=>true);
    await assert.rejects(store.recoverLegacy('legacy','branch',()=>false),/已变化/);
    assert.deepEqual(await store.list('branch'),[]);
    await store.recoverLegacy('legacy','branch',()=>true);
    assert.equal((await store.list('branch')).length,1);
    await store.recoverLegacy('legacy','other',()=>true);
    assert.deepEqual(await store.list('other'),[]);
});


test('card rejects invalid note dependencies before switching the active branch',async()=>{
    const f=await fixture(),card=await f.cards.export(),owner=f.identity();
    card.data.notes[0].chapter.dependencies=[null];
    await assert.rejects(f.cards.import(card),/札记格式无效/);
    assert.equal(f.identity(),owner);
    assert.equal((await f.world.read()).notes.length,1);
});

test('planner recovers an old imported note without requiring an export first',async()=>{
    const f=await fixture(),oldWorld=(await f.world.read()).world;
    const original=(await f.notes.list(plannerOwner(f.identity(),oldWorld)))[0];
    await f.storage.update(f.identity(),state=>({state:forkWorld(state,state.version,'legacy-branch')}));
    const world=await f.storage.read(f.identity()),snap=plannerSnapshot(world,plannerMemory,chat,f.identity());
    await f.notes.putImported(f.identity(),[{...structuredClone(original),id:'legacy-direct',owner:f.identity(),revision:original.revision+1,chapter:{text:'旧导入章节札记',dependencies:[]}}],()=>true);
    let calls=0;const planner=createPlanner({snapshot:()=>snap,store:f.notes,write:async()=>{calls++;throw Error('unexpected');},status:()=>{}});
    assert.equal(await planner.prepare(),'旧导入章节札记');
    assert.equal(calls,0);
    assert.equal((await f.notes.list(snap.owner)).length,1);
});

test('a recovered legacy revision cannot supersede a newer branch publication',async()=>{
    const f=await fixture(),world=(await f.world.read()).world;
    const snap=plannerSnapshot(world,plannerMemory,chat,f.identity()), current=(await f.notes.list(snap.owner))[0];
    await f.notes.putImported(f.identity(),[{...structuredClone(current),id:'legacy-high-revision',owner:f.identity(),revision:999,
        chapter:{text:'更早的旧札记',dependencies:[]}}],()=>true);
    let calls=0;const planner=createPlanner({snapshot:()=>snap,store:f.notes,write:async()=>{calls++;throw Error('unexpected');},status:()=>{}});
    assert.equal(await planner.prepare(),note.chapter.text);
    assert.equal(calls,0);
    const recovered=(await f.notes.list(snap.owner)).find(row=>row.recoveredLegacy);
    assert.equal(recovered.revision,999,'the original revision remains intact');
});

test('a branch change during legacy recovery cannot claim notes for a stale snapshot',async()=>{
    const f=await fixture(),world=(await f.world.read()).world;
    const old=(await f.notes.list(plannerOwner(f.identity(),world)))[0];
    await f.notes.putImported(f.identity(),[{...structuredClone(old),id:'legacy-switch',owner:f.identity(),chapter:{text:'旧札记',dependencies:[]}}],()=>true);
    let scope=0;
    const service={read:()=>f.storage.read(f.identity()),scopeVersion:()=>scope};
    const noteStore={...f.notes,recoverLegacy:(...args)=>{scope++;return f.notes.recoverLegacy(...args);}};
    const cardData=createWorldCardData({identity:f.identity,storage:f.storage,service,noteStore});
    await assert.rejects(cardData.read(),/已变化/);
    assert.equal((await f.notes.list(plannerOwner(f.identity(),world))).length,1);
    assert.equal((await f.world.read()).notes.length,2,'legacy note can still be claimed after retry');
});
