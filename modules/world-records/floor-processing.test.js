import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory } from 'fake-indexeddb';
import { createWorldService } from './service.js';
import { createWorldStorage } from './storage.js';
import { createFloorProcessing } from './turn-processing.js';
import { currentTurns } from './turn-ledger.js';
import { buildAuthorityContext, projectAuthorityMap } from './authority.js';
import { readSourcePlotLines, collectPlotLines } from '../story-state/plot-lines.js';
import { captureRangeSource } from '../story-summary/data/turn-source.js';
import { createChapterProcessing } from '../../core/chapter-processing.js';
import { createMemorySession } from '../story-summary/maintenance/session.js';
import { commitMemorySession } from '../story-summary/maintenance/commit.js';
import { watchChapterSaves } from '../story-summary/maintenance/notification.js';
import { createPlanner } from '../story-planner/runtime.js';
import { plannerSnapshot } from '../story-planner/notes.js';
import { countRemoteRequest, featureCalls } from '../text-api/call-stats.js';

function fixture(t, texts) {
    const chat = texts.map((mes, i) => ({ mes, is_user:i%2===0, name:i%2===0?'主角':'店主',send_date:'m'+i }));
    const storage = createWorldStorage({indexedDB:new IDBFactory()}); t.after(()=>storage.close());
    const f = { owner:'清河县', chat, stores:{}, keys:['memory'], requests:[], errors:[] };
    const store = () => f.stores[f.owner] ??= {};
    const service = createWorldService({storage,getIdentity:()=>f.owner});
    f.service=service; f.store=store;
    f.reload=()=>createFloorProcessing({ read:()=>({owner:f.owner,playerName:'主角',chat:f.chat,end:f.chat.length-1}),store,getService:()=>service,
        tasks:()=>f.keys.map(key=>({key,group:['review','chapter'].includes(key) ? key : ['subscribed','mapEvolution'].includes(key)?'simulation':'update',label:key})),
        requireAgent:async()=>{}, async save(source,check,apply){check();const next=structuredClone(store());
            const entry=(next.floorWork ??= {})[source.end] ??= {source,digest:source.digest,done:[]};apply(entry,next);check();f.stores[f.owner]=next;},
        generate:async(feature,{messages})=>{const input=JSON.parse(messages[1].content);f.requests.push([feature,input]);
            if(f.fail===input.increment.end) throw new Error('测试连接失败');
            if(f.delay) await f.delay;
            return {text:JSON.stringify(await f.reply?.(feature,input,messages) || {summary:'确认第 '+(input.increment.end+1)+' 楼',changes:[]})};},
        status:info=>{if(info?.error) f.errors.push(info);},review:f.review || {},chapter:f.chapter || {} });
    f.queue=f.reload();return f;
}
test('100 floors stop at reply 20, reuse confirmed work on reopen and release one waiting generation',async t=>{
    const f=fixture(t,Array.from({length:100},(_,i)=>'虚构对白 '+i)); f.fail=39;
    await assert.rejects(f.queue.settle(),/测试连接失败/);
    assert.equal(f.requests.length,20);assert.equal(f.store().lastSummarizedMesId,37);
    let generated=0; f.queue=f.reload();const generate=async()=>{let aborted=false;await f.queue.beforeGeneration(()=>{aborted=true;});if(!aborted)generated++;};
    const owner=generate(), duplicate=generate(); await duplicate;
    while(f.errors.length<2) await setImmediate();
    assert.equal(generated,0);assert.equal(f.requests.filter(([,p])=>p.increment.end>39).length,0);
    f.fail=-1;await f.queue.settle();await owner;
    assert.equal(generated,1);assert.equal(f.store().summaryHistory.length,50);assert.equal(f.store().lastSummarizedMesId,99);
    for(const [,p] of f.requests) {assert.equal(p.increment.messages.length,2);assert.ok(p.background.summaries.every(n=>n.end<p.increment.start));}
    const before=f.requests.length;await f.queue.settle();assert.equal(f.requests.length,before);
});
test('all-off, duplicate player messages and disabling an in-flight update',async t=>{
    const f=fixture(t,['玩家甲','玩家乙','角色一','角色二']);f.chat[1].is_user=true;f.chat[2].is_user=false;
    f.keys=[];await f.queue.settle();assert.deepEqual(f.stores,{});assert.equal(await f.service.read(),null);
    f.keys=['memory'];let release;f.delay=new Promise(done=>{release=done;});const run=f.queue.settle();
    while(!f.requests.length) await setImmediate();f.keys=[];f.queue.invalidate();await assert.rejects(run);
    await f.queue.beforeGeneration(()=>assert.fail('全关不能阻断正文'));release();await setImmediate();assert.equal(f.store().summaryHistory,undefined);
    f.keys=['memory'];await f.queue.settle();assert.deepEqual(f.requests.slice(-2).map(([,p])=>p.increment.messages.map(m=>m.text)),[['玩家乙','角色一'],['角色二']]);
});
async function seed(f,wallet) {
    const state=await f.service.ensure();const source={module:'manual',key:'初始',label:'初始'};
    const objects=[['hero','person','主角'],['shop','person','店主'],['bell','item','铜铃'],['bridge','place','东桥']];
    const operations=objects.map(([id,kind,name])=>({type:'create',id,kind,name,source}));
    const set=(entityId,field,value)=>operations.push({type:'set',entityId,field,value,source});
    set('hero','coins',10);set('bell','owner',{entityId:'shop'});set('bridge','通行状态','可通行');
    operations.push({type:'bind',entityId:'bridge',binding:JSON.stringify(['map','place:bridge'])});if(wallet) set('shop','coins',37);
    return (await f.service.commit(f.service.command(state,operations,'虚构初始资料'))).state;
}
for(const wallet of [false,true]) test(`hero-only purchase, sale and merged bridge simulation, old wallet ${wallet}`,async t=>{
    const f=fixture(t,['我递出五枚金币。','店主收下五枚金币，交给我铜铃。东桥有守卫。','我卖出铜铃。','店主收下铜铃，我实收三枚金币。']);
    f.keys=['overview','subscribed','mapEvolution'];await seed(f,wallet);
    f.store().json={storyRecords:[{id:'east',kind:'situation',scope:'东桥',title:'封桥警戒',description:'守卫在东桥查验行人',status:'open',_addedAt:0}]};
    f.reply=(feature,p)=>{const m=p.increment.messages.at(-1),first=m.floor===1;
        if(feature==='world')return {changes:[{task:'mapEvolution',type:'set',target:'bridge',field:'通行状态',value:'已封锁',knownBy:['shop'],result:'守卫封锁东桥',floor:m.floor,quote:'东桥有守卫',nature:'established_fact'}]};
        return {changes:[{task:'overview',type:'trade',group:'交易',direction:first?'buy':'sell',counterparty:'shop',item:'bell',price:first?5:3,
            paymentQuote:first?'我递出五枚金币':'实收三枚金币',floor:m.floor,quote:m.text}]};};
    await f.queue.settle();const state=await f.service.read();const field=(id,key)=>state.entities.find(e=>e.id===id).fields[key]?.value;
    assert.equal(field('hero','coins'),8);assert.equal(field('shop','coins'),wallet?37:undefined);assert.equal(field('bell','owner').entityId,'shop');
    assert.equal(field('bridge','通行状态'),'已封锁');assert.equal(f.requests.filter(([k])=>k==='world').length,1);
    assert.equal(f.requests.filter(([k])=>k==='summary').length,2);assert.equal(f.store().summaryHistory,undefined);
    assert.match(buildAuthorityContext(state,'东桥',8000,'主角'),/已知情人物.*店主/);
    assert.doesNotMatch(buildAuthorityContext(state,'东桥',8000,'主角',[],{tasks:['people']}),/通行状态|金币/);
    const map=projectAuthorityMap({atlas:{locations:[{key:'bridge',name:'东桥'}],actors:[],links:[{id:'east',from:'bridge',to:'town'}]}},state);
    assert.match(map.atlas.links[0].label,/已封锁/);assert.deepEqual(state.entities.find(e=>e.id==='bridge').fields['通行状态'].source.knownBy,['shop']);
    assert.equal(currentTurns(state).length,2);
});
test('first handover creates a custodian and a key without assuming an owner or user',async t=>{
    const f=fixture(t,['这把钥匙先放你这儿','新来的守卫阿棠接过钥匙，答应明早交还。']);f.keys=['people'];
    f.reply=()=>({changes:[{type:'create',kind:'person',name:'阿棠',ref:'guard'}, {type:'create',kind:'item',name:'钥匙',ref:'key',importance:'明早交还'},
        {type:'set',target:'key',field:'保管人',value:{entityId:'guard'}},{type:'set',target:'key',field:'归还条件',value:'明早交还'}].map(row=>({...row,task:'people',floor:1,group:'交接',quote:f.chat[1].mes}))});
    await f.queue.settle();await f.queue.settle();const state=await f.service.read();const key=state.entities.find(e=>e.name==='钥匙');
    assert.equal(state.entities.length,2);assert.equal(state.receipts.filter(r=>r.origin).length,1);assert.equal(key.fields.owner,undefined);assert.equal(key.fields['使用人'],undefined);
    assert.equal(key.fields['保管人'].value.entityId,state.entities.find(e=>e.name==='阿棠').id);
});
test('source-based plot identity survives rename and preserves independently closable linked investigations',()=>{
    const chat=[{mes:'沉船一事传为渡口闹鬼。'},{mes:'船底有新凿的斧痕。'},{mes:'船夫另托寻找女儿。'}];const history=[];
    function add(floor,row){const source=captureRangeSource(chat,floor,floor);const lines=readSourcePlotLines([{...row,floor,status:'active',reading:chat[floor].mes,quote:chat[floor].mes}],source,collectPlotLines(history));
        history.push({roundSource:source,endMesId:floor,plotLines:lines});return lines[0].id;}
    const ferry=add(0,{title:'渡口闹鬼',question:'沉船原因'});assert.equal(add(1,{title:'渡船沉没案',id:ferry}),ferry);
    const search=add(2,{title:'寻人',relatedIds:[ferry]});assert.notEqual(search,ferry);
    const lines=collectPlotLines(history,[],{chat});assert.equal(lines.length,2);assert.equal(lines.find(l=>l.id===ferry).beats.length,2);
    assert.deepEqual(lines.find(l=>l.id===search).relatedIds,[ferry]);
});

