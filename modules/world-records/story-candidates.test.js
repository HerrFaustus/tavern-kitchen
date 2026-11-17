import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorldStoryProposal, isCurrentStoryProposal, worldStoryRecords } from './world-story-state.js';

const source = { module: 'turn-update', key: 'update:1', label: '逐楼更新' };
const emptyState = () => ({ modules: { story: { version: 1, records: [], candidates: [] } } });

function apply(state, record, nature, version) {
    const applied = applyWorldStoryProposal(state, { type: 'story', record, before: { present: false }, nature,
        evidence: { floor: 1, quote: '原文' } }, source, version, `event:${version}`, `key:${version}`, { start: 0, end: 1 });
    return { ...applied, value: { ...state, modules: { ...state.modules, story: applied.value } } };
}

test('uncertain plans, goals and person presences stay in the visible current story set', () => {
    let state = emptyState();
    const plan = { id: 'plan:night', kind: 'plan', holders: ['主角'], title: '夜探城主府', description: '查明账目', conditions: '', status: 'open', reason: '', due: '' };
    const goal = { id: 'goal:truth', kind: 'goal', holders: ['主角'], title: '查清真相', description: '找到账本', conditions: '', status: 'open', reason: '', due: '' };
    const person = { id: 'person:lord', kind: 'person', name: '城主', presence: 'present', note: '正厅接见' };
    for (const [record, nature, version] of [[plan, 'hypothesis', 2], [goal, 'belief', 3], [person, 'rumor', 4]]) {
        assert.equal(isCurrentStoryProposal({ record, nature }), true);
        const applied = apply(state, record, nature, version);
        assert.equal(applied.outcome, 'applied');
        assert.equal(applied.value.modules.story.candidates.length, 0);
        state = applied.value;
    }
    const records = worldStoryRecords(state);
    assert.deepEqual(records.map(record => [record.id, record._nature]), [
        ['plan:night', 'hypothesis'],
        ['goal:truth', 'belief'],
        ['person:lord', 'rumor'],
    ]);
});

test('situations, suspense and clocks are current for every qualified nature, and removals still apply', () => {
    let state = emptyState();
    for (const [record, nature, version] of [
        [{ id: 'situation:gate', kind: 'situation', title: '城门戒严', description: '', status: 'open', reason: '', due: '' }, 'rumor', 2],
        [{ id: 'suspense:ledger', kind: 'suspense', title: '账本下落', description: '', status: 'open', reason: '', due: '' }, 'hypothesis', 3],
        [{ id: 'clock', kind: 'clock', label: '次日', date: '' }, 'belief', 4],
    ]) {
        const applied = apply(state, record, nature, version);
        assert.equal(applied.outcome, 'applied');
        state = applied.value;
    }
    assert.equal(worldStoryRecords(state).length, 3);

    // Closing an item with a qualified nature must remove it instead of leaving a candidate.
    const removed = apply(state, { id: 'suspense:ledger', kind: 'suspense', remove: true }, 'belief', 5);
    assert.equal(removed.outcome, 'applied');
    assert.equal(removed.value.modules.story.candidates.length, 0);
    assert.equal(worldStoryRecords(removed.value).some(record => record.id === 'suspense:ledger'), false);
});

test('historical creative proposals still stay in the candidate list', () => {
    const state = emptyState();
    const creative = apply(state, { id: 'situation:moon', kind: 'situation', title: '月球坠落', description: '', status: 'open', reason: '', due: '' }, 'creative_proposal', 2);
    assert.equal(creative.outcome, 'candidate');
    assert.equal(creative.value.modules.story.records.length, 0);
    assert.equal(creative.value.modules.story.candidates.length, 1);
    const unclassified = apply(state, { id: 'situation:dream', kind: 'situation', title: '梦境', description: '', status: 'open', reason: '', due: '' }, 'unclassified', 2);
    assert.equal(unclassified.outcome, 'candidate');
});
