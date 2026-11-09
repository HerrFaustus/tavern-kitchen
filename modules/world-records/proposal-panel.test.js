import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createProposalPanel } from './proposal-panel.js';
import { buildUpdateContext, worldUpdates } from './update-context.js';
import { prepareWorldUpdate } from './update-result.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';

const seed = {module:'manual',key:'seed',label:'开局'};
const quote = '主角支付五金币，铁匠收到五金币，铁剑交给主角。';
const proof = {floor:1,quote};
const change = (entityId,field,before,value,groupId = 'trade') => ({type:'field',entityId,field,before:{present:true,value:before},value,
    nature:'established_fact',certainty:'uncertain',groupId,evidence:proof});
async function fixture(t, makeProposals = () => [change('hero','coins',10,5)]) {
    const { document, window } = parseHTML('<html><body><section id="queue" hidden></section></body></html>');
    const create = document.createElement.bind(document);
    document.createElement = (tag,...args) => {
        const node = create(tag,...args);
        if (tag === 'select') { let value = ''; Object.defineProperty(node,'value',{get:()=>value,set:next=>{value=next;}}); }
        node.focus ||= () => {}; return node;
    };
    const store = createWorldStorage({indexedDB:new IDBFactory()}); t.after(() => store.close());
    const chat = [{mes:'买下铁剑。',is_user:true,send_date:'u'},{mes:'主角原有10金币、铁匠原有0金币。'+quote+' 信使说他十分忠诚。',send_date:'a'}];
    const history = []; let seq = 0, identity = 'world-a';
    const service = createWorldService({storage:store,getIdentity:()=>identity,id:()=>`fixture-${++seq}`,
        isSourceCurrent:turn=>!!turn && isRangeSourceCurrent(turn.source,chat),
        isUpdateSourceCurrent:update=>!!update && isRangeSourceCurrent(update.source,chat),
        getReviewContext:()=>({available:true,history,storyRecords:[]})});
    let state = await service.syncTurns(chat);
    state = (await service.commit(service.command(state,[
        ...[['hero','主角','person'],['smith','铁匠','person'],['sword','铁剑','item']].map(([id,name,kind])=>({type:'create',id,name,kind,source:seed})),
        {type:'set',entityId:'hero',field:'coins',value:10,source:seed},
        {type:'set',entityId:'smith',field:'coins',value:0,source:seed},
        {type:'set',entityId:'sword',field:'owner',value:{entityId:'smith'},source:seed},
    ],'开局'))).state;
    const receipt = service.memorySourceReceipt(state,chat,0,1), context = buildUpdateContext(state,{json:{},summaryHistory:[]},chat,receipt);
    const update = prepareWorldUpdate({basis:{worldId:state.worldId,branchId:state.branchId,version:state.version},
        proposals:makeProposals(),conflicts:[],acknowledgedReceipts:context.executionReceipts.map(item=>item.commandId)},context);
    history.push({worldUpdate:update,sourceReceipt:receipt,summary:'买下铁剑。',endMesId:1});
    state = await service.syncTurns(chat,{history});
    const panel=createProposalPanel({service,getIdentity:()=>identity}), root=document.querySelector('#queue');
    panel.mount(root); panel.show(state);
    const click = (text, container=root) => {const b=[...container.querySelectorAll('button')].find(node=>node.textContent===text);assert.ok(b,text);b.click();return b;};
    const inputValue = (title,value) => {const node=root.querySelector(`[aria-label="${title}"]`);assert.ok(node,title);node.value=value;node.dispatchEvent(new window.Event('input',{bubbles:true}));};
    const submit = () => root.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    const wait = async predicate => {for(let i=0;i<100;i++){if(predicate())return;await setImmediate();}assert.fail(root.textContent);};
    return {document,window,root,panel,service,store,state,chat,history,receipt,click,inputValue,submit,wait,setIdentity:value=>{identity=value;}};
}

