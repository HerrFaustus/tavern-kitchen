import { createTestModuleUrl } from './helpers/bundle-module.js';
// Real summary/anchor/history transaction, HTTP confirmation and IndexedDB boundary.
// Protects import undo, source retirement and ambiguous saves; no model calls or source-text assertions.
import assert from 'node:assert/strict';
import { beforeEach, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { setImmediate } from 'node:timers';
import path from 'node:path';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { maintenanceFixture } from './fixtures/memory-maintenance.js';
import { entry } from './helpers/story-summary-entry.js';
import { hostSaveEntry } from './helpers/host-save-entry.js';
import { createHideStateController } from '../hide-state.js';
import { memorySaveError } from '../data/memory-copy.js';
import { shouldNotifyMemoryFailure } from '../user-feedback.js';
import * as vectorWrites from '../vector/runtime/maintenance-coordinator.js';
import { createAbortError, throwIfSignalAborted } from '../../../shared/common/abort-utils.js';
import { METADATA_CONFIRMATION_TIMEOUT_MS } from '../data/metadata-confirmation.js';
import { SUMMARY_FEEDBACK_COPY } from '../feedback-copy.js';
import { summaryFailureReason } from '../summary-failure.js';
import { createSummaryDiagnostics } from '../summary-diagnostics.js';
import { getChatIdentity } from '../data/chat-identity.js';
import { captureRangeSource } from '../data/turn-source.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const host = globalThis.__memoryStorageTest = { metadata: {}, context: {} };
const shims = {
    'extensions.js': 'export const getContext=()=>globalThis.__memoryStorageTest.context;',
    'script.js': 'export let chat_metadata=globalThis.__memoryStorageTest.metadata; export function reload(){chat_metadata=globalThis.__memoryStorageTest.metadata;} export const getRequestHeaders=()=>({});',
    'debug-core.js': 'export const xbLog={info(){},warn(){},error(){},debug(){}};',
    'runtime.js': 'export const applyRecallRuntimeMutationBestEffort=(chatId,change)=>globalThis.__memoryStorageTest.mutations.push({chatId,...change}); export const clearRecallRuntime=async()=>{};',
    'modules/story-summary/data/config.js': 'export const getTextFilterRules=()=>[]; export const getVectorConfig=()=>globalThis.__memoryStorageTest.vectorConfig; export const getSummaryPanelConfig=()=>({memoryMaintenanceEnabled:false,trigger:{},ui:{hideSummarized:true,keepVisibleCount:0}}); export const getSettings=()=>({storySummary:{enabled:true}}); export const DEFAULT_MEMORY_PROMPT_TEMPLATE="{$剧情记忆}";',
    'modules/story-summary/generate/llm.js': `export const generateSummary=async options=>{
        const host=globalThis.__memoryStorageTest, raw=await host.generate(options);
        if (!options.updateContext) {
            let decoded; try { decoded=JSON.parse(raw); } catch { return raw; }
            if (!Array.isArray(decoded?.events)) return raw;
            return JSON.stringify({summary:'本轮原文已有进展。', ...decoded});
        }
        if (!host.autoUnifiedFixture) return raw;
        const context=options.updateContext;
        return JSON.stringify({summary:'本轮行动已经完成，双方保留各自的记录。',worldUpdate:{basis:{worldId:context.basis.worldId,branchId:context.basis.branchId,version:context.basis.version},proposals:[],acknowledgedReceipts:context.executionReceipts.map(item=>item.commandId),conflicts:[]},...JSON.parse(raw)});
    }; export function parseSummaryJson(raw){try{return JSON.parse(raw);}catch{return null;}} export const isSummaryGenerationCancelledError=()=>false;`,
    'modules/story-summary/vector/utils/embedder.js': 'export const getEngineFingerprint=()=>"test-engine";',
    'modules/story-summary/vector/llm/siliconflow.js': 'export const embed=(texts)=>globalThis.__memoryStorageTest.embed(texts);',
    'modules/story-summary/vector/llm/atom-extraction.js': 'export const extractAtomsForRound=()=>{throw Error("unexpected anchor request");};',
    'shared/common/async-errors.js': 'export const observeBackgroundTask=task=>globalThis.__memoryStorageTest.background.push(Promise.resolve(task).catch(error=>{globalThis.__memoryStorageTest.backgroundErrors.push(error);}));',
    'core/agent-status.js': 'export const showAgentNotice=notice=>globalThis.__memoryStorageTest.notices.push(notice?.message ?? String(notice)); export const clearAgentNotice=()=>{}; export const setAgentIdleStatus=()=>{}; export const installAgentStatus=()=>()=>{}; export const configureAgentStatusActions=()=>{};',
    'modules/story-summary/vector/retrieval/recall.js': 'export const recallMemory=(...args)=>globalThis.__memoryStorageTest.recall(...args); export const hydrateDirectEvidence=()=>{throw Error("unexpected hydration");}; export const releaseDirectEvidenceContext=async()=>{};',
    'modules/story-summary/vector/retrieval/raw-recall.js': 'import { getPublishedSummaryStore } from "./modules/story-summary/data/store.js"; export const recallRawMemory=()=>globalThis.__memoryStorageTest.recall(getPublishedSummaryStore()?.json?.events || []);',
};
const bundled = await build({
    stdin: { resolveDir: root, contents: [
        "export * from './modules/story-summary/data/store.js';",
        "export { registerWorldAuthority } from './modules/world-records/sources.js';",
        "export { createWorldArchive } from './modules/world-records/host.js';",
        "export { getWorldBridge } from './modules/world-records/bridge.js';",
        "export { currentTurns, turnProgress } from './modules/world-records/turn-ledger.js';",
        "export { worldUpdates, buildUpdateContext } from './modules/world-records/update-context.js';",
        "export * from './modules/story-summary/inline/ledger.js';",
        "export * from './modules/story-summary/data/memory-commit.js';",
        "export * from './modules/story-summary/data/summary-import.js';",
        "export { normalizeCharacterAliases } from './modules/story-summary/data/character-aliases.js';",
        "export * from './modules/story-summary/data/summary-history.js';",
        "export * from './modules/story-summary/data/anchor-extraction.js';",
        "export * from './modules/story-summary/data/anchor-invalidation.js';",
        "export * from './modules/story-summary/data/message-sources.js';",
        "export * from './modules/story-summary/data/source-sync.js';",
        "export * from './modules/story-summary/generate/generator.js';",
        "export { buildVectorPromptText } from './modules/story-summary/generate/prompt.js';",
        "export * from './modules/story-summary/vector/storage/state-store.js';",
        "export { vectorizeMissingStateAtoms, getL0VectorBuildStatus } from './modules/story-summary/vector/pipeline/state-integration.js';",
        "export { db, stateVectorsTable, chunksTable, chunkVectorsTable, metaTable } from './modules/story-summary/data/db.js';",
        "export { deleteChunksFromFloor, deleteChunksAtFloor, updateMeta, clearAllChunks, clearEventVectors } from './modules/story-summary/vector/storage/chunk-store.js';",
        "export { reload } from 'script.js';",
    ].join('\n') },
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'host-boundaries', setup(api) {
        api.onResolve({ filter: /.*/ }, args => {
            const relative = path.relative(root, path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/');
            const key = Object.hasOwn(shims, relative) ? relative : path.basename(args.path);
            return Object.hasOwn(shims, key) ? { path: key, namespace: 'host' } : null;
        });
        api.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: shims[args.path], resolveDir: root }));
    } }],
});
// eslint-disable-next-line no-unsanitized/method -- Generated local test bundle, never external code.
const mod = await import(await createTestModuleUrl(bundled.outputFiles[0].text));
const originalFetch = globalThis.fetch;
after(() => { mod.db.close(); globalThis.fetch = originalFetch; delete globalThis.__memoryStorageTest; });
const ext = () => host.metadata.extensions.TavernKitchen;
const disk = () => host.files.get(host.context.chatId).extensions.TavernKitchen;

beforeEach(async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const expireReadback = () => {
        // Transport-failure integration cases advance the real transaction's
        // deadline; retry timing itself is covered by metadata-confirmation tests.
        setImmediate(() => t.mock.timers.tick(10_000));
    };
    for (const table of mod.db.tables) await table.clear();
    const fixture = maintenanceFixture();
    Object.assign(host, { fixture, mode: 'save', autoUnifiedFixture: false, expireReadback: false, reads: 0, writes: 0, mutations: [], background: [], backgroundErrors: [], afterSave: null, files: new Map(), metadata: { extensions: { TavernKitchen: {} } } });
    host.vectorConfig = { enabled: false, embeddingApi: {} };
    host.generate = () => assert.fail('unexpected summary request');
    host.embed = () => assert.fail('unexpected embedding request');
    host.recall = () => assert.fail('unexpected recall request');
    host.context = { ...fixture, characterId: 0, characters: [{ name: '角色', chat: fixture.chatId, avatar: 'fixture.png' }],
        saveMetadata: async () => {
            host.writes++;
            if (host.mode !== 'old') host.files.set(host.context.chatId, structuredClone(host.metadata));
            await host.afterSave?.();
            if (host.mode === 'throw_after' || host.mode === 'old') throw new Error('transport');
        },
    };
    host.files.set(fixture.chatId, structuredClone(host.metadata));
    globalThis.fetch = async (url, request) => {
        host.reads++;
        if (host.mode === 'read_fail') { expireReadback(); throw new Error('read offline'); }
        if (['old', 'different'].includes(host.mode) || host.expireReadback) expireReadback();
        const key = JSON.parse(request.body).file_name;
        return new Response(JSON.stringify([{ chat_metadata: host.files.get(key) }]));
    };
    mod.reload();
    mod.getSummaryStore();
});

async function importFixture() {
    const next = mod.prepareImportedSummary(mod.readSummaryMemory(), host.fixture.json, host.fixture.cutoff);
    await mod.commitSummaryMemory(host.context.chatId, next);
    return structuredClone(ext().storySummary.json);
}

// Acceptance: opt-in success feedback means both persistence and follow-up
// work finished. Cost: a hidden failed save or misleading completion signal.
for (const scenario of ['default', 'enabled', 'save-failed', 'followup-failed', 'chat-changed']) {
    test(`summary completion notification observes the actual result: ${scenario}`, async t => {
        await importFixture();
        host.context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
        host.generate = async () => JSON.stringify({ events: [], factUpdates: [] });
        const notices = host.notices = [];
        t.after(() => { host.notices = []; });
        if (scenario === 'save-failed') host.mode = 'old';
        const result = await mod.runSummaryGeneration(25, {
            trigger: { delayFloors: 0, ...(scenario === 'default' ? {} : { notifyOnComplete: true }) },
        }, { onComplete: async () => {
            assert.equal(notices.length, 0);
            if (scenario === 'followup-failed') throw new Error('index unavailable');
            if (scenario === 'chat-changed') host.context = { ...host.context, chatId: 'another-chat' };
        } });
        assert.equal(notices.length, scenario === 'enabled' ? 1 : 0);
        if (scenario === 'enabled' || scenario === 'default') assert.equal(result.success, true);
    });
}

test('switching characters with the same filename does not roll back or save the target summary', async () => {
    await importFixture();
    const tracker = mod.createMessageSourceTracker();
    tracker.reset({ ...host.context, characterId: 1, chat: [...host.context.chat, { mes: 'other owner extra floor' }] });
    tracker.switchChat(host.context);
    const before = structuredClone(disk());
    const writes = host.writes;
    assert.equal((await mod.synchronizeSourceCaches(tracker, host.context)).status, 'unchanged');
    assert.deepEqual(disk(), before);
    assert.equal(host.writes, writes);
});

for (const edited of [false, true]) test(`invalid L2 history does not block raw-source maintenance (edited: ${edited})`, async () => {
    await importFixture();
    ext().storySummary.summaryInvalid = true;
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    if (edited) host.context.chat[0].mes += ' edited';
    const gate = entry(['ensureCurrentSources', 'waitForSummaryPreparation'], {
        ...mod, ...vectorWrites, createAbortError, throwIfSignalAborted, memorySaveError,
        getContext: () => host.context, messageSources: tracker, isChatStale: () => false,
        isStorySummaryConsumableForCurrentChat: () => mod.isSummaryConsumable(mod.getSummaryStore(), host.context.chat.length),
        synchronizeCurrentSources: () => mod.synchronizeSourceCaches(tracker, host.context),
    });
    await gate.ensureCurrentSources(null, { requireSummary: false });
    assert.equal(tracker.inspect(host.context), null);
    assert.equal(ext().storySummary.summaryInvalid, true);
    await assert.rejects(gate.ensureCurrentSources(), { code: 'summary_history_invalid' });
});

test('an uncertain save can be confirmed on the next operation without replaying the save', async () => {
    await importFixture();
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = 'saved while offline';
    host.mode = 'read_fail';
    await assert.rejects(mod.commitSummaryMemory(host.context.chatId, next), { code: 'metadata_save_unconfirmed' });
    const writes = host.writes;
    host.mode = 'save';
    await mod.waitForMemoryCommit();
    assert.equal(mod.getMemoryCommitState(), 'ready');
    assert.equal(host.writes, writes);
    assert.deepEqual(mod.readPublishedSummaryMemory(), next);
    mod.assertMemoryWritable();
});

