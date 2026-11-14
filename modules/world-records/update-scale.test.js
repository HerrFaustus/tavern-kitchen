import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorld } from './domain.js';
import { buildUpdateContext, UPDATE_INPUT_LIMIT, UPDATE_PREFIX } from './update-context.js';
import { captureRangeSource } from '../story-summary/data/turn-source.js';
import { layerSignature, summaryLayers } from '../story-summary/data/summary-layers.js';

test('buildUpdateContext compresses recursive history and compacts old settled proposal batches on 200+ turn logs', () => {
    const turnCount = 216;
    const chat = Array.from({ length: turnCount * 2 + 2 }, (_, i) => ({
        is_user: i % 2 === 0,
        mes: `第${i + 1}楼对话。`,
    }));
    const verboseSummary = '详细过往摘要文本。'.repeat(65); // ~600 chars * 216 = ~130k chars uncompacted
    const summaryHistory = Array.from({ length: turnCount }, (_, i) => ({
        previousEndMesId: 2 * i - 1,
        endMesId: 2 * i + 1,
        summary: `轮${i}:${verboseSummary}`,
        sourceReceipt: {
            id: `req-${i}`,
            worldId: 'w-scale',
            branchId: 'main',
            basisVersion: 0,
            source: captureRangeSource(chat, 2 * i, 2 * i + 1),
        },
    }));

    const { leaves } = summaryLayers(summaryHistory, [], { chat });
    const stages = [];
    for (let i = 0; i < leaves.length; i += 12) {
        const group = leaves.slice(i, i + 12);
        stages.push({
            id: `s-${i}`,
            level: 'stage',
            start: group[0].start,
            end: group.at(-1).end,
            text: `阶段(${group[0].start}-${group.at(-1).end})摘要。`,
            sourceId: layerSignature(group),
            childIds: group.map(g => g.id),
        });
    }
    const chapters = [];
    for (let i = 0; i < stages.length; i += 6) {
        const group = stages.slice(i, i + 6);
        chapters.push({
            id: `c-${i}`,
            level: 'chapter',
            start: group[0].start,
            end: group.at(-1).end,
            text: `章节(${group[0].start}-${group.at(-1).end})总结。`,
            sourceId: layerSignature(group),
            childIds: group.map(g => g.id),
        });
    }
    const vol = {
        id: 'vol-0',
        level: 'L3',
        start: chapters[0].start,
        end: chapters.at(-1).end,
        text: '全书第一卷压缩总结。',
        sourceId: layerSignature(chapters),
        childIds: chapters.map(c => c.id),
    };
    summaryHistory.at(-1).reviewLayers = [...stages, ...chapters, vol];

    let state = emptyWorld('w-scale', 'main', '超长对话扩展测试');
    // Inject 60 heavy settled proposal batches (> 180k chars if uncompacted) plus 1 active pending proposal!
    const heavyEvidenceQuote = '超长引文细节'.repeat(400);
    for (let i = 0; i < 60; i++) {
        state.sources[`${UPDATE_PREFIX}settled-${i}`] = {
            kind: 'independent_world_update',
            status: 'ready',
            fingerprint: `fp-${i}`,
            update: {
                requestId: `settled-${i}`,
                basis: { worldId: 'w-scale', branchId: 'main', version: 0, digest: 'd' },
                source: { start: i * 2, end: i * 2 + 1, digest: `d-${i}` },
                proposals: [{ type: 'field', entityId: 'e1', field: 'coins', value: i, evidence: { floor: i * 2, quote: heavyEvidenceQuote } }],
                conflicts: [],
            },
            reviews: [{ index: 0, status: 'accepted' }],
        };
    }
    state.sources[`${UPDATE_PREFIX}active-pending`] = {
        kind: 'independent_world_update',
        status: 'ready',
        fingerprint: 'fp-active',
        update: {
            requestId: 'active-pending',
            basis: { worldId: 'w-scale', branchId: 'main', version: 0, digest: 'd' },
            source: { start: 420, end: 421, digest: 'd-active' },
            proposals: [{ type: 'field', entityId: 'e1', field: 'coins', value: 99, evidence: { floor: 420, quote: '待确认报价' } }],
            conflicts: [],
        },
        reviews: [],
    };

    const store = {
        lastSummarizedMesId: turnCount * 2 - 1,
        summaryHistory,
        json: {
            storyRecords: [],
            scenes: [{ id: 'old-scene', name: '应被过滤的旧场景' }],
            events: Array.from({ length: 45 }, (_, i) => ({ id: `ev-${i}`, summary: `旧事件${i}` })),
        },
    };
    const receipt = {
        id: 'next-turn',
        turns: [],
        source: captureRangeSource(chat, turnCount * 2, turnCount * 2 + 1),
    };

    const ctx = buildUpdateContext(state, store, chat, receipt);
    const serializedLen = JSON.stringify(ctx).length;
    assert.ok(serializedLen < UPDATE_INPUT_LIMIT, `Expected compact context < 200k, got ${serializedLen}`);
    assert.equal(ctx.background.summaries.length, 1);
    assert.equal(ctx.background.summaries[0].level, 'L3');
    assert.equal(ctx.manifest.archivedProposalBatches, 48); // 60 - 12 recent retained
    assert.ok(ctx.world.proposalHistory.some(p => p.requestId === 'active-pending'));
    assert.equal(ctx.background.data.scenes, undefined);
    assert.equal(ctx.background.data.archivedEventsCount, 15);
    assert.equal(ctx.background.data.events.length, 30);

    // Partial swipe mutating floor 1 invalidates vol-0 & stage-0 cleanly inside buildUpdateContext without throwing!
    chat[1].mes = '已翻页支线';
    const ctxAfterSwipe = buildUpdateContext(state, store, chat, receipt);
    assert.ok(ctxAfterSwipe.background.summaries.every(s => s.level !== 'L3'));
    assert.ok(ctxAfterSwipe.background.summaries.some(s => s.level === 'chapter'));
});