test('one visible group confirms a related trade atomically with evidence and duplicate-click protection',async t=>{
    const f=await fixture(t,()=>[change('hero','coins',10,5),change('smith','coins',0,5),change('sword','owner',{entityId:'smith'},{entityId:'hero'})]);
    assert.match(f.root.textContent,/第 2 楼/); assert.match(f.root.textContent,/依据/);
    assert.equal(f.root.querySelectorAll('.tk-proposal-row').length,1);
    let calls=0; const commit=f.service.commit; f.service.commit=command=>{calls++;return commit(command);};
    const button=f.click('确认写入'); button.click();
    await f.wait(()=>f.root.textContent.includes('已保存'));
    const next=await f.service.read(), updates=worldUpdates(next)[0];
    assert.equal(calls,1); assert.equal(next.version,f.state.version+1);
    assert.equal(next.entities.find(item=>item.id==='hero').fields.coins.value,5);
    assert.equal(next.entities.find(item=>item.id==='smith').fields.coins.value,5);
    assert.equal(next.entities.find(item=>item.id==='sword').fields.owner.value.entityId,'hero');
    assert.equal(updates.reviews.length,3); assert.equal(new Set(updates.reviews.map(row=>row.eventId)).size,1);
    assert.equal(next.receipts.at(-1).origins.length,3);
});

test('editing and rejecting preserve the original, source, decision and current world',async t=>{
    const f=await fixture(t);f.click('修改');f.inputValue('新值','4');f.inputValue('处理说明（可选）','改为四金币');f.submit();
    await f.wait(()=>f.root.textContent.includes('已保存'));
    let next=await f.service.read(), record=worldUpdates(next)[0];
    assert.equal(next.entities.find(item=>item.id==='hero').fields.coins.value,4);
    assert.equal(record.update.proposals[0].value,5);assert.equal(record.reviews[0].proposal.value,4);
    assert.equal(record.reviews[0].reason,'改为四金币');assert.equal(record.reviews[0].edited,true);
    const rejected=await fixture(t);rejected.click('拒绝');rejected.inputValue('处理说明（可选）','未成交');rejected.submit();
    await rejected.wait(()=>rejected.root.textContent.includes('已保存'));
    next=await rejected.service.read();record=worldUpdates(next)[0];
    assert.equal(next.entities.find(item=>item.id==='hero').fields.coins.value,10);
    assert.equal(record.reviews[0].action,'rejected');assert.equal(record.reviews[0].reason,'未成交');
});

test('conflicting world updates keep the draft and require rereading before confirmation',async t=>{
    const f=await fixture(t);f.click('修改');f.inputValue('新值','4');
    await f.service.commit(f.service.command(f.state,[{type:'set',entityId:'hero',field:'coins',value:12,source:seed}],'外部更新'));
    f.submit();await f.wait(()=>!!f.root.querySelector('[role=alert]'));
    assert.equal(f.root.querySelector('[aria-label="新值"]').value,'4');
    assert.equal((await f.service.read()).entities.find(item=>item.id==='hero').fields.coins.value,12);
    f.click('取消');await f.wait(()=>!f.root.querySelector('form'));
    const toggle=f.root.querySelector('.tk-proposal-private input');toggle.checked=true;toggle.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    f.click('核对并确认'); assert.match(f.root.textContent,/当前值：12/);
    f.inputValue('新值','4');f.submit();await f.wait(()=>f.root.textContent.includes('已保存'));
    assert.equal((await f.service.read()).entities.find(item=>item.id==='hero').fields.coins.value,4);
});

test('after-save response failure retries the same command and never applies the effect twice',async t=>{
    const f=await fixture(t), commit=f.service.commit, ids=[];let fail=true;
    f.service.commit=async command=>{ids.push(command.id);const result=await commit(command);if(fail){fail=false;throw Error('结果丢失');}return result;};
    f.click('确认写入');await f.wait(()=>!!f.root.querySelector('[role=alert]'));
    f.click('确认写入');await f.wait(()=>f.root.textContent.includes('已保存'));
    const next=await f.service.read();assert.equal(ids[0],ids[1]);assert.equal(next.version,f.state.version+1);
    assert.equal(worldUpdates(next)[0].reviews.length,1);
});

test('private proposals and their evidence are absent until explicitly revealed',async t=>{
    const privateProposal={type:'field',entityId:'smith',field:'管理员私有/真实身份',before:{present:false},value:'幕后秘密',
        nature:'established_fact',certainty:'uncertain',groupId:'private',evidence:{floor:1,quote:'信使说他十分忠诚'}};
    const f=await fixture(t,()=>[change('hero','coins',10,5),privateProposal]);
    assert.doesNotMatch(f.root.textContent,/真实身份|幕后秘密|信使说/);
    const toggle=f.root.querySelector('.tk-proposal-private input');toggle.checked=true;
    toggle.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    assert.match(f.root.textContent,/真实身份|幕后秘密/);
    f.panel.reset();assert.equal(f.root.hidden,true);
});