test('a stalled host save releases the task after sixty seconds and can be confirmed without replay', async t => {
    await importFixture();
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    host.afterSave = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    t.after(() => release?.());
    const writes = host.writes;
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = 'host save still pending';
    const saving = mod.commitSummaryMemory(host.context.chatId, next).catch(error => error);
    await started;
    t.mock.timers.tick(6000); await nextTurn();
    assert.equal(mod.getMemoryCommitState(), 'saving');
    t.mock.timers.tick(54_000);
    const error = await saving;
    assert.equal(error.code, 'metadata_save_unconfirmed');
    assert.equal(error.cause.code, 'metadata_save_timeout');
    assert.equal(mod.getMemoryCommitState(), 'unconfirmed');
    assert.equal(host.writes, writes + 1);
    // The server already has the exact candidate, even though the host promise
    // has not settled. Read-only recovery may confirm it without another write.
    await mod.waitForMemoryCommit();
    assert.equal(mod.getMemoryCommitState(), 'ready');
    assert.equal(mod.getPublishedSummaryStore().json.facts[0].o, 'host save still pending');
    assert.equal(host.writes, writes + 1);
    release(); await nextTurn();
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

test('stalled readback releases the writer within its deadline, including a noncooperative transport', async t => {
    await importFixture();
    let entered, signal, otherWrite = false;
    const reading = new Promise(resolve => { entered = resolve; });
    globalThis.fetch = (_url, options) => {
        signal = options.signal;
        entered();
        return new Promise(() => {});
    };
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = 'saved';
    const saving = assert.rejects(vectorWrites.runVectorWriteTask({ scope: vectorWrites.VECTOR_WRITE_SCOPES.IO },
        () => mod.commitSummaryMemory(host.context.chatId, next)), { code: 'metadata_save_unconfirmed' });
    const following = vectorWrites.runVectorWriteTask({ scope: vectorWrites.VECTOR_WRITE_SCOPES.CONFIG }, () => { otherWrite = true; });
    await reading;
    assert.equal(otherWrite, false);
    t.mock.timers.tick(METADATA_CONFIRMATION_TIMEOUT_MS);
    await Promise.all([saving, following]);
    assert.equal(signal.aborted, true);
    assert.equal(otherWrite, true);
    assert.equal(mod.getMemoryCommitState(), 'unconfirmed');
    await vectorWrites.shutdownVectorWriteCoordinator();
    vectorWrites.resumeVectorWriteCoordinator();
});

async function seedAnchors() {
    const next = mod.readSummaryMemory();
    next.stateAtoms = structuredClone(host.fixture.atoms);
    next.l0Index = structuredClone(host.fixture.l0Index);
    await mod.commitSummaryMemory(host.context.chatId, next);
}

async function seedCacheRange(chatId, floors, lastChunkFloor = Math.max(...floors)) {
    const keys = floors.map(floor => ({ chatId, floor, chunkId: `c-${floor}-0` }));
    await mod.chunksTable.bulkPut(keys.map(row => ({ ...row, text: `floor ${row.floor}` })));
    await mod.chunkVectorsTable.bulkPut(keys.map(({ chatId: owner, chunkId }) => ({ chatId: owner, chunkId, vector: new ArrayBuffer(8) })));
    await mod.saveStateVectors(chatId, floors.map(floor => ({ atomId: `a-${floor}`, floor, vector: [1, 0] })), 'test');
    await mod.metaTable.put({ chatId, lastChunkFloor, fingerprint: 'test', updatedAt: 1 });
}

function observeCacheWrites(t) {
    let writes = 0;
    const record = () => { writes++; };
    for (const table of mod.db.tables) for (const event of ['creating', 'updating', 'deleting']) {
        table.hook(event, record);
        t.after(() => table.hook(event).unsubscribe(record));
    }
    return () => writes;
}

for (const scenario of [
    { name: 'floor zero USER edit', kind: 'edit', floor: 0, change: chat => { chat[0].mes += ' changed'; }, chunks: [0], anchors: [0, 1] },
    { name: 'AI continuation', change: chat => { chat[1].mes += ' continued'; }, chunks: [1], anchors: [1] },
    { name: 'swipe', kind: 'swipe', floor: 1, change: chat => { chat[1].mes = 'replacement'; }, chunks: [1], from: 1 },
    { name: 'reorder then quiet', kind: 'edit', floor: 2, change: chat => { [chat[1], chat[2]] = [chat[2], chat[1]]; }, from: 1 },
    { name: 'middle deletion', kind: 'delete', change: chat => { chat.splice(2, 1); }, from: 2 },
    { name: 'tail deletion', kind: 'delete', change: chat => { chat.splice(22); }, from: 22 },
]) test(`source owner retires persisted cache: ${scenario.name}`, async t => {
    await seedAnchors();
    const { chatId, chat } = host.context;
    await seedCacheRange(chatId, chat.map((_, floor) => floor));
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    scenario.change(chat);
    const beforeIO = { writes: host.writes, reads: host.reads };
    tracker.observeCompletion(host.context, chat.length - 1);
    assert.ok(tracker.inspect(host.context));
    const result = await mod.synchronizeSourceCaches(tracker, host.context, scenario);
    assert.equal(result.status, 'synced');
    assert.equal(tracker.inspect(host.context), null);
    const removedChunk = floor => scenario.chunks ? scenario.chunks.includes(floor) : floor >= scenario.from;
    const removedAnchor = floor => scenario.anchors ? scenario.anchors.includes(floor) : floor >= scenario.from;
    const chunks = await mod.chunksTable.where('chatId').equals(chatId).toArray();
    assert.deepEqual(chunks.map(row => row.floor).sort((a, b) => a - b), Array.from({ length: 24 }, (_, floor) => floor).filter(floor => !removedChunk(floor)));
    assert.equal(await mod.chunkVectorsTable.where('chatId').equals(chatId).count(), chunks.length);
    assert.ok(ext().stateAtoms.every(atom => !removedAnchor(atom.floor)));
    assert.ok((await mod.getAllStateVectors(chatId)).every(row => !removedAnchor(row.floor)));
    assert.deepEqual({ writes: host.writes, reads: host.reads }, beforeIO);
    await host.context.saveMetadata(); // The next normal host save carries live retirement.
    assert.deepEqual(disk(), ext());
    const writes = observeCacheWrites(t), saves = host.writes;
    assert.equal((await mod.synchronizeSourceCaches(tracker, host.context, scenario)).status, 'unchanged');
    assert.equal(writes(), 0);
    assert.equal(host.writes, saves);
});

// Exercise the real entry's hide wiring, not a second copy of its save policy.
function memoryVisibility() {
    const errors = [], rendered = [], saves = [];
    let warnings = 0;
    host.context.saveChat = async () => saves.push(host.context.chat.map(message => message.is_system));
    const ui = entry(['hideState', 'applyHideState', 'clearHideState', 'isStorySummaryEnabledForCurrentChat'], {
        ...mod, createHideStateController, memorySaveError, shouldNotifyMemoryFailure,
        getContext: () => host.context,
        getStorySummaryEnablement: () => ({ context: host.context, effectiveEnabled: true }),
        getHideUiSettings: () => ({ hideSummarized: true, useVectorBoundary: false, keepVisibleCount: 4 }),
        getVectorConfig: () => host.vectorConfig,
        events: {}, MODULE_ID: 'story-summary',
        document: { querySelector: selector => ({ setAttribute: (_key, value) => rendered.push({ selector, value }) }) },
        window: { toastr: { warning: () => { warnings++; } } },
        xbLog: { error: (_module, _message, error) => errors.push(error.code) },
    });
    return { ...ui, errors, rendered, saves, warnings: () => warnings };
}

for (const unavailable of [false, true]) test(`first swipe during initial visibility needs no plugin save (readback unavailable: ${unavailable})`, async () => {
    await importFixture();
    const context = host.context;
    context.chat.push({ mes: '次日', is_user: true }, { mes: '原回复', is_user: false, swipe_id: 0 });
    const memory = mod.readSummaryMemory();
    memory.l0Index.byFloor[25] = { floor: 25, status: 'empty', atoms: 0 };
    await mod.commitSummaryMemory(context.chatId, memory);
    // Loaded persisted flags/cache, with no edit or generation in this session.
    context.chat.forEach((message, floor) => { message.is_system = floor <= 17; });
    const initial = context.chat.map(message => message.is_system);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(context);
    const ui = memoryVisibility();
    const beforeIO = { writes: host.writes, reads: host.reads };
    if (unavailable) host.mode = 'read_fail';
    context.chat[25].swipe_id = 1;
    const syncing = mod.synchronizeSourceCaches(tracker, context, { kind: 'swipe', floor: 25 });
    assert.equal(ext().l0Index.byFloor[25], undefined);
    assert.equal(mod.getMemoryCommitState(), 'ready');
    assert.equal((await syncing).status, 'synced');
    await ui.applyHideState();
    assert.deepEqual({ writes: host.writes, reads: host.reads }, beforeIO);
    assert.deepEqual(ui.saves, []);
    assert.equal(ui.warnings(), 0);
    assert.deepEqual(ui.errors, []);
    assert.equal(mod.getMemoryCommitState(), 'ready');
    assert.equal(mod.isSummaryConsumable(mod.getSummaryStore(), context.chat.length), true);
    // The changed tail is beyond the published summary; uncertainty cannot unhide it.
    assert.deepEqual(context.chat.map(message => message.is_system), initial);
    assert.deepEqual(ui.rendered, []);
    assert.equal(tracker.inspect(context), null);
    await host.context.saveMetadata();
    assert.deepEqual(disk(), ext());
});

// Acceptance: failure of the new range cannot alter the previous 980 floors.
// Cost: lost memory / unusable summaries. Run the real retry, generator and commit.
function summaryExecutionHarness(overrides = {}) {
    const messages = [], errors = [], toasts = [];
    const summaryDiagnostics = createSummaryDiagnostics();
    let running = false;
    const noop = () => {};
    const ui = entry(['AUTO_SUMMARY_MAX_ATTEMPTS', 'autoRunSummaryWithRetry', 'handleManualGenerate', 'ensureCurrentSources',
        'isSummaryGenerating', 'beginSummaryExecution', 'cancelActiveSummaryExecution', 'isSummaryExecutionActive',
        'finishSummaryExecution', 'notifySummaryState', 'postSummaryExecution', 'reportSummaryExecutionFailure',
        'assertSummaryExecutionActive', 'handleFrameMessage', 'prepareSummaryExecution', 'runSummaryAttempt', 'waitForSummaryPreparation',
        'sendFrameBaseData', 'sendFrameFullData', 'buildFramePayload', 'updateFrameStatsAfterSummary'], {
        ...mod, ...vectorWrites, AbortController, createAbortError, throwIfSignalAborted,
        createSummaryGenerationCancelledError: createAbortError, isSummaryGenerationCancelledError: () => false,
        memorySaveError, SUMMARY_FEEDBACK_COPY, summaryFailureReason,
        activeSummaryExecution: null, currentMesId: null, MODULE_ID: 'summary', summaryDiagnostics, getChatIdentity,
        getContext: () => host.context, document: { getElementById: noop }, isTrustedMessage: () => true,
        isStorySummaryEnabledForCurrentChat: () => true,
        isStorySummaryConsumableForCurrentChat: () => mod.isSummaryConsumable(mod.getSummaryStore(), host.context.chat.length),
        isChatStale: id => id !== host.context.chatId, messageSources: { inspect: () => null },
        synchronizeCurrentSources: async () => {},
        guard: { isRunning: () => running, acquire: () => {
            if (running) return null;
            running = true;
            return () => { running = false; };
        } },
        postToFrame: message => messages.push(message), cancelPendingHide: noop,
        notifyStorySummaryChatState: () => messages.push({ type: 'CHAT_SUMMARY_STATE' }),
        xbLog: { error: (_module, _text, error) => errors.push(error) },
        window: { toastr: { error: (text, _title, options) => { assert.equal(options.escapeHtml, true); toasts.push(text); },
            warning: (text, _title, options) => { assert.equal(options.escapeHtml, true); toasts.push(text); } } },
        shouldNotifyMemoryFailure, sleep: async () => {},
        refreshEntityLexiconAndWarmup: noop, addEventDocuments: noop, replaceEventDocuments: noop,
        getHideUiSettings: () => ({ hideSummarized: true, keepVisibleCount: 4 }), getVectorConfig: () => host.vectorConfig,
        applyHideState: noop, applyHideStateDebounced: noop,
        autoVectorizeMissingEvents: noop, rebuildActiveVectorCacheAfterSummary: noop,
        scheduleVectorIntegrityCheck: noop, ...overrides,
    });
    return { ...ui, messages, errors, toasts, summaryDiagnostics, isRunning: () => running };
}

test(`manual summary catches up in confirmed batches through the requested completed reply`, async () => {
    await importFixture();
    host.context.chat.push(...Array.from({ length: 6 }, (_, index) => ({ mes: `新增原文 ${index}`, is_user: index % 2 === 0 })));
    const run = summaryExecutionHarness(), ranges = [], writes = host.writes;
    host.generate = async ({ newHistoryText }) => {
        ranges.push(newHistoryText);
        return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: `第${ranges.length}段`, isState: false }] });
    };
    await run.handleManualGenerate(29, { trigger: { maxPerRun: 2, delayFloors: 0 } });
    assert.equal(ranges.length, 3); assert.equal(mod.getSummaryStore().lastSummarizedMesId, 29);
    assert.equal(disk().storySummary.lastSummarizedMesId, 29); assert.equal(host.writes - writes, 3); assert.equal(run.isRunning(), false);
    for (const [index, text] of ranges.entries()) {
        assert.ok(text.includes(`新增原文 ${index * 2}`));
        assert.equal(text.includes(`新增原文 ${(index + 1) * 2}`), false);
    }
});

test('a failed catch-up batch preserves confirmed progress and retry resumes after that range', async () => {
    await importFixture();
    host.context.chat.push(...Array.from({ length: 6 }, (_, index) => ({ mes: `后续原文 ${index}`, is_user: index % 2 === 0 })));
    const run = summaryExecutionHarness(), writes = host.writes; let calls = 0;
    host.generate = async () => { if (++calls === 2) throw new Error('fixture provider offline'); return JSON.stringify({ events: [] }); };
    await run.handleManualGenerate(29, { trigger: { maxPerRun: 2 } });
    assert.equal(mod.getSummaryStore().lastSummarizedMesId, 25); assert.equal(host.writes - writes, 1);
    await run.handleManualGenerate(29, { trigger: { maxPerRun: 2 } });
    assert.equal(mod.getSummaryStore().lastSummarizedMesId, 29); assert.equal(host.writes - writes, 3); assert.equal(calls, 4);
});

test('stopping during catch-up preserves the first batch and does not start a third model request', async () => {
    await importFixture();
    host.context.chat.push(...Array.from({ length: 6 }, (_, index) => ({ mes: `未处理原文 ${index}`, is_user: index % 2 === 0 })));
    const run = summaryExecutionHarness(), writes = host.writes; let calls = 0;
    host.generate = async () => { if (++calls === 2) run.cancelActiveSummaryExecution(); return JSON.stringify({ events: [] }); };
    await run.handleManualGenerate(29, { trigger: { maxPerRun: 2 } });
    assert.equal(calls, 2); assert.equal(host.writes - writes, 1); assert.equal(mod.getSummaryStore().lastSummarizedMesId, 25); assert.equal(run.isRunning(), false);
});

for (const failure of ['request', 'empty', 'parse', 'structure']) {
    test(`1000 floors with 980 summarized: ${failure} failure preserves memory and permits manual retry`, async () => {
        host.context.chat = Array.from({ length: 1000 }, (_, i) => ({ mes: `floor ${i + 1}`, is_user: i % 2 === 0 }));
        await mod.commitSummaryMemory(host.context.chatId, mod.prepareImportedSummary(mod.readSummaryMemory(), host.fixture.json, 979));
        const visibility = memoryVisibility();
        await visibility.applyHideState();
        const before = mod.readSummaryMemory(), flags = host.context.chat.map(message => message.is_system);
        const writes = host.writes, requests = [];
        host.generate = async request => {
            requests.push(request);
            if (failure === 'request') throw new Error('HTTP 429 provider key=never-display-this-secret');
            return failure === 'empty' ? '' : failure === 'parse' ? '{' : '{}';
        };
        const run = summaryExecutionHarness();
        const config = { trigger: { delayFloors: 0 } };
        await run.handleManualGenerate(999, config);
        assert.equal(requests.length, 1);
        assert.equal(run.isRunning(), false);
        assert.equal(run.messages.at(-2).isGenerating, false);
        assert.equal(run.messages.at(-1).type, 'CHAT_SUMMARY_STATE');
        assert.equal(run.messages.filter(message => message.type === 'SUMMARY_ERROR').at(-1).uncertain, false);
        const reason = summaryFailureReason(run.errors.at(-1));
        assert.ok(run.messages.filter(message => message.type === 'SUMMARY_ERROR').at(-1).message.includes(reason));
        assert.ok(run.messages.some(message => message.type === 'SUMMARY_ERROR' && message.message.includes(reason)));
        if (failure === 'request') assert.ok(reason.includes('HTTP 429'));
        if (failure === 'structure') {
            assert.equal(run.errors.at(-1).cause.path, 'summary');
            assert.ok(reason.includes(run.errors.at(-1).cause.message));
        }
        assert.equal(JSON.stringify(run.messages).includes('never-display-this-secret'), false);
        assert.deepEqual(mod.readSummaryMemory(), before);
        assert.deepEqual(host.context.chat.map(message => message.is_system), flags);
        assert.equal(host.writes, writes);
        await visibility.applyHideState();
        assert.deepEqual(host.context.chat.map(message => message.is_system), flags);
        const pending = mod.buildIncrementalSlice(999, before.storySummary.lastSummarizedMesId, 100, 0);
        assert.equal(pending.count, 20);
        await run.handleManualGenerate(999, config);
        assert.ok(run.messages.filter(message => message.type === 'SUMMARY_ERROR').at(-1).message.includes(reason));
        host.generate = async request => {
            requests.push(request);
            assert.equal(request.newHistoryText, pending.text);
            return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '继续出发', isState: false }] });
        };
        await run.handleManualGenerate(999, config);
        assert.equal(requests.length, 3);
        assert.equal(mod.getPublishedSummaryStore().lastSummarizedMesId, pending.endMesId);
        assert.equal(run.isRunning(), false);
        const attempts = run.summaryDiagnostics.read(getChatIdentity(host.context)).attempts;
        assert.equal(attempts.length, 3);
        assert.equal(attempts[0].outcome, 'completed');
        assert.equal(attempts[0].saveState, 'confirmed');
        assert.equal(attempts[1].automatic, false);
        assert.ok(attempts.every(item => !item.automatic && item.attempt === 1));
        assert.equal(new Set(attempts.map(item => item.runId)).size, 3);
        for (const item of attempts.slice(1)) {
            assert.equal(item.outcome, 'failed');
            assert.equal(item.stage, failure === 'empty' ? 'response' : failure);
            assert.equal(item.reason, reason);
            assert.deepEqual(item.range, { from: 981, to: 1000 });
            assert.equal(item.saveState, 'not_started');
        }
    });
}

