import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLocalConditions } from './ambient.js';

test('local conditions use active branch, resolved scopes and current effects; expired, ambiguous and removed records stay out', () => {
    const atlas = {locations:[{key:'north',name:'北岸',scale:'region'},{key:'quay',name:'渡口',parent:'north'},
        {key:'other',name:'渡口'}]};
    const world = {worldId:'isles',branchId:'main',entities:[{id:'a',kind:'place',name:'渡口',aliases:['老渡头'],bindings:['["map","place:quay"]']}],
        modules:{story:{records:[]}}};
    const event = {id:'fair',flavor:'scenery',kind:'situation',status:'open',title:'灯会',impact:'灯摊沿坡排开。',scope:'渡口'};
    const batch = (branchId,row) => ({sourceReceipt:{worldId:'isles',branchId},endMesId:2,ambient:{visit:{key:'visit'},updates:[row]}});
    const snapshot = {enabled:true,store:{lastSummarizedMesId:2,summaryHistory:[
        batch('main',{...event,placeId:'entity:a',_addedAt:2}),batch('other',{...event,id:'elsewhere',scope:'北岸'})]}};
    const add = record => world.modules.story.records.push({record,end:3,version:2});
    add({...event,id:'ambiguous'}); add({...event,id:'region',scope:'北岸'});
    add({...event,id:'alias',scope:'老渡头'}); add({...event,id:'staleId',placeId:'entity:gone',scope:'北岸'});
    const local = () => mapLocalConditions(world,snapshot,atlas).map(row=>[row.id,row.places]);
    assert.deepEqual(local(),[['fair',['quay']],['region',['north']],['alias',['quay']]]);
    add({...event,status:'done'});
    assert.ok(!local().some(([id])=>id==='fair'));
    world.modules.story.records.pop();
    add({id:'fair',kind:'situation',remove:true});
    assert.ok(!local().some(([id])=>id==='fair'));
    assert.deepEqual(mapLocalConditions(world,{...snapshot,invalidFrom:0},atlas),[]);
});
