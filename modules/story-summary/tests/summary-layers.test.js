import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryLayers, layerSignature, projectLayers } from '../data/summary-layers.js';
import { readNarrativeUnits, requestNarrativeClosure, validateStagedUnits } from '../maintenance/narrative-review.js';
import { captureRangeSource } from '../data/turn-source.js';

function fixture() {
    const chat = Array.from({length: 20}, (_, i) => ({is_user: i % 2 === 0, mes: '原文' + (i + 1) + '。'}));
    const summaryHistory = Array.from({length: 10}, (_, i) => ({endMesId: 2*i+1, summary: '摘要' + (i+1),
        sourceReceipt: {id: 's' + i, source: captureRangeSource(chat, 2*i, 2*i+1)} }));
    return {store: {summaryHistory}, chat};
}
test('a review at turn ten closes turn seven, rejects unsupported divisions, and composes a chapter only from closed stages', async () => {
    const c = fixture(), history = c.store.summaryHistory, staged = [];
    let calls = 0;
    const read = level => readNarrativeUnits(c, staged, 19, {level});
    const close = (level, from, to, overrides = {}) => requestNarrativeClosure({level, from, to, revision: read(level).revision,
        reason: '目标已有明确结果', evidence: {floor: to, quote: c.chat[to-1].mes}, ...overrides}, c, staged, 19,
        async () => '总结' + (++calls), async () => c);
    assert.equal(read('stage').total, 10);
    await assert.rejects(close('stage', 1, 14, {evidence:{floor:14, quote:'不存在'}}));
    await assert.rejects(close('stage', 1, 13));
    await assert.rejects(close('stage', 1, 14, {revision:'旧版'}));
    assert.equal(calls, 0);
    staged.push((await close('stage', 1, 14)).node);
    assert.equal((await close('stage', 1, 14)).status, 'unchanged');
    assert.equal(read('stage').units[0].from, 15);
    await assert.rejects(close('chapter', 1, 14));
    staged.push((await close('stage', 15, 18)).node);
    staged.push((await close('chapter', 1, 18)).node);
    assert.equal(calls, 3);
    validateStagedUnits(c, staged);
    history.at(-1).reviewLayers = structuredClone(staged);
    const {parents, leaves} = summaryLayers(history);
    assert.deepEqual(projectLayers(leaves, parents).map(n => n.text), ['总结3', '摘要10']);
    assert.equal((await close('chapter', 1, 18)).status,'unchanged');
    history[0].summary = '更正';
    assert.deepEqual(summaryLayers(history).parents.map(n=>n.text), ['总结2']);
    c.chat[1].mes = '换了正文'; assert.throws(()=>read('stage'));
});
test('legacy fixed-size summaries remain usable without creating new groups', () => {
    const c = fixture(), h = c.store.summaryHistory;
    const kids = summaryLayers(h).leaves.slice(0,5);
    h[4].layers = {stage:{level:'stage',start:0,end:9,text:'旧阶段',sourceId:layerSignature(kids)}};
    assert.deepEqual(summaryLayers(h).parents.map(n=>n.text), ['旧阶段']);
});