// Acceptance: attempt diagnostics preserve the real stop/failure/save boundary,
// including failures after saving. Cost: duplicate paid requests or lost diagnosis.
for (const scenario of ['preparation', 'timeout', 'not_saved', 'followup', 'stale']) {
    test(`summary execution diagnostics preserve ${scenario} outcome`, async () => {
        await importFixture();
        host.context.chat.push({ mes: 'new question', is_user: true }, { mes: 'new answer', is_user: false });
        const problem = new Error('fixture failure');
        if (scenario === 'followup') problem.cause = Object.assign(new Error('upstream throttled api_key=fixture-secret'), {
            status: 429, request: { authorization: 'request-secret' },
        });
        const run = summaryExecutionHarness({
            ...(scenario === 'preparation' ? { applyHideState: () => { throw problem; } } : {}),
            ...(scenario === 'followup' ? { rebuildActiveVectorCacheAfterSummary: () => { throw problem; } } : {}),
        });
        host.generate = async () => {
            if (scenario === 'timeout') throw Object.assign(problem, { name: 'AbortError' });
            if (scenario === 'stale') host.context.chat.at(-1).mes = 'changed source';
            return JSON.stringify({ events: [], factUpdates: [] });
        };
        if (scenario === 'not_saved') host.mode = 'old';
        await run.handleManualGenerate(25, { trigger: { delayFloors: 0 } });
        const record = run.summaryDiagnostics.read(getChatIdentity(host.context)).attempts[0];
        assert.equal(record.stage, { preparation: 'preparation', timeout: 'request', not_saved: 'saving', followup: 'followup', stale: 'source_validation' }[scenario]);
        assert.equal(record.outcome, scenario === 'followup' ? 'followup_failed' : scenario === 'stale' ? 'stale' : 'failed');
        assert.equal(record.saveState, scenario === 'followup' ? 'confirmed' : scenario === 'not_saved' ? 'not_saved' : 'not_started');
        assert.equal(mod.getPublishedSummaryStore().lastSummarizedMesId, scenario === 'followup' ? 25 : 23);
        if (['preparation', 'timeout', 'followup'].includes(scenario)) {
            assert.ok(record.reason.includes(summaryFailureReason(problem)));
            assert.ok(run.messages.filter(message => message.type === 'SUMMARY_ERROR').at(-1).message.includes(record.reason));
        }
        if (scenario === 'followup') {
            assert.ok(record.reason.includes('429'));
            assert.ok(record.reason.includes('upstream throttled'));
            for (const secret of ['fixture-secret', 'request-secret']) {
                assert.equal(JSON.stringify([record, run.messages]).includes(secret), false);
            }
        }
    });
}

test('unconfirmed new summary keeps published hiding and never saves its draft through visibility', async () => {
    await importFixture();
    host.context.chat.push({ mes: 'new question', is_user: true }, { mes: 'new answer', is_user: false });
    const visibility = memoryVisibility();
    await visibility.applyHideState();
    const flags = host.context.chat.map(message => message.is_system), before = mod.readPublishedSummaryMemory();
    let finishSave;
    host.mode = 'read_fail';
    host.afterSave = () => new Promise(resolve => { finishSave = resolve; });
    const next = mod.readSummaryMemory();
    next.storySummary.lastSummarizedMesId = 25;
    next.storySummary.json.facts[0].o = 'unpublished';
    const saving = assert.rejects(mod.commitSummaryMemory(host.context.chatId, next), { uncertain: true });
    while (!finishSave) await Promise.resolve();
    const projecting = visibility.applyHideState();
    assert.deepEqual(mod.readPublishedSummaryMemory(), before);
    assert.deepEqual(host.context.chat.map(message => message.is_system), flags);
    finishSave(); await saving; await projecting;
    assert.deepEqual(host.context.chat.map(message => message.is_system), flags);
    const saveCount = visibility.saves.length, writes = host.writes;
    await visibility.clearHideState();
    assert.ok(host.context.chat.every(message => !message.is_system));
    await visibility.applyHideState();
    assert.deepEqual(host.context.chat.map(message => message.is_system), flags);
    assert.equal(visibility.saves.length, saveCount);
    assert.equal(host.writes, writes);
    assert.deepEqual(mod.readPublishedSummaryMemory(), before);
});

// Acceptance: confirmation without new content must publish the recovered view.
// Cost: stale summary / wrong hidden range, or a duplicate paid model request.
test('confirmed manual retry refreshes data and hiding without another model request', async () => {
    await importFixture();
    host.context.chat.push({ mes: 'new question', is_user: true }, { mes: 'new answer', is_user: false });
    const visibility = memoryVisibility();
    await visibility.applyHideState();
    const flags = host.context.chat.map(message => message.is_system);
    let requests = 0;
    host.generate = async () => {
        requests++;
        return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '继续出发', isState: false }] });
    };
    const run = summaryExecutionHarness({ applyHideState: visibility.applyHideState });
    host.mode = 'read_fail';
    await run.handleManualGenerate(25, { trigger: { delayFloors: 0 } });
    const next = mod.readSummaryMemory();
    assert.equal(mod.getMemoryCommitState(), 'unconfirmed');
    assert.equal(mod.getPublishedSummaryStore().lastSummarizedMesId, 23);
    assert.deepEqual(host.context.chat.map(message => message.is_system), flags);
    const writes = host.writes;
    await run.handleManualGenerate(25, { trigger: { delayFloors: 0 } });
    assert.equal(run.isRunning(), false);
    assert.equal(run.messages.filter(message => message.type === 'SUMMARY_ERROR').at(-1).uncertain, true);
    const messageCount = run.messages.length;
    host.mode = 'save';
    await run.handleManualGenerate(25, { trigger: { delayFloors: 0 } });
    assert.equal(mod.getMemoryCommitState(), 'ready');
    assert.deepEqual(mod.readPublishedSummaryMemory(), next);
    assert.equal(host.writes, writes);
    assert.equal(requests, 1);
    assert.equal(run.isRunning(), false);
    const recoveryMessages = run.messages.slice(messageCount);
    const data = recoveryMessages.find(message => message.type === 'SUMMARY_FULL_DATA')?.payload;
    assert.equal(data?.lastSummarizedMesId, 25);
    assert.deepEqual(data.facts, next.storySummary.json.facts);
    const stats = recoveryMessages.find(message => message.type === 'SUMMARY_BASE_DATA')?.stats;
    assert.equal(stats?.summarizedUpTo, 26);
    assert.equal(stats.pendingFloors, 0);
    assert.equal(stats.hiddenCount, 18);
    assert.deepEqual(host.context.chat.map(message => !!message.is_system), host.context.chat.map((_, floor) => floor < 18));
    const attempts = run.summaryDiagnostics.read(getChatIdentity(host.context)).attempts;
    assert.equal(attempts[0].outcome, 'no_content');
    assert.equal(attempts[1].stage, 'preparation');
    assert.equal(attempts[1].saveState, 'unconfirmed');
    assert.equal(attempts[2].stage, 'saving');
    assert.equal(attempts[2].saveState, 'unconfirmed');
});

// Acceptance: stop frees this run while independent consistency/IO work continues.
// Cost: locked retry entry, cross-chat late results, or duplicate model requests.
for (const stage of ['source', 'writer']) {
    test(`stop during ${stage} preparation frees the manual run before independent work settles`, async t => {
        await importFixture();
        let finish, entered, requests = 0;
        const pending = new Promise(resolve => { finish = resolve; });
        const started = new Promise(resolve => { entered = resolve; });
        let completed = false;
        const writing = vectorWrites.runVectorWriteTask({ chatId: host.context.chatId, scope: vectorWrites.VECTOR_WRITE_SCOPES.IO }, async () => {
            entered(); await pending; completed = true;
        });
        t.after(async () => { finish(); await writing; });
        await started;
        const run = summaryExecutionHarness({
            synchronizeCurrentSources: stage === 'source' ? () => writing : async () => {},
            runSummaryGeneration: async () => { requests++; return { success: true }; },
        });
        const generate = run.handleManualGenerate;
        const first = generate(23, {});
        await nextTurn();
        await run.handleFrameMessage({ data: { type: 'REQUEST_CANCEL' } });
        await nextTurn();
        assert.equal(run.isRunning(), false);
        assert.equal(completed, false);
        assert.equal(requests, 0);
        await first;
        assert.equal(run.summaryDiagnostics.read(getChatIdentity(host.context)).attempts[0].outcome, 'cancelled');
        // Another request owns a new run while the cancelled waiter remains pending.
        const second = generate(23, {});
        await nextTurn();
        assert.equal(run.isRunning(), true);
        finish(); await writing; await second;
        assert.equal(requests, 1);
        assert.equal(run.isRunning(), false);
        assert.equal(run.messages.some(message => message.type === 'SUMMARY_ERROR'), false);
    });
}

test('a cancelled source waiter logs a late failure without touching the new chat or run', async () => {
    await importFixture();
    let rejectSource;
    const source = new Promise((_resolve, reject) => { rejectSource = reject; });
    const run = summaryExecutionHarness({ synchronizeCurrentSources: () => source });
    const first = run.handleManualGenerate(23, {});
    await nextTurn();
    run.cancelActiveSummaryExecution();
    host.context = { ...host.context, chatId: 'another-chat' };
    await first;
    const messageCount = run.messages.length;
    const error = new Error('independent source repair failed');
    rejectSource(error);
    await nextTurn();
    assert.equal(run.isRunning(), false);
    assert.equal(run.messages.length, messageCount);
    assert.ok(run.errors.includes(error));
});

test('reconfirmation publishes the saved range even when the remaining-range request fails', async () => {
    await importFixture();
    host.context.chat.push(...Array.from({ length: 4 }, (_, i) => ({ mes: `new ${i}`, is_user: i % 2 === 0 })));
    const visibility = memoryVisibility();
    const run = summaryExecutionHarness({ applyHideState: visibility.applyHideState });
    host.mode = 'read_fail';
    let requests = 0;
    host.generate = async () => {
        requests++;
        return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '继续出发', isState: false }] });
    };
    await run.handleManualGenerate(27, { trigger: { delayFloors: 0, maxPerRun: 2 } });
    assert.equal(mod.getMemoryCommitState(), 'unconfirmed');
    const next = mod.readSummaryMemory(), writes = host.writes;
    host.mode = 'save';
    host.generate = async request => {
        requests++;
        assert.equal(request.newHistoryText, mod.buildIncrementalSlice(27, 25, 2, 0).text);
        throw new Error('provider offline');
    };
    const messageCount = run.messages.length;
    await run.handleManualGenerate(27, { trigger: { delayFloors: 0, maxPerRun: 2 } });
    const recovery = run.messages.slice(messageCount);
    assert.equal(recovery.find(message => message.type === 'SUMMARY_FULL_DATA')?.payload.lastSummarizedMesId, 25);
    assert.equal(recovery.find(message => message.type === 'SUMMARY_BASE_DATA')?.stats.hiddenCount, 20);
    assert.deepEqual(mod.readPublishedSummaryMemory(), next);
    assert.equal(requests, 2);
    assert.equal(host.writes, writes);
    assert.equal(run.isRunning(), false);
});

for (const switchTarget of ['chat', 'character']) test(`late generation failure after a ${switchTarget} switch does not report into or cancel from the new chat`, async () => {
    await importFixture();
    host.context.chat.push({ mes: 'new question', is_user: true }, { mes: 'new answer', is_user: false });
    let rejectRequest;
    host.generate = () => new Promise((_resolve, reject) => { rejectRequest = reject; });
    const run = summaryExecutionHarness();
    const owner = getChatIdentity(host.context);
    const generating = run.handleManualGenerate(25, { trigger: { delayFloors: 0 } });
    while (!rejectRequest) await nextTurn();
    host.context = { ...host.context, ...(switchTarget === 'chat' ? { chatId: 'another-chat' }
        : { characterId: 1, characters: [...host.context.characters, { avatar: 'another-character.png' }] }) };
    run.notifySummaryState();
    assert.equal(run.messages.at(-1).isGenerating, false);
    const messageCount = run.messages.length;
    await run.handleFrameMessage({ data: { type: 'REQUEST_CANCEL' } });
    assert.equal(run.messages.length, messageCount);
    rejectRequest(new Error('late failure'));
    await generating;
    assert.equal(run.messages.slice(messageCount).some(message => message.type === 'SUMMARY_ERROR' || message.type === 'SUMMARY_STATUS'), false);
    assert.equal(run.isRunning(), false);
    assert.equal(run.summaryDiagnostics.read(getChatIdentity(host.context)).total, 0);
    assert.equal(run.summaryDiagnostics.read(owner).attempts[0].outcome, 'cancelled');
});

test('same-chat reload preserves every persisted L0/L1 row and extraction receipt with zero writes', async t => {
    await importFixture(); await seedAnchors();
    const context = host.context;
    await seedCacheRange(context.chatId, [0, 1, 2, 3]);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(context);
    const beforeMemory = mod.readSummaryMemory();
    const beforeTables = await Promise.all(mod.db.tables.map(table => table.toArray()));
    const saves = host.writes, writes = observeCacheWrites(t);
    context.chat.splice(0, context.chat.length, ...structuredClone(context.chat));
    host.metadata = structuredClone(host.files.get(context.chatId));
    mod.reload();
    tracker.switchChat(context);
    assert.equal((await mod.synchronizeSourceCaches(tracker, context)).status, 'unchanged');
    assert.deepEqual(mod.readSummaryMemory(), beforeMemory);
    assert.deepEqual(await Promise.all(mod.db.tables.map(table => table.toArray())), beforeTables);
    assert.equal(host.writes, saves);
    assert.equal(writes(), 0);
});



for (const failure of ['cache', 'save']) test(`source safety depends on cache cleanup, not an extra ${failure} save`, async t => {
    await seedAnchors();
    await seedCacheRange(host.context.chatId, [0, 1, 2, 3]);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    host.context.chat[0].mes += ' changed';
    if (failure === 'cache') {
        const fail = () => { throw new Error('storage unavailable'); };
        mod.chunkVectorsTable.hook('deleting', fail);
        t.after(() => mod.chunkVectorsTable.hook('deleting').unsubscribe(fail));
    } else host.mode = 'old';
    const beforeIO = { writes: host.writes, reads: host.reads };
    if (failure === 'cache') {
        await assert.rejects(mod.synchronizeSourceCaches(tracker, host.context));
        assert.ok(tracker.inspect(host.context));
        assert.equal(mod.isSummaryConsumable(ext().storySummary, host.context.chat.length), false);
    } else {
        assert.equal((await mod.synchronizeSourceCaches(tracker, host.context)).status, 'synced');
        assert.equal(tracker.inspect(host.context), null);
    }
    assert.deepEqual({ writes: host.writes, reads: host.reads }, beforeIO);
});