test('credit, custody and return settle actual possessions without fabricating a cash payment',async t=>{
    const f=fixture(t,['我想赊购。','店主把铜铃交给主角，约定次日给五金币。','我借出铜铃。','店主接过铜铃代管，明早归还。','把铜铃给我。','店主将代管的铜铃归还主角。']);
    await seed(f); f.keys=['overview'];
    f.reply=(_feature,p)=>{
        const m=p.increment.messages.at(-1);
        const [field,id]=m.floor===1?['owner','hero']:m.floor===3?['保管人','shop']:['保管人','hero'];
        const changes=[{type:'set',target:'bell',field,value:{entityId:id}}];
        if(m.floor===1) changes.push({type:'set',target:'bell',field:'欠款',value:'次日给五金币'});
        return {changes:changes.map(row=>({...row,task:'overview',group:'交接',floor:m.floor,quote:m.text}))};
    };
    await f.queue.settle(); await f.queue.settle();
    const state=await f.service.read(), item=state.entities.find(e=>e.id==='bell');
    assert.equal(state.entities[0].fields.coins.value,10);
    assert.equal(item.fields.owner.value.entityId,'hero');assert.equal(item.fields['保管人'].value.entityId,'hero');
    assert.equal(item.fields['欠款'].value,'次日给五金币');assert.equal(state.receipts.filter(r=>r.origin).length,3);
});
test('switching a settled purchase to a quote previews the source, reverses in place and replays only the new candidate',async t=>{
    const f=fixture(t,['我付五金币。','店主收下五金币，交出铜铃。']);await seed(f);
    f.keys=['overview','memory'];
    f.reply=(_feature,p)=>({summary:p.increment.messages.at(-1).text,changes:p.increment.messages.at(-1).text.includes('收下')?
        [{type:'trade',task:'overview',direction:'buy',counterparty:'shop',item:'bell',price:5,paymentQuote:'收下五金币',floor:1,quote:'交出铜铃'}]:[]});
    await f.queue.settle(); const before=await f.service.read(), trade=before.receipts.find(r=>r.origin);
    assert.equal(before.entities[0].fields.coins.value,5);
    Object.assign(f.chat[1],{swipes:['店主收下五金币，交出铜铃。','十枚才卖。'],swipe_id:1,mes:'十枚才卖。'});
    f.queue.invalidate(); await assert.rejects(f.queue.settle(),/原位重记/);
    assert.equal(f.requests.length,1);const revised=await f.service.rewind(before,trade.version-1);
    assert.equal(revised.entities[0].fields.coins.value,10);assert.equal(revised.entities.find(e=>e.id==='bell').fields.owner.value.entityId,'shop');
    assert.equal(revised.branchId,before.branchId);assert.equal(revised.worldId,before.worldId);
    assert.ok(revised.withdrawn.at(-1).receipts.some(r=>r.commandId===trade.commandId));
    // The host's confirmed memory recovery removes the tail in its own transaction.
    f.stores[f.owner]={};await f.queue.settle();assert.equal(f.store().summaryHistory.length,1);
    assert.equal(f.store().summaryHistory[0].summary,'十枚才卖。');assert.equal((await f.service.branches()).length,1);
    const count=f.requests.length;f.owner='另一聊天';f.queue.invalidate();f.keys=[];await f.queue.settle();
    assert.equal(await f.service.read(),null);assert.equal(f.requests.length,count);
});
test('simulation-only input, intentions, unknown observers, and a pre-dispatch UTF-16 overflow',async t=>{
    const f=fixture(t,['东桥发生何事？','东桥守卫商量封路。']);await seed(f);f.keys=['mapEvolution'];
    f.reply=()=>({changes:[{task:'mapEvolution',type:'set',target:'bridge',field:'通行状态',value:'已封锁',knownBy:[],result:'计划封桥',floor:1,quote:'商量封路',nature:'intention'}]});
    await f.queue.settle();const world=await f.service.read();
    assert.equal(world.entities.find(e=>e.id==='bridge').fields['通行状态'].value,'可通行');
    assert.equal(world.claims.at(-1).nature,'intention');assert.equal(f.requests.length,1);assert.equal(f.store().summaryHistory,undefined);
    f.reply=()=>({summary:'已确认',changes:[]});
    f.chat.push({is_user:true,mes:'请记下'},{mes:'渡'.repeat(200001)});f.keys=['memory'];
    const count=f.requests.length;
    await assert.rejects(f.queue.settle(),/预算|20 万|长度|上限/);
    assert.equal(f.requests.length,count+1);assert.equal(f.requests.at(-1)[1].increment.end,1);
});

