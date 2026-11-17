import test from 'node:test';
import assert from 'node:assert/strict';
import {
    summaryLayers,
    layerSignature,
    projectLayers,
    planNextCompression,
    selectHistoryNodesBefore,
    thresholdForLevel,
    DEFAULT_LEAF_KEEP_RECENT,
} from '../data/summary-layers.js';
import { captureRangeSource } from '../data/turn-source.js';

function makeRounds(count) {
    const chat = Array.from({ length: count * 2 }, (_, i) => ({ is_user: i % 2 === 0, mes: `原文 ${i + 1}。` }));
    const summaryHistory = Array.from({ length: count }, (_, i) => ({
        kind: 'batch',
        previousEndMesId: i * 2 - 1,
        endMesId: i * 2 + 1,
        summary: `摘要 ${i + 1}`,
        roundSource: captureRangeSource(chat, i * 2, i * 2 + 1),
    }));
    return { chat, summaryHistory };
}

test('planNextCompression automatically rolls L0->L1->L2->L3+ from minDepth=0 without manual proofreading', () => {
    assert.equal(thresholdForLevel(0), 12);
    assert.equal(thresholdForLevel(1), 6);
    assert.equal(thresholdForLevel(2), 3);

    // 14 rounds with default keepRecent=3 leaves only 11 eligible L0 nodes (<12) -> null
    const c14 = makeRounds(14);
    assert.equal(planNextCompression(c14.summaryHistory, { chat: c14.chat, minDepth: 0 }), null);

    // 15 rounds -> compresses oldest 12 into L1 stage node
    const c15 = makeRounds(15);
    const l1Plan = planNextCompression(c15.summaryHistory, { chat: c15.chat, minDepth: 0, leafKeepRecent: DEFAULT_LEAF_KEEP_RECENT });
    assert.equal(l1Plan?.depth, 1);
    assert.equal(l1Plan?.level, 'stage');
    assert.equal(l1Plan?.nodes.length, 12);
    assert.equal(l1Plan?.start, 0);
    assert.equal(l1Plan?.end, 23);

    // Build 6 L1 stage nodes + 3 recent L0 rounds -> next plan is L2 chapter
    const total = 12 * 6 + 3;
    const c75 = makeRounds(total);
    for (let i = 0; i < 6; i++) {
        const plan = planNextCompression(c75.summaryHistory, { chat: c75.chat, minDepth: 0 });
        assert.equal(plan?.depth, 1);
        const tail = c75.summaryHistory[Math.min(c75.summaryHistory.length - 1, Math.floor(plan.end / 2))];
        (tail.compressionNodes ??= []).push({
            id: `l1-${i}`,
            level: plan.level,
            depth: plan.depth,
            start: plan.start,
            end: plan.end,
            childIds: plan.childIds,
            sourceId: plan.sourceId,
            text: `阶段 ${i + 1}`,
        });
    }
    const l2Plan = planNextCompression(c75.summaryHistory, { chat: c75.chat, minDepth: 0 });
    assert.equal(l2Plan?.depth, 2);
    assert.equal(l2Plan?.level, 'chapter');
    assert.equal(l2Plan?.nodes.length, 6);
    assert.equal(l2Plan?.start, 0);
    assert.equal(l2Plan?.end, 143);

    const anchorTail = c75.summaryHistory[Math.floor(l2Plan.end / 2)];
    (anchorTail.compressionNodes ??= []).push({
        id: 'l2-0',
        level: l2Plan.level,
        depth: l2Plan.depth,
        start: l2Plan.start,
        end: l2Plan.end,
        childIds: l2Plan.childIds,
        sourceId: l2Plan.sourceId,
        text: '第一章完结',
    });

    const selected = selectHistoryNodesBefore(c75.summaryHistory, c75.chat, total * 2);
    assert.equal(selected[0].level, 'chapter');
    assert.equal(selected[0].text, '第一章完结');
    assert.equal(selected.length, 4); // 1 L2 chapter + 3 recent L0 rounds
});

test('legacy fixed-size layers remain usable without creating new groups', () => {
    const c = makeRounds(10);
    const kids = summaryLayers(c.summaryHistory).leaves.slice(0, 5);
    c.summaryHistory[4].layers = { stage: { level: 'stage', start: 0, end: 9, text: '旧阶段', sourceId: layerSignature(kids) } };
    const { leaves, parents } = summaryLayers(c.summaryHistory);
    assert.deepEqual(parents.map(n => n.text), ['旧阶段']);
    assert.equal(projectLayers(leaves, parents).length, 6);
});