for (const kind of ['edit', 'swipe']) test(`queued ${kind} survives leaving and returning before the consistency writer runs`, async () => {
    await importFixture(); await seedAnchors();
    const context = host.context;
    await seedCacheRange(context.chatId, [0, 1, 2, 3]);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(context);
    context.chat[1].mes += ' changed';
    mod.retainSourceChange(tracker, context, { kind, floor: 1 });
    const other = { chatId: 'other', chat: [] };
    tracker.switchChat(other);
    assert.equal((await mod.synchronizeSourceCaches(tracker, other, { kind, floor: 1, isCurrent: () => false })).status, 'stale');
    tracker.switchChat(context);
    const result = await mod.synchronizeSourceCaches(tracker, context);
    assert.equal(await mod.chunksTable.where('[chatId+floor]').equals([context.chatId, 1]).count(), 0);
    // The explicit edit or swipe crossed the imported baseline. Keep it available for recovery.
    assert.equal(result.status, 'failed');
    assert.ok(tracker.inspect(context));
    assert.equal(ext().storySummary.sourceRollbackFromFloor, 1);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, undefined);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, context.chat.length), false);
    assert.deepEqual(disk(), ext());
});

function cardEntry() {
    const noop = () => {};
    return entry(['kitchenCardMemory', 'extractSummaryImportJson', 'cloneSummaryJsonForPortability',
        'normalizePortableFact', 'normalizeInternalFact', 'stripFloorMarker'], {
        ...mod, structuredClone, getContext: () => host.context, getChatIdentity, captureRangeSource,
        guard: { isAnyRunning: () => false }, cancelActiveSummaryExecution: noop,
        cancelRecallAndClearPrompt: noop,
        runVectorWriteTask: async (_options, task) => task(), VECTOR_WRITE_SCOPES: vectorWrites.VECTOR_WRITE_SCOPES,
        invalidateLexicalIndex: noop, refreshEntityLexiconAndWarmup: noop,
        sendFrameBaseData: noop, sendFrameFullData: noop, notifyStorySummaryChatState: noop,
    });
}

for (const order of ['event-first', 'background-first']) for (const sameText of [false, true]) test(`${order}: a selected swipe change cannot leave imported L2 consumable (same text: ${sameText})`, async () => {
    await importFixture(); await seedAnchors();
    const context = host.context;
    context.chat[1].swipe_id = 0;
    const tracker = mod.createMessageSourceTracker(); tracker.reset(context);
    context.chat[1].swipe_id = 1;
    if (!sameText) context.chat[1].mes += ' selected another branch';
    const first = await mod.synchronizeSourceCaches(tracker, context, order === 'event-first' ? { kind: 'swipe', floor: 1 } : {});
    assert.equal(first.status, 'failed');
    assert.equal(mod.isSummaryConsumable(ext().storySummary, context.chat.length), false);
    assert.equal((await mod.synchronizeSourceCaches(tracker, context, { kind: 'swipe', floor: 1 })).status, 'failed');
    assert.equal(ext().storySummary.sourceRollbackFromFloor, 1);
    assert.deepEqual(disk(), ext());
});

for (const generated of [false, true]) test(`unselected swipe deletion preserves the branch and the subsequent explicit edit invalidates its actual floor (generated: ${generated})`, async t => {
    await importFixture(); await seedAnchors();
    const context = host.context;
    if (generated) {
        context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
        host.generate = async () => JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '共同出发', isState: false }] });
        await mod.runSummaryGeneration(25, { trigger: { delayFloors: 0 } });
    }
    const floor = generated ? 25 : 1;
    await seedCacheRange(context.chatId, [floor]);
    const message = context.chat[floor];
    message.swipes = ['unused', message.mes]; message.swipe_id = 1;
    const tracker = mod.createMessageSourceTracker(); tracker.reset(context);
    const before = structuredClone(ext().storySummary);
    const metadataWrites = host.writes, cacheWrites = observeCacheWrites(t);
    message.swipes.splice(0, 1); message.swipe_id = 0;
    tracker.observeSwipeDeleted(context, { messageId: floor, swipeId: 0 });
    assert.equal(host.writes, metadataWrites);
    assert.equal(cacheWrites(), 0);
    // No intervening inspect/sync: the edit must not disguise the renumbering as a branch replacement.
    message.mes += ' ordinary edit'; message.swipes[0] = message.mes;
    assert.equal((await mod.synchronizeSourceCaches(tracker, context, { kind: 'edit', floor })).status, generated ? 'synced' : 'failed');
    if (generated) assert.equal(ext().storySummary.lastSummarizedMesId, 23);
    else {
        assert.deepEqual(ext().storySummary.json, before.json);
        assert.equal(ext().storySummary.sourceRollbackFromFloor, floor);
    }
    assert.equal(mod.isSummaryConsumable(ext().storySummary, context.chat.length), generated);
    assert.equal(await mod.chunksTable.where('[chatId+floor]').equals([context.chatId, floor]).count(), 0);
    assert.equal(host.writes, metadataWrites + 1);
    await context.saveMetadata();
    assert.deepEqual(disk(), ext());
});

// Verified native contracts: 1.14 loads the replacement before deletion notification
// and then reloads; 1.18 notifies first, then loads it and emits MESSAGE_SWIPED.
for (const order of ['body-before-notice', 'body-after-notice']) for (const sameText of [false, true]) {
    test(`selected swipe deletion rolls generated L2 back once (${order}, same text: ${sameText})`, async () => {
        await importFixture();
        const baselineFacts = structuredClone(ext().storySummary.json.facts);
        const context = host.context;
        context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
        host.generate = async () => JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '共同出发', isState: false }] });
        await mod.runSummaryGeneration(25, { trigger: { delayFloors: 0 } });
        assert.equal(ext().storySummary.lastSummarizedMesId, 25);
        assert.ok(ext().storySummary.json.facts.some(fact => fact.p === '行程' && fact.o === '共同出发'));
        const message = context.chat[25];
        message.swipes = [message.mes, sameText ? message.mes : '独自留下']; message.swipe_id = 0;
        const tracker = mod.createMessageSourceTracker(); tracker.reset(context);
        message.swipes.splice(0, 1);
        if (order === 'body-before-notice') message.mes = message.swipes[0];
        tracker.observeSwipeDeleted(context, { messageId: 25, swipeId: 0 });
        assert.equal((await mod.synchronizeSourceCaches(tracker, context)).status, 'synced');
        assert.equal(ext().storySummary.lastSummarizedMesId, 23);
        assert.deepEqual(ext().storySummary.json.facts, baselineFacts);
        const rolledBack = structuredClone(ext().storySummary);
        if (order === 'body-after-notice') {
            message.mes = message.swipes[0];
            await mod.synchronizeSourceCaches(tracker, context, { kind: 'swipe', floor: 25 });
        } else {
            context.chat = structuredClone(context.chat);
            tracker.switchChat(context);
        }
        assert.equal(tracker.inspect(context), null);
        assert.deepEqual(ext().storySummary, rolledBack);
        assert.deepEqual(disk(), ext());
    });
}

for (const kind of ['swipe', 'delete']) for (const stage of ['queued', 'failed']) for (const action of ['card', 'clear']) test(`confirmed ${action} resolves ${stage} ${kind} rollback intent without confirming source caches`, async () => {
    await importFixture(); await seedAnchors();
    const context = host.context;
    await seedCacheRange(context.chatId, [0, 1, 2, 3]);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(context);
    if (kind === 'swipe') context.chat[1].mes += ' swiped';
    else context.chat.splice(1, 1);
    mod.retainSourceChange(tracker, context, { kind, floor: 1 });
    if (stage === 'failed') assert.equal((await mod.synchronizeSourceCaches(tracker, context)).status, 'failed');
    // Explicit recovery can follow a queued, cancelled or failed consistency task.
    const sourceBasis = tracker.capture(context);
    let imported;
    if (action === 'card') {
        const summary = { ...mod.SUMMARY_MEMORY_PACKAGE,
            data: { facts: [{ 人物名字: '夏实', 种类: '去向', 描述: '导入后确认的新路线' }] } };
        await cardEntry().kitchenCardMemory().write(transaction => transaction.commit({
            source: { digest: 'different-chat', length: 1 },
            memory: { storySummary: {}, stateAtoms: [], l0Index: {} }, summary,
        }, 'replacement-branch', () => {}));
        imported = structuredClone(mod.readSummaryMemory().storySummary.json);
    } else await mod.clearSummaryData(context.chatId);
    tracker.resolveRollback(sourceBasis, context);
    assert.ok(tracker.inspect(context));
    assert.equal((await mod.synchronizeSourceCaches(tracker, context, { kind, floor: 1 })).status, 'synced');
    assert.equal(tracker.inspect(context), null);
    assert.equal(await mod.chunksTable.where('[chatId+floor]').equals([context.chatId, 1]).count(), 0);
    assert.ok(ext().stateAtoms.every(atom => atom.floor !== 1));
    assert.equal(ext().storySummary.sourceInvalidFromFloor, undefined);
    assert.equal(ext().storySummary.sourceRollbackFromFloor, undefined);
    if (action === 'card') {
        assert.equal(mod.isSummaryConsumable(ext().storySummary, context.chat.length), true);
        assert.deepEqual(ext().storySummary.json, imported);
    }
    assert.deepEqual(disk(), ext());
});

test('tail invalidation preserves other chats and earlier floors, with a matching durable L1 boundary', async () => {
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 5, 22, 23]);
    await seedCacheRange('other-chat', [22, 23]);
    host.mutations = [];
    assert.equal(await mod.deleteStateVectorsFromFloor(chatId, 22), 2);
    assert.deepEqual(await mod.deleteChunksFromFloor(chatId, 22), { deletedCount: 2, boundaryChanged: true, lastChunkFloor: 21 });
    assert.deepEqual((await mod.chunksTable.where('chatId').equals(chatId).toArray()).map(row => row.floor).sort((a, b) => a - b), [0, 5]);
    assert.deepEqual((await mod.stateVectorsTable.where('chatId').equals(chatId).toArray()).map(row => row.floor).sort((a, b) => a - b), [0, 5]);
    assert.equal(await mod.chunkVectorsTable.where('chatId').equals(chatId).count(), 2);
    for (const table of [mod.chunksTable, mod.chunkVectorsTable, mod.stateVectorsTable]) {
        assert.equal(await table.where('chatId').equals('other-chat').count(), 2);
    }
    const meta = await mod.metaTable.get(chatId);
    assert.equal(meta.lastChunkFloor, 21);
    assert.equal(meta.fingerprint, 'test');
    assert.ok(host.mutations.every(change => change.chatId === chatId));
});

for (const failureStage of ['vectors', 'boundary']) test(`L1 range deletion rolls back all tables when ${failureStage} fail`, async t => {
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [20, 22, 23]);
    const before = await Promise.all(mod.db.tables.map(table => table.toArray()));
    host.mutations = [];
    const fail = () => { throw new Error('fixture storage failure'); };
    const table = failureStage === 'vectors' ? mod.chunkVectorsTable : mod.metaTable;
    const event = failureStage === 'vectors' ? 'deleting' : 'updating';
    table.hook(event, fail);
    t.after(() => table.hook(event).unsubscribe(fail));
    await assert.rejects(mod.deleteChunksFromFloor(chatId, 22));
    assert.deepEqual(await Promise.all(mod.db.tables.map(table => table.toArray())), before);
    assert.deepEqual(host.mutations, []);
});

test('empty invalidation does not write, create metadata or announce cache changes', async t => {
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 5], 5);
    const originalMeta = await mod.metaTable.get(chatId);
    host.mutations = [];
    const writes = observeCacheWrites(t);
    for (const owner of [chatId, 'missing-chat']) {
        assert.equal(await mod.deleteStateVectorsFromFloor(owner, 22), 0);
        assert.deepEqual(await mod.deleteChunksFromFloor(owner, 22), {
            deletedCount: 0, boundaryChanged: false, lastChunkFloor: owner === chatId ? 5 : -1,
        });
    }
    assert.equal(writes(), 0);
    assert.deepEqual(await mod.metaTable.get(chatId), originalMeta);
    assert.equal(await mod.metaTable.get('missing-chat'), undefined);
    assert.deepEqual(host.mutations, []);
});

test('L1 boundary rewinds even when a processed range contains no chunks', async () => {
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0], 23);
    host.mutations = [];
    assert.deepEqual(await mod.deleteChunksFromFloor(chatId, 22), { deletedCount: 0, boundaryChanged: true, lastChunkFloor: 21 });
    assert.equal((await mod.metaTable.get(chatId)).lastChunkFloor, 21);
    assert.equal(host.mutations.length, 1);
});

test('ordinary tail edits without affected memory do not add a memory save or readback', async t => {
    await importFixture(); await seedAnchors();
    const before = mod.readSummaryMemory(), saves = host.writes, reads = host.reads;
    const cacheWrites = observeCacheWrites(t);
    host.mutations = [];
    host.context.chat[22].mes = 'edited user text';
    await mod.rollbackSummaryIfNeeded({ invalidateFloors: [22, 23] });
    await mod.deleteChunksAtFloor(host.context.chatId, 22);
    assert.deepEqual(mod.readSummaryMemory(), before);
    assert.equal(host.writes, saves);
    assert.equal(host.reads, reads);
    assert.equal(cacheWrites(), 0);
    assert.deepEqual(host.mutations, []);
});

test('an empty extraction status is retired live and persisted by the next host save', async () => {
    await importFixture();
    const memory = mod.readSummaryMemory();
    memory.l0Index.byFloor[23] = { floor: 23, status: 'empty', atoms: 0 };
    await mod.commitSummaryMemory(host.context.chatId, memory);
    const saves = host.writes;
    await mod.rollbackSummaryIfNeeded({ invalidateFloors: [22, 23] });
    assert.equal(host.writes, saves);
    assert.equal(ext().l0Index.byFloor[23], undefined);
    await host.context.saveMetadata();
    assert.deepEqual(disk(), ext());
});

test('ordinary edit preserves later memory/vectors and retires only the affected anchor history', async () => {
    await importFixture(); await seedAnchors();
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 1, 3, 22, 23]);
    await seedCacheRange('other', [1, 3]);
    const before = structuredClone(ext());
    await mod.rollbackSummaryIfNeeded({ invalidateFloors: [1] });
    await mod.deleteChunksAtFloor(chatId, 1);
    assert.deepEqual(ext().stateAtoms, before.stateAtoms.filter(atom => atom.floor !== 1));
    assert.deepEqual(ext().storySummary.json, before.storySummary.json);
    assert.equal(ext().l0Index.byFloor[1], undefined);
    for (const table of [mod.chunksTable, mod.stateVectorsTable]) {
        assert.deepEqual((await table.where('chatId').equals(chatId).toArray()).map(row => row.floor).sort((a, b) => a - b), [0, 3, 22, 23]);
        assert.equal(await table.where('chatId').equals('other').count(), 2);
    }
    assert.equal(await mod.chunkVectorsTable.where('chatId').equals(chatId).count(), 4);
    assert.equal((await mod.metaTable.get(chatId)).lastChunkFloor, 0);
    await host.context.saveMetadata();
    assert.deepEqual(disk(), ext());
});

for (const failureStage of ['vectors', 'boundary']) test(`local edit invalidation is atomic on ${failureStage} failure`, async t => {
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 1, 3]);
    const before = await Promise.all(mod.db.tables.map(table => table.toArray()));
    host.mutations = [];
    const table = failureStage === 'vectors' ? mod.chunkVectorsTable : mod.metaTable;
    const event = failureStage === 'vectors' ? 'deleting' : 'updating';
    const fail = () => { throw new Error('fixture storage failure'); };
    table.hook(event, fail);
    t.after(() => table.hook(event).unsubscribe(fail));
    await assert.rejects(mod.deleteChunksAtFloor(chatId, 1));
    assert.deepEqual(await Promise.all(mod.db.tables.map(table => table.toArray())), before);
    assert.deepEqual(host.mutations, []);
});

