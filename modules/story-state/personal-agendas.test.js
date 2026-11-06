import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { parseStoryUpdates, projectPersonalAgendas, storyContextLines } from './records.js';
import { createProtagonistView, renderPersonalAgendas } from './view.js';
import { getArchiveCharacters } from '../story-summary/archive-view.js';
import { readInvolvement } from './involvement.js';

const plan = {kind:'plan',id:'ferry',holders:['阿青','船夫'],title:'渡江送药',description:'把药送到南岸诊所',
    conditions:'退潮后出发',statusNote:'药箱已装船',status:'open',due:'今晚'};
const goal = {kind:'goal',id:'health',holders:['阿青'],title:'乡里有医',description:'让沿江各村都能得到医治',status:'open'};

test('one shared project appears under both holders and completing it leaves the long-term agenda open', t => {
    const prev = globalThis.document;
    globalThis.document = parseHTML('<html><body></body></html>').document;
    t.after(() => { globalThis.document = prev; });
    const records = parseStoryUpdates([{...plan,status:'done',reason:'诊所签收了药箱'},goal],{requireHolders:true});
    const root = document.createElement('div');
    renderPersonalAgendas(root,records,name => name === '船夫');
    assert.match(root.textContent,/渡江送药 · 已完成/);
    assert.match(root.textContent,/持有人：阿青、船夫/);
    assert.match(root.textContent,/条件约束：退潮后出发/);
    assert.match(root.textContent,/当前进展：药箱已装船/);
    assert.doesNotMatch(root.textContent,/乡里有医/);
    const hero = createProtagonistView({getPlayerName:() => '阿青',getSnapshot:() => ({enabled:true,store:{json:{storyRecords:records}}})});
    hero.mount(document.body); hero.show({entities:[]});
    assert.match(document.body.textContent,/乡里有医 · 未结/);
    assert.equal(document.body.querySelectorAll('[data-record-id="ferry"]').length,1);
    const data = {storyRecords:records,characters:{main:[],relationships:[]},arcs:[],characterAliases:[]};
    assert.deepEqual(getArchiveCharacters(data).map(row => row.name),['阿青','船夫']);
    assert.equal(storyContextLines(records,['船夫']).length,1);
    assert.equal(storyContextLines(records,['阿青']).length,2);
    assert.deepEqual(storyContextLines(records,['路人']),[]);
});

test('old records retain their source shape; only explicitly named holders are projected', () => {
    const old = {kind:'plan',id:'old',title:'送信',description:'阿青与船夫约定明早渡江',status:'open',reason:'',due:''};
    const unknown = {...old,id:'other',description:'给船夫送信'};
    assert.deepEqual(parseStoryUpdates([old])[0],old);
    const projected = projectPersonalAgendas([old,unknown],new Set(['阿青','船夫']));
    assert.deepEqual(projected[0].holders,['阿青','船夫']);
    assert.equal(projected[1].holders,undefined);
    assert.equal(old.holders,undefined);
    assert.throws(() => parseStoryUpdates([old],{requireHolders:true}),/持有人/);
    assert.throws(() => parseStoryUpdates([{...goal,holders:[]}]),/持有人/);
    assert.throws(() => parseStoryUpdates([{...plan,description:''}]),/具体内容/);
});

test('character evolution sees open owned projects and agendas, including a shared project through an alias', () => {
    const world = {worldId:'world',branchId:'branch',entities:[{id:'ferry',kind:'person',name:'周三',aliases:['船夫']}]};
    const snapshot = {enabled:true,store:{json:{storyRecords:[plan,goal]},summaryHistory:[]}};
    const rows = readInvolvement(world,snapshot,'阿青',{includeAgendas:true});
    assert.deepEqual(rows[0].agendas.map(record => record.id),['ferry']);
    assert.equal(rows[0].agendas[0].conditions,'退潮后出发');
    snapshot.store.json.storyRecords[0] = {...plan,status:'done',reason:'药已送达'};
    assert.equal(readInvolvement(world,snapshot,'阿青',{includeAgendas:true})[0].agendas,undefined);
});
