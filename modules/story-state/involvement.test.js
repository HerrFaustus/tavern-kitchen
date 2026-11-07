import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { prepareInvolvement, readInvolvement } from './involvement.js';
import { createProtagonistView } from './view.js';

test('all people and open situations or scenery in a mapped region follow the player across region boundaries', () => {
    const location = entityId => ({nature:'established_fact',value:entityId ? {entityId} : null});
    const places = [
        ['world','世界','world'],['east','东郡','region','world'],['west','西郡','region','world'],
        ['city','港城','city','east'],['inn','客栈','building','city'],['port','东码头','outdoor','east'],
        ['fort','关塞','building','west'],
    ];
    const atlas = {locations:places.map(([key,name,scale,parent]) => ({key,name,scale,parent})),actors:[
        {actorKey:'player',displayName:'阿青',locationKey:'inn'},{actorKey:'smith',displayName:'铁匠',locationKey:'port'}]};
    const entities = places.map(([key,name]) => ({id:'place-'+key,kind:'place',name,aliases:key === 'port' ? ['渡口'] : [],bindings:[JSON.stringify(['map','place:'+key])]}));
    const hero = {kind:'person',id:'hero',name:'阿青',fields:{},bindings:['["map","actor:player"]']};
    const world = {worldId:'test',branchId:'main',modules:{map:{atlas}},entities:[...entities,hero,
        {id:'ally',kind:'person',name:'同行者',fields:{location:location('place-port')}},
        {id:'smith',kind:'person',name:'铁匠',fields:{},bindings:['["map","actor:smith"]']}]};
    const situation = (id,scope,extra = {}) => ({id,kind:'situation',title:id,status:'open',scope,...extra});
    const snapshot = {enabled:true,store:{json:{storyRecords:[
        situation('罢工','渡口'),situation('灯节','港城',{flavor:'scenery'}),
        situation('潮汐','西郡、东郡',{flavor:'scenery'}),situation('散场','东郡',{status:'done'}),situation('警戒','关塞'),
    ]},summaryHistory:[{sourceReceipt:{worldId:'test',branchId:'main'},involvement:[
        {action:'enter',target:'person/ally',reason:'仍在帮主角找人'},{action:'leave',target:'situation/灯节'}]}]}};
    const read = () => readInvolvement(world,snapshot,'阿青').filter(row => row.near);
    const titles = () => read().map(row => row.title).sort();
    assert.deepEqual(titles(),['同行者','铁匠','罢工','灯节','潮汐'].sort());
    assert.ok(read().every(row => row.regional && row.reason.includes('东郡')));
    hero.fields.location = location('place-fort'); // World fact supersedes the saved map actor.
    assert.deepEqual(titles(),['同行者','警戒','潮汐'].sort());
    assert.equal(read().find(row => row.key === 'person/ally').reason,'仍在帮主角找人');
    hero.fields.location = location(null);
    assert.deepEqual(titles(),['同行者']);
});

test('a retired roster cannot establish regional proximity and ambiguous geography never promotes namesakes', () => {
    const world = {entities:[]};
    const records = [{kind:'scene',id:'scene',location:'雾港',participants:['阿青','卖花人','路过的水手']},
        {kind:'person',id:'florist',name:'卖花人',presence:'present',note:'正在等阿青取花'},
        {kind:'situation',id:'snow',title:'初雪',status:'open',flavor:'scenery',scope:'雾港'},
        {kind:'situation',id:'mist',title:'海雾',status:'open',flavor:'scenery',scope:'新雾港'}];
    const read = () => readInvolvement(world,{enabled:true,store:{json:{storyRecords:records}}},'阿青').filter(row => row.near);
    assert.deepEqual(read(),[]);
    world.entities = ['a','b'].map(id => ({id,kind:'place',name:'雾港'}));
    assert.deepEqual(read(),[]);
});

test('the protagonist view and simulation share evidenced membership across omission, closure and rollback', t => {
    const previous = globalThis.document;
    globalThis.document = parseHTML('<html><body></body></html>').document;
    t.after(() => { globalThis.document = previous; });
    const person = (id, name) => ({id, name, kind:'person', fields:{}});
    const world = {worldId:'world', branchId:'main', entities:[person('hero','阿青'),person('guard','守卫'),person('vendor','摊主')]};
    const store = {summaryHistory:[], json:{storyRecords:[{id:'scene',kind:'scene',participants:['阿青','摊主']}]}};
    const snapshot = {enabled:true,store};
    const read = () => readInvolvement(world,snapshot,'阿青');
    const view = createProtagonistView({getSnapshot:() => snapshot,getPlayerName:() => '阿青',getInvolvement:read});
    view.mount(document.body);
    const list = () => { view.show(world); return document.body.textContent; };
    const quote = '守卫拦住了阿青。';
    const change = {action:'enter',target:'person/guard',reason:'阻挡阿青出城',floor:3,quote};
    const context = {increment:{messages:[{role:'assistant',floor:3,text:quote}]},involvementContext:read()};
    const delta = prepareInvolvement([change,{...change,quote:'捏造的原文'},{...change,target:'person/unknown'}], context);
    assert.deepEqual(delta,[change]);
    const batch = involvement => ({sourceReceipt:{worldId:'world',branchId:'main'},involvement});
    store.summaryHistory.push(batch(delta), batch([]));
    assert.match(list(),/当前牵涉守卫：阻挡阿青出城/);
    assert.equal(read().find(row => row.title === '摊主').near,false);
    store.summaryHistory.push({...batch([{...change,action:'leave'}]),sourceReceipt:{worldId:'world',branchId:'other'}});
    assert.ok(read().some(row => row.near));
    store.summaryHistory.push(batch([{...change,action:'leave'}, {...change,action:'wake',floor:8}]));
    assert.doesNotMatch(list(),/当前牵涉/);
    assert.equal(read().find(row => row.title === '守卫').wakeFloor,8);
    store.summaryHistory.at(-1).floorEntry = {omitted:true};
    assert.match(list(),/当前牵涉守卫/);
});