test('person records share actual summary persistence and return to the imported baseline on rollback', async () => {
    const original = await importFixture();
    const previous = mod.readSummaryMemory();
    const next = structuredClone(previous);
    const merged = mod.mergeNewData(next.storySummary.json, { storyUpdates: [
        { id: 'a', kind: 'person', name: '夏实', presence:'present', note:'等候' },
        { id: 'p1', kind: 'plan', title: '送信', description: '', status: 'open', due: '', reason: '' },
    ] }, 25, { returnMeta: true, sourceStart: 24 });
    next.storySummary.json = merged.json; next.storySummary.lastSummarizedMesId = 25;
    mod.addSummarySnapshot(next.storySummary, 23, 25, merged.undo);
    host.context.chat.push({ mes: '次日到渡口', is_user: true }, { mes: '等待信使' });
    await mod.commitSummaryMemory(host.context.chatId, next, { previous });
    assert.equal(disk().storySummary.json.storyRecords[0]._sourceStart, 24);
    host.metadata = structuredClone(host.metadata); mod.reload();
    assert.equal((await mod.rollbackSummaryOnce(host.context.chatId)).success, true);
    assert.deepEqual(ext().storySummary.json.storyRecords, []);
    assert.deepEqual(ext().storySummary.json.facts, original.facts);
    assert.deepEqual(disk(), ext());
});

test('upstream import boundary converts once; corrupt exact inverse cannot become a baseline', () => {
    const oldImport = [{ endMesId: 23 }];
    const upgraded = mod.upgradeSummaryHistory(oldImport);
    assert.equal(upgraded.value[0].kind, 'baseline');
    assert.equal(mod.getRollbackOnceTargetEndMesId({ lastSummarizedMesId: 23, summaryHistory: upgraded.value }), null);
    assert.throws(() => mod.upgradeSummaryHistory([{ format: 1, previousEndMesId: -1, endMesId: 23, undo: { version: 1, unknown: true } }]));
});

test('source replacement across baseline preserves imported content and persists only source invalidity', async () => {
    const original = await importFixture(); await seedAnchors();
    host.context.chat[20].mes = 'changed';
    const result = await mod.rollbackSummaryIfNeeded({ changedFromFloor: 20 });
    assert.equal(result.reason, 'source_boundary_invalid');
    assert.deepEqual(ext().storySummary.json, original);
    assert.equal(ext().storySummary.sourceRollbackFromFloor, 20);
    assert.equal(ext().storySummary.summaryInvalid, undefined);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, 24), false);
    assert.deepEqual(disk(), ext());
});

test('source stays blocked when both rollback and safety-marker saves are confirmed not saved', async () => {
    await importFixture();
    host.mode = 'old';
    await assert.rejects(mod.rollbackSummaryIfNeeded({ changedFromFloor: 20 }), { code: 'metadata_not_saved' });
    assert.equal(mod.getMemoryCommitState(), 'source_invalid');
    assert.equal(mod.isSummaryConsumable(ext().storySummary, 24), false);
    assert.equal(ext().storySummary.summaryInvalid, undefined);
    host.mode = 'save';
    await mod.clearSummaryData(host.context.chatId);
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

test('ordinary source edit with failed vector cleanup blocks old anchors without corrupting history', async t => {
    await importFixture(); await seedAnchors();
    const original = structuredClone(ext().storySummary.json);
    const cacheFailure = t.mock.method(mod.stateVectorsTable, 'where', () => { throw new Error('cache offline'); });
    host.context.chat[1].mes = 'edited source';
    await assert.rejects(mod.rollbackSummaryIfNeeded({ invalidateFromFloor: 1 }), { code: 'memory_cache_invalidation_failed' });
    assert.deepEqual(ext().storySummary.json, original);
    assert.equal(ext().storySummary.summaryInvalid, undefined);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, 1);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, 24), false);
    await host.context.saveMetadata();
    assert.deepEqual(disk(), ext());
    cacheFailure.mock.restore();
    ext().storySummary = { ...(ext().storySummary || {}), floorWork: { 1: { done: ['memory'] } } };
    await mod.clearSummaryData(host.context.chatId);
    assert.equal(ext().stateAtoms.length, 0);
    assert.equal(ext().storySummary?.floorWork, undefined);
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

test('ordinary source edit never calls a failing host save', async () => {
    await importFixture(); await seedAnchors();
    host.mode = 'old';
    const beforeIO = { writes: host.writes, reads: host.reads };
    host.context.chat[1].mes = 'edited source';
    assert.equal((await mod.rollbackSummaryIfNeeded({ invalidateFromFloor: 1 })).status, 'not_needed');
    assert.deepEqual({ writes: host.writes, reads: host.reads }, beforeIO);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, 24), true);
    host.mode = 'save';
    await mod.clearSummaryData(host.context.chatId);
    assert.equal(ext().stateAtoms.length, 0);
    assert.deepEqual(ext().l0Index.byFloor, {});
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

test('a local L1 cleanup failure preserves L2 but cannot restore the retired anchor', async t => {
    await importFixture(); await seedAnchors();
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 1, 3]);
    const before = structuredClone(ext());
    const fail = () => { throw new Error('L1 storage offline'); };
    mod.chunkVectorsTable.hook('deleting', fail);
    t.after(() => mod.chunkVectorsTable.hook('deleting').unsubscribe(fail));
    await assert.rejects(mod.rollbackSummaryIfNeeded({ invalidateFloors: [1],
        invalidateSourceCache: () => mod.deleteChunksAtFloor(chatId, 1) }));
    assert.deepEqual(ext().stateAtoms, before.stateAtoms.filter(atom => atom.floor !== 1));
    assert.deepEqual(ext().storySummary.json, before.storySummary.json);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, 1);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, 24), false);
    await host.context.saveMetadata();
    assert.deepEqual(disk(), ext());
    mod.chunkVectorsTable.hook('deleting').unsubscribe(fail);
    await mod.clearSummaryData(chatId);
    assert.deepEqual((await mod.chunksTable.where('chatId').equals(chatId).toArray()).map(row => row.floor), [0]);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, undefined);
    assert.equal(ext().storySummary.sourceRollbackFromFloor, undefined);
    assert.deepEqual(disk(), ext());
});

async function generatedSourceRecoveryFixture() {
    const baseline = await importFixture(); await seedAnchors();
    host.context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
    host.generate = async () => JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '共同出发', isState: false }] });
    await mod.runSummaryGeneration(25, { trigger: { delayFloors: 0 } });
    return baseline;
}

function reloadSourceRecovery() {
    host.metadata = structuredClone(host.files.get(host.context.chatId));
    host.context.chat = structuredClone(host.context.chat);
    mod.reload(); mod.getSummaryStore();
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    assert.equal(tracker.inspect(host.context), null); // No old page-local observation survives.
}

for (const crossedBaseline of [false, true]) test(`confirmed tail recovery keeps a verified prefix and catches up to the latest reply (crossed import: ${crossedBaseline})`, async () => {
    const base = await generatedSourceRecoveryFixture(), { chat, chatId } = host.context;
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    const edit = mod.readSummaryMemory(), store = edit.storySummary;
    store.dataBranch = 'branch-a';
    const fw2 = { source: captureRangeSource(chat, 1, 2), done: ['memory'] };
    const fw25 = { source: captureRangeSource(chat, 24, 25), done: ['memory'] };
    store.floorDrafts = { 2: { text: '前段草稿' }, 25: { text: '失效草稿' } };
    store.floorWork = { 2: fw2, 25: fw25 };
    store.summaryHistory.at(-1).compressionNodes = [{ start: 24, end: 25, text: '旧尾段' }];
    store.json.facts.find(fact => fact.p === '行程').o = '与旧撤销记录冲突';
    await mod.commitSummaryMemory(chatId, edit);
    const sibling = structuredClone(ext()); host.files.set('branch-b', structuredClone(sibling));
    await seedCacheRange(chatId, [1, 25]);
    await seedCacheRange('branch-b', [1, 25]);
    const changed = crossedBaseline ? 20 : 24;
    chat[changed].mes = '改道后走北门';
    chat.push({ mes: '随后', is_user: true }, { mes: '新到达', is_user: false });
    const blocked = await mod.synchronizeSourceCaches(tracker, host.context, { kind: 'edit', floor: changed });
    assert.equal(blocked.result.reason, crossedBaseline ? 'source_boundary_invalid' : 'history_discontinuous');
    assert.equal(mod.isSummaryConsumable(ext().storySummary, chat.length), false);
    const recovery = mod.summaryRecoveryPreview(), from = crossedBaseline ? 0 : 24;
    assert.equal(recovery.fromFloor, from);
    const run = summaryExecutionHarness({ messageSources: tracker, prepareSummaryRecovery: async () => () => {},
        removeDocumentsFromFloor() {}, synchronizeCurrentSources: () => mod.synchronizeSourceCaches(tracker, host.context) });
    let calls = 0;
    host.generate = async () => {
        if (calls++ === 0) {
            const saved = disk().storySummary;
            assert.equal(saved.lastSummarizedMesId, from - 1);
            assert.deepEqual(saved.json, crossedBaseline ? null : base);
            assert.deepEqual(saved.floorDrafts, crossedBaseline ? undefined : { 2: { text: '前段草稿' } });
            assert.deepEqual(saved.floorWork, crossedBaseline ? undefined : { 2: fw2 });
            assert.equal(saved.summaryHistory.some(batch => batch.compressionNodes), false);
            assert.equal(saved.sourceInvalidFromFloor, undefined);
            assert.equal(saved.sourceRollbackFromFloor, undefined);
            assert.equal(saved.summaryInvalid, undefined);
            assert.deepEqual((await mod.getAllStateVectors(chatId)).map(row => row.floor), crossedBaseline ? [] : [1]);
            assert.deepEqual((await mod.chunksTable.where('chatId').equals(chatId).toArray()).map(row => row.floor), crossedBaseline ? [] : [1]);
        }
        return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '北门', isState: false }] });
    };
    await run.handleManualGenerate(27, { trigger: { maxPerRun: 2, delayFloors: 0 } }, recovery);
    assert.deepEqual(run.errors.map(error => error.message), []);
    assert.equal(calls, (28 - from) / 2);
    assert.equal(disk().storySummary.lastSummarizedMesId, 27);
    assert.equal(disk().storySummary.dataBranch, 'branch-a');
    assert.deepEqual(disk(), ext());
    assert.deepEqual(host.files.get('branch-b'), sibling);
    assert.equal(await mod.chunksTable.where('chatId').equals('branch-b').count(), 2);
    assert.equal(mod.summaryRecoveryPreview(), null);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, chat.length), true);
});

test('stale recovery confirmation, world conflict and cache-only failure never discard summary history', async () => {
    await importFixture();
    const { chat, chatId } = host.context;
    mod.noteInvalidMemorySource(1);
    assert.equal(mod.summaryRecoveryPreview(), null);
    await mod.rollbackSummaryIfNeeded({ changedFromFloor: 20 });
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    const before = structuredClone(disk()), preview = mod.summaryRecoveryPreview();
    chat[2].mes += '另一处修改';
    await assert.rejects(mod.recoverSummaryTail(chatId, preview.token), /恢复范围已变化/);
    const run = summaryExecutionHarness({ messageSources: tracker, prepareSummaryRecovery: async () => { throw Error('请到世界版本与恢复核对'); } });
    await run.handleManualGenerate(23, {}, mod.summaryRecoveryPreview());
    assert.match(run.messages.find(message => message.type === 'SUMMARY_ERROR').message, /世界版本与恢复/);
    assert.deepEqual(disk(), before);
    assert.deepEqual(ext(), before);
});

test('older imports without a checkpoint recover their confirmed fields from complete before-values', async () => {
    const base = await generatedSourceRecoveryFixture(), previous = mod.readSummaryMemory();
    delete previous.storySummary.summaryHistory[0].baseJson;
    previous.storySummary.json.facts.find(fact => fact.p === '行程').o = '在已失效的后续批次修改';
    await mod.commitSummaryMemory(host.context.chatId, previous);
    host.context.chat[24].mes = '取消本轮行程';
    assert.equal((await mod.rollbackSummaryIfNeeded({ changedFromFloor: 24 })).reason, 'history_discontinuous');
    const preview = mod.summaryRecoveryPreview();
    assert.equal(preview.fromFloor, 24);
    await mod.recoverSummaryTail(host.context.chatId, preview.token);
    assert.deepEqual(disk().storySummary.json, base);
    assert.equal(disk().storySummary.lastSummarizedMesId, 23);
});

for (const recovery of ['same-page', 'reload', 'runtime-only']) test(`ordinary edit cleanup failure retries without L2 undo: ${recovery}`, async t => {
    await generatedSourceRecoveryFixture();
    const before = structuredClone(ext().storySummary);
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 1, 3, 25]);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    host.context.chat[1].mes += ' ordinary correction';
    const fail = () => { throw new Error('L1 storage unavailable'); };
    mod.chunkVectorsTable.hook('deleting', fail);
    t.after(() => mod.chunkVectorsTable.hook('deleting').unsubscribe(fail));
    if (recovery === 'runtime-only') host.mode = 'old';
    await assert.rejects(mod.synchronizeSourceCaches(tracker, host.context));
    assert.deepEqual(ext().storySummary.json, before.json);
    mod.chunkVectorsTable.hook('deleting').unsubscribe(fail);
    host.mode = 'save';
    if (recovery === 'reload') {
        await host.context.saveMetadata(); // The host persists the pending cleanup boundary, not the plugin.
        reloadSourceRecovery();
        assert.equal((await mod.rollbackSummaryIfNeeded()).status, 'not_needed');
    } else {
        assert.equal((await mod.synchronizeSourceCaches(tracker, host.context)).status, 'synced');
        assert.equal(tracker.inspect(host.context), null);
    }
    assert.deepEqual(ext().storySummary.json, before.json);
    assert.deepEqual(ext().storySummary.summaryHistory, before.summaryHistory);
    assert.equal(ext().storySummary.lastSummarizedMesId, before.lastSummarizedMesId);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, undefined);
    assert.equal(ext().storySummary.sourceRollbackFromFloor, undefined);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, host.context.chat.length), true);
    assert.deepEqual((await mod.chunksTable.where('chatId').equals(chatId).toArray()).map(row => row.floor), [0]);
    assert.equal((await mod.getAllStateVectors(chatId)).some(vector => vector.floor === 1), false);
    await host.context.saveMetadata();
    assert.deepEqual(disk(), ext());
});

for (const mixed of [false, true]) test(`failed real swipe remains recoverable after reload without over-rolling L2 (earlier cache failure: ${mixed})`, async t => {
    const baseline = await generatedSourceRecoveryFixture();
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 1, 3, 25]);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    const failure = t.mock.method(mod.stateVectorsTable, 'where', () => { throw new Error('state cache offline'); });
    if (mixed) {
        host.context.chat[1].mes += ' earlier ordinary edit';
        await assert.rejects(mod.synchronizeSourceCaches(tracker, host.context));
    }
    host.context.chat[25].swipe_id = 1;
    assert.equal((await mod.synchronizeSourceCaches(tracker, host.context)).status, 'failed');
    assert.equal(ext().storySummary.lastSummarizedMesId, 25);
    assert.equal(disk().storySummary.sourceRollbackFromFloor, 24);
    failure.mock.restore();
    reloadSourceRecovery();
    assert.equal((await mod.rollbackSummaryIfNeeded()).status, 'rolled_back');
    assert.equal(ext().storySummary.lastSummarizedMesId, 23);
    assert.deepEqual(ext().storySummary.json, baseline);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, undefined);
    assert.equal(ext().storySummary.sourceRollbackFromFloor, undefined);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, host.context.chat.length), true);
    assert.equal(await mod.chunksTable.where('[chatId+floor]').equals([chatId, mixed ? 1 : 25]).count(), 0);
    assert.deepEqual(disk(), ext());
});

