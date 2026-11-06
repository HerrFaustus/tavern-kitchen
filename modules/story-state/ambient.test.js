import assert from 'node:assert/strict';
import test from 'node:test';
import { ambientControl, ambientPrompt, ambientRecords, prepareAmbient } from './ambient.js';

const world = {worldId:'world', branchId:'main'};
const store = () => ({lastSummarizedMesId:-1,summaryHistory:[]});
const market = {place:'东港集市',period:'傍晚', publicSpace:true,quiet:true,
    encounter:{title:'鱼摊促销',detail:'最后三筐，两尾算一尾。',until:'摊主收摊',relatedId:'port'},
    scenery:[{id:'lanterns',title:'港口灯节',detail:'竹架上新糊了纸灯。',phase:'筹备中'}]};
function append(memory, raw, flags = {}) {
    const end = ++memory.lastSummarizedMesId;
    const receipt = {...world,source:{start:end}};
    const control = ambientControl(memory,world,receipt,{sceneryEvolution:true});
    const ambient = prepareAmbient(raw,{...control,draw:true,...flags},end,['port']);
    memory.summaryHistory.push({endMesId:end,sourceReceipt:receipt,ambient});
    return ambient;
}

test('near scenery can advance in place and a distant report can update its original location once evidenced', () => {
    const memory = store(), first = append(memory,market);
    const id = first.updates[0].id, quote = '集市挂起第一盏灯。';
    const raw = {...market,scenery:[{id,title:'港口灯节',detail:'街口亮起一盏灯。',quote}]};
    const messages = [{role:'assistant',text:quote}];
    assert.deepEqual(append(memory,raw,{messages}).updates,[]);
    const near = new Set(['situation/' + id]);
    assert.deepEqual(append(memory,raw,{near,messages:[]}).updates,[]);
    assert.equal(append(memory,raw,{near,messages}).updates[0].id,id);
    const distant = {...raw,place:'山中小屋',quiet:false,publicSpace:false};
    assert.deepEqual(append(memory,distant,{messages}).updates,[]);
    const updated = append(memory,distant,{wake:near,messages}).updates[0];
    assert.equal(updated.scope,market.place);
    assert.equal(updated.id,id);
});
test('one local encounter per visit, with a persistent outcome and no replay on the next floor', () => {
    const memory = store(), first = append(memory,market);
    assert.equal(first.updates.length,2);
    assert.match(ambientPrompt(memory,world),/鱼摊促销/);
    assert.equal(first.updates[1].relatedId,'port');
    const next = append(memory,market);
    assert.equal(next.visit.key,first.visit.key);
    assert.deepEqual(next.updates,[]);
    assert.equal(ambientPrompt(memory,world),'');
    append(memory,{...market,place:'密室',publicSpace:false,quiet:false});
    assert.equal(ambientRecords(memory,world).find(item=>item.flavor==='encounter').status,'done');
    assert.equal(ambientPrompt(memory,world),'');
    assert.deepEqual(ambientRecords(memory,{...world,branchId:'other'}),[]);
    const revisit = append(memory,market); assert.notEqual(revisit.visit.key,first.visit.key);
    assert.equal(ambientRecords(memory,world).filter(r=>r.flavor==='encounter' && r.status==='open').length,1);
});
test('probability, scenery switch, quiet setting, time jump and rollback are independently enforced', () => {
    const memory = store(), receipt = {...world,source:{start:1}};
    const roll = () => ambientControl(memory,world,receipt,{}).draw;
    assert.equal(roll(),roll());
    assert.equal(ambientControl(memory,world,receipt,{encounterFrequency:'off'}).draw,false);
    assert.deepEqual(append(memory,market,{draw:false,evolve:false}).updates,[]);
    assert.deepEqual(append(memory,{...market,timeJump:true}).updates,[]);
    const later=append(memory,{...market,timeJump:true,period:'次日清晨',quiet:false});
    assert.deepEqual(later.updates.map(item=>item.flavor),['scenery']);
    memory.summaryHistory.pop(); memory.lastSummarizedMesId--;
    assert.deepEqual(ambientRecords(memory,world),[]);
});
test('aliases, map renames and minor wording changes preserve one visit; ambiguous names cannot start one', () => {
    const places = [{kind:'place',id:'port',name:'东港集市',aliases:['鱼市']}];
    const control = {previous:null,seed:'first',active:[],draw:true,evolve:true};
    const enter = (place,previous,entities) => prepareAmbient({...market,place},{...control,previous,seed:previous?'second':'first'},7,[],entities);
    const first = enter('鱼市',null,places);
    for (const spelling of ['东港的集市','东港集市','鱼市']) {
        const next = enter(spelling,first.visit,places);
        assert.equal(next.visit.placeId,'entity:port'); assert.equal(next.arrived,false); assert.deepEqual(next.updates,[]);
    }
    const ambiguous = enter('鱼市',first.visit,[...places,{kind:'place',id:'west',name:'西港',aliases:['鱼市']}]);
    assert.deepEqual(ambiguous.updates,[]); assert.equal(ambiguous.quiet,false);
    const legacy = {place:'东港集市',key:'saved',period:'傍晚'};
    assert.equal(enter('东港的集市',legacy,[]).visit.key,'saved');
    assert.equal(enter('西港集市',legacy,[]).arrived,true);
});
