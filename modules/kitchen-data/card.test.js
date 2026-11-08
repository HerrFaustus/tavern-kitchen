import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createKitchenCards, validateKitchenCard } from './card.js';
import { createWorldCardData } from './world.js';
import { createWorldStorage } from '../world-records/storage.js';
import { emptyWorld, applyCommand } from '../world-records/domain.js';
import { createNoteStore } from '../story-planner/storage.js';

const memoryValue = () => ({storySummary:{json:{facts:[]},summaryHistory:[],lastSummarizedMesId:-1,hideSummarizedHistory:true,apiKey:'must-not-export',prompt:'must-not-export'},stateAtoms:[],l0Index:{version:1,byFloor:{}}});
const snapshot = () => ({identity:'chat',memory:memoryValue(),source:{digest:'digest',length:1},summary:{type:'TavernKitchenStorySummaryMemory',version:1,exportedAt:new Date().toISOString(),data:{facts:[],rounds:[]}}});
const note = {id:'n1',revision:1,end:0,source:'digest',global:{text:'世界正在变冷'},chapter:{text:'灯塔等待来客'}};

async function fixture() {
    globalThis.indexedDB = new IDBFactory();
    const storage = createWorldStorage(), notes = createNoteStore();
    let branch = '', current = snapshot(), fail = false;
    const identity = (override = branch) => 'chat' + override;
    const empty = emptyWorld('world','old','原世界');
    const original = applyCommand(empty,{id:'original-command',worldId:'world',branchId:'old',expectedVersion:0,at:'2026-11-09T00:00:00Z',title:'建立人物',operations:[{type:'create',id:'traveler',kind:'person',name:'旅人',source:{module:'manual',key:'fixture',label:'手工设定'}}]}).state;
    await storage.update(identity(), () => ({state:original}));
    await notes.put({...note,owner:identity()});
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
    assert.equal((await f.notes.list(oldIdentity)).length,1,'old branch remains recoverable');
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
    await assert.rejects(store.putImported('a',[{...note,owner:'b'}],()=>true),/归属/);
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