test('an imported baseline retains the actual swipe boundary after reload without re-clearing healthy caches', async () => {
    const original = await importFixture();
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 1, 3, 23]);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    host.context.chat[1].swipe_id = 1;
    assert.equal((await mod.synchronizeSourceCaches(tracker, host.context)).status, 'failed');
    assert.equal(ext().storySummary.sourceInvalidFromFloor, undefined);
    assert.equal(await mod.chunksTable.where('[chatId+floor]').equals([chatId, 3]).count(), 1);
    const cacheBefore = await Promise.all(mod.db.tables.map(table => table.toArray()));
    reloadSourceRecovery();
    const result = await mod.rollbackSummaryIfNeeded();
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'source_boundary_invalid');
    assert.equal(ext().storySummary.sourceRollbackFromFloor, 1);
    assert.deepEqual(ext().storySummary.json, original);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, host.context.chat.length), false);
    assert.deepEqual(await Promise.all(mod.db.tables.map(table => table.toArray())), cacheBefore);
    assert.deepEqual(disk(), ext());
});

test('manual L2 undo does not claim pending raw-source caches were cleaned', async () => {
    const baseline = await generatedSourceRecoveryFixture();
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 1, 3]);
    const next = mod.readSummaryMemory(); next.storySummary.sourceInvalidFromFloor = 1;
    await mod.commitSummaryMemory(chatId, next);
    assert.equal((await mod.rollbackSummaryOnce(chatId)).success, true);
    assert.deepEqual(ext().storySummary.json, baseline);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, 1);
    assert.equal(await mod.chunksTable.where('[chatId+floor]').equals([chatId, 1]).count(), 1);
    assert.equal((await mod.rollbackSummaryIfNeeded()).status, 'not_needed');
    assert.deepEqual(ext().storySummary.json, baseline);
    assert.equal(ext().storySummary.lastSummarizedMesId, 23);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, undefined);
    assert.equal(await mod.chunksTable.where('[chatId+floor]').equals([chatId, 1]).count(), 0);
    await host.context.saveMetadata();
    assert.deepEqual(disk(), ext());
});

