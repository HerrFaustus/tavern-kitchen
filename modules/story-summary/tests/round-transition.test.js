import assert from 'node:assert/strict';
import test from 'node:test';
import { createSummaryBatch } from '../data/summary-history.js';
import { captureRangeSource } from '../data/turn-source.js';
import { buildSummaryUndo } from '../data/summary-undo.js';
import { reviewedRounds, summaryLayers, timelineRounds, layerSignature } from '../data/summary-layers.js';
import { upgradeSummaryHistory } from '../data/summary-history.js';
import { migrateRoundSummaries } from '../data/migrations/round-summaries.js';
import { createMemorySession } from '../maintenance/session.js';
import { commitMemorySession } from '../maintenance/commit.js';
import { memoryTagsByFloor } from '../data/memory-tags.js';
import { projectMaintenanceReceipts } from '../maintenance/history.js';

const chat = [{ mes: '他拿到了手令。' }, { mes: '守卫开了门。' }];
function fixture() {
    const rows = chat.map((msg, i) => ({ ...createSummaryBatch(i - 1, i, { version: 1 }),
        summary: i ? msg.mes : '囚犯已经获释。', sourceReceipt: { id: 's' + i, source: captureRangeSource(chat, i, i) } }));
    return { chat, chatId: 'review', cutoff: 1, json: {}, atoms: [], l0Index: { byFloor: {} },
        store: { json: {}, lastSummarizedMesId: 1, summaryHistory: rows } };
}

test('review stages a sourced, versioned correction, invalidates its parent and rolls back at the review boundary', async () => {
    const current = fixture(), history = current.store.summaryHistory;
    history[0].reviewLayers = [{ level: 'stage', start: 0, end: 0, text: '旧阶段',
        sourceId: layerSignature(summaryLayers(history).leaves.slice(0, 1)) }];
    history[0].worldUpdate = { requestId: 'original', proposals: [{ groupId: 'paid-once' }] };
    const session = createMemorySession({ ...current, generateReviewedLayer: async () => '阶段' });
    const revise = args => session.reviewUnit('ReviseRoundSummary', args, current);
    const args = { to: 1, version: 0, previous: history[0].summary, text: '手令到手，放人仍待确认。', memoryTags: { characters: [], locations: [], times: [], keywords: ['手令'] },
        evidence: { floor: 1, quote: '拿到了手令' } };
    await assert.rejects(revise({ ...args, evidence: { floor: 2, quote: '开了门' } }));
    await revise(args);
    await assert.rejects(revise(args));
    assert.equal((await session.reviewUnit('ReadNarrativeUnits', { level: 'round' }, current)).units[0].summary, args.text);
    assert.equal(history[0].summary, args.previous);
    const saved = await commitMemorySession(session, { runId: 'r1' }, { read: () => current,
        commit: async (next, previous, impact, validate) => { validate(); assert.equal(impact.summary, true); return next; } });
    const updated = saved.current.store.summaryHistory;
    assert.equal(projectMaintenanceReceipts(saved.current.store).items[0].counts.revisedRounds, 1);
    assert.deepEqual(updated[0].worldUpdate, history[0].worldUpdate);
    assert.equal(reviewedRounds(updated)[0].roundVersion, 1);
    assert.equal(timelineRounds(saved.current.store)[0].summary, args.text);
    assert.ok(memoryTagsByFloor(saved.current.store, chat).get(0).includes('手令'));
    assert.equal(summaryLayers(updated).parents.length, 0);
    assert.equal(reviewedRounds(updated.slice(0, 1))[0].summary, args.previous);
    assert.equal(summaryLayers(updated.slice(0, 1)).parents.length, 1);
    const edited = structuredClone(current); edited.chat[0].mes = '换了正文。';
    assert.throws(() => session.assertCurrent(edited));
});

