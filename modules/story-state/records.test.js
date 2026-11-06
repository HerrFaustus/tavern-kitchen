import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { parseStoryUpdates, mergeStoryRecords, characterStoryState, availableStoryRecords, relativeStoryTime, storyContextLines } from './records.js';
import { createProtagonistView, createSuspenseBook, renderWorldAttributes } from './view.js';
import { buildSummaryUndo, applySummaryUndo, summaryBatchChanges } from '../story-summary/data/summary-undo.js';
import { prepareSummaryResult } from '../story-summary/generate/summary-result.js';
import { projectFloorChanges } from '../story-summary/floor-summary.js';
import { readSummaryPackageData, prepareImportedSummary } from '../story-summary/data/summary-import.js';
import { applyCharacterAliasUpdates, canonicalizeIncrementalSummaryData } from '../story-summary/data/character-aliases.js';
import { editMemoryBatch, restoreMaintenance } from '../story-summary/maintenance/domain.js';

const scene = { id: 'scene', kind: 'scene', location: '渡口', situation: '等待船只', participants: ['阿林'], tension: '', pendingBeat: '信使回来' };
test('shared profiles separate social roles, physical state, mood, competence and actual possession', t => {
    const {document} = parseHTML('<html><body></body></html>');
    const previous = globalThis.document;
    globalThis.document = document; t.after(() => {globalThis.document = previous;});
    const fact = value => ({nature:'established_fact',value});
    const npc = {id:'a',name:'阿林',kind:'person',fields:{身份:fact('贵族'),职务:fact('守备官'),阵营:fact('王党'),
        身体状况:fact('右肩脱臼'),当前情绪:fact('焦急'),能力与专长:fact('识潮，夜航须点灯'),
        '关系身份/b':fact({entityId:'b',role:'师父'})}};
    const hero = {id:'b',name:'小孟',kind:'person',fields:{}};
    const ship = {id:'ship',kind:'item',name:'渡船',fields:{owner:fact({entityId:'a'}),持有类别:fact('资产'),
        保管人:fact({entityId:'b'}),使用人:fact({entityId:'b'})}};
    const show = person => {
        document.body.replaceChildren();
        renderWorldAttributes(document.body,[npc,hero,ship],person);
        return document.body.textContent;
    };
    const first = show(npc);
    assert.match(first,/贵族.*守备官.*王党.*右肩脱臼.*焦急.*识潮/);
    assert.match(first,/小孟：本人是对方的师父/);
    const second = show(hero);
    assert.match(second,/阿林：对方是本人的师父/);
    assert.match(second,/资产渡船：所有人：阿林；保管人：小孟；使用人：小孟/);
    assert.equal(second.split('渡船').length,2);
});
test('any character shows confirmed traits, items and assets by current ownership', t => {
    const {document} = parseHTML('<html><body></body></html>');
    const previous = globalThis.document;
    globalThis.document = document; t.after(() => {globalThis.document = previous;});
    const fact = value => ({nature:'established_fact',value});
    const npc = {id:'smith',name:'铁匠',kind:'person',fields:{外貌:fact('左颊有疤'),体型:fact('宽肩'),衣着:fact('皮围裙'),性格:fact('守信')}};
    const owner = fact({entityId:npc.id});
    const entities = [npc,{kind:'item',name:'钳子',fields:{owner}},{kind:'item',name:'货船',fields:{owner,持有类别:fact('资产')}},
        {kind:'place',name:'铁铺',fields:{owner}},{kind:'item',name:'借来的剑',fields:{owner:fact({entityId:'other'})}}];
    renderWorldAttributes(document.body,entities,npc);
    const group = title => [...document.querySelectorAll('section')].find(el => el.querySelector('h4')?.textContent === title)?.textContent;
    assert.match(group('人物特征'),/左颊有疤.*宽肩.*皮围裙.*守信/);
    assert.match(group('资产'),/货船.*铁铺/);
    assert.match(group('物品'),/钳子/);
    assert.doesNotMatch(document.body.textContent,/借来的剑/);
});
const plan = { id: 'p1', kind: 'plan', title: '交付信件', status: 'open', due: '2026-10-31' };
const belief = { id: 'k1', kind: 'knowledge', person: '阿林', certainty: 'believed', content: '信使已经叛逃', evidence: '听到传言', learnedAt: '黎明' };
const start = () => mergeStoryRecords([], parseStoryUpdates([scene, plan, belief, { id: 'clock', kind: 'clock', label: '十月三十日黎明', date: '2026-10-30' }]), 3, 1);
test('suspense book shows every open clue and authoritative closures, and clears invalid sources', t => {
    const { document } = parseHTML('<main></main>');
    const original = globalThis.document; globalThis.document = document; t.after(() => { globalThis.document = original; });
    const clues = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, kind: 'suspense', title: `密信${i}`, status: 'open' }));
    const snapshot = { enabled: true, store: { json: { storyRecords: [...clues, plan] }, lastSummarizedMesId: 7 } };
    const view = createSuspenseBook({ getSnapshot: () => snapshot }), parent = document.querySelector('main');
    const closed = { ...clues[0], status: 'done', reason: '寄信人承认了身份' };
    const world = { modules: { story: { records: [{ record: closed, start: 4, end: 6 }] } } };
    view.mount(parent); view.show(world);
    assert.equal(parent.querySelectorAll('[data-record-id]').length, 6);
    assert.match(parent.textContent, /密信5 · 未结/); assert.doesNotMatch(parent.textContent, /交付信件/);
    assert.match(parent.textContent, /已结 1 项/); assert.match(parent.textContent, /寄信人承认了身份/);
    assert.match(parent.textContent, /第 5–7 楼/);
    snapshot.invalidFrom = 4; view.show(world); assert.doesNotMatch(parent.textContent, /密信/);
    view.reset(); assert.equal(parent.textContent, '');
});
test('existing maintenance can correct knowledge and close plans atomically, and undo its correction', () => {
    const before = { json: { storyRecords: start() }, atoms: [] };
    const result = editMemoryBatch(before, [
        { collection: 'storyRecords', key: 'p1', kind: 'edit', patch: { status: 'done', reason: '已送达' } },
        { collection: 'storyRecords', key: 'k1', kind: 'edit', patch: { certainty: 'known', content: '信使仍在送信', evidence: '收到信使回信' } },
    ], 3);
    assert.equal(result.memory.json.storyRecords.find(record => record.id === 'p1').status, 'done');
    assert.deepEqual(restoreMaintenance(result.memory, [{ operations: result.results.map(item => ({ changes: item.changes })) }]), before);
    assert.throws(() => editMemoryBatch(before, [{ collection: 'storyRecords', key: 'p1', kind: 'edit', patch: { status: 'done' } }], 3));
    assert.throws(() => editMemoryBatch(before, [{ collection: 'storyRecords', key: 'clock', kind: 'edit', patch: { presence: 'present' } }], 3));
    assert.equal(before.json.storyRecords.find(record => record.id === 'p1').status, 'open');
});
test('one summary validates observations, preserves IDs on reschedule/closure and undoes the entire batch', () => {
    const before = { storyRecords: start() };
    const prepared = prepareSummaryResult({ events: [], storyUpdates: [{ ...plan, status: 'failed', reason: '道路被封' }, { ...scene, participants: ['贝拉'], pendingBeat: '' }] }, { startFloor: 5, endFloor: 6 });
    const after = { storyRecords: mergeStoryRecords(before.storyRecords, prepared.storyUpdates, 5, 4) };
    assert.equal(after.storyRecords.filter(record => record.id === 'p1').length, 1);
    assert.equal(after.storyRecords.find(record => record.kind === 'scene').pendingBeat, '');
    const undo = buildSummaryUndo(before, after);
    assert.deepEqual(applySummaryUndo(after, undo).storyRecords, before.storyRecords);
    assert.equal(summaryBatchChanges(undo).length, 2);
    const store = { json: after, lastSummarizedMesId: 5, summaryHistory: [{ kind: 'batch', previousEndMesId: 3, endMesId: 5, undo }] };
    assert.match(projectFloorChanges(store, 4).changes.join('\n'), /已失败.*道路被封/);
    assert.equal(projectFloorChanges(store, 4, 5), null);
    assert.equal(projectFloorChanges({ ...store, summaryInvalid: true }, 4), null);
    assert.equal(projectFloorChanges(store, 3), null);
});
test('omission retains data, deletion is explicit, invalid types and fake dates fail before commit', () => {
    const previous = start(); assert.deepEqual(mergeStoryRecords(previous, [], 10), previous);
    assert.equal(mergeStoryRecords(previous, parseStoryUpdates([{ id: 'scene', kind: 'scene', remove: true }]), 10).some(record => record.id === 'scene'), false);
    for (const update of [{ ...plan, status: 'done' }, { ...belief, person: '' }, { ...scene, id: 's2' }, { id: 'clock', kind: 'clock', label: '时间', date: '2026-02-30' }, { kind: 'person', id: 'x', name: '阿林', presence: 'maybe' }]) assert.throws(() => parseStoryUpdates([update]));
    assert.throws(() => parseStoryUpdates([plan, plan]));
    assert.throws(() => mergeStoryRecords(previous, [{ id: 'p1', kind: 'suspense' }], 8));
    assert.equal(relativeStoryTime('2026-10-29', '2026-10-30'), '昨天');
    assert.equal(relativeStoryTime('2026-11-01', '2026-10-30'), '2 天后');
    assert.equal(relativeStoryTime('暮秋二日', '暮秋三日'), '');
});
test('new scene roster takes precedence, knowledge stays scoped to its owner, stale records are withheld', () => {
    const records = mergeStoryRecords(start(), parseStoryUpdates([{ id: 'a', kind: 'person', name: '阿林', presence: 'present' }]), 4);
    const after = mergeStoryRecords(records, parseStoryUpdates([{ ...scene, participants: ['贝拉'] }]), 5);
    assert.equal(characterStoryState(after, '阿林').presence, 'away');
    assert.equal(characterStoryState(after, '贝拉').presence, 'present');
    assert.equal(characterStoryState(after, '贝拉').knowledge.length, 0);
    assert.doesNotMatch(storyContextLines(after).join('\n'), /听到传言/);
    assert.match(storyContextLines(after, ['阿林']).join('\n'), /阿林 · 相信／误解：信使已经叛逃.*听到传言.*黎明/);
    assert.deepEqual(availableStoryRecords({ json: { storyRecords: after }, lastSummarizedMesId: 5 }, 4), []);
    assert.deepEqual(availableStoryRecords({ json: { storyRecords: after }, lastSummarizedMesId: 5, sourceInvalidFromFloor: 4 }), []);
});
test('aliases apply to roster, presence and beliefs, while record IDs remain stable', () => {
    const json = { characters: { main: [] }, storyRecords: start() };
    const result = applyCharacterAliasUpdates(json, [{ to: '林恩', from: ['阿林'], evidence: '姓名揭晓' }], 5);
    assert.equal(result.json.storyRecords.find(record => record.id === 'k1').person, '林恩');
    assert.deepEqual(result.json.storyRecords.find(record => record.id === 'scene').participants, ['林恩']);
    const parsed = canonicalizeIncrementalSummaryData({ storyUpdates: [structuredClone(belief)] }, result.json.characterAliases);
    assert.equal(parsed.storyUpdates[0].person, '林恩');
});
test('portable state retains records and binds to the destination boundary without importing old floor numbers', () => {
    const data = { facts: [], storyRecords: start() };
    assert.equal(readSummaryPackageData({ type: 'TavernKitchenStorySummaryMemory', version: 1, data }), data);
    const imported = prepareImportedSummary({ storySummary: {} }, data, 12);
    assert.ok(imported.storySummary.json.storyRecords.every(record => record._addedAt === 12 && record._sourceStart === undefined));
    assert.throws(() => readSummaryPackageData({ type: 'TavernKitchenStorySummaryMemory', version: 1, data: { facts: [], storyRecords: [{ ...plan, status: 'done' }] } }));
});
test('protagonist page scopes confirmed fields, reverse links and knowledge to the player', t => {
    const { document } = parseHTML('<html><body><main></main></body></html>');
    const original = globalThis.document; globalThis.document = document; t.after(() => { globalThis.document = original; });
    let name = '林', snapshot = { enabled: true, store: { json: { storyRecords: start() }, lastSummarizedMesId: 3 } };
    const field = value => ({ value, nature: 'established_fact' });
    const hero = { id: 'p', name: '阿林', kind: 'person', aliases: ['林'], fields: { coins: field(0) } };
    const other = { id: 'npc', name: '守卫', kind: 'person', fields: { description: field('私人秘密') } };
    const world = { entities: [hero, other, { id: 'k', kind: 'item', name: '银钥匙', fields: { owner: field({entityId:'p'}), description: field('封存资料') } }] };
    const view = createProtagonistView({ getSnapshot: () => snapshot, getPlayerName: () => name });
    view.mount(document.querySelector('main')); view.show(world);
    assert.match(document.body.textContent, /金币：0/); assert.match(document.body.textContent, /银钥匙/);
    assert.match(document.body.textContent, /听到传言/); assert.doesNotMatch(document.body.textContent, /私人秘密|封存资料/);
    snapshot = { ...snapshot, invalidFrom: 1 }; view.show(world); assert.doesNotMatch(document.body.textContent, /听到传言/);
    other.aliases = ['林']; view.show(world); assert.match(document.body.textContent, /无法确定/);
    hero.bindings = ['["map","actor:player"]']; view.show(world); assert.match(document.body.textContent, /银钥匙/);
    name = '陌生人'; view.show(world); assert.doesNotMatch(document.body.textContent, /银钥匙/); assert.match(document.body.textContent, /尚无/);
    view.empty(); assert.match(document.body.textContent, /选择一段对话/); assert.doesNotMatch(document.body.textContent, /银钥匙/);
});