test('a later enabled simulation replays in floor order without reading or overwriting a future sale',async t=>{
    const f=fixture(t,['我递出五金币。','店主收下五金币，交出铜铃。东桥有守卫。',
        '我到东桥。','东桥守卫换岗。','我要卖铜铃。','店主收下铜铃，我实收三金币。']);
    await seed(f); f.keys=['overview'];
    f.reply=(_feature,p)=>{
        const floor=p.increment.end;
        if(floor===3) return {changes:[]};
        const buy=floor===1;
        return {changes:[{task:'overview',type:'trade',direction:buy?'buy':'sell',counterparty:'shop',item:'bell',
            price:buy?5:3,paymentQuote:buy?'收下五金币':'实收三金币',floor,quote:p.increment.messages.at(-1).text}]};
    };
    await f.queue.settle();
    f.keys=['overview','mapEvolution'];
    f.reply=(_feature,p)=>{
        const floor=p.increment.end, bridge=p.world.entities.find(e=>e.id==='bridge');
        assert.ok(floor===1 || floor===3);
        if(floor===3) assert.equal(bridge.fields['通行状态'].value,'已封锁');
        return {changes:floor===1?[{task:'mapEvolution',type:'set',target:'bridge',field:'通行状态',value:'已封锁',knownBy:['shop'],
            result:'守卫封锁东桥',floor,quote:'东桥有守卫'}]:[]};
    };
    await f.queue.settle();
    assert.equal(f.requests.filter(([k])=>k==='world').length,2);
    assert.equal((await f.service.read()).entities.find(e=>e.id==='hero').fields.coins.value,8);
});

