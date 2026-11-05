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
        shouldNotifyMemoryFailure: () => true, MODULE_ID: 'raw',
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
