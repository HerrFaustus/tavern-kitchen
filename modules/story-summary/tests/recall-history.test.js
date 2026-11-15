import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildRecallHistoryEntry,
    clearRecallHistory,
    getRecallHistory,
    recordRecallHistoryEntry,
} from '../recall-history.js';

function installMemoryStorage(t) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const store = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: key => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key),
        },
    });
    clearRecallHistory();
    t.after(() => {
        clearRecallHistory();
        if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
        else delete globalThis.localStorage;
    });
    return store;
}

test('buildRecallHistoryEntry captures structured trace fields and separates included vs trimmed chunks', () => {
    const entry = buildRecallHistoryEntry({
        chatId: 'chat-a',
        branchId: 'branch-1',
        type: 'normal',
        targetFloor: 12,
        status: 'matched',
        diagnostics: {
            startedAt: 100,
            finishedAt: 245,
            fallbacks: [{ stage: 'rerank', detail: 'skip' }],
        },
        prepared: {
            recallTrace: {
                mode: 'hybrid',
                reranked: true,
                queryPreview: '码头 银钥匙',
                focusCharacters: ['守门人', '旅人'],
                hiddenThrough: 8,
                backgroundItems: 4,
                includedBackgroundItems: 2,
                rawBudgetUsed: 620,
                rawBudgetMax: 3000,
                chunks: [
                    { chunkId: 'c1', floor: 2, speaker: '守门人', _score: 0.91234, _rerankScore: 0.87654, text: '交接钥匙', included: true },
                    { chunkId: 'c2', floor: 9, speaker: '旅人', _score: 0.55, text: '尚未隐藏', included: false, filterReason: 'above_boundary' },
                ],
            },
        },
        recallLogText: 'diagnostics raw line',
    });

    assert.equal(entry.mode, 'hybrid');
    assert.equal(entry.reranked, true);
    assert.equal(entry.elapsedMs, 145);
    assert.equal(entry.hiddenThrough, 8);
    assert.equal(entry.includedCount, 1);
    assert.equal(entry.trimmedCount, 1);
    assert.deepEqual(entry.focusCharacters, ['守门人', '旅人']);
    assert.equal(entry.chunks[0].score, 0.9123);
    assert.equal(entry.chunks[1].filterReason, 'above_boundary');
    assert.equal(entry.diagnosticsText, 'diagnostics raw line');
});

test('recall history isolates branches, enforces ring bounds, and clears cleanly', t => {
    const store = installMemoryStorage(t);
    for (let i = 0; i < 25; i += 1) {
        recordRecallHistoryEntry(buildRecallHistoryEntry({
            chatId: 'chat-1',
            branchId: 'main',
            targetFloor: i,
            status: 'matched',
        }));
    }
    recordRecallHistoryEntry(buildRecallHistoryEntry({
        chatId: 'chat-1',
        branchId: 'alt',
        targetFloor: 3,
        status: 'reused',
    }));

    const mainHistory = getRecallHistory('chat-1', 'main');
    assert.equal(mainHistory.length, 20);
    assert.equal(mainHistory[0].targetFloor, 24);
    assert.equal(getRecallHistory('chat-1', 'alt').length, 1);
    assert.ok(store.get('tk-recall-history-v1'));

    for (let c = 2; c <= 12; c += 1) {
        recordRecallHistoryEntry(buildRecallHistoryEntry({
            chatId: `chat-${c}`,
            branchId: 'main',
            targetFloor: c,
            status: 'empty',
        }));
    }
    const persisted = JSON.parse(store.get('tk-recall-history-v1'));
    assert.equal(persisted.length, 10);

    clearRecallHistory('chat-12', 'main');
    assert.equal(getRecallHistory('chat-12', 'main').length, 0);
});