test('saving a cache marker cannot discard an unpersisted runtime rollback boundary', async () => {
    await generatedSourceRecoveryFixture();
    host.mode = 'old';
    await assert.rejects(mod.rollbackSummaryIfNeeded({ changedFromFloor: 25 }), { code: 'metadata_not_saved' });
    host.mode = 'save';
    const cacheOnly = mod.readSummaryMemory(); cacheOnly.storySummary.sourceInvalidFromFloor = 1;
    await mod.commitSummaryMemory(host.context.chatId, cacheOnly);
    assert.equal(mod.getRuntimeSourceRollbackFloor(), 25);
    assert.equal((await mod.rollbackSummaryIfNeeded()).status, 'rolled_back');
    assert.equal(ext().storySummary.lastSummarizedMesId, 23);
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

for (const cancel of [false, true]) test(`manual summary owns cancellation while an earlier edit is saving (cancel: ${cancel})`, async () => {
    await importFixture();
    host.context.chat.push({ mes: 'new question', is_user: true }, { mes: 'new answer', is_user: false });
    const messageSources = mod.createMessageSourceTracker();
    messageSources.reset(host.context);
    let finishSave, running = false, requests = 0;
    host.afterSave = () => new Promise(resolve => { finishSave = resolve; });
    const next = mod.readSummaryMemory();
    next.storySummary.json.facts[0].o = 'edited fact';
    const saving = mod.commitSummaryMemory(host.context.chatId, next);
    while (!finishSave) await Promise.resolve();
    const messages = [], errors = [];
    const noop = () => {};
    const ui = entry(['handleFrameMessage', 'handleManualGenerate', 'ensureCurrentSources', 'waitForSummaryPreparation',
        'prepareSummaryExecution', 'runSummaryAttempt', 'assertSummaryExecutionActive', 'isSummaryExecutionActive',
        'isSummaryGenerating', 'beginSummaryExecution', 'cancelActiveSummaryExecution',
        'finishSummaryExecution', 'notifySummaryState', 'postSummaryExecution', 'reportSummaryExecutionFailure'], {
        ...mod, ...vectorWrites, messageSources, AbortController, createAbortError, throwIfSignalAborted,
        memorySaveError, SUMMARY_FEEDBACK_COPY, summaryFailureReason, activeSummaryExecution: null, currentMesId: null,
        summaryDiagnostics: createSummaryDiagnostics(), getChatIdentity, isSummaryGenerationCancelledError: () => false,
        getContext: () => host.context, document: { getElementById: noop }, isTrustedMessage: () => true,
        isStorySummaryEnabledForCurrentChat: () => true,
        isStorySummaryConsumableForCurrentChat: () => mod.isSummaryConsumable(mod.getSummaryStore(), host.context.chat.length),
        isChatStale: () => false, synchronizeCurrentSources: async () => {},
        guard: { isRunning: () => running, acquire: () => {
            if (running) return null;
            running = true;
            return () => { running = false; };
        } },
        postToFrame: message => messages.push(message), cancelPendingHide: noop, notifyStorySummaryChatState: noop,
        applyHideState: noop, replaceEventDocuments: noop, refreshEntityLexiconAndWarmup: noop,
        sendFrameFullData: noop, updateFrameStatsAfterSummary: noop, createSummaryGenerationCancelledError: createAbortError,
        reportMemorySaveFailure: error => errors.push(error),
        xbLog: { error: (_module, _text, error) => errors.push(error) }, MODULE_ID: 'summary',
        runSummaryGeneration: async () => { requests++; return { success: true, committed: false }; },
    });
    const request = ui.handleFrameMessage({ data: { type: 'REQUEST_GENERATE' } });
    await nextTurn();
    const registeredWhileSaving = running;
    const requestsWhileSaving = requests;
    if (cancel) await ui.handleFrameMessage({ data: { type: 'REQUEST_CANCEL' } });
    await nextTurn();
    const runningAfterCancel = running;
    const saveStateAfterCancel = mod.getMemoryCommitState();
    finishSave();
    await saving;
    await request;
    await nextTurn();
    assert.equal(registeredWhileSaving, true);
    assert.equal(requestsWhileSaving, 0);
    assert.equal(runningAfterCancel, !cancel);
    assert.equal(saveStateAfterCancel, 'saving');
    assert.equal(requests, cancel ? 0 : 1);
    assert.equal(running, false);
    assert.equal(messages.some(message => message.type === 'SUMMARY_ERROR'), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(disk(), next); // Stopping summary does not cancel the separate edit's save.
});

test('in-flight saves publish no draft receipt and queue another writer without overwriting it', async () => {
    await importFixture(); await seedAnchors();
    const before = mod.readPublishedSummaryMemory();
    const releases = [];
    host.afterSave = () => new Promise(resolve => releases.push(resolve));
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = 'pending';
    next.stateAtoms = [];
    const saving = mod.commitSummaryMemory(host.context.chatId, next);
    while (!releases.length) await Promise.resolve();
    let resumed = false;
    const waiting = mod.waitForMemoryCommit().then(() => { resumed = true; });
    const controller = new AbortController();
    const cancelled = mod.waitForMemoryCommit(controller.signal);
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    await Promise.resolve();
    assert.equal(resumed, false);
    assert.equal(mod.getMemoryCommitState(), 'saving');
    assert.notEqual(mod.readPublishedSummaryMemory().storySummary.json.facts[0].o, 'pending');
    assert.deepEqual(mod.getPublishedSummaryStore(), before.storySummary);
    assert.deepEqual(mod.getPublishedStateAtoms(), before.stateAtoms);
    assert.deepEqual(mod.getFacts(), before.storySummary.json.facts.filter(fact => !fact.retracted));
    // Busy is not an error: the second writer queues behind the in-flight save.
    // Fold the outcome into a value so the pre-fix code fails with a telling
    // message instead of an unhandled rejection.
    const queued = mod.commitSummaryMemory(host.context.chatId, mod.readSummaryMemory())
        .then(() => 'settled', error => `rejected:${error.code}`);
    releases.forEach(resolve => resolve());
    await saving;
    await waiting;
    for (let i = 0; i < 100 && releases.length < 2; i++) await Promise.resolve();
    assert.equal(releases.length, 2, 'the queued writer must reach its own host save');
    releases.forEach(resolve => resolve());
    assert.equal(await queued, 'settled');
    assert.equal(resumed, true);
    assert.equal(mod.readPublishedSummaryMemory().storySummary.json.facts[0].o, 'pending');
    assert.deepEqual(mod.getPublishedStateAtoms(), []);
});

test('a writer arriving during an in-flight save queues behind it instead of being rejected as busy', async () => {
    await importFixture(); await seedAnchors();
    const chatId = host.context.chatId;
    // The host save is slow (TT queues saveMetadata behind full chat saves), so the
    // first writer holds the transaction across many event-loop turns.
    const releases = [];
    host.afterSave = () => new Promise(resolve => releases.push(resolve));
    const first = mod.readSummaryMemory();
    first.storySummary.json.facts[0].o = 'first-writer';
    const saving = mod.commitSummaryMemory(chatId, first);
    while (!releases.length) await Promise.resolve(); // installed; host save in flight
    // The second writer drafts from the installed state: its payload is valid and
    // it only lost the race for the transaction, not the data.
    const second = mod.readSummaryMemory();
    second.storySummary.json.facts[0].o = 'second-writer';
    const queued = mod.commitSummaryMemory(chatId, second)
        .then(() => 'settled', error => `rejected:${error.code}`);
    releases.forEach(resolve => resolve());
    await saving;
    // Pre-fix the entry rejected the writer at this point; post-fix it is still queued.
    const early = await Promise.race([queued, Promise.resolve('still-queued')]);
    assert.equal(early, 'still-queued', 'busy is not an error: the writer must queue behind the in-flight save');
    for (let i = 0; i < 100 && releases.length < 2; i++) await Promise.resolve();
    assert.equal(releases.length, 2, 'the queued writer must reach its own host save');
    releases.forEach(resolve => resolve());
    assert.equal(await queued, 'settled');
    assert.equal(mod.readPublishedSummaryMemory().storySummary.json.facts[0].o, 'second-writer');
});

for (const mode of ['save', 'old']) test(`recall started before a ${mode} commit never follows its unpublished draft`, async () => {
    host.fixture.json.facts = [{ id:'local-test', s:'夏实', p:'性格', o:'总会先听完对方的话', _isState:true, _addedAt:1 }];
    await importFixture();
    const publishedFact = structuredClone(mod.getPublishedSummaryStore().json.facts[0]);
    const draftFact = { ...publishedFact, o: '倾向独自行动' };
    host.vectorConfig.enabled = true;
    let enterRecall, finishRecall, finishSave;
    const started = new Promise(resolve => { enterRecall = resolve; });
    const recalled = new Promise(resolve => { finishRecall = resolve; });
    host.recall = async events => {
        enterRecall();
        await recalled;
        return { events: [{ event: events[0], similarity: 1, _recallType: 'DIRECT' }], focusCharacters: [publishedFact.s] };
    };
    const borrowed = mod.getPublishedSummaryStore();
    const boundary = borrowed.lastSummarizedMesId;
    const prompt = mod.buildVectorPromptText();
    await started;
    host.mode = mode;
    host.afterSave = () => new Promise(resolve => { finishSave = resolve; });
    const next = mod.readSummaryMemory();
    next.storySummary.json.facts = [draftFact];
    next.storySummary.lastSummarizedMesId = boundary + 1;
    const saving = mod.commitSummaryMemory(host.context.chatId, next).then(() => null, error => error);
    while (!finishSave) await Promise.resolve();
    finishRecall();
    const result = await prompt;
    const assemblyState = mod.getMemoryCommitState();
    const borrowedBoundary = borrowed.lastSummarizedMesId;
    finishSave();
    const error = await saving;
    assert.equal(assemblyState, 'saving');
    // The assertions identify injected fixture data, not prompt wording.
    assert.ok(result.text.includes(publishedFact.o));
    assert.equal(result.text.includes(draftFact.o), false);
    assert.equal(borrowedBoundary, boundary);
    assert.equal(error?.code ?? null, mode === 'old' ? 'metadata_not_saved' : null);
    assert.equal(mod.getMemoryCommitState(), 'ready');
    assert.deepEqual(borrowed.json.facts, [publishedFact]);
    assert.deepEqual(mod.getPublishedSummaryStore().json.facts, [mode === 'save' ? draftFact : publishedFact]);
});

test('failed save confirmed old restores the entire previous snapshot in one place', async () => {
    await importFixture(); await seedAnchors();
    const before = structuredClone(ext());
    host.mode = 'old';
    const next = mod.prepareImportedSummary(mod.readSummaryMemory(), { events: [], facts: [] }, 23);
    await assert.rejects(mod.commitSummaryMemory(host.context.chatId, next), { code: 'metadata_not_saved', uncertain: false });
    assert.deepEqual(ext(), before);
    assert.deepEqual(disk(), before);
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

for (const mode of ['read_fail', 'different']) {
    test(`${mode}: ambiguous import never restores old memory, gates every write, and reload is read-only recovery`, async () => {
        await importFixture(); await seedAnchors();
        const before = mod.readPublishedSummaryMemory();
        host.mode = mode;
        if (mode === 'different') host.afterSave = () => { disk().storySummary.json.facts[0].o = 'external disk edit'; };
        const next = mod.prepareImportedSummary(mod.readSummaryMemory(), host.fixture.json, 23);
        next.storySummary.json.facts[0].o = 'new import';
        const reads = host.reads;
        await assert.rejects(mod.commitSummaryMemory(host.context.chatId, next), { uncertain: true });
        assert.equal(ext().storySummary.json.facts[0].o, 'new import');
        assert.equal(ext().stateAtoms.length, 0);
        assert.equal(mod.getMemoryCommitState(), 'unconfirmed');
        assert.deepEqual(mod.getPublishedSummaryStore(), before.storySummary);
        assert.deepEqual(mod.getPublishedStateAtoms(), before.stateAtoms);
        assert.deepEqual(mod.getFacts(), before.storySummary.json.facts.filter(fact => !fact.retracted));
        if (mode === 'read_fail') await assert.rejects(mod.waitForMemoryCommit(), { code: 'metadata_save_unconfirmed' });
        else await assert.rejects(mod.waitForMemoryCommit(), { code: 'metadata_save_conflict' });
        assert.throws(() => mod.assertMemoryWritable(), { uncertain: true });
        assert.equal(ext().storySummary.summaryInvalid, undefined);
        assert.equal(mod.isSummaryConsumable(ext().storySummary, 24), false);
        assert.ok(host.reads > reads);
        const writes = host.writes;
        await assert.rejects(mod.clearSummaryData(host.context.chatId), { uncertain: true });
        await assert.rejects(mod.invalidateSummaryAnchors(host.context.chatId), { uncertain: true });
        assert.throws(() => mod.createAnchorExtractionDraft(host.context.chatId, host.context.chat), { uncertain: true });
        assert.equal(host.writes, writes);
        host.metadata = structuredClone(host.files.get(host.context.chatId)); mod.reload(); mod.getSummaryStore();
        assert.equal(mod.getMemoryCommitState(), 'ready');
        assert.equal(host.writes, writes);
    });
}

test('thrown save with confirmed new disk is success, not a false rollback', async () => {
    await importFixture(); host.mode = 'throw_after';
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = 'confirmed';
    await mod.commitSummaryMemory(host.context.chatId, next);
    assert.deepEqual(disk(), ext());
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

test('concurrent manual mutation during a failed save is preserved and quarantined, never restored over', async () => {
    await importFixture(); host.mode = 'old';
    host.afterSave = () => { ext().storySummary.json.facts[1].o = 'later manual edit'; };
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = 'staged';
    await assert.rejects(mod.commitSummaryMemory(host.context.chatId, next), { uncertain: true });
    assert.equal(ext().storySummary.json.facts[1].o, 'later manual edit');
    assert.equal(mod.getMemoryCommitState(), 'unconfirmed');
});

test('draft validation and vector failure leave canonical memory unchanged and release the write gate', async () => {
    await importFixture();
    const before = structuredClone(ext());
    const writes = host.writes;
    await assert.rejects(mod.commitSummaryMemory(host.context.chatId, mod.readSummaryMemory(), {
        invalidate: async () => { throw new Error('cache unavailable'); },
    }));
    assert.deepEqual(ext(), before);
    assert.equal(host.writes, writes);
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

test('L0 results remain draft-only, merge with newer summary, but cannot overwrite an edited source', async () => {
    await importFixture();
    const extraction = mod.createAnchorExtractionDraft(host.context.chatId, host.context.chat);
    extraction.addAtoms(host.fixture.atoms.slice(0, 1)); extraction.setStatus(1, { status: 'ok', atoms: 1 });
    assert.equal(ext().stateAtoms.length, 0);
    const edit = mod.readSummaryMemory(); edit.storySummary.json.facts[0].o = '并发事实更新';
    await mod.commitSummaryMemory(host.context.chatId, edit);
    await extraction.commit();
    assert.equal(ext().storySummary.json.facts[0].o, '并发事实更新');
    const stale = mod.createAnchorExtractionDraft(host.context.chatId, host.context.chat);
    stale.setStatus(3, { status: 'empty', atoms: 0 });
    host.context.chat[2].mes = 'changed USER';
    await assert.rejects(stale.commit(), { code: 'metadata_draft_conflict' });
    assert.equal(ext().l0Index.byFloor[3], undefined);
});

// Acceptance: waiting writers must not overwrite restored data or another chat (cost: data loss).
for (const mode of ['old', 'switch']) test(`queued writer after ${mode} save preserves the settled chat`, async () => {
    await importFixture();
    const chatId = host.context.chatId;
    const baseline = mod.readSummaryMemory();
    let release;
    if (mode === 'old') host.mode = 'old';
    host.afterSave = () => new Promise(resolve => { release = resolve; });
    const first = structuredClone(baseline); first.storySummary.json.facts[0].o = 'first';
    const saving = mod.commitSummaryMemory(chatId, first).then(() => null, error => error);
    while (!release) await nextTurn();
    const second = mod.readSummaryMemory(); second.storySummary.json.facts[0].o = 'second';
    const queued = mod.commitSummaryMemory(chatId, second).then(() => null, error => error);
    if (mode === 'switch') {
        host.metadata = { extensions: { TavernKitchen: { storySummary: { json: { facts: ['other chat'] } } } } };
        host.context = { ...host.context, chatId: 'other' }; mod.reload();
    }
    release();
    await saving;
    const error = await queued;
    assert.equal(error.code, mode === 'old' ? 'metadata_draft_conflict' : 'summary_chat_changed_before_save');
    if (mode === 'switch') assert.deepEqual(ext().storySummary.json.facts, ['other chat']);
    else {
        assert.deepEqual(mod.readSummaryMemory(), baseline);
        host.mode = 'save'; host.afterSave = null;
        await mod.commitSummaryMemory(chatId, first);
        assert.equal(mod.readPublishedSummaryMemory().storySummary.json.facts[0].o, 'first');
    }
});

test('a chat switch during confirmation never restores or installs into the newly opened chat', async () => {
    await importFixture();
    const old = host.metadata;
    host.afterSave = () => {
        host.metadata = { extensions: { TavernKitchen: { storySummary: { json: { facts: ['other chat'] } } } } };
        host.context = { ...host.context, chatId: 'other' }; mod.reload();
    };
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = 'first chat';
    await mod.commitSummaryMemory(host.context.chatId, next);
    assert.equal(old.extensions.TavernKitchen.storySummary.json.facts[0].o, 'first chat');
    assert.deepEqual(ext().storySummary.json.facts, ['other chat']);
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

// Acceptance: automatic L0 adds no full-chat IO; explicit bulk work survives a slow save.
// Cost: chat stalls or silently lost manual work.
for (const persistence of ['host', 'confirmed']) test(`anchor extraction persistence is explicit: ${persistence}`, async t => {
    await importFixture();
    const beforeIO = { writes: host.writes, reads: host.reads };
    const draft = mod.createAnchorExtractionDraft(host.context.chatId, host.context.chat, { persistence });
    draft.addAtoms(host.fixture.atoms.slice(0, 1));
    draft.setStatus(1, { status: 'ok', atoms: 1 });
    let release, finished = false;
    if (persistence === 'confirmed') host.afterSave = () => new Promise(resolve => { release = resolve; });
    const writing = draft.commit().then(() => { finished = true; });
    await nextTurn();
    if (persistence === 'confirmed') {
        assert.ok(release);
        t.mock.timers.tick(30_000); await nextTurn();
        assert.equal(finished, false);
        assert.equal(host.reads, beforeIO.reads);
        release();
    }
    await writing;
    assert.equal(ext().stateAtoms.length, 1);
    assert.deepEqual({ writes: host.writes, reads: host.reads }, {
        writes: beforeIO.writes + Number(persistence === 'confirmed'),
        reads: beforeIO.reads + Number(persistence === 'confirmed'),
    });
    host.afterSave = null;
    if (persistence === 'host') {
        assert.equal(disk().stateAtoms.length, 0);
        await host.context.saveMetadata();
    }
    assert.deepEqual(disk(), ext());
});

test('an entirely superseded manual extraction is not reported as saved', async () => {
    await importFixture();
    const draft = mod.createAnchorExtractionDraft(host.context.chatId, host.context.chat, { persistence: 'confirmed' });
    draft.addAtoms(host.fixture.atoms.slice(0, 1)); draft.setStatus(1, { status: 'ok', atoms: 1 });
    let release;
    host.afterSave = () => new Promise(resolve => { release = resolve; });
    const writing = draft.commit().then(() => null, error => error.code);
    while (!release) await nextTurn();
    mod.retireSummaryMemorySources(host.context.chatId, { floors: [1] });
    release();
    assert.equal(await writing, 'metadata_source_changed');
    assert.equal(ext().stateAtoms.length, 0);
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

test('cleanup releases only the source boundary it actually handled', async t => {
    await importFixture(); await seedAnchors();
    let release;
    const cleaning = new Promise(resolve => { release = resolve; });
    const mock = t.mock.method(mod.stateVectorsTable, 'where', () => ({ between: () => ({ delete: () => cleaning }) }));
    const cleanup = mod.rollbackSummaryIfNeeded({ invalidateFromFloor: 20 });
    await nextTurn();
    mod.noteInvalidMemorySource(1);
    release(0);
    assert.equal((await cleanup).status, 'deferred');
    assert.equal(mod.getRuntimeInvalidSourceFloor(), 1);
    mock.mock.restore();
});



test('automatic preparation waits for an active save but never recovers an uncertain one', async () => {
    await importFixture();
    host.mode = 'read_fail';
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = 'awaiting confirmation';
    await assert.rejects(mod.commitSummaryMemory(host.context.chatId, next), { code: 'metadata_save_unconfirmed' });
    const beforeIO = { writes: host.writes, reads: host.reads };
    assert.equal(await mod.waitForMemoryCommit(undefined, { recover: false }), false);
    assert.equal((await mod.rollbackSummaryIfNeeded({ invalidateFloors: [1] })).status, 'deferred');
    assert.deepEqual({ writes: host.writes, reads: host.reads }, beforeIO);
});

// Acceptance: pinned native saves carry automatic metadata, without a preceding plugin save.
// Cost: lost L0 or extra whole-chat traffic on supported hosts.
for (const version of ['1.14.0', '1.18.0']) test(`official ST ${version} saves live swipe retirement and automatic extraction together`, async () => {
    await seedAnchors();
    const { chatId, chat } = host.context;
    const posted = [];
    const native = hostSaveEntry(version, { read: () => host.context, metadata: () => host.metadata,
        fetch: async (url, request) => { posted.push({ url, body: JSON.parse(request.body) }); return { ok: true }; } });
    host.context.saveMetadata = native.context.saveMetadata;
    const beforeReads = host.reads;
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    chat[1].swipe_id = 1; chat[1].mes = 'replacement branch';
    const retiring = mod.synchronizeSourceCaches(tracker, host.context, { kind: 'swipe', floor: 1 });
    assert.equal(ext().stateAtoms.some(atom => atom.floor === 1), false);
    assert.equal((await retiring).status, 'synced');
    const draft = mod.createAnchorExtractionDraft(chatId, chat, { persistence: 'host' });
    draft.setStatus(1, { status: 'empty', atoms: 0 });
    await draft.commit();
    assert.deepEqual(posted, []);
    assert.equal(host.reads, beforeReads);
    await native.context.saveChatConditional();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].url, '/api/chats/save');
    assert.deepEqual(JSON.parse(JSON.stringify(posted[0].body.chat[0].chat_metadata.extensions.TavernKitchen)), ext());
    assert.equal(host.reads, beforeReads);
    assert.deepEqual(native.errors, []);
});


// Main-reply summaries must share the real persistence/undo path, with no generation gateway.
let sourceAccount = 0;
function sourceArchive(t, getAmbientPreferences) {
    host.autoUnifiedFixture = true;
    const account = `turn-source-test-${++sourceAccount}`;
    const archive = mod.createWorldArchive({ getAmbientPreferences, getContext: () => host.context, getAccountId: () => account,
        getMemorySnapshot: () => ({ enabled: true, store: mod.getPublishedSummaryStore() }),
        getMount: () => assert.fail('no UI expected'), isVisible: () => false, navigate() {}, onError: error => assert.fail(error.message) });
    t.after(() => archive.dispose());
    return { archive, service: () => mod.getWorldBridge(JSON.stringify(['character', host.context.characters[0].avatar, host.context.chatId])).service };
}
function appendSourceTurn() {
    const start = host.context.chat.length;
    host.context.chat.push({ is_user: true, mes: '我支付五金币。', send_date: `user-${start}` },
        { name: '铁匠', mes: '你拿到了铁剑。', send_date: `reply-${start}` });
    return start + 1;
}
const unifiedBlock = (context, proposals = []) => ({ basis: { worldId: context.basis.worldId, branchId: context.basis.branchId, version: context.basis.version },
    proposals, acknowledgedReceipts: context.executionReceipts.map(receipt => receipt.commandId), conflicts: [] });
async function seedUpdateWorld(f) {
    host.context.name1 = '主角';
    await f.archive.prepare(); const service = f.service(), state = await service.read();
    const source = { module: 'manual', key: 'seed', label: '测试开局' };
    return (await service.commit(service.command(state, [{ type: 'create', id: 'resource-holder', name: '主角', kind: 'person', source },
        { type: 'set', entityId: 'resource-holder', field: 'coins', value: 10, source },
        { type: 'create', id: 'distant-npc', name: '远方人物', kind: 'person', source },
        { type: 'set', entityId: 'distant-npc', field: '秘密', value: '藏着一封信，主角并不知情。', source }], '开局'))).state;
}
const updateProposal = floor => ({ type: 'field', entityId: 'resource-holder', field: 'coins', before: { present: true, value: 10 }, value: 5,
    nature: 'established_fact', evidence: { floor, quote: '铁剑' } });

test('one actual summary transaction receives the full world and saves summary plus proposals without mutating world facts', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); await seedUpdateWorld(f); let calls = 0;
    host.generate = async ({ updateContext }) => {
        calls++; assert.equal(updateContext.manifest.worldComplete, true);
        assert.equal(updateContext.world.entities.find(entity => entity.id === 'distant-npc').fields['秘密'].value, '藏着一封信，主角并不知情。');
        assert.equal(updateContext.background.hierarchyAvailable, false);
        return JSON.stringify({ events: [], factUpdates: [], summary: '主角付出五金币，从铁匠手中获得铁剑。',
            memoryTags: { characters: ['主角', '铁匠'], keywords: ['铁剑', '金币'] }, worldUpdate: unifiedBlock(updateContext, [updateProposal(floor)]) });
    };
    const result = await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } });
    assert.equal(result.success, true); assert.equal(result.proposalCount, 1); assert.equal(result.proposalStatus, 'ready'); assert.equal(calls, 1);
    const saved = disk().storySummary.summaryHistory.at(-1); assert.match(saved.summary, /铁剑/); assert.equal(saved.worldUpdate.proposals[0].value, 5);
    assert.equal(saved.memoryTags.version, 1); assert.deepEqual(saved.memoryTags.characters, ['主角', '铁匠']);
    assert.deepEqual(saved.memoryTags.keywords, ['铁剑', '金币']);
    const world = await f.service().read(); assert.equal(world.entities.find(entity => entity.id === 'resource-holder').fields.coins.value, 10);
    assert.equal(mod.worldUpdates(world)[0].update.requestId, saved.sourceReceipt.id);
    host.metadata = structuredClone(host.files.get(host.context.chatId)); mod.reload();
    assert.deepEqual(mod.getSummaryStore().summaryHistory.at(-1).memoryTags, saved.memoryTags);
});

test('one actual summary request saves metadata then automatically commits explicit world changes with accurate feedback', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn();
    host.context.chat[floor].mes = '你支付五金币，拿到了铁剑。'; await seedUpdateWorld(f);
    let calls = 0; const statuses = [];
    host.generate = async ({ updateContext }) => {
        calls++;
        return JSON.stringify({ events: [], factUpdates: [], summary: '主角付出五金币，获得铁剑。', worldUpdate: unifiedBlock(updateContext,
            [{ ...updateProposal(floor), groupId: 'purchase', certainty: 'explicit' }]) });
    };
    const result = await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } }, { onStatus: status => statuses.push(status) });
    assert.equal(result.success, true); assert.equal(calls, 1); assert.equal(result.proposalAutoConfirmed, 1); assert.equal(result.proposalPending, 0);
    const state = await f.service().read(), update = mod.worldUpdates(state)[0];
    assert.equal(state.entities.find(entity => entity.id === 'resource-holder').fields.coins.value, 5);
    assert.equal(update.reviews[0].mode, 'automatic'); assert.equal(update.reviews[0].worldVersion, state.receipts.find(receipt => receipt.commandId === update.reviews[0].commandId).version);
    assert.equal(disk().storySummary.summaryHistory.at(-1).worldUpdate.proposals[0].certainty, 'explicit');
    assert.ok(statuses.some(status => status.includes('1 条世界变化已自动写入')));
    host.metadata = structuredClone(host.files.get(host.context.chatId)); mod.reload(); await f.archive.prepare();
    assert.equal(mod.worldUpdates(await f.service().read())[0].reviews.length, 1);
});

test('the actual prompt keeps confirmed plot background even when raw retrieval has no hit', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); await f.archive.prepare();
    const summary = '主角已经拿到铁剑，约定返城后再找铁匠。';
    host.generate = async ({ updateContext }) => JSON.stringify({ events: [], factUpdates: [], summary, worldUpdate: unifiedBlock(updateContext) });
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).success, true);
    host.vectorConfig.enabled = true;
    host.recall = async () => ({ chunks: [], focusCharacters: [] });
    const result = await mod.buildVectorPromptText();
    assert.ok(result.text.includes(summary));
    assert.equal(result.notice, null);
});