test('migration preserves a later correction to an earlier scene, its tags, original summary and world receipt', () => {
    const current = fixture(), store = current.store;
    const old = { id: 'evt-1', title: '手令', summary: '取到手令 (#1)', participants: ['主角'], _addedAt: 0 };
    const updated = { ...old, summary: '取到盖印的手令 (#1)', timeLabel: '正午' };
    store.summaryHistory[0].undo = buildSummaryUndo({}, { events: [old] });
    store.summaryHistory[1].undo = buildSummaryUndo({ events: [old] }, { events: [updated] });
    store.summaryHistory[0].worldUpdate = { requestId: 'paid-once' };
    store.json.events = [updated];
    assert.equal(migrateRoundSummaries(store), true);
    assert.equal(migrateRoundSummaries(store), false);
    assert.equal(store.json.events, undefined);
    assert.match(reviewedRounds(store.summaryHistory)[0].summary, /盖印/);
    assert.deepEqual(store.summaryHistory[0].worldUpdate, { requestId: 'paid-once' });
    assert.ok(memoryTagsByFloor(store, chat).get(0).includes('正午'));
    const previous = reviewedRounds(store.summaryHistory.slice(0, 1))[0];
    assert.match(previous.summary, /取到手令/);
    assert.doesNotMatch(previous.summary, /盖印/);
    assert.deepEqual(previous.memoryTags.characters, ['主角']);
});

test('ReviseRoundSummary checks plotLine quotes against revised text and validates updated plotLines', async () => {
    const current = fixture();
    current.store.summaryHistory[0].summary = '囚犯已经获释，拿到铜印。';
    current.store.summaryHistory[0].plotLines = [
        { title: '越狱线', status: 'active', reading: '拿到铜印', quote: '拿到铜印' },
        { title: '获释线', status: 'potential', reading: '获释疑点', quote: '已经获释' },
    ];
    const session = createMemorySession({ ...current, generateReviewedLayer: async () => '阶段' });
    const warnResult = await session.reviewUnit('ReviseRoundSummary', {
        to: 1,
        version: 0,
        previous: current.store.summaryHistory[0].summary,
        text: '手令到手，放人仍待确认。',
        evidence: { floor: 1, quote: '拿到了手令' },
    }, current);
    assert.match(warnResult.warning || '', /不再/);
    assert.equal(warnResult.invalidatedPlotLines.length, 2);

    await assert.rejects(session.reviewUnit('ReviseRoundSummary', {
        to: 1,
        version: 1,
        previous: '手令到手，放人仍待确认。',
        text: '手令到手，暂未放人。',
        plotLines: [{ title: '越狱线', status: 'active', reading: '新版', quote: '不存在的引文' }],
        evidence: { floor: 1, quote: '拿到了手令' },
    }, current), /plotLines|引文|逐字/i);

    const updated = await session.reviewUnit('ReviseRoundSummary', {
        to: 1,
        version: 1,
        previous: '手令到手，放人仍待确认。',
        text: '手令到手，暂未放人。',
        plotLines: [{ title: '手令风波', status: 'active', reading: '手令暂扣', quote: '手令到手' }],
        evidence: { floor: 1, quote: '拿到了手令' },
    }, current);
    assert.deepEqual(updated.retainedPlotLines, ['手令风波']);
    const saved = await commitMemorySession(session, { runId: 'r-plot' }, {
        read: () => current,
        commit: async next => next,
    });
    const rounds = reviewedRounds(saved.current.store.summaryHistory);
    assert.equal(rounds[0].plotLines[0].title, '手令风波');
    assert.equal(rounds[0].plotLines[0].quote, '手令到手');
    const savedRevision = saved.current.store.summaryHistory.at(-1).roundRevisions;
    assert.doesNotThrow(() => upgradeSummaryHistory([{ ...createSummaryBatch(-1, 0, { version: 1 }), summary: '初版', roundRevisions: savedRevision }]));
    assert.throws(() => upgradeSummaryHistory([{
        ...createSummaryBatch(-1, 0, { version: 1 }),
        summary: '初版',
        roundRevisions: [{ ...savedRevision[0], plotLines: [{ title: '越狱线', status: 'active', reading: 'x', quote: '不匹配' }] }],
    }]));
});
