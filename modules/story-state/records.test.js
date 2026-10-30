import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { parseStoryUpdates, mergeStoryRecords, characterStoryState, availableStoryRecords, relativeStoryTime, storyContextLines } from './records.js';
import { createStoryOverview, renderPersonState } from './view.js';
import { buildSummaryUndo, applySummaryUndo, summaryBatchChanges } from '../story-summary/data/summary-undo.js';
import { prepareSummaryResult } from '../story-summary/generate/summary-result.js';
import { projectFloorChanges } from '../story-summary/floor-summary.js';
import { readSummaryPackageData, prepareImportedSummary } from '../story-summary/data/summary-import.js';
import { applyCharacterAliasUpdates, canonicalizeIncrementalSummaryData } from '../story-summary/data/character-aliases.js';
import { editMemoryBatch, restoreMaintenance } from '../story-summary/maintenance/domain.js';

const scene = { id: 'scene', kind: 'scene', location: '渡口', situation: '等待船只', participants: ['阿林'], tension: '', pendingBeat: '信使回来' };
const plan = { id: 'p1', kind: 'plan', title: '交付信件', status: 'open', due: '2026-10-31' };
const belief = { id: 'k1', kind: 'knowledge', person: '阿林', certainty: 'believed', content: '信使已经叛逃', evidence: '听到传言', learnedAt: '黎明' };
const start = () => mergeStoryRecords([], parseStoryUpdates([scene, plan, belief, { id: 'clock', kind: 'clock', label: '十月三十日黎明', date: '2026-10-30' }]), 3, 1);
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
    assert.match(storyContextLines(after, ['阿林']).join('\n'), /仅代表该人物的认知/);
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
test('overview and character details render safe source-aware content, clear old chats and retain closure reasons', t => {
    const { document } = parseHTML('<html><body><main></main></body></html>');
    const original = globalThis.document; globalThis.document = document; t.after(() => { globalThis.document = original; });
    let snapshot = { enabled: true, store: { json: { storyRecords: start(), events: [] }, lastSummarizedMesId: 3 } };
    const routes = [], view = createStoryOverview({ getSnapshot: () => snapshot, navigate: route => routes.push(route) });
    view.mount(document.querySelector('main')); view.show({ entities: [], claims: [] });
    assert.match(document.body.textContent, /明天/); assert.match(document.body.textContent, /等待船只/);
    const profile = document.createElement('div'); renderPersonState(profile, start(), '阿林'); assert.match(profile.textContent, /听到传言/);
    const injected = start(); injected[0].situation = '<img src=x onerror=alert(1)>';
    snapshot.store.json.storyRecords = injected; view.show({ entities: [], claims: [] });
    assert.equal(document.querySelector('img'), null); assert.match(document.body.textContent, /<img/);
    snapshot = { ...snapshot, invalidFrom: 1 }; view.show({ entities: [], claims: [] }); assert.doesNotMatch(document.body.textContent, /信使已经叛逃/);
    view.empty(); assert.match(document.body.textContent, /选择一段对话/); assert.doesNotMatch(document.body.textContent, /等待船只/);
});
