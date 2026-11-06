import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { parseStoryUpdates } from './records.js';
import { renderThreads } from './view.js';
import { situationViewRecords } from './situation-history.js';

test('a situation keeps distinct source-backed changes and linked background apart from its history', t => {
    const [initial] = parseStoryUpdates([{ id:'port', kind:'situation', title:'封港', description:'军械失窃', status:'open' }]);
    assert.equal(Object.hasOwn(initial,'scope'),false);
    const [limited, closed] = [parseStoryUpdates([{...initial, parties:'港务司、船主', scope:'东港', impact:'粮船可通行', releaseCondition:'查明军械去向'}])[0],
        parseStoryUpdates([{...initial, status:'done', reason:'封港令撤销'}])[0]];
    const entry = (record, end, id) => ({record, end, start:end, eventId:id});
    const event = (id, entries) => ({id,effects:[{type:'module',id:'story',after:{records:entries}}]});
    const world = {events:[event('a',[entry(limited,4,'a')]),event('b',[entry(limited,4,'a')]),event('c',[entry(closed,8,'c')])]};
    const store = {json:{storyRecords:[{...initial,_addedAt:1}]}};
    const [record] = situationViewRecords([closed],store,world,[{situationId:'port', title:'码头积货',body:'仓库满了'}]);
    assert.deepEqual(record._history.map(step => step._addedAt),[1,4,8]);
    assert.match(record._history[1].text,/当前影响：粮船可通行/);
    assert.match(record._history[2].text,/已完成/);
    assert.equal(record._history.some(step => step.text.includes('积货')),false);
    const {document} = parseHTML('<html><body><main></main></body></html>');
    const previous = globalThis.document; globalThis.document = document; t.after(() => {globalThis.document = previous;});
    renderThreads(document.querySelector('main'),[record],['situation']);
    assert.match(document.body.textContent,/局势历史/); assert.match(document.body.textContent,/幕后进展 · 码头积货/);
    assert.match(document.body.textContent,/第 9 楼/);
});