test('the three agents settle one world before a confirmed L2 sends the writer current bridge facts',async t=>{
    const f=fixture(t,['我递出五金币。','店主收下五金币，交出铜铃。东桥有守卫。',
        '我要卖铜铃。','店主收下铜铃，我实收三金币。']);
    await seed(f,true);
    const setup=await f.service.read();
    await f.service.commit(f.service.command(setup,[{type:'create',id:'far',kind:'person',name:'远方船夫',
        source:{module:'manual',key:'far',label:'城外船夫'}}],'城外人物'));
    f.keys=['memory','overview','subscribed','mapEvolution','review','chapter'];
    f.store().json={storyRecords:[{id:'east',kind:'situation',title:'东桥警戒',scope:'东桥',description:'守卫在东桥查验行人',status:'open',_addedAt:0}]};
    const wire=[], notes=[], saves=[];
    featureCalls.clear();
    const call=(feature,run,task)=>countRemoteRequest(feature,async dispatch=>{
        dispatch(); wire.push(feature); return run();
    },task);
    f.reply=(feature,p,messages)=>call(feature,async()=>{
        const floor=p.increment.end;
        if(feature==='world') {
            assert.equal(f.store().summaryHistory.at(-1).endMesId,1);
            assert.equal((await f.service.read()).entities.find(e=>e.id==='hero').fields.coins.value,5);
            assert.match(messages[0].content,/推进与本轮相关或到期的局势/);
            assert.match(messages[0].content,/更新有依据的地点和通路/);
            return {changes:[{type:'set',task:'mapEvolution',target:'bridge',field:'通行状态',value:'已封锁',
                knownBy:['shop'],result:'守卫封锁东桥',floor,quote:'东桥有守卫'}]};
        }
        const buy=floor===1;
        return {summary:p.increment.messages.at(-1).text,changes:[{task:'overview',type:'trade',direction:buy?'buy':'sell',
            counterparty:'shop',item:'bell',price:buy?5:3,paymentQuote:buy?'收下五金币':'实收三金币',floor,quote:p.increment.messages.at(-1).text}]};
    });
    const current=()=>({identity:f.owner,chatId:f.owner,chat:f.chat,store:f.store(),json:f.store().json,atoms:[],
        l0Index:{version:1,byFloor:{}},start:0,cutoff:f.store().lastSummarizedMesId});
    t.after(watchChapterSaves({enabled:()=>true,changed:()=>saves.push(current().cutoff)}));
    let failSave=true;
    f.review={pending:(source,data)=>source.end===3 && !data.summaryHistory?.some(b=>b.pendingPlannerChapter),
        async run(_source,signal,guard) {
            const agentTask=featureCalls.task('memory');
            const session=createMemorySession({...current(),generateReviewedLayer:()=>call('summary',()=>'本轮铜铃交易已确认',agentTask)});
            await call('memory',async()=>{
                for(const [level,from,to] of [['stage',1,2],['stage',3,4],['chapter',1,4]]) {
                    const units=await session.reviewUnit('ReadNarrativeUnits',{level},current());
                    const result=await session.reviewUnit('CloseNarrativeUnit',{level,from,to,reason:'买卖阶段已闭合',
                        revision:units.revision,evidence:{floor:to,quote:f.chat[to-1].mes}},current(),current,signal);
                    assert.equal(result.status,'staged');
                }
            },agentTask);
            await commitMemorySession(session,{runId:'县城结章',calls:[],mode:'chat'},{read:current,async commit(next){
                guard(); if(failSave) throw new Error('章节未保存'); f.stores[f.owner]=structuredClone(next.storySummary);return next;
            }});
        }};
    let world;
    let writerInput;
    const writer=createPlanner({snapshot:()=>({...plannerSnapshot(world,{enabled:true,store:f.store()},f.chat,f.owner),cast:{player:'主角'}}),status:()=>{},
        store:{list:async()=>notes,put:async(note,guard)=>{assert.ok(guard());notes.push(note);return note;}},
        write:messages=>call('planner',()=>{
            assert.deepEqual(saves,[3]);
            writerInput=JSON.parse(messages[1].content);
            return JSON.stringify({global:{text:'桥防已确认',dependencies:[]},chapter:{text:'先核对通行状态。',dependencies:[]}});
        })});
    f.chapter=createChapterProcessing({read:current,requireUpdate:async()=>{},reviewEnabled:()=>true,plannerEnabled:()=>true,
        memory:{getPublishedSummaryStore:f.store,async saveFloorWork(source,guard,edit){guard();edit(f.store().floorWork[source.end],f.store());}},
        writeChapter:async(source,signal)=>{world=await f.service.read();assert.ok(await writer.prepare(signal,source.end));}});
    f.queue=f.reload();
    await assert.rejects(f.queue.settle(),/章节未保存/);
    assert.deepEqual(saves,[]);assert.equal(wire.includes('planner'),false);
    failSave=false; f.queue=f.reload();await f.queue.settle(); await f.queue.settle();
    assert.equal((await writer.inspect()).state,'ready');assert.equal(notes.length,1);
    const bridge=writerInput.world.find(e=>e.id==='bridge').fields['通行状态'];
    assert.equal(bridge.value,'已封锁'); assert.deepEqual(bridge.source.knownBy,['shop']);
    assert.equal(writerInput.world.find(e=>e.id==='hero').fields.coins.value,8);
    assert.equal(writerInput.world.find(e=>e.id==='shop').fields.coins,undefined);
    assert.ok(writerInput.chapterHistory.length);
    const stats=featureCalls.snapshot();
    assert.deepEqual(stats.tasks,{update:4,simulation:1,planner:1});
    assert.deepEqual(Object.fromEntries(Object.entries(stats.features).map(([name,row])=>[name,row.calls])),{summary:8,world:1,memory:2,planner:1});
    assert.equal(wire.length,12);
    assert.equal(world.receipts.filter(r=>r.origin).length,3);
    assert.match(buildAuthorityContext(world,'远方船夫',8000,'主角'),/"已知情人物":\["店主"\]/);
    assert.equal(world.entities.find(e=>e.id==='far').fields['通行状态'],undefined);
});