test('the full-world basis rejects same-branch edits made while the model is running', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); await seedUpdateWorld(f); const writes = host.writes;
    host.generate = async () => {
        const service = f.service(), state = await service.read();
        await service.commit(service.command(state, [{ type: 'set', entityId: 'resource-holder', field: 'coins', value: 12,
            source: { module: 'manual', key: 'later', label: '人工修改' } }], '修改'));
        return JSON.stringify({ events: [], factUpdates: [] });
    };
    const result = await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } });
    assert.equal(result.success, false); assert.equal(host.writes, writes); assert.equal(disk().storySummary.lastSummarizedMesId, 23);
    assert.match(result.error.message, /完整世界或记忆基线/);
    assert.equal((await f.service().read()).entities.find(entity => entity.id === 'resource-holder').fields.coins.value, 12);
});

test('a proposal delivery failure keeps the confirmed result and reconciles later without another model call or metadata save', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); await seedUpdateWorld(f);
    let calls = 0; host.generate = async ({ updateContext }) => { calls++; return JSON.stringify({ events: [], factUpdates: [], worldUpdate: unifiedBlock(updateContext, [updateProposal(floor)]) }); };
    const put = IDBObjectStore.prototype.put, notices = [], writes = host.writes;
    IDBObjectStore.prototype.put = function(...args) {
        if (this.name === 'branches' && Object.keys(args[0]?.sources || {}).some(key => key.startsWith('update:'))) throw Error('projection disk offline');
        return put.apply(this, args);
    };
    let result;
    try { result = await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } }, { onError: message => notices.push(message) }); }
    finally { IDBObjectStore.prototype.put = put; }
    assert.equal(result.committed, true); assert.equal(result.proposalStatus, 'pending_delivery'); assert.ok(result.deliveryError);
    assert.equal(disk().storySummary.lastSummarizedMesId, floor); assert.match(notices[0], /摘要与提案已保存/);
    await f.archive.prepare(); const state = await f.service().read(); assert.equal(mod.worldUpdates(state)[0].status, 'ready');
    assert.equal(host.writes, writes + 1); assert.equal(calls, 1);
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).noContent, true); assert.equal(calls, 1);
});

test('a world edit during host save preserves manual state and labels delivered proposals stale', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); await seedUpdateWorld(f);
    host.generate = async ({ updateContext }) => JSON.stringify({ events: [], factUpdates: [], worldUpdate: unifiedBlock(updateContext, [updateProposal(floor)]) });
    host.afterSave = async () => {
        const service = f.service(), state = await service.read();
        await service.commit(service.command(state, [{ type: 'set', entityId: 'resource-holder', field: 'coins', value: 12,
            source: { module: 'manual', key: 'during-save', label: '人工修改' } }], '保存期间修改'));
    };
    const result = await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } });
    assert.equal(result.committed, true); assert.equal(result.proposalStatus, 'stale');
    assert.equal((await f.service().read()).entities.find(entity => entity.id === 'resource-holder').fields.coins.value, 12);
    assert.equal(mod.worldUpdates(await f.service().read())[0].status, 'stale');
});

test('unified output rejects missing evidence and direct scene-state writes before saving any summary', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); await seedUpdateWorld(f); const writes = host.writes;
    host.generate = async ({ updateContext }) => JSON.stringify({ events: [], factUpdates: [],
        worldUpdate: unifiedBlock(updateContext, [{ ...updateProposal(floor), evidence: { floor, quote: '不存在的依据' } }]) });
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).success, false);
    host.generate = async () => JSON.stringify({ events: [], factUpdates: [], storyUpdates: [{ id: 'clock', kind: 'clock', label: '擅自过了十年', date: '' }] });
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).success, false);
    assert.equal(host.writes, writes); assert.equal(disk().storySummary.lastSummarizedMesId, 23);
});

test('unconfirmed unified results do not appear in the world until read-only save recovery succeeds', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); await seedUpdateWorld(f); let calls = 0;
    host.generate = async ({ updateContext }) => { calls++; return JSON.stringify({ events: [], factUpdates: [], worldUpdate: unifiedBlock(updateContext, [updateProposal(floor)]) }); };
    const writes = host.writes; host.mode = 'read_fail';
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).success, false);
    await f.archive.prepare(); assert.equal(mod.worldUpdates(await f.service().read()).length, 0);
    host.mode = 'save'; host.expireReadback = false; assert.equal(await mod.waitForMemoryCommit(), true);
    await f.archive.prepare(); assert.equal(mod.worldUpdates(await f.service().read())[0].update.proposals.length, 1);
    assert.equal(calls, 1); assert.equal(host.writes, writes + 1);
});

test('independent generation persists exact turn sources and reconciles once without another model request', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); let calls = 0;
    host.generate = async () => { calls++; return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '物品', o: '铁剑', isState: true }] }); };
    const result = await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } });
    assert.equal(result.success, true); const receipt = disk().storySummary.summaryHistory.at(-1).sourceReceipt;
    assert.equal(receipt.source.start, floor - 1); assert.equal(receipt.source.end, floor);
    assert.deepEqual(receipt.source.messages.map(item => item.text), ['我支付五金币。', '你拿到了铁剑。']);
    await f.archive.prepare(); const state = await f.service().read(), turn = mod.currentTurns(state).find(item => item.source.end === floor);
    assert.equal(turn.memory[0].id, receipt.id); assert.equal(receipt.branchId, state.branchId);
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).noContent, true);
    assert.equal(calls, 1); await f.archive.prepare(); assert.equal((await f.service().read()).version, state.version);
    // Imported old summaries remain explicitly unlinked; a high cutoff is not proof.
    assert.equal(mod.turnProgress(state).memoryThroughFloor, -1);
});

test('a failed summary followed by another reply retries the complete missing source range', async t => {
    await importFixture(); const f = sourceArchive(t), first = appendSourceTurn(); let calls = 0;
    host.generate = async () => { calls++; if (calls === 1) throw Error('model offline'); return JSON.stringify({ events: [], factUpdates: [] }); };
    assert.equal((await mod.runSummaryGeneration(first, { trigger: { delayFloors: 0 } })).success, false);
    assert.equal(disk().storySummary.lastSummarizedMesId, 23);
    const second = appendSourceTurn(); assert.equal((await mod.runSummaryGeneration(second, { trigger: { delayFloors: 0 } })).success, true);
    const receipt = disk().storySummary.summaryHistory.at(-1).sourceReceipt;
    assert.equal(receipt.source.start, first - 1); assert.equal(receipt.source.end, second);
    await f.archive.prepare(); const turns = mod.currentTurns(await f.service().read()).filter(item => item.source.end >= first);
    assert.equal(turns.length, 2); assert.ok(turns.every(item => item.memory.length === 1)); assert.equal(calls, 2);
});

test('an unconfirmed metadata save cannot advance world memory delivery and recovers through readback', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); let calls = 0;
    host.generate = async () => { calls++; return JSON.stringify({ events: [], factUpdates: [] }); };
    host.mode = 'read_fail'; const writes = host.writes;
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).success, false);
    assert.equal(mod.getMemoryCommitState(), 'unconfirmed');
    await f.archive.prepare(); assert.equal(mod.currentTurns(await f.service().read()).find(item => item.source.end === floor).memory.length, 0);
    const savedReceipt = disk().storySummary.summaryHistory.at(-1).sourceReceipt.id;
    host.mode = 'save'; host.expireReadback = false; assert.equal(await mod.waitForMemoryCommit(), true);
    await f.archive.prepare(); const delivered = mod.currentTurns(await f.service().read()).find(item => item.source.end === floor);
    assert.equal(delivered.memory[0].id, savedReceipt); assert.equal(calls, 1); assert.equal(host.writes, writes + 1);
});

test('a world branch switch during generation cannot save a summary with the old source basis', async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn();
    host.generate = async () => { const service = f.service(), state = await service.read(); await service.fork(state, state.version);
        return JSON.stringify({ events: [], factUpdates: [] }); };
    const result = await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } });
    assert.equal(result.success, false); assert.equal(disk().storySummary.lastSummarizedMesId, 23);
    assert.ok(mod.currentTurns(await f.service().read()).every(item => item.memory.length === 0));
});

for (const edit of ['player', 'reply', 'reload']) test(`editing a confirmed source undoes only its new memory batch and allows regeneration: ${edit}`, async t => {
    await importFixture(); const f = sourceArchive(t), floor = appendSourceTurn(); let calls = 0;
    host.generate = async () => { calls++; return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '本轮物品', o: '铁剑', isState: true }] }); };
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).success, true);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    host.context.chat[edit === 'player' ? floor - 1 : floor].mes += ' 改为未购买。';
    if (edit === 'reload') {
        host.metadata = structuredClone(host.files.get(host.context.chatId)); mod.reload(); tracker.reset(host.context);
    }
    const result = await mod.synchronizeSourceCaches(tracker, host.context);
    assert.ok(['synced', 'rolled_back'].includes(result.status), JSON.stringify(result));
    assert.equal(disk().storySummary.lastSummarizedMesId, 23);
    assert.equal(disk().storySummary.json.facts.some(item => item.p === '本轮物品'), false);
    assert.equal(calls, 1);
    host.generate = async () => { calls++; return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '本轮物品', o: '未购买', isState: true }] }); };
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: { delayFloors: 0 } })).success, true);
    await f.archive.prepare(); const turns = mod.currentTurns(await f.service().read());
    assert.equal(turns.find(item => item.source.end === floor).memory.length, 1);
    assert.equal(disk().storySummary.json.facts.find(item => item.p === '本轮物品').o, '未购买'); assert.equal(calls, 2);
});

test('published world authority filters actual summary constraint reads without rewriting historical summary data', async () => {
    await importFixture(); const original = structuredClone(ext().storySummary.json);
    host.context.characterId = 0; host.context.characters = [{ avatar: 'authority-test.png' }];
    const fact = mod.getFacts()[0], identity = JSON.stringify(['character', 'authority-test.png', host.context.chatId]);
    const entity = { id: 'world-person', name: fact.s, aliases: [], bindings: [JSON.stringify(['memory', 'person:source'])],
        fields: { [fact.p]: { nature: 'established_fact', value: '世界已确认的新状态' } } };
    const state = { entities: [entity], sources: { memory: { records: [{ key: 'person:source', name: fact.s, aliases: [] }] } } };
    const remove = mod.registerWorldAuthority('world-test', () => ({ identity, state }));
    try {
        assert.equal(mod.getFacts().some(row => row.s === fact.s && row.p === fact.p), false);
        assert.deepEqual(ext().storySummary.json, original);
        host.context.chatId = 'another-story';
        assert.ok(mod.getFacts().some(row => row.s === fact.s && row.p === fact.p));
    } finally { remove(); }
});

test('ambient developments persist with their source batch and inject only on arrival', async t => {
    await importFixture();
    const { archive } = sourceArchive(t, () => ({sceneryEvolution:true, encounterFrequency:'off'}));
    await archive.prepare();
    host.generate = async ({updateContext}) => {
        assert.equal(updateContext.ambientControl.draw, false);
        return JSON.stringify({summary:'到访集市',events:[],factUpdates:[],worldUpdate:unifiedBlock(updateContext),
            ambient:{place:'东港集市',period:'傍晚',publicSpace:true,quiet:true,scenery:[{id:'fair', title:'灯节筹备',
                phase:'扎灯',detail:'屋檐下挂起纸灯。'}],encounter:{title:'促销',detail:'限时特卖',until:'收摊'}}});
    };
    for (let turn = 0; turn < 2; turn++) {
        assert.equal((await mod.runSummaryGeneration(appendSourceTurn(), {trigger:{}})).success, true);
        const batch = disk().storySummary.summaryHistory.at(-1);
        assert.ok(batch.sourceReceipt);
        assert.equal(batch.ambient.updates.length, turn === 0 ? 1 : 0);
        const prompt = await archive.prepare('');
        assert.equal(prompt.includes('屋檐下挂起纸灯'), turn === 0);
        assert.doesNotMatch(prompt, /限时特卖/);
    }
});

test('independent update records a distant fact and carries evidenced involvement into the next turn', async t => {
    await importFixture();
    host.context.name1 = '主角';
    const f = sourceArchive(t);
    await seedUpdateWorld(f);
    const floor = appendSourceTurn(), quote = '守卫拦住主角。';
    host.context.chat[floor].mes = quote + '远方人物已烧掉密信。';
    const change = {target:'person-name/守卫',action:'enter',quote,floor,reason:'拦住主角去路'};
    host.generate = async ({updateContext}) => {
        assert.equal(updateContext.involvementContext.find(row => row.key === 'person/distant-npc').near,false);
        return JSON.stringify({summary:'守卫拦路，远方的密信已销毁。',involvement:[change],worldUpdate:unifiedBlock(updateContext,[
            {type:'field',entityId:'distant-npc',field:'秘密',before:{present:true,value:'藏着一封信，主角并不知情。'},
                value:'密信已销毁',nature:'established_fact',certainty:'explicit',groupId:'letter',evidence:{floor,quote:'远方人物已烧掉密信。'}}])});
    };
    assert.equal((await mod.runSummaryGeneration(floor,{trigger:{}})).success,true);
    assert.deepEqual(disk().storySummary.summaryHistory.at(-1).involvement,[change]);
    assert.equal((await f.service().read()).entities.find(row => row.id === 'distant-npc').fields['秘密'].value,'密信已销毁');
    host.generate = async ({updateContext}) => {
        assert.ok(updateContext.involvementContext.find(row => row.title === '守卫' && row.near));
        return JSON.stringify({summary:'买到铁剑。',worldUpdate:unifiedBlock(updateContext)});
    };
    assert.equal((await mod.runSummaryGeneration(appendSourceTurn(),{trigger:{}})).success,true);
});

test('independent updates share one project between holders and close it without closing their agenda', async t => {
    await importFixture();
    const f = sourceArchive(t);
    await f.archive.prepare();
    let floor = appendSourceTurn();
    const promise = '船夫和药师约定退潮后送药。', aim = '药师立志让沿江各村有医可求。';
    host.context.chat[floor].mes = promise + aim;
    const plan = {id:'river-delivery',kind:'plan',holders:['船夫','药师'],title:'渡江送药',description:'把药箱送到南岸诊所',conditions:'退潮后',status:'open'};
    const goal = {id:'river-health',kind:'goal',holders:['药师'],title:'乡里有医',description:'让沿江各村有医可求',status:'open'};
    const proposal = (record,quote,before = {present:false}) => ({type:'story',record,before,nature:'intention',
        evidence:{floor,quote},certainty:'explicit',groupId:'delivery'});
    host.generate = async ({updateContext}) => JSON.stringify({summary:'船夫和药师约定送药，药师道出长远志向。',
        worldUpdate:unifiedBlock(updateContext,[proposal(plan,promise),proposal(goal,aim)])});
    assert.equal((await mod.runSummaryGeneration(floor,{trigger:{}})).proposalAutoConfirmed,2);
    floor = appendSourceTurn();
    const received = '南岸诊所签收了两人送来的药箱。';
    host.context.chat[floor].mes = received;
    host.generate = async ({updateContext}) => {
        const previous = updateContext.world.storyRecords.find(record => record.id === plan.id);
        return JSON.stringify({summary:received,worldUpdate:unifiedBlock(updateContext,[
            {...proposal({...plan,status:'done',reason:received},received,{present:true,value:previous}),nature:'established_fact'}])});
    };
    assert.equal((await mod.runSummaryGeneration(floor,{trigger:{}})).proposalAutoConfirmed,1);
    const {records} = (await f.service().read()).modules.story;
    assert.equal(records.length,2);
    const project = records.find(entry => entry.record.id === plan.id), agenda = records.find(entry => entry.record.id === goal.id);
    assert.deepEqual(project.record.holders,['船夫','药师']);
    assert.equal(project.record.status,'done'); assert.equal(agenda.record.status,'open');
    assert.ok(project.version > agenda.version && project.end === floor && agenda.end < floor);
});
