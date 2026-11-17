import assert from 'node:assert/strict';
import test from 'node:test';
import { entry } from './helpers/story-summary-entry.js';

function fixture(overrides = {}) {
    const calls = [], errors = [], session = { signal: new AbortController().signal, commit: task => task() };
    const context = { chatId: 'current', chat: [{ mes: '本轮正文', is_user: false }] };
    const config = { enabled: true, retrievalMode: 'raw', embeddingApi: { key: 'fixture' } };
    const ui = entry(['maybeRunDelayedVectorMaintenance', 'generateVectorsNow', 'repairVectorsNow', 'handleAnchorGenerate', 'handleAnchorGenerateNow'], {
        getContext: () => context, getVectorConfig: () => config,
        isStorySummaryEnabledForCurrentChat: () => true, isHostGenerating: () => false, isL0FloorDeferred: () => false,
        isChatStale: id => id !== context.chatId, isVectorWriteSessionCurrent: () => true,
        ensureCurrentSources: async () => calls.push('source'),
        guard: { isAnyRunning: () => false, acquire: () => () => calls.push('release') },
        runVectorGenerationTask: async (_options, run) => run(session),
        VECTOR_WRITE_SCOPES: { EMBEDDING: 'embedding' }, AUTO_L0_BACKFILL_DELAY_MS: 5000,
        maintainChunks: async options => { calls.push({ kind: 'raw', options }); return { success: true, built: 1 }; },
        repairMissingChunks: async options => { calls.push({ kind: 'repair', options }); return { success: true, repaired: 1 }; },
        finishVectorMaintenance: () => calls.push('finished'), clearVectorMaintenance: () => calls.push('cleared'),
        retryVectorMaintenanceAfterCancel: () => calls.push('retry'), scheduleAutoL0Backfill: () => calls.push('scheduled'),
        stopVectorMaintenanceAfterFailure: () => calls.push('failed'),
        sendVectorStatsToFrame: async () => calls.push('stats'),
        clearAllChunks: async () => calls.push('clear-raw'), clearChunkDocuments() {}, updateMeta: async () => calls.push('meta'),
        getEngineFingerprint: () => 'test', postToFrame() {}, executeSlashCommand: async () => calls.push('notice'),
        shouldNotifyMemoryFailure: () => true, MODULE_ID: 'raw', showAgentNotice: () => {},
        xbLog: { info() {}, warn() {}, error: (...args) => errors.push(args) },
        // Any regression to a paid retired channel fails this contract.
        getAnchorStats: () => assert.fail('legacy anchor inspection'), incrementalExtractAtoms: () => assert.fail('extra semantic call'),
        vectorizeMissingStateAtoms: () => assert.fail('legacy scene vectorization'), repairMissingEventVectorsNow: () => assert.fail('legacy event vectorization'),
        clearStateVectors: () => assert.fail('historical scene vectors cleared'), clearEventVectors: () => assert.fail('historical event vectors cleared'),
        ...overrides,
    });
    return { ui, calls, errors, context, config, session };
}

test('automatic maintenance runs only raw chunks inside the existing writer and source guards', async () => {
    const f = fixture();
    await f.ui.maybeRunDelayedVectorMaintenance('current');
    assert.equal(f.calls.filter(call => call.kind === 'raw').length, 1);
    assert.equal(f.calls.find(call => call.kind === 'raw').options.commit, f.session.commit);
    assert.deepEqual(f.calls.filter(call => typeof call === 'string'), ['source', 'finished', 'release', 'stats']);
    assert.deepEqual(f.errors, []);
});

test('manual rebuild and repair preserve retired vectors and do not interpret prose again', async () => {
    const f = fixture();
    await f.ui.generateVectorsNow(f.config, 'current', f.session);
    await f.ui.repairVectorsNow(f.config, 'current', f.session);
    await f.ui.handleAnchorGenerate();
    assert.equal(f.calls.filter(call => call === 'clear-raw').length, 1);
    assert.equal(f.calls.filter(call => call.kind === 'raw').length, 1);
    assert.equal(f.calls.filter(call => call.kind === 'repair').length, 1);
    assert.deepEqual(f.errors, []);
});

test('failed maintenance stops this round and a cancelled writer remains retryable', async () => {
    for (const result of [{ success: false, code: 'offline' }, { cancelled: true }]) {
        const f = fixture({ maintainChunks: async () => result });
        await f.ui.maybeRunDelayedVectorMaintenance('current');
        assert.ok(f.calls.includes(result.cancelled ? 'retry' : 'failed'));
        assert.equal(f.calls.includes('finished'), false);
    }
});

test('a stale chat or active host generation cannot start paid maintenance', async () => {
    const stale = fixture(); await stale.ui.maybeRunDelayedVectorMaintenance('other'); assert.deepEqual(stale.calls, []);
    const busy = fixture({ isHostGenerating: () => true }); await busy.ui.maybeRunDelayedVectorMaintenance('current');
    assert.deepEqual(busy.calls, ['scheduled']);
});

test('reconcileSettledFloorChunks rewinds indexed raw chunks when settled floor has simulation prose and skips missing ones', async () => {
    const ops = [];
    let meta = { chatId: 'current', lastChunkFloor: 3 };
    let store = {
        lastSummarizedMesId: 1,
        floorSimulations: {
            1: { floor: 1, text: '后厨暗门悄然合拢。' },
            2: { floor: 2, text: '   ' },
        },
    };
    const api = entry(['reconcileSettledFloorChunks'], {
        getPublishedSummaryStore: () => store,
        getContext: () => ({ chatId: 'current' }),
        removeDocumentsByFloor: (floor, chatId) => ops.push(['remove-doc', floor, chatId]),
        getMeta: async () => meta,
        runVectorWriteTask: async (_opts, run) => { ops.push(['task', _opts.kind]); return await run(); },
        VECTOR_WRITE_SCOPES: { CONSISTENCY: 'consistency' },
        deleteChunksAtFloor: async (chatId, floor) => ops.push(['delete-chunks', chatId, floor]),
        updateMeta: async (chatId, patch) => { meta = { ...meta, ...patch }; ops.push(['update-meta', chatId, patch]); },
        getVectorConfig: () => ({ enabled: true }),
        scheduleAutoL0Backfill: (delay, chatId) => ops.push(['schedule-backfill', delay, chatId]),
        AUTO_L0_BACKFILL_DELAY_MS: 5000,
    });

    await api.reconcileSettledFloorChunks(1);
    assert.deepEqual(structuredClone(ops), [
        ['remove-doc', 1, 'current'],
        ['task', 'settle-floor-sim-chunks'],
        ['delete-chunks', 'current', 1],
        ['update-meta', 'current', { lastChunkFloor: 0 }],
        ['schedule-backfill', 5000, 'current'],
    ]);
    assert.equal(meta.lastChunkFloor, 0);

    ops.length = 0;
    await api.reconcileSettledFloorChunks(2);
    await api.reconcileSettledFloorChunks(0);
    assert.deepEqual(ops, []);
});