test('the county key retains ownership on a first handover and a changed world invalidates an unpaid draft',async t=>{
    const f=fixture(t,['这把钥匙先放你这儿','新来的守卫阿棠接过县衙的库房钥匙，答应明早交还。']);
    const before=await f.service.ensure(),source={module:'manual',key:'county',label:'县衙档案'};
    await f.service.commit(f.service.command(before,[{type:'create',id:'county',kind:'organization',name:'县衙',source}],'建立县衙'));
    f.keys=['people'];
    f.reply=()=>({changes:[{type:'create',kind:'person',name:'阿棠',ref:'guard'}, {type:'create',kind:'item',name:'库房钥匙',ref:'key',importance:'明早交还'},
        {type:'set',target:'key',field:'owner',value:{entityId:'county'}},{type:'set',target:'key',field:'保管人',value:{entityId:'guard'}},
        {type:'set',target:'key',field:'归还条件',value:'明早交还'}].map(row=>({...row,task:'people',floor:1,group:'库房',quote:f.chat[1].mes}))});
    await f.queue.settle();f.queue=f.reload();await f.queue.settle();
    const world=await f.service.read(),key=world.entities.find(e=>e.name==='库房钥匙');
    assert.equal(key.fields.owner.value.entityId,'county');assert.equal(key.fields['保管人'].value.entityId,world.entities.find(e=>e.name==='阿棠').id);
    assert.equal(key.fields['使用人'],undefined);assert.equal(key.fields['归还条件'].source.proof.floor,1);
    assert.equal(world.receipts.filter(r=>r.origin).length,1);
    const sale=fixture(t,['我付五金币。','店主收下五金币，交出铜铃。']); await seed(sale);sale.keys=['memory','overview'];
    sale.reply=()=>({summary:'已确认本轮对白',changes:[{type:'trade',task:'overview',item:'bell',counterparty:'shop',direction:'buy',
        price:4,paymentQuote:'收下五金币',floor:1,quote:'交出铜铃'}]});
    await assert.rejects(sale.queue.settle(),/成交价/);
    const prior=await sale.service.read();await sale.service.commit(sale.service.command(prior,[{type:'set',field:'coins',entityId:'hero',value:12,source}],'核对账目'));
    sale.reply=(_f,p,messages)=>{assert.doesNotMatch(messages[0].content,/本轮经过/);assert.equal(p.world.entities.find(e=>e.id==='hero').fields.coins.value,12);return {changes:[]};};
    await sale.queue.settle();
    assert.equal(sale.requests.length,2);assert.equal(sale.store().summaryHistory[0].summary,'已确认本轮对白');
    assert.equal((await sale.service.read()).entities.find(e=>e.id==='hero').fields.coins.value,12);
});

