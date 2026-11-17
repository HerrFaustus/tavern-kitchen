import assert from 'node:assert/strict';
import test from 'node:test';
import { entry } from './helpers/story-summary-entry.js';

function fixture(overrides = {}) {
    const context = {
        chatId: 'chat-1', name1: '旅人',
        chat: [
            { mes: '开场', is_system: true },
            { is_user: true, mes: '进城' },
            { mes: '城门开了。' },
            { is_user: true, mes: '继续' },
        ],
    };
    return entry(['buildFramePayload'], {
        getContext: () => context,
        worldAuthorityForContext: () => null,
        authorityStoryStore: store => store,
        extractRelationshipsFromFacts: () => [],
        normalizeCharacterAliases: () => [],
        ...overrides,
    });
}

test('SUMMARY_FULL_DATA payload carries live header stats after a pre-send settlement', () => {
    const api = fixture();
    const store = {
        lastSummarizedMesId: 1,
        summaryHistory: [
            { kind: 'batch', previousEndMesId: -1, endMesId: 0, summary: '开场。' },
            { kind: 'batch', previousEndMesId: 0, endMesId: 1, summary: '进城。' },
        ],
        json: { facts: [], storyRecords: [] },
    };
    const payload = api.buildFramePayload(store);
    assert.deepEqual(structuredClone(payload.stats), {
        totalFloors: 4,
        summarizedUpTo: 2,
        roundCount: 2,
        pendingFloors: 2,
        hiddenCount: 1,
    });
    assert.equal(payload.lastSummarizedMesId, 1);
    assert.equal(payload.rounds.length, 2);
});

test('payload stats stay consistent for an empty ledger and reflect the projected hide state', () => {
    const api = fixture();
    const payload = api.buildFramePayload({ lastSummarizedMesId: -1, summaryHistory: [], json: { facts: [] } });
    assert.deepEqual(structuredClone(payload.stats), {
        totalFloors: 4,
        summarizedUpTo: 0,
        roundCount: 0,
        pendingFloors: 4,
        hiddenCount: 1,
    });
});