test('changed narrative source cannot be confirmed even if its update notification is delayed',async t=>{
    const f=await fixture(t);f.chat[1].mes='主角没有付款。';f.click('确认写入');
    await f.wait(()=>!!f.root.querySelector('[role=alert]'));
    assert.match(f.root.textContent,/来源已变化/);
    assert.equal((await f.service.read()).entities.find(item=>item.id==='hero').fields.coins.value,10);
});


test('unmarked private inferences are also hidden until opted in',async t=>{
    const guess={type:'field',entityId:'smith',field:'身份',before:{present:false},value:'秘密统领',
        nature:'established_fact',certainty:'uncertain',groupId:'unknown',evidence:{floor:1,quote:'信使说他十分忠诚'}};
    const f=await fixture(t,()=>[change('hero','coins',10,5),guess]);
    assert.doesNotMatch(f.root.textContent,/秘密统领/);
    const toggle=f.root.querySelector('.tk-proposal-private input');toggle.checked=true;toggle.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    assert.match(f.root.textContent,/秘密统领/);
});

test('an entire related group is modified and rejected as one decision',async t=>{
    const make=()=>[change('hero','coins',10,5),change('smith','coins',0,5),change('sword','owner',{entityId:'smith'},{entityId:'hero'})];
    const f=await fixture(t,make);f.click('修改');
    const controls=f.root.querySelectorAll('[aria-label="新值"]');assert.equal(controls.length,3);
    controls[0].value='4';controls[1].value='4';f.submit();await f.wait(()=>f.root.textContent.includes('已保存'));
    let next=await f.service.read();assert.equal(next.entities.find(row=>row.id==='hero').fields.coins.value,4);
    assert.equal(next.entities.find(row=>row.id==='smith').fields.coins.value,4);
    assert.equal(worldUpdates(next)[0].reviews.length,3);assert.equal(new Set(worldUpdates(next)[0].reviews.map(row=>row.eventId)).size,1);
    const r=await fixture(t,make);r.click('拒绝');r.inputValue('处理说明（可选）','交易没有完成');r.submit();
    await r.wait(()=>r.root.textContent.includes('已保存'));next=await r.service.read();
    assert.equal(next.entities.find(row=>row.id==='hero').fields.coins.value,10);
    assert.deepEqual(worldUpdates(next)[0].reviews.map(row=>row.action),['rejected','rejected','rejected']);
});

test('editing a plan retains its holders, conditions, progress and source',async t=>{
    const plan={type:'story',nature:'intention',certainty:'uncertain',groupId:'plan',before:{present:false},evidence:proof,
        record:{id:'plan-1',kind:'plan',title:'找钥匙',description:'寻找钥匙',holders:['主角','铁匠'],conditions:'夜幕后',statusNote:'尚未动身',status:'open',reason:'',due:''}};
    const f=await fixture(t,()=>[plan]);
    const toggle=f.root.querySelector('.tk-proposal-private input');toggle.checked=true;toggle.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    f.click('修改');f.inputValue('当前进展','已经启程');f.submit();await f.wait(()=>f.root.textContent.includes('已保存'));
    const record=worldUpdates(await f.service.read())[0].reviews[0].proposal.record;
    assert.deepEqual(record.holders,['主角','铁匠']);assert.equal(record.conditions,'夜幕后');assert.equal(record.statusNote,'已经启程');
    assert.deepEqual(worldUpdates(await f.service.read())[0].update.proposals[0].evidence,proof);
});

test('a newer undisclosed value keeps a stale proposal hidden by default',async t=>{
    const f=await fixture(t);
    const changed=await f.service.commit(f.service.command(f.state,[{type:'set',entityId:'hero',field:'coins',value:15,source:seed}],'外部更新'));
    f.panel.show(changed.state);
    assert.doesNotMatch(f.root.textContent,/当前值：15|金币/);
    const toggle=f.root.querySelector('.tk-proposal-private input');toggle.checked=true;toggle.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    assert.match(f.root.textContent,/当前值：15/);
});

test('unverified details inside story records remain hidden by default',async t=>{
    const proposal={type:'story',nature:'established_fact',certainty:'uncertain',groupId:'situation',before:{present:false},evidence:proof,
        record:{id:'situation-1',kind:'situation',title:'铁剑',description:'主角',status:'open',parties:'幕后首脑',scope:'',impact:'',releaseCondition:'',due:'',reason:''}};
    const f=await fixture(t,()=>[proposal]);
    assert.doesNotMatch(f.root.textContent,/幕后首脑/);
    const toggle=f.root.querySelector('.tk-proposal-private input');toggle.checked=true;toggle.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    assert.match(f.root.textContent,/幕后首脑/);
});