test('counted goods cannot oversell, and a partial purchase settles its actual total with one receipt',async t=>{
    const f=fixture(t,['我付五金币。','店主收下五金币，交出两只铜铃。']);
    const seeded=await seed(f,true),source={module:'manual',key:'lot',label:'三只铜铃'};
    await f.service.commit(f.service.command(seeded,[{type:'set',entityId:'bell',field:'数量',value:3,source}],'清点物品'));
    f.keys=['overview'];
    f.reply=()=>({changes:[{task:'overview',type:'trade',counterparty:'shop',item:'bell',direction:'buy',price:5,
        floor:1,quantity:2,quote:'交出两只铜铃',paymentQuote:'收下五金币'}]});
    await f.queue.settle();await f.queue.settle();
    const paid=await f.service.read(), receipt=paid.receipts.find(r=>r.trades), trade=receipt.trades[0];
    assert.equal(paid.entities.find(e=>e.id==='hero').fields.coins.value,5);
    assert.equal(paid.entities.find(e=>e.id==='bell').fields['数量'].value,1);
    assert.equal(trade.quantity,2);assert.equal(trade.price,5);assert.equal(trade.counterparty,'shop');
    assert.equal(paid.entities.find(e=>e.id===trade.transferredItemId).fields['数量'].value,2);
    f.chat.push({is_user:true,name:'主角',send_date:'sell-u',mes:'我要全卖掉。'},{name:'店主',send_date:'sell-a',mes:'店主收下三只铜铃，我实收三金币。'});
    f.reply=()=>({changes:[{task:'overview',type:'trade',counterparty:'shop',item:trade.transferredItemId,direction:'sell',price:3,
        floor:3,quantity:3,quote:'收下三只铜铃',paymentQuote:'实收三金币'}]});
    await assert.rejects(f.queue.settle(),/库存不足/);
    const blocked=await f.service.read();
    assert.equal(blocked.entities.find(e=>e.id==='hero').fields.coins.value,5);
    assert.equal(blocked.receipts.filter(r=>r.trades).length,1);
    assert.equal(Object.keys(f.store().floorWork[3].review).length,1);
});

test('a sale between the shopkeeper and boatman cannot pass as a protagonist payment',async t=>{
    const f=fixture(t,['我在旁边看。','船夫递出五金币，店主收下五金币，交给船夫铜铃。']);await seed(f,true);
    f.keys=['overview'];
    f.reply=()=>({changes:[{task:'overview',type:'trade',counterparty:'shop',item:'bell',direction:'buy',price:5,
        floor:1,quote:'交给船夫铜铃',paymentQuote:'收下五金币'}]});
    await assert.rejects(f.queue.settle(),/未确认主角/);
    const state=await f.service.read();assert.equal(state.entities.find(e=>e.id==='hero').fields.coins.value,10);
    assert.equal(state.receipts.filter(r=>r.origin).length,0);
});
