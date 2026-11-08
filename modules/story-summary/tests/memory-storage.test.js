import { runMemoryAgent } from '../maintenance/runner.js';
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
import { timelineRounds } from '../data/summary-layers.js';
import { maintenanceFixture } from './fixtures/memory-maintenance.js';
import { memoryPolicy } from '../data/memory-policy.js';
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
import { applySummarySectionEdit } from '../data/section-edits.js';
import { mergeEditedFactsWithTimestamps } from '../data/fact-edits.js';

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
    'modules/story-summary/maintenance/runner.js': 'export const createSharedMemoryAgent=()=>{throw Error("unexpected Agent request");}; export const runMemoryAgent=createSharedMemoryAgent; let sequence=0; export const memoryRunId=()=>"memory-storage-test-"+(++sequence);',
    'modules/story-summary/vector/utils/embedder.js': 'export const getEngineFingerprint=()=>"test-engine";',
    'modules/story-summary/vector/llm/siliconflow.js': 'export const embed=(texts)=>globalThis.__memoryStorageTest.embed(texts);',
    'modules/story-summary/vector/llm/atom-extraction.js': 'export const extractAtomsForRound=()=>{throw Error("unexpected anchor request");};',
    'shared/common/async-errors.js': 'export const observeBackgroundTask=task=>globalThis.__memoryStorageTest.background.push(Promise.resolve(task).catch(error=>{globalThis.__memoryStorageTest.backgroundErrors.push(error);}));',
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
        "export * from './modules/story-summary/inline/controller.js';",
        "export * from './modules/story-summary/data/memory-commit.js';",
        "export * from './modules/story-summary/data/summary-import.js';",
        "export { normalizeCharacterAliases, replaceCharacterAliases } from './modules/story-summary/data/character-aliases.js';",
        "export * from './modules/story-summary/data/summary-history.js';",
        "export * from './modules/story-summary/data/anchor-extraction.js';",
        "export * from './modules/story-summary/data/anchor-invalidation.js';",
        "export * from './modules/story-summary/data/message-sources.js';",
        "export * from './modules/story-summary/data/source-sync.js';",
        "export * from './modules/story-summary/maintenance/domain.js';",
        "export * from './modules/story-summary/maintenance/history.js';",
        "export * from './modules/story-summary/maintenance/ranges.js';",
        "export * from './modules/story-summary/maintenance/session.js';",
        "export * from './modules/story-summary/maintenance/commit.js';",
        "export * from './modules/story-summary/maintenance/host.js';",
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

// Acceptance: queued panel edits must preserve preceding source retirement and
// unrelated panel edits. Cost: silently unsaved changes or resurrected stale anchors.
function manualPanelEntry(errors, execution = null) {
    return entry(['handleFrameMessage', 'buildFramePayload', 'cancelActiveSummaryExecution'], {
        ...mod, structuredClone, document: { getElementById: () => ({}) }, isTrustedMessage: () => true,
        getContext: () => host.context, getChatIdentity, VALID_SECTIONS: ['characters', 'facts'],
        applySummarySectionEdit, mergeEditedFactsWithTimestamps, getCurrentFloorHint: () => host.context.chat.length - 1,
        cancelRecallAndClearPrompt() {}, memoryMaintenance: { cancel: () => assert.fail('manual edit cancelled maintenance') },
        activeSummaryExecution: execution, cancelPendingHide() {}, refreshEntityLexiconAndWarmup() {},
        runVectorWriteTask: vectorWrites.runVectorWriteTask, VECTOR_WRITE_SCOPES: vectorWrites.VECTOR_WRITE_SCOPES,
        postToFrame() {}, reportMemorySaveFailure: error => errors.push(error.code),
    });
}

function editSection(panel, section, data, previous = structuredClone(ext().storySummary.json[section])) {
    return panel.handleFrameMessage({ data: { type: 'UPDATE_SECTION', section, previous, data } });
}

// Acceptance: saving a manual correction cancels generation synchronously, even
// after its response arrived; it must not discard maintenance or overwrite the edit.
// Cost: silently losing user-authored memory and paying for another generation.
for (const section of ['facts', 'aliases']) for (const phase of ['request', 'response']) {
    test(`manual ${section} save protects edits during summary ${phase}`, async () => {
        await importFixture();
        host.context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
        const controller = new AbortController();
        const panel = manualPanelEntry([], { controller });
        if (section === 'aliases') panel.memoryMaintenance = { cancel() {} };
        const errors = [];
        panel.reportMemorySaveFailure = error => errors.push(error.code);
        let entered, respond, finishSave, observedStage, calls = 0;
        const started = new Promise(resolve => { entered = resolve; });
        host.generate = () => { calls++; entered(); return new Promise(resolve => { respond = resolve; }); };
        const running = mod.runSummaryGeneration(25, { trigger: { delayFloors: 0 } }, {
            onProgress: ({ stage }) => { observedStage = stage; },
        }, { signal: controller.signal });
        await started;
        const response = JSON.stringify({ events: [],
            factUpdates: [{ s: '夏实', p: '回收原因', o: '模型旧值', isState: false }],
            characterAliasUpdates: [{ from: ['小夏'], to: '旅人', evidence: '模型旧解释' }],
        });
        let saving, edited;
        try {
            if (phase === 'response') {
                const maintenance = mod.createMemorySession(readMaintenanceState()); maintenance.initial();
                maintenance.runTool('EditMemory', { edits: [fixFact] });
                host.afterSave = () => new Promise(resolve => { finishSave = resolve; });
                saving = saveMaintenanceSession(maintenance);
                while (!finishSave) await Promise.resolve();
                respond(response);
                await nextTurn();
                assert.equal(observedStage, 'save_confirmation');
            }
            if (section === 'facts') {
                const facts = structuredClone(ext().storySummary.json.facts);
                facts[0].o = '用户刚保存的修正';
                edited = editSection(panel, 'facts', facts);
            } else edited = panel.handleFrameMessage({ data: { type: 'UPDATE_CHARACTER_ALIASES',
                aliases: [{ from: '小夏', to: '夏实', evidence: '用户确认的身份' }] } });
            assert.equal(controller.signal.aborted, true);
        } finally {
            host.afterSave = null;
            finishSave?.();
            respond(response);
            await saving;
            await edited;
        }
        const result = await running;
        assert.equal(result.cancelled, true);
        assert.equal(result.committed === true, false);
        assert.deepEqual(errors, []);
        assert.equal(calls, 1);
        assert.equal(disk().storySummary.lastSummarizedMesId, 23);
        if (section === 'facts') assert.equal(disk().storySummary.json.facts[0].o, '用户刚保存的修正');
        else assert.equal(disk().storySummary.json.characterAliases[0].to, '夏实');
        if (phase === 'response') assert.equal(disk().storySummary.summaryHistory[0].maintenance.length, 1);
        assert.deepEqual(disk(), ext());
    });
}

for (const preceding of ['source-sync', 'panel-edit']) {
    test(`manual summary edit uses the memory published by preceding ${preceding}`, async () => {
        await importFixture(); await seedAnchors();
        const errors = [];
        const panel = manualPanelEntry(errors);
        const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
        let release;
        const blocked = new Promise(resolve => { release = resolve; });
        const blocking = vectorWrites.runVectorWriteTask({ scope: vectorWrites.VECTOR_WRITE_SCOPES.IO }, () => blocked);
        let first;
        if (preceding === 'source-sync') {
            host.context.chat[1].mes += ' edited prose';
            first = vectorWrites.runVectorWriteTask({ scope: vectorWrites.VECTOR_WRITE_SCOPES.CONSISTENCY },
                () => mod.synchronizeSourceCaches(tracker, host.context, { kind: 'edit', floor: 1 }));
        } else {
            first = editSection(panel, 'facts', [{ s:'同行者', p:'衣着', o:'灰斗篷' }]);
        }
        const second = editSection(panel, 'facts', [{ s: '主角', p: '当前情绪', o: '平静' }]);
        try { await nextTurn(); }
        finally { release(); }
        await Promise.all([blocking, first, second]);
        assert.deepEqual(errors, []);
        assert.ok(disk().storySummary.json.facts.some(fact => fact.s === '主角' && fact.o === '平静'));
        if (preceding === 'source-sync') {
            assert.equal(disk().stateAtoms.some(atom => atom.floor === 1), false);
            assert.equal(disk().l0Index.byFloor[1], undefined);
            assert.equal(tracker.inspect(host.context), null);
        } else assert.ok(disk().storySummary.json.facts.some(fact => fact.s === '同行者' && fact.o === '灰斗篷'));
        assert.deepEqual(disk(), ext());
    });
}

// Acceptance: a queued edit must never be applied to another character's chat,
// even when filenames match. Cost: cross-chat data corruption.
test('queued manual summary edit stays with its original character', async () => {
    await importFixture();
    const errors = [], panel = manualPanelEntry(errors);
    const before = structuredClone(ext()), saves = host.writes;
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const blocking = vectorWrites.runVectorWriteTask({ scope: vectorWrites.VECTOR_WRITE_SCOPES.IO }, () => blocked);
    const editing = editSection(panel, 'facts', [{ s: '主角', p: '当前情绪', o: '旧聊天的修改' }]);
    try {
        await nextTurn();
        host.context = { ...host.context, characterId: 1,
            characters: [...host.context.characters, { name: '另一角色', avatar: 'another.png', chat: host.context.chatId }] };
    } finally { release(); }
    await Promise.all([blocking, editing]);
    assert.equal(host.writes, saves);
    assert.deepEqual(ext(), before);
    assert.deepEqual(errors, []);
});

// Acceptance: an editor opened before a rollback must save only the user's
// changes, never revive untouched withdrawn facts. Cost: corrupt canonical memory.
for (const timing of ['queued', 'finished']) test(`manual edit preserves source rollback (${timing})`, async () => {
    await importFixture();
    const context = host.context;
    context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
    host.generate = async () => JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '共同出发', isState: false }] });
    await mod.runSummaryGeneration(25, { trigger: { delayFloors: 0 } });
    const previous = structuredClone(ext().storySummary.json.facts);
    const edited = structuredClone(previous);
    edited.find(fact => fact.p === '物品').o = '代为保管药箱';
    const tracker = mod.createMessageSourceTracker(); tracker.reset(context);
    context.chat[25].mes = '独自留下';
    const errors = [], panel = manualPanelEntry(errors);
    let release;
    const blocking = vectorWrites.runVectorWriteTask({ scope: vectorWrites.VECTOR_WRITE_SCOPES.IO },
        () => new Promise(resolve => { release = resolve; }));
    await nextTurn();
    const rollback = vectorWrites.runVectorWriteTask({ scope: vectorWrites.VECTOR_WRITE_SCOPES.CONSISTENCY },
        () => mod.synchronizeSourceCaches(tracker, context, { kind: 'swipe', floor: 25 }));
    let editing;
    if (timing === 'queued') editing = editSection(panel, 'facts', edited, previous);
    release(); await Promise.all([blocking, rollback]);
    if (timing === 'finished') editing = editSection(panel, 'facts', edited, previous);
    await editing;
    assert.deepEqual(errors, []);
    assert.equal(disk().storySummary.lastSummarizedMesId, 23);
    assert.equal(disk().storySummary.json.facts.some(fact => fact.p === '行程'), false);
    assert.equal(disk().storySummary.json.facts.find(fact => fact.p === '物品').o, '代为保管药箱');
});

// Acceptance: manual edits and independent Agent edits may commit in either
// order without stopping the run or losing either result. Cost: lost maintenance.
for (const order of ['agent-first', 'user-first']) test(`manual edit coexists with maintenance (${order})`, async () => {
    await importFixture();
    const previous = structuredClone(ext().storySummary.json.facts);
    const edited = structuredClone(previous);
    edited.find(fact => fact.p === '物品').o = '代为保管药箱';
    const session = mod.createMemorySession(readMaintenanceState()); session.initial();
    session.runTool('EditMemory', { edits: [fixFact] });
    const errors = [], panel = manualPanelEntry(errors);
    if (order === 'agent-first') await saveMaintenanceSession(session);
    await editSection(panel, 'facts', edited, previous);
    if (order === 'user-first') await saveMaintenanceSession(session);
    assert.deepEqual(errors, []);
    assert.equal(disk().storySummary.json.facts[0].o, fixFact.patch.o);
    assert.equal(disk().storySummary.json.facts.find(fact => fact.p === '物品').o, '代为保管药箱');
});

// Acceptance: a user-edited target makes only the Agent's stale edit reread;
// the maintenance session remains usable. Cost: overwriting user edits or wasted runs.
test('maintenance can reread a manually changed target and continue', async () => {
    await importFixture();
    const session = mod.createMemorySession(readMaintenanceState()); session.initial();
    session.runTool('EditMemory', { edits: [fixFact] });
    const edited = structuredClone(ext().storySummary.json.facts);
    edited[0].o = '用户补充的信息';
    const errors = [];
    await editSection(manualPanelEntry(errors), 'facts', edited);
    assert.deepEqual(errors, []);
    await assert.rejects(saveMaintenanceSession(session), { code: 'memory_updated' });
    session.discard();
    const latest = session.runTool('ReadMemory', { collection: 'facts', key: fixFact.key }, readMaintenanceState());
    assert.equal(latest.items[0].value.o, '用户补充的信息');
    session.runTool('EditMemory', { edits: [fixFact] });
    const saved = await saveMaintenanceSession(session);
    assert.equal(saved.receipt.operations.length, 1);
    assert.equal(disk().storySummary.json.facts[0].o, fixFact.patch.o);
});

// Acceptance: editing visible facts cannot reactivate a hidden retracted fact.
// Cost: withdrawn memory becomes active again without the user's knowledge.
test('manual facts edit preserves retracted records without reviving them', async () => {
    await importFixture();
    const withdrawn = mod.readSummaryMemory(); withdrawn.storySummary.json.facts[0].retracted = true;
    await mod.commitSummaryMemory(host.context.chatId, withdrawn);
    const previous = structuredClone(ext().storySummary.json.facts.filter(fact => !fact.retracted));
    const edited = structuredClone(previous); edited[0].o = '代为保管药箱';
    const errors = [];
    await editSection(manualPanelEntry(errors), 'facts', edited, previous);
    assert.deepEqual(errors, []);
    assert.deepEqual(disk().storySummary.json.facts[0], withdrawn.storySummary.json.facts[0]);
});

// Acceptance: opt-in success feedback means both persistence and follow-up
// work finished. Cost: a hidden failed save or misleading completion signal.
for (const scenario of ['default', 'enabled', 'save-failed', 'followup-failed', 'chat-changed']) {
    test(`summary completion notification observes the actual result: ${scenario}`, async t => {
        await importFixture();
        host.context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
        host.generate = async () => JSON.stringify({ events: [], factUpdates: [] });
        const notices = [], previousWindow = globalThis.window;
        globalThis.window = { toastr: { success: value => notices.push(value) } };
        t.after(() => { globalThis.window = previousWindow; });
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

async function maintain(commands) {
    const next = mod.readSummaryMemory();
    const { memory, results } = mod.editMemoryBatch({ json: next.storySummary.json, atoms: next.stateAtoms }, commands, host.fixture.cutoff);
    const operations = results.map((result, index) => ({ ...commands[index], changes: result.changes }));
    next.storySummary.json = memory.json;
    next.stateAtoms = memory.atoms;
    mod.appendMaintenanceReceipt(next.storySummary, { version: 2, id: `receipt-${host.writes}`, runId: 'storage-test', policy: memoryPolicy(), operations,
        coverage: { supplied: [], missingAnchors: [] } });
    await mod.commitSummaryMemory(host.context.chatId, next);
    return operations;
}
const fixFact = { kind: 'edit', collection: 'facts', key: 'f-1', patch: { o: '未经证实的传闻' } };
const fixAnchor = { kind: 'edit', collection: 'anchors', key: 'atom-1-0', patch: { semantic: '夏实说听说可能如此，自己没有确证。' } };

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

for (const automatic of [false, true]) test(`${automatic ? 'automatic' : 'manual'} summary catches up in confirmed batches through the requested completed reply`, async () => {
    await importFixture();
    host.context.chat.push(...Array.from({ length: 6 }, (_, index) => ({ mes: `新增原文 ${index}`, is_user: index % 2 === 0 })));
    const run = summaryExecutionHarness(), ranges = [], writes = host.writes;
    host.generate = async ({ newHistoryText }) => {
        ranges.push(newHistoryText);
        return JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: `第${ranges.length}段`, isState: false }] });
    };
    await (automatic ? run.autoRunSummaryWithRetry : run.handleManualGenerate)(29, { trigger: { maxPerRun: 2, delayFloors: 0 } });
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
        await run.autoRunSummaryWithRetry(999, config);
        assert.equal(requests.length, 3);
        assert.equal(run.isRunning(), false);
        assert.equal(run.messages.at(-2).isGenerating, false);
        assert.equal(run.messages.at(-1).type, 'CHAT_SUMMARY_STATE');
        assert.equal(run.messages.filter(message => message.type === 'SUMMARY_ERROR').at(-1).uncertain, false);
        const reason = summaryFailureReason(run.errors.at(-1));
        assert.ok(run.messages.filter(message => message.type === 'SUMMARY_ERROR').at(-1).message.includes(reason));
        assert.ok(run.toasts.at(-1).includes(reason));
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
        assert.equal(requests.length, 5);
        assert.equal(mod.getPublishedSummaryStore().lastSummarizedMesId, pending.endMesId);
        assert.equal(run.isRunning(), false);
        const attempts = run.summaryDiagnostics.read(getChatIdentity(host.context)).attempts;
        assert.equal(attempts.length, 5);
        assert.equal(attempts[0].outcome, 'completed');
        assert.equal(attempts[0].saveState, 'confirmed');
        assert.equal(attempts[1].automatic, false);
        assert.deepEqual(attempts.slice(2).map(item => item.attempt), [3, 2, 1]);
        assert.equal(new Set(attempts.slice(2).map(item => item.runId)).size, 1);
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
for (const automatic of [false, true]) test(`confirmed retry refreshes data and hiding without another model request (automatic: ${automatic})`, async () => {
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
    await (automatic ? run.autoRunSummaryWithRetry : run.handleManualGenerate)(25, { trigger: { delayFloors: 0 } });
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
for (const stage of ['source', 'writer']) for (const automatic of [false, true]) {
    test(`stop during ${stage} preparation frees the run before independent work settles (automatic: ${automatic})`, async t => {
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
        const generate = automatic ? run.autoRunSummaryWithRetry : run.handleManualGenerate;
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
    if (kind === 'edit') {
        assert.equal(result.status, 'synced');
        assert.equal(tracker.inspect(context), null);
        assert.equal(mod.isSummaryConsumable(ext().storySummary, context.chat.length), true);
        await context.saveMetadata();
    } else {
        // Historical swipe crossed the imported baseline: preserve, but block L2.
        assert.equal(result.status, 'failed');
        assert.equal(ext().storySummary.sourceRollbackFromFloor, 1);
        assert.equal(ext().storySummary.sourceInvalidFromFloor, undefined);
        assert.equal(mod.isSummaryConsumable(ext().storySummary, context.chat.length), false);
    }
    assert.deepEqual(disk(), ext());
});

function importEntry(tracker) {
    const noop = () => {};
    return entry(['importSummaryMemoryPackage', 'extractSummaryImportJson', 'cloneSummaryJsonForPortability',
        'normalizePortableFact', 'normalizeInternalFact', 'stripFloorMarker'], { ...mod, getContext: () => host.context, messageSources: tracker,
        invalidateLexicalIndex: noop, refreshEntityLexiconAndWarmup: noop, scheduleLexicalWarmup: noop,
        clearHideState: noop, sendFrameBaseData: noop, sendFrameFullData: noop, sendAnchorStatsToFrame: noop,
        sendVectorStatsToFrame: noop, notifyStorySummaryChatState: noop });
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

for (const generated of [false, true]) test(`unselected swipe deletion then immediate edit preserves L2 (generated: ${generated})`, async t => {
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
    assert.equal((await mod.synchronizeSourceCaches(tracker, context, { kind: 'edit', floor })).status, 'synced');
    if (generated) assert.equal(ext().storySummary.lastSummarizedMesId, 23);
    else assert.deepEqual(ext().storySummary, before);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, context.chat.length), true);
    assert.equal(await mod.chunksTable.where('[chatId+floor]').equals([context.chatId, floor]).count(), 0);
    assert.equal(host.writes, metadataWrites + (generated ? 1 : 0));
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

for (const kind of ['swipe', 'delete']) for (const stage of ['queued', 'failed']) for (const action of ['import', 'clear']) test(`confirmed ${action} resolves ${stage} ${kind} rollback intent without confirming source caches`, async () => {
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
    if (action === 'import') {
        await importEntry(tracker).importSummaryMemoryPackage(JSON.stringify({ ...mod.SUMMARY_MEMORY_PACKAGE,
            data: { facts: [{ 人物名字: '夏实', 种类: '去向', 描述: '导入后确认的新路线' }] } }), context.chatId);
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
    if (action === 'import') {
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
    await importFixture(); await seedAnchors(); await maintain([fixAnchor]); await completeRange();
    const chatId = host.context.chatId;
    await seedCacheRange(chatId, [0, 1, 3, 22, 23]);
    await seedCacheRange('other', [1, 3]);
    const before = structuredClone(ext());
    await mod.rollbackSummaryIfNeeded({ invalidateFloors: [1] });
    await mod.deleteChunksAtFloor(chatId, 1);
    assert.deepEqual(ext().stateAtoms, before.stateAtoms.filter(atom => atom.floor !== 1));
    assert.deepEqual(ext().storySummary.json, before.storySummary.json);
    assert.equal(ext().l0Index.byFloor[1], undefined);
    assert.deepEqual(mod.maintenanceRanges(ext().storySummary.summaryHistory, 23).pending, [{ from: 2, to: 2 }]);
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

test('pure source retirement preserves its input, including absent anchors and completed history', async () => {
    await importFixture(); await seedAnchors(); await maintain([{ ...fixAnchor, kind: 'delete' }]); await completeRange();
    const before = mod.readSummaryMemory(), original = structuredClone(before);
    const result = mod.invalidateMemoryAnchors(before, 1);
    assert.deepEqual(before, original);
    assert.deepEqual(result.next.storySummary.json, original.storySummary.json);
    assert.ok(result.atomIds.includes('atom-1-0'));
    assert.ok(result.retired > 0);
    assert.ok(result.next.stateAtoms.every(atom => atom.floor < 1));
    assert.deepEqual(mod.maintenanceRanges(result.next.storySummary.summaryHistory, 23).pending, [{ from: 2, to: 24 }]);
    const repeated = mod.invalidateMemoryAnchors(result.next, 1);
    assert.deepEqual(repeated.next, result.next);
    assert.equal(repeated.retired, 0);
    assert.deepEqual(repeated.atomIds, []);
});

for (const identityShape of ['portable', 'duplicate']) {
    test(`imported ${identityShape} fact identities support maintenance and undo without changing their content`, async () => {
        // The portable decoder supplies empty IDs; import is the identity boundary.
        const facts = host.fixture.json.facts;
        for (const fact of facts) fact.id = identityShape === 'portable' ? '' : 'f-8';
        facts.at(-1).id = 'retained-identity';
        const content = facts.map(({ id: _id, ...fact }) => fact);
        const imported = await importFixture();
        assert.equal(new Set(imported.facts.map(f => f.id)).size, facts.length);
        assert.ok(imported.facts.every(f => f.id));
        assert.equal(imported.facts.at(-1).id, 'retained-identity');
        if (identityShape === 'duplicate') assert.equal(imported.facts[0].id, 'f-8');
        assert.deepEqual(imported.facts.map(({ id: _id, _addedAt: _floor, ...fact }) => fact),
            content.map(({ _addedAt: _floor, ...fact }) => fact));
        assert.deepEqual(disk().storySummary.json.facts, imported.facts);

        await maintain([{ ...fixFact, key: imported.facts[0].id }]);
        assert.equal(ext().storySummary.json.facts[0].o, fixFact.patch.o);
        assert.equal((await mod.rollbackSummaryOnce(host.context.chatId)).success, true);
        assert.deepEqual(ext().storySummary.json.facts, imported.facts);
        assert.deepEqual(disk().storySummary.json.facts, imported.facts);
    });
}

function readMaintenanceState() {
    const store = mod.getSummaryStore();
    return { chatId: host.context.chatId, chat: host.context.chat, store, json: store.json,
        cutoff: store.lastSummarizedMesId, atoms: mod.getStateAtoms(), l0Index: mod.getL0Index() };
}

async function saveMaintenanceSession(session) {
    return mod.commitMemorySession(session, { runId: 'session-test', calls: [] }, {
        read: readMaintenanceState,
        commit: (next, previous, _impact, validate) => mod.commitSummaryMemory(host.context.chatId, next,
            { previous, validate, maintenanceWrite: true }),
    });
}

for (const change of ['append', 'edit']) test(`content-sync entry keeps maintenance alive while retiring ${change} caches`, async () => {
    await importFixture(); await seedAnchors();
    const original = structuredClone(ext().storySummary.json);
    const tracker = mod.createMessageSourceTracker(); tracker.reset(host.context);
    const session = mod.createMemorySession(readMaintenanceState()); session.initial();
    session.runTool('ReadSource', { floor: 2 }, readMaintenanceState());
    let syncing;
    const sync = () => { syncing = mod.synchronizeSourceCaches(tracker, host.context); return syncing; };
    const gate = entry(['runContentChangeSync'], {
        getContext: () => host.context, isStorySummaryEnabledForCurrentChat: () => true,
        messageSources: tracker, memoryMaintenance: { cancel: () => assert.fail('source-only change cancelled maintenance') },
        handleMessageUpdated: sync, recallReuse: { invalidate() {}, historyChanged() {} },
        cancelPendingHide() {}, cancelEmbeddingWriteTasks: vectorWrites.cancelEmbeddingWriteTasks,
        isChatStale: () => false, clearHideState: async () => {}, reportMemorySaveFailure: assert.fail,
        xbLog: { error: assert.fail },
    });
    if (change === 'append') host.context.chat.push({ mes: '新的尾楼', is_user: false });
    else host.context.chat[1].mes = '修改后的真实原因，原先只是传闻。';
    gate.runContentChangeSync(sync);
    assert.equal((await syncing).status, 'synced');
    assert.deepEqual(ext().storySummary.json, original);
    assert.equal(ext().storySummary.lastSummarizedMesId, 23);
    assert.equal(session.runTool('ReadSource', { floor: 2 }, readMaintenanceState()).items[0].text, host.context.chat[1].mes);
    session.runTool('EditMemory', { edits: [fixFact] });
    const saved = await saveMaintenanceSession(session);
    assert.equal(saved.receipt.operations.length, 1);
    assert.equal(disk().storySummary.json.facts[0].o, fixFact.patch.o);
});

test('source edits after reading do not reject confirmed maintenance completion', async () => {
    await importFixture();
    const session = mod.createMemorySession(readMaintenanceState()); session.initial();
    session.runTool('ReadSource', { floor: 2 }, readMaintenanceState());
    host.context.chat = structuredClone(host.context.chat);
    host.context.chat[1].mes += ' 原文修订';
    host.context.chat[20].mes += ' 未读原文修订';
    host.context.chat.push({ mes: '边界以后的新楼', is_user: false });
    session.runTool('ReadSource', { floor: 2 }, readMaintenanceState());
    session.runTool('CompleteMaintenance', { from: 1, to: 24 });
    const saved = await saveMaintenanceSession(session);
    assert.deepEqual(saved.ranges.completed, [{ from: 1, to: 24 }]);
    assert.deepEqual(saved.ranges, progress());
    assert.deepEqual(disk(), ext());
});

test('an existing source warning does not erase newly confirmed maintenance on later saves', async () => {
    await importFixture(); await completeRange();
    mod.noteInvalidMemorySource(5);
    const marked = mod.readSummaryMemory(); marked.storySummary.sourceInvalidFromFloor = 5;
    await mod.commitSummaryMemory(host.context.chatId, marked);
    assert.deepEqual(progress().pending, [{ from: 6, to: 24 }]);
    const session = mod.createMemorySession(readMaintenanceState()); session.initial();
    session.runTool('CompleteMaintenance', { from: 6, to: 24 });
    const saved = await saveMaintenanceSession(session);
    assert.deepEqual(saved.ranges, progress());
    assert.deepEqual(progress().pending, []);
    assert.equal(ext().storySummary.sourceInvalidFromFloor, 5);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, host.context.chat.length), false);
    const unrelated = mod.readSummaryMemory(); unrelated.storySummary.updatedAt = Date.now();
    await mod.commitSummaryMemory(host.context.chatId, unrelated);
    assert.deepEqual(progress().pending, []);
    assert.deepEqual(disk(), ext());
    const expanded = mod.readSummaryMemory(); expanded.storySummary.sourceInvalidFromFloor = 2;
    await mod.commitSummaryMemory(host.context.chatId, expanded);
    assert.deepEqual(progress().pending, [{ from: 3, to: 24 }]);
    assert.deepEqual(disk(), ext());
});

// Acceptance: earlier maintenance cannot discard a paid generation; new facts
// and arcs win, causal links follow merges, and undo restores the maintained base.
// Cost: wasted calls, lost memory, mislinked events or broken rollback.
test('generation merges concurrent factual corrections and preserves their exact undo', async () => {
        await importFixture();
        const initial = mod.readSummaryMemory();
        initial.storySummary.json.arcs = [{ name: '夏实', trajectory: '出发前', progress: 0.1, moments: [], _addedAt: 23 }];
        await mod.commitSummaryMemory(host.context.chatId, initial);
        host.context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发，确认了新的回收原因。', is_user: false });
        let release, entered, calls = 0;
        const started = new Promise(resolve => { entered = resolve; });
        host.generate = () => { calls++; entered(); return new Promise(resolve => { release = resolve; }); };
        const generating = mod.runSummaryGeneration(25, { trigger: { delayFloors: 0 } });
        await started;
        let maintained;
        try {
            const session = mod.createMemorySession(readMaintenanceState()); session.initial();
            const edit = session.runTool('EditMemory', { edits: [
                fixFact,
                { kind: 'edit', collection: 'facts', key: 'f-3', patch: { o: '北京' } },
            ] });
            assert.equal(edit.status, 'staged', JSON.stringify(edit));
            await saveMaintenanceSession(session);
            maintained = mod.readSummaryMemory();
        } finally {
            release(JSON.stringify({ events: [
                { title: '次日出发', summary: '两人共同出发。(#25-26)', causedBy: ['evt-4'] },
                { title: '途中确认', summary: '途中确认新的原因。(#26)', causedBy: ['new-1', 'evt-4'] },
            ], factUpdates: [{ s: '夏实', p: '回收原因', o: '新剧情确认的原因', isState: false }],
            arcUpdates: [{ name: '夏实', trajectory: '新剧情进展', progress: 80 }], newCharacters: ['同行者'] }));
        }
        const result = await generating;
        assert.equal(result.success, true, JSON.stringify(result));
        assert.equal(calls, 1);
        assert.equal(ext().storySummary.json.events, undefined);
        assert.equal(ext().storySummary.json.facts.find(fact => fact.id === 'f-1').o, '新剧情确认的原因');
        assert.equal(ext().storySummary.json.facts.find(fact => fact.id === 'f-3').o, '北京');
        assert.equal(ext().storySummary.json.arcs[0].trajectory, '出发前');
        assert.equal(ext().storySummary.json.arcs[0].progress, 0.1);
        assert.equal(ext().storySummary.json.characters.main.at(-1).name, '同行者');
        assert.deepEqual(ext().storySummary.summaryHistory[0], maintained.storySummary.summaryHistory[0]);
        assert.deepEqual(disk(), ext());
        assert.equal((await mod.rollbackSummaryOnce(host.context.chatId)).success, true);
        assert.deepEqual(ext().storySummary.json, maintained.storySummary.json);
        assert.deepEqual(ext().storySummary.summaryHistory, maintained.storySummary.summaryHistory);
        assert.deepEqual(disk(), ext());
});

for (const action of ['completion', 'outcome', 'anchor', 'summary']) {
    test(`pending generation preserves ${action} maintenance while committing new content`, async () => {
        await importFixture(); await seedAnchors();
        const initial = mod.readSummaryMemory();
        initial.storySummary.updatedAt = 1;
        await mod.commitSummaryMemory(host.context.chatId, initial);
        host.context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
        const session = mod.createMemorySession(readMaintenanceState()); session.initial();
        let release, entered;
        const started = new Promise(resolve => { entered = resolve; });
        host.generate = () => { entered(); return new Promise(resolve => { release = resolve; }); };
        const generating = mod.runSummaryGeneration(25, { trigger: { delayFloors: 0 } });
        await started;
        if (action === 'completion') session.runTool('CompleteMaintenance', { from: 1, to: 24 });
        else if (action === 'outcome') session.conclude({ status: 'partial', summary: '下次继续' });
        else session.runTool('EditMemory', { edits: [action === 'anchor' ? fixAnchor : fixFact] });
        let saved;
        try { saved = await saveMaintenanceSession(session); }
        finally { release(JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '共同出发', isState: false }] })); }
        const result = await generating;
        assert.equal(result.success, true, JSON.stringify(result));
        assert.equal(result.stale, undefined);
        assert.equal(saved.current.store.updatedAt === 1, action !== 'summary');
        assert.ok(ext().storySummary.summaryHistory[0].maintenance.some(receipt => receipt.id === saved.receipt.id));
        assert.equal(ext().storySummary.lastSummarizedMesId, 25);
        if (action === 'summary') assert.equal(ext().storySummary.json.facts[0].o, fixFact.patch.o);
        if (action === 'anchor') assert.equal(ext().stateAtoms[0].semantic, fixAnchor.patch.semantic);
    });
}

for (const scenario of ['completion', 'outcome', 'anchor', 'summary', 'source-edit', 'cancel', 'chat-switch', 'save-rejected', 'save-unconfirmed']) {
    test(`summary response during ${scenario} maintenance save waits, then revalidates before committing`, async () => {
        await importFixture(); await seedAnchors();
        const initial = mod.readSummaryMemory();
        host.context.chat.push({ mes: '次日', is_user: true }, { mes: '共同出发', is_user: false });
        const session = mod.createMemorySession(readMaintenanceState()); session.initial();
        const controller = new AbortController();
        let release, entered, calls = 0, settled = false;
        const started = new Promise(resolve => { entered = resolve; });
        host.generate = () => { calls++; entered(); return new Promise(resolve => { release = resolve; }); };
        const generating = mod.runSummaryGeneration(25, { trigger: { delayFloors: 0 } }, {}, { signal: controller.signal })
            .then(result => { settled = true; return result; });
        await started;
        if (scenario === 'outcome') session.conclude({ status: 'partial', summary: '下次继续' });
        else if (scenario === 'anchor' || scenario === 'summary') {
            session.runTool('EditMemory', { edits: [scenario === 'anchor' ? fixAnchor : fixFact] });
        } else session.runTool('CompleteMaintenance', { from: 1, to: 24 });
        let finishSave, saveEntered;
        const saveStarted = new Promise(resolve => { saveEntered = resolve; });
        host.afterSave = () => { saveEntered(); return new Promise(resolve => { finishSave = resolve; }); };
        if (scenario === 'save-rejected') {
            host.expireReadback = true;
            host.mode = 'old';
            const saveMetadata = host.context.saveMetadata;
            host.context.saveMetadata = async () => {
                try { await saveMetadata(); }
                finally { host.mode = 'save'; host.context.saveMetadata = saveMetadata; }
            };
        }
        if (scenario === 'save-unconfirmed') host.mode = 'read_fail';
        const writes = host.writes;
        const saving = saveMaintenanceSession(session);
        const saved = scenario === 'save-rejected'
            ? assert.rejects(saving, { code: 'metadata_not_saved', uncertain: false })
            : scenario === 'save-unconfirmed'
                ? assert.rejects(saving, { code: 'metadata_save_unconfirmed', uncertain: true }) : saving;
        let result, maintenance;
        try {
            await saveStarted;
            release(JSON.stringify({ events: [], factUpdates: [{ s: '旅人', p: '行程', o: '共同出发', isState: false }] }));
            await nextTurn();
            assert.equal(settled, false);
            assert.equal(host.writes, writes + 1);
            if (scenario === 'source-edit') host.context.chat[24].mes = '修改后的来源';
            if (scenario === 'chat-switch') host.context = { ...host.context, chatId: 'other-chat' };
            if (scenario === 'cancel') {
                controller.abort();
                await nextTurn();
                assert.equal(settled, true); // Cancellation must not wait for the unrelated save.
            }
        } finally {
            host.afterSave = null;
            finishSave?.();
            try { maintenance = await saved; }
            finally { host.mode = 'save'; host.expireReadback = false; result = await generating; }
        }
        const commits = ['completion', 'outcome', 'anchor', 'summary', 'save-rejected', 'save-unconfirmed'].includes(scenario);
        assert.equal(result.success, commits, JSON.stringify(result));
        assert.equal(result.stale === true, scenario === 'source-edit');
        assert.equal(result.cancelled === true, ['cancel', 'chat-switch'].includes(scenario));
        assert.equal(mod.getMemoryCommitState(), 'ready');
        assert.equal(calls, 1);
        assert.equal(host.writes, writes + 1 + Number(commits));
        assert.equal(ext().storySummary.lastSummarizedMesId, commits ? 25 : 23);
        if (maintenance) assert.ok(ext().storySummary.summaryHistory[0].maintenance.some(receipt => receipt.id === maintenance.receipt.id));
        if (scenario === 'save-rejected') assert.deepEqual(ext().storySummary.summaryHistory[0].maintenance,
            initial.storySummary.summaryHistory[0].maintenance);
        assert.equal(ext().storySummary.json.facts.some(fact => fact.s === '旅人' && fact.p === '行程' && fact.o === '共同出发'), commits);
        if (scenario === 'summary') assert.equal(ext().storySummary.json.facts[0].o, fixFact.patch.o);
        if (scenario === 'anchor') assert.equal(ext().stateAtoms[0].semantic, fixAnchor.patch.semantic);
        assert.deepEqual(host.files.get(host.fixture.chatId).extensions.TavernKitchen, ext());
    });
}

test('an old event edit cannot add a card to a migrated chat', async () => {
    await importFixture();
    const session = mod.createMemorySession(readMaintenanceState());
    const before = mod.readSummaryMemory();
    const rejected = session.runTool('EditMemory', { edits: [{ kind: 'edit', collection: 'events', key: 'evt-1', patch: { title: '旧事件' } }] });
    assert.equal(rejected.status, 'needs_fix');
    assert.deepEqual(mod.readSummaryMemory(), before);
});

test('index status and repair include earlier runs regardless of results pagination', async () => {
    await importFixture(); await seedAnchors();
    await maintain([fixAnchor]);
    const next = mod.readSummaryMemory();
    for (let i = 0; i < 10; i++) mod.appendMaintenanceReceipt(next.storySummary, {
        version: 2, id: `later-${i}`, runId: `later-run-${i}`, policy: memoryPolicy(), operations: [],
        coverage: { supplied: [], missingAnchors: [] }, outcome: { status: 'partial' },
    });
    await mod.commitSummaryMemory(host.context.chatId, next, { maintenanceWrite: true });
    host.vectorConfig.enabled = true;
    const maintenance = mod.createMemoryMaintenanceHost({ isEnabled: () => true, changed() {} });
    const first = await maintenance.results(), older = await maintenance.results(10);
    assert.equal(first.items.length, 10); assert.equal(older.items.length, 1);
    assert.deepEqual(first.index, { status: 'pending', count: 1 });
    assert.deepEqual(older.index, first.index);
    let embedded = 0;
    host.embed = texts => { embedded += texts.length; return texts.map(() => [1, 0]); };
    assert.equal((await maintenance.repairIndexes()).status, 'ready');
    assert.equal(embedded, 2); // One anchor scene and its relation.
    assert.deepEqual((await maintenance.results()).index, { status: 'ready', count: 0 });
    assert.deepEqual((await maintenance.results(10)).index, { status: 'ready', count: 0 });
});

async function completeRange(from = 1, to = 24) {
    const next = mod.readSummaryMemory();
    mod.appendMaintenanceReceipt(next.storySummary, { version: 2, id: `complete-${host.writes}`, runId: 'complete-run', policy: memoryPolicy(),
        cutoff: host.fixture.cutoff + 1, operations: [], completion: { from, to }, coverage: { supplied: [], missingAnchors: [] } });
    await mod.commitSummaryMemory(host.context.chatId, next, { maintenanceWrite: true });
}
const progress = () => mod.maintenanceRanges(ext().storySummary.summaryHistory, ext().storySummary.lastSummarizedMesId);

test('completion survives reload; manual edits invalidate its fixed baseline in the same confirmed save', async () => {
    await importFixture(); await completeRange();
    host.metadata = structuredClone(host.metadata); mod.reload(); mod.getSummaryStore();
    assert.deepEqual(progress().pending, []);
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = '用户改动';
    await mod.commitSummaryMemory(host.context.chatId, next);
    assert.deepEqual(progress().pending, [{ from: 1, to: 24 }]);
    assert.deepEqual(disk(), ext());
});

test('late anchors reopen just their floor; clear and same-ID regeneration never resurrect completion', async () => {
    await importFixture(); await completeRange();
    const next = mod.readSummaryMemory(); next.stateAtoms.push(structuredClone(host.fixture.atoms[0]));
    await mod.commitSummaryMemory(host.context.chatId, next);
    assert.deepEqual(progress().pending, [{ from: 2, to: 2 }]);
    await completeRange(2, 2);
    const { next: cleared } = mod.invalidateMemoryAnchors(mod.readSummaryMemory(), 1, 'anchors_cleared');
    await mod.commitSummaryMemory(host.context.chatId, cleared);
    assert.equal(ext().stateAtoms.length, 0);
    const afterClear = progress();
    host.metadata = structuredClone(host.metadata); mod.reload(); mod.getSummaryStore();
    const rebuilt = mod.readSummaryMemory(); rebuilt.stateAtoms.push(structuredClone(host.fixture.atoms[0]));
    await mod.commitSummaryMemory(host.context.chatId, rebuilt);
    assert.deepEqual(progress(), afterClear);
    assert.deepEqual(disk(), ext());
});

test('own edits retain completed ranges; import replacement and rollback remove their receipts', async () => {
    await importFixture(); await completeRange();
    const next = mod.readSummaryMemory(); next.storySummary.json.facts[0].o = '维护修正';
    await mod.commitSummaryMemory(host.context.chatId, next, { maintenanceWrite: true });
    assert.deepEqual(progress().pending, []);
    await mod.rollbackSummaryOnce(host.context.chatId);
    assert.deepEqual(progress().completed, []);
    await completeRange(); await importFixture();
    assert.deepEqual(progress().completed, []);
});

test('old-server save and uncertain save never publish newly completed ranges', async () => {
    for (const mode of ['old', 'read_fail']) {
        host.mode = 'save'; await importFixture();
        host.mode = mode;
        await assert.rejects(completeRange());
        const published = mod.readPublishedSummaryMemory();
        assert.deepEqual(mod.maintenanceRanges(published.storySummary.summaryHistory, 23).completed, []);
        if (mode === 'read_fail') assert.equal(mod.getMemoryCommitState(), 'unconfirmed');
    }
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

test('actual import baseline: repeated maintenance is reversible but imported events/facts are not erased', async () => {
    const original = await importFixture();
    assert.equal(mod.getRollbackOnceTargetEndMesId(ext().storySummary), null);
    await maintain([fixFact]);
    await maintain([{ ...fixFact, patch: { o: '夏实只听说，未查证' } }]);
    host.metadata = structuredClone(host.metadata); mod.reload();
    const result = await mod.rollbackSummaryOnce(host.context.chatId);
    assert.equal(result.success, true);
    assert.equal(result.targetEndMesId, 23);
    assert.deepEqual(ext().storySummary.json, original);
    assert.equal(original.events, undefined);
    assert.match(timelineRounds(ext().storySummary)[0].summary, /青山船票争吵/);
    assert.equal(original.facts.length, 5);
    assert.equal(mod.getRollbackOnceTargetEndMesId(ext().storySummary), null);
    assert.deepEqual(disk(), ext());
});

test('fact correction survives the next generated batch; batch then maintenance rollback restores the original facts', async () => {
    host.fixture.json.facts.push({ id: 'f-6', s: '药君', p: '物品', o: '拥有药杖', since: 3, _addedAt: 19 });
    const original = await importFixture();
    const correction = { kind: 'edit', collection: 'facts', key: 'f-2', patch: { s: '药君', o: '拥有药箱和药杖' } };
    await assert.rejects(maintain([correction]), { code: 'fact_conflict' });
    assert.deepEqual(disk().storySummary.json, original);
    await maintain([correction, { kind: 'delete', collection: 'facts', key: 'f-6' }]);
    const corrected = structuredClone(ext().storySummary.json);
    const next = mod.readSummaryMemory();
    const merged = mod.mergeNewData(next.storySummary.json, { factUpdates: [] }, 25, { returnMeta: true });
    assert.deepEqual(merged.json.facts, corrected.facts);
    next.storySummary.json = merged.json;
    next.storySummary.lastSummarizedMesId = 25;
    mod.addSummarySnapshot(next.storySummary, 23, 25, merged.undo);
    host.context.chat.push({ mes: '次日', is_user: true }, { mes: '出发' });
    await mod.commitSummaryMemory(host.context.chatId, next);
    assert.equal((await mod.rollbackSummaryOnce(host.context.chatId)).success, true);
    assert.deepEqual(ext().storySummary.json, corrected);
    assert.equal((await mod.rollbackSummaryOnce(host.context.chatId)).success, true);
    assert.deepEqual(ext().storySummary.json, original);
    assert.deepEqual(disk(), ext());
});

test('upstream import boundary converts once; corrupt exact inverse cannot become a baseline', () => {
    const oldImport = [{ endMesId: 23 }];
    const upgraded = mod.upgradeSummaryHistory(oldImport);
    assert.equal(upgraded.value[0].kind, 'baseline');
    assert.equal(mod.getRollbackOnceTargetEndMesId({ lastSummarizedMesId: 23, summaryHistory: upgraded.value }), null);
    assert.throws(() => mod.upgradeSummaryHistory([{ format: 1, previousEndMesId: -1, endMesId: 23, undo: { version: 1, unknown: true } }]));
});

for (const kind of ['edit', 'delete']) {
    test(`${kind} anchor: clear retires history, reload and same-ID extraction cannot resurrect old source`, async () => {
        const original = await importFixture();
        await seedAnchors();
        await maintain([fixFact, { ...fixAnchor, kind }]);
        await mod.saveStateVectors(host.context.chatId, [{ atomId: 'atom-1-0', floor: 1, vector: [1, 0] }], 'test');
        const writes = host.writes;
        await mod.invalidateSummaryAnchors(host.context.chatId, 0, 'anchors_cleared');
        assert.equal(host.writes - writes, 1);
        assert.equal((await mod.getAllStateVectors(host.context.chatId)).length, 0);
        const receipt = ext().storySummary.summaryHistory[0].maintenance[0];
        assert.equal(receipt.operations[1].changes[0].retired.reason, 'anchors_cleared');
        assert.equal(mod.maintenanceImpact(receipt.operations).atomIds.length, 0);
        assert.ok(receipt.operations[1].changes[0].before);
        host.metadata = structuredClone(host.metadata); mod.reload();
        const extraction = mod.createAnchorExtractionDraft(host.context.chatId, host.context.chat);
        const regenerated = { ...host.fixture.atoms[0], semantic: '重新提取的新正文，不能被旧撤销覆盖' };
        extraction.addAtoms([regenerated]);
        extraction.setStatus(1, { status: 'ok', atoms: 1 });
        await extraction.commit();
        assert.equal((await mod.rollbackSummaryOnce(host.context.chatId)).success, true);
        assert.deepEqual(ext().storySummary.json, original);
        assert.deepEqual(ext().stateAtoms, [regenerated]);
    });
}

test('active anchor conflicts still refuse undo; retirement only skips explicitly invalidated changes', async () => {
    await importFixture(); await seedAnchors(); await maintain([fixFact, fixAnchor]);
    const edit = mod.readSummaryMemory();
    edit.stateAtoms[0].semantic = '人工修改';
    await mod.commitSummaryMemory(host.context.chatId, edit);
    const before = structuredClone(ext());
    const result = await mod.rollbackSummaryOnce(host.context.chatId);
    assert.equal(result.reason, 'history_discontinuous');
    assert.deepEqual(ext(), before);
});

test('source invalidation scans every batch, including absent anchors, before undoing a generated batch', async () => {
    await importFixture(); await seedAnchors();
    await maintain([{ ...fixAnchor, kind: 'delete' }]);
    // Add a new generated batch after the imported baseline.
    const next = mod.readSummaryMemory();
    const merged = mod.mergeNewData(next.storySummary.json, { factUpdates: [{ s: '夏实', p: '城市', o: '北京' }] }, 25, { returnMeta: true });
    next.storySummary.json = merged.json;
    next.storySummary.lastSummarizedMesId = 25;
    mod.addSummarySnapshot(next.storySummary, 23, 25, merged.undo);
    await mod.commitSummaryMemory(host.context.chatId, next);
    host.context.chat.push({ mes: 'new', is_user: true }, { mes: 'new reply', is_user: false });
    // Ordinary edit keeps L2 but retires the older, already absent L0 operation.
    await mod.rollbackSummaryIfNeeded({ invalidateFromFloor: 1 });
    assert.equal(ext().storySummary.lastSummarizedMesId, 25);
    assert.ok(ext().storySummary.summaryHistory[0].maintenance[0].operations[0].changes[0].retired);
    const result = await mod.rollbackSummaryIfNeeded({ changedFromFloor: 24 });
    assert.equal(result.status, 'rolled_back');
    assert.equal(ext().storySummary.lastSummarizedMesId, 23);
    assert.equal((await mod.rollbackSummaryOnce(host.context.chatId)).success, true);
    assert.equal(ext().stateAtoms.length, 0);
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

test('undoing baseline maintenance cannot clear an unresolved source boundary', async () => {
    const original = await importFixture(); await maintain([fixFact]);
    await mod.rollbackSummaryIfNeeded({ changedFromFloor: 20 });
    assert.equal((await mod.rollbackSummaryOnce(host.context.chatId)).success, true);
    assert.deepEqual(ext().storySummary.json, original);
    assert.equal(ext().storySummary.sourceRollbackFromFloor, 20);
    assert.equal(mod.isSummaryConsumable(ext().storySummary, 24), false);
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
    await importFixture(); await seedAnchors(); await maintain([fixAnchor]);
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
    await mod.clearSummaryData(host.context.chatId);
    assert.equal(ext().stateAtoms.length, 0);
    assert.equal(mod.getMemoryCommitState(), 'ready');
});

test('ordinary source edit never calls a failing host save', async () => {
    await importFixture(); await seedAnchors(); await maintain([fixAnchor]);
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
    await maintain([fixFact]);
    await extraction.commit();
    assert.equal(ext().storySummary.json.facts[0].o, fixFact.patch.o);
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

// Acceptance: source changes win over both outcomes of a submitted manual/Agent save.
// Cost: old-branch anchors resurrected or unrelated durable edits lost.
for (const outcome of ['saved-original', 'saved-retired', 'not-saved', 'conflict']) {
    test(`retirement during a durable save preserves its actual outcome: ${outcome}`, async () => {
        await importFixture(); await seedAnchors(); await maintain([fixAnchor]);
        const chatId = host.context.chatId;
        const previous = mod.readSummaryMemory();
        const next = structuredClone(previous);
        next.storySummary.json.facts[0].o = 'durable edit';
        if (outcome === 'not-saved') host.mode = 'old';
        let release;
        host.afterSave = () => new Promise(resolve => { release = resolve; });
        const writing = mod.commitSummaryMemory(chatId, next).then(() => null, error => error.code);
        while (!release) await nextTurn();
        const beforeIO = { writes: host.writes, reads: host.reads };
        host.context.chat[1].mes += ' replaced source';
        mod.retireSummaryMemorySources(chatId, { floors: [1] });
        assert.equal(mod.getPublishedStateAtoms().some(atom => atom.floor === 1), false);
        assert.equal(ext().l0Index.byFloor[1], undefined);
        assert.deepEqual({ writes: host.writes, reads: host.reads }, beforeIO);
        if (outcome === 'saved-retired') host.files.set(chatId, structuredClone(host.metadata));
        if (outcome === 'conflict') { disk().storySummary.json.facts[1].o = 'unrelated external edit'; host.expireReadback = true; }
        release();
        const error = await writing;
        assert.equal(error, outcome === 'not-saved' ? 'metadata_not_saved' : outcome === 'conflict' ? 'metadata_save_conflict' : null);
        assert.equal(ext().stateAtoms.some(atom => atom.floor === 1), false);
        assert.equal(mod.getPublishedStateAtoms().some(atom => atom.floor === 1), false);
        assert.equal(mod.readPublishedSummaryMemory().storySummary.json.facts[0].o,
            outcome.startsWith('saved') ? 'durable edit' : previous.storySummary.json.facts[0].o);
        assert.ok(mod.readPublishedSummaryMemory().storySummary.summaryHistory[0].maintenance[0].operations[0].changes[0].retired);
    });
}

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

for (const mixed of [false, true]) test(`Agent reports the post-swipe receipt, preserving unrelated edits: ${mixed}`, async () => {
    await importFixture(); await seedAnchors();
    const session = mod.createMemorySession(readMaintenanceState()); session.initial();
    session.runTool('EditMemory', { edits: mixed ? [fixAnchor, fixFact] : [fixAnchor] });
    session.conclude({ status: 'completed' });
    let release;
    host.afterSave = () => new Promise(resolve => { release = resolve; });
    const writing = saveMaintenanceSession(session).then(saved => ({ saved }), error => ({ error: error.code }));
    while (!release) await nextTurn();
    mod.retireSummaryMemorySources(host.context.chatId, { floors: [1] });
    release();
    const result = await writing;
    assert.equal(result.error, undefined);
    session.acknowledge(result.saved);
    assert.equal(session.savedCount, mixed ? 1 : 0);
    assert.equal(result.saved.outcome.status, mixed ? 'partially_superseded' : 'superseded');
    const history = mod.projectMaintenanceRun(ext().storySummary, 'session-test');
    assert.equal(history.outcome.status, result.saved.outcome.status);
    assert.equal(history.counts.anchors, 0);
    if (mixed) {
        assert.equal(result.error, undefined);
        assert.equal(result.saved.current.atoms.some(atom => atom.floor === 1), false);
        assert.deepEqual(result.saved.impact.atomIds, []);
        assert.equal(result.saved.current.json.facts[0].o, fixFact.patch.o);
        assert.ok(result.saved.receipt.operations[0].changes[0].retired);
    } else assert.equal(result.saved.current.atoms.some(atom => atom.floor === 1), false);
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
const inlinePayload = (summary, records = []) => ({ summary, updates: { storyUpdates: records } });
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
    await f.archive.prepare(); const service = f.service(), state = await service.read();
    const source = { module: 'manual', key: 'seed', label: '测试开局' };
    return (await service.commit(service.command(state, [{ type: 'create', id: 'resource-holder', name: '主角', kind: 'person', source },
        { type: 'set', entityId: 'resource-holder', field: 'coins', value: 10, source },
        { type: 'create', id: 'distant-npc', name: '远方人物', kind: 'person', source },
        { type: 'set', entityId: 'distant-npc', field: '秘密', value: '藏着一封信，主角并不知情。', source }], '开局'))).state;
}
const updateProposal = floor => ({ type: 'field', entityId: 'resource-holder', field: 'coins', before: { present: true, value: 10 }, value: 5,
    nature: 'established_fact', evidence: { floor, quote: '铁剑' } });

test('correcting a paid turn survives reload without resubmitting its world effect', async t => {
    await importFixture();
    const f = sourceArchive(t), floor = appendSourceTurn();
    host.context.chat[floor].mes = '铁匠收下五金币。你拿到了铁剑。';
    await seedUpdateWorld(f);
    host.generate = async ({ updateContext }) => JSON.stringify({ summary: '买下铁剑。', worldUpdate: unifiedBlock(updateContext,
        [{ ...updateProposal(floor), groupId: 'payment', certainty: 'explicit', evidence: { floor, quote: '铁匠收下五金币' } }]) });
    assert.equal((await mod.runSummaryGeneration(floor, { trigger: {} })).success, true);
    const before = await f.service().read(), batch = structuredClone(disk().storySummary.summaryHistory.at(-1));
    assert.equal(before.entities.find(entity => entity.id === 'resource-holder').fields.coins.value, 5);
    const current = readMaintenanceState(), session = mod.createMemorySession(current);
    await session.reviewUnit('ReviseRoundSummary', { to: floor + 1, version: 0, previous: batch.summary,
        text: '主角支付五金币，拿到了铁剑。', evidence: { floor: floor + 1, quote: '拿到了铁剑' } }, current);
    await saveMaintenanceSession(session);
    host.metadata = structuredClone(host.files.get(host.context.chatId)); mod.reload();
    const store = mod.getSummaryStore();
    assert.equal(timelineRounds(store).at(-1).version, 1);
    assert.deepEqual(store.summaryHistory.at(-1).sourceReceipt, batch.sourceReceipt);
    assert.deepEqual(store.summaryHistory.at(-1).worldUpdate, batch.worldUpdate);
    await f.archive.prepare();
    const after = await f.service().read();
    assert.deepEqual(after.events.slice(0, before.events.length), before.events);
    // Reopening may confirm source delivery. It must never repeat the payment.
    assert.ok(after.events.slice(before.events.length).every(event => event.effects.every(effect => effect.type === 'source')));
    assert.deepEqual(mod.worldUpdates(after), mod.worldUpdates(before));
    assert.equal(after.entities.find(entity => entity.id === 'resource-holder').fields.coins.value, 5);
});

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

test('manual floor revisions preserve later source receipts through replay and confirmed metadata storage', async t => {
    await importFixture(); const f = sourceArchive(t), first = appendSourceTurn(), controller = inlineController();
    await controller.update(first, { payload: inlinePayload('购买铁剑') });
    const second = appendSourceTurn(); await controller.update(second, { payload: inlinePayload('离开铁匠铺') });
    const receipt = disk().storySummary.summaryHistory.at(-1).sourceReceipt;
    await controller.update(first, { payload: inlinePayload('买剑后收好收据') });
    assert.deepEqual(disk().storySummary.summaryHistory.at(-1).sourceReceipt, receipt);
    await f.archive.prepare(); const turns = mod.currentTurns(await f.service().read()).filter(item => item.source.end >= first);
    assert.equal(turns.length, 2); assert.ok(turns.every(item => item.memory.length === 1));
});

function inlineController() {
    return mod.createFloorSummaryController({ getContext: () => host.context, enabled: () => true,
        getConfig: () => ({ enabled: true, review: false }), ensureSources: () => mod.waitForMemoryCommit(),
        read: mod.readSummaryMemory, commit: mod.commitSummaryMemory, merge: mod.mergeNewData });
}
test('main reply commits once, replays a historical correction and survives actual reload and undo', async () => {
    await importFixture();
    const baseline = structuredClone(ext().storySummary);
    const start = host.context.chat.length;
    host.generate = () => assert.fail('main reply must not call independent summary API');
    const first = inlinePayload('抵达渡口', [{ id: 'scene', kind: 'scene', location: '渡口', situation: '等船', participants: [] }]);
    host.context.chat.push({ mes: '出发', is_user: true }, { mes: `正文<kitchen_summary>${JSON.stringify(first)}</kitchen_summary>` });
    const controller = inlineController();
    await controller.ingest(start + 1);
    const writes = host.writes;
    await controller.ingest(start + 1); assert.equal(host.writes, writes);
    const firstId = ext().storySummary.summaryHistory.at(-1).floorEntry.source.digest;
    const second = inlinePayload('船已开走', [{ id: 'scene', kind: 'scene', location: '码头', situation: '错过渡船', participants: [] }]);
    host.context.chat.push({ mes: '等着', is_user: true }, { mes: `正文<kitchen_summary>${JSON.stringify(second)}</kitchen_summary>` });
    await controller.ingest(start + 3);
    const secondId = ext().storySummary.summaryHistory.at(-1).floorEntry.source.digest;
    await controller.update(start + 1, { payload: inlinePayload('抵达旧渡口', first.updates.storyUpdates), reviewed: true });
    assert.equal(ext().storySummary.summaryHistory.at(-2).summary, '抵达旧渡口');
    assert.equal(ext().storySummary.summaryHistory.at(-2).floorEntry.source.digest, firstId);
    assert.equal(ext().storySummary.summaryHistory.at(-1).floorEntry.source.digest, secondId);
    assert.equal((ext().storySummary.json.storyRecords || []).some(record => record.kind === 'scene'), false);
    host.metadata = structuredClone(host.files.get(host.context.chatId)); mod.reload(); mod.getSummaryStore();
    assert.equal(ext().storySummary.summaryHistory.at(-2).floorEntry.payload.summary, '抵达旧渡口');
    assert.equal((await mod.executeRollback(host.context.chatId, mod.getSummaryStore(), baseline.lastSummarizedMesId)).status, 'rolled_back');
    assert.deepEqual(ext().storySummary.json.facts, baseline.json.facts);
    assert.ok(ext().storySummary.summaryHistory.every(batch => ![firstId, secondId].includes(batch.floorEntry?.source.digest)));
});
test('pending review, deletion and omission use one confirmed transaction; a failed save leaves current memory intact', async () => {
    await importFixture();
    const floor = host.context.chat.length + 1, payload = inlinePayload('确认收到信件');
    host.context.chat.push({ mes: '接信', is_user: true }, { mes: `正文<kitchen_summary>${JSON.stringify(payload)}</kitchen_summary>` });
    const controller = inlineController();
    await controller.update(floor, { payload, stage: true });
    assert.equal(ext().storySummary.lastSummarizedMesId, host.fixture.cutoff);
    await controller.update(floor, { reviewed: true });
    assert.equal(disk().storySummary.summaryHistory.at(-1).floorEntry.reviewed, true);
    await controller.update(floor, { omitted: true });
    assert.equal(timelineRounds(ext().storySummary).some(round => round._addedAt === floor), false);
    await controller.update(floor, { omitted: false });
    assert.equal(timelineRounds(ext().storySummary).some(round => round._addedAt === floor), true);
    const before = structuredClone(ext().storySummary);
    host.mode = 'old';
    await assert.rejects(controller.update(floor, { payload: inlinePayload('不应保存的修改') }));
    assert.deepEqual(ext().storySummary, before);
    host.mode = 'ok';
    await controller.update(floor, { deleted: true });
    assert.equal(ext().storySummary.summaryHistory.at(-1).floorEntry.deleted, true);
    assert.equal(timelineRounds(ext().storySummary).some(round => round._addedAt === floor), false);
});

test('earlier floor edits preserve later maintenance fields and replayed history remains undoable', async () => {
    await importFixture();
    const floor = host.context.chat.length + 1;
    const original = { summary: '灯塔熄灭', updates: { events: [{ title: '灯塔', summary: '灯灭了', participants: [] }] } };
    host.context.chat.push({ mes: '查看灯塔', is_user: true }, { mes: `灯塔熄灭。<kitchen_summary>${JSON.stringify(original)}</kitchen_summary>` });
    const controller = inlineController(); await controller.ingest(floor);
    const current = readMaintenanceState(), session = mod.createMemorySession(current);
    await session.reviewUnit('ReviseRoundSummary', { to: floor + 1, version: 0, previous: '灯塔熄灭',
        text: '灯塔的灯熄灭了。', evidence: { floor: floor + 1, quote: '灯塔熄灭' } }, current);
    await saveMaintenanceSession(session);
    assert.equal(timelineRounds(ext().storySummary).at(-1).summary, '灯塔的灯熄灭了。');
    await controller.update(floor, { payload: { ...original, summary: '守望者目睹灯塔熄灭' } });
    assert.equal(timelineRounds(ext().storySummary).at(-1).summary, '守望者目睹灯塔熄灭');
    host.metadata = structuredClone(host.files.get(host.context.chatId)); mod.reload();
    assert.equal((await mod.executeRollback(host.context.chatId, mod.getSummaryStore(), host.fixture.cutoff)).status, 'rolled_back');
    assert.ok(timelineRounds(ext().storySummary).every(row => row._addedAt < floor));
});

test('omitting an early round preserves source identity, restores safely, and stale source edits never overwrite memory', async () => {
    await importFixture(); const start = host.context.chat.length;
    const controller = inlineController();
    for (const text of ['第一封信', '第二封信']) {
        host.context.chat.push({ mes: '读信', is_user: true }, { mes: `<kitchen_summary>${JSON.stringify(inlinePayload(text))}</kitchen_summary>` });
        await controller.ingest(host.context.chat.length - 1);
    }
    const firstId = ext().storySummary.summaryHistory.at(-2).floorEntry.source.digest;
    const secondId = ext().storySummary.summaryHistory.at(-1).floorEntry.source.digest;
    await controller.update(start + 1, { deleted: true });
    host.context.chat.push({ mes: '再读', is_user: true }, { mes: `<kitchen_summary>${JSON.stringify(inlinePayload('第三封信'))}</kitchen_summary>` });
    await controller.ingest(start + 5);
    assert.notEqual(ext().storySummary.summaryHistory.at(-1).floorEntry.source.digest, firstId);
    await controller.update(start + 1, { deleted: false });
    assert.ok(ext().storySummary.summaryHistory.some(row => row.floorEntry?.source.digest === firstId));
    assert.ok(ext().storySummary.summaryHistory.some(row => row.floorEntry?.source.digest === secondId));
    const before = structuredClone(ext()); host.context.chat[start + 1].mes += '原文改变';
    await assert.rejects(controller.update(start + 1, { payload: inlinePayload('不该写入') }), /原文|候选/);
    assert.deepEqual(ext(), before);
});

test('an unsummarized earlier floor can be filled without losing a later inline summary', async () => {
    await importFixture(); const start = host.context.chat.length; const controller = inlineController();
    for (const text of ['先前没摘的信件', '后来已摘的信件']) host.context.chat.push({ mes: '读信', is_user: true },
        { mes: `<kitchen_summary>${JSON.stringify(inlinePayload(text))}</kitchen_summary>` });
    await controller.ingest(start + 3);
    const laterId = ext().storySummary.summaryHistory.at(-1).floorEntry.source.digest;
    await controller.ingest(start + 1);
    assert.equal(ext().storySummary.summaryHistory.at(-2).floorEntry.floor, start + 1);
    assert.equal(ext().storySummary.summaryHistory.at(-1).floorEntry.source.digest, laterId);
    assert.equal(ext().storySummary.lastSummarizedMesId, start + 3);
});

const inlineAnchor = { scene: '贝拉来到渡口，将失踪的通行证交还给守卫。', where: '渡口', edges: [{ s: '贝拉', t: '守卫', r: '交还通行证' }] };
test('main-reply anchors share review, confirmed save, omission, editing and exact rollback with summaries', async () => {
    await importFixture(); const original = structuredClone(ext());
    const floor = host.context.chat.length + 1;
    const payload = { ...inlinePayload('交还通行证'), anchors: [inlineAnchor] };
    host.context.chat.push({ mes: '还给守卫', is_user: true }, { mes: `<kitchen_summary>${JSON.stringify(payload)}</kitchen_summary>` });
    const controller = inlineController();
    await controller.update(floor, { payload, stage: true }); assert.deepEqual(ext().stateAtoms, original.stateAtoms);
    await controller.update(floor, { reviewed: true });
    const atom = ext().stateAtoms.find(row => row.floor === floor);
    assert.equal(atom.semantic, inlineAnchor.scene); assert.deepEqual(atom.edges, inlineAnchor.edges);
    assert.equal(ext().l0Index.byFloor[floor].status, 'ok'); assert.deepEqual(disk(), ext());
    assert.equal(mod.projectMaintenanceReceipts(ext().storySummary).items.some(run => run.runId === `inline-anchors-${floor}`), false);
    const before = structuredClone(ext()); host.mode = 'old';
    await assert.rejects(controller.update(floor, { payload: { ...payload, anchors: [] } })); assert.deepEqual(ext(), before); host.mode = 'ok';
    await controller.update(floor, { omitted: true }); assert.equal(ext().stateAtoms.some(row => row.floor === floor), false);
    await controller.update(floor, { omitted: false }); assert.equal(ext().stateAtoms.find(row => row.floor === floor).atomId, atom.atomId);
    await controller.update(floor, { payload: { ...payload, anchors: [{ ...inlineAnchor, where: '北岸渡口' }] } });
    assert.notEqual(ext().stateAtoms.find(row => row.floor === floor).atomId, atom.atomId);
    host.metadata = structuredClone(host.files.get(host.context.chatId)); mod.reload(); mod.getSummaryStore();
    assert.equal((await mod.executeRollback(host.context.chatId, mod.getSummaryStore(), host.fixture.cutoff)).status, 'rolled_back');
    assert.deepEqual(ext().stateAtoms, original.stateAtoms); assert.equal(ext().l0Index.byFloor[floor], undefined);
});

test('historical anchor replay preserves later manual corrections and explicit empty anchors remove the floor', async () => {
    await importFixture(); const floor = host.context.chat.length + 1;
    const payload = { ...inlinePayload('交还通行证'), anchors: [inlineAnchor] };
    host.context.chat.push({ mes: '还给守卫', is_user: true }, { mes: `<kitchen_summary>${JSON.stringify(payload)}</kitchen_summary>` });
    const controller = inlineController(); await controller.ingest(floor);
    const key = ext().stateAtoms.find(row => row.floor === floor).atomId;
    const session = mod.createMemorySession(readMaintenanceState()); session.initial();
    session.runTool('ReadMemory', { collection: 'anchors', key }, readMaintenanceState());
    const edit = session.runTool('EditMemory', { edits: [{ kind: 'edit', collection: 'anchors', key, patch: { where: '守卫岗亭' } }] });
    assert.equal(edit.status, 'staged', JSON.stringify(edit)); await saveMaintenanceSession(session);
    await controller.update(floor, { payload: { ...payload, summary: '修正摘要但保留本楼场景卡' } });
    assert.equal(ext().stateAtoms.find(row => row.atomId === key).where, '守卫岗亭');
    const before = structuredClone(ext());
    await assert.rejects(controller.update(floor, { payload: { ...payload, anchors: [] } }), /修订.*移除/);
    assert.deepEqual(ext(), before);
});

test('main reply anchors enter existing embedding repair without calling the anchor extraction model', async () => {
    await importFixture(); const floor = host.context.chat.length + 1;
    const payload = { ...inlinePayload('交还通行证'), anchors: [inlineAnchor] };
    host.context.chat.push({ mes: '还给守卫', is_user: true }, { mes: `<kitchen_summary>${JSON.stringify(payload)}</kitchen_summary>` });
    await inlineController().ingest(floor);
    host.vectorConfig = { enabled: true, embeddingApi: {} };
    const inputs = []; host.embed = texts => { inputs.push(...texts); return texts.map(() => [1, 0]); };
    assert.equal((await mod.getL0VectorBuildStatus(host.context.chatId)).missing > 0, true);
    const repaired = await mod.vectorizeMissingStateAtoms(host.context.chatId);
    assert.equal(repaired.success, true, JSON.stringify(repaired));
    assert.equal((await mod.getL0VectorBuildStatus(host.context.chatId)).missing, 0);
    assert.ok(inputs.includes(inlineAnchor.scene));
    const atom = ext().stateAtoms.find(row => row.floor === floor);
    assert.equal(await mod.stateVectorsTable.where('[chatId+atomId]').equals([host.context.chatId, atom.atomId]).count(), 1);
});

test('undo restores the pre-existing anchor extraction status along with the original hand-maintained anchor', async () => {
    await importFixture(); const floor = host.context.chat.length + 1;
    const payload = { ...inlinePayload('交还通行证'), anchors: [inlineAnchor] };
    host.context.chat.push({ mes: '还给守卫', is_user: true }, { mes: `<kitchen_summary>${JSON.stringify(payload)}</kitchen_summary>` });
    const before = mod.readSummaryMemory();
    before.stateAtoms.push({ atomId: 'hand-existing', floor, source: 'ai', semantic: '已手工整理的原场景记录，保留其原有含义。', where: '旧渡口', edges: [], quality: 0.3 });
    before.l0Index.byFloor[floor] = { floor, status: 'ok', atoms: 1, updatedAt: 12345 };
    await mod.commitSummaryMemory(host.context.chatId, before);
    await inlineController().ingest(floor);
    assert.equal(ext().stateAtoms.some(atom => atom.atomId === 'hand-existing'), false);
    assert.equal((await mod.executeRollback(host.context.chatId, mod.getSummaryStore(), host.fixture.cutoff)).status, 'rolled_back');
    assert.deepEqual(ext().stateAtoms, before.stateAtoms);
    assert.deepEqual(ext().l0Index.byFloor[floor], before.l0Index.byFloor[floor]);
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

test('six independent updates preserve all leaves until proofreading closes a unit', async t => {
    await importFixture(); const archive = sourceArchive(t); await archive.archive.prepare();
    let calls = 0;
    host.generate = async ({ updateContext }) => {
        assert.equal(updateContext.background.hierarchyAvailable, false);
        return JSON.stringify({ events: [], factUpdates: [], summary: '本轮' + (++calls), worldUpdate: unifiedBlock(updateContext) });
    };
    for (let i = 0; i < 6; i++) assert.equal((await mod.runSummaryGeneration(appendSourceTurn(), { trigger: {} })).success, true);
    assert.equal(calls, 6);
    assert.ok(disk().storySummary.summaryHistory.every(b => !b.layers && !b.reviewLayers));
    const current = readMaintenanceState();
    const session = mod.createMemorySession({ ...current, generateReviewedLayer: async () => '交易告一段落' });
    let step = 0, end, confirmed;
    const tool = (name, args) => ({ text: '', toolCalls: [{ id: 'call' + step, name, arguments: JSON.stringify(args) }] });
    const outcome = await runMemoryAgent(session, {mode:'auto', readCurrent: readMaintenanceState,
        config: { provider:'openai', model:'offline-test' }, countTokens: async () => ({tokens:100,source:'test'}),
        adapter: { chat: async request => {
            step++;
            if (step === 1) {
                assert.ok(request.tools.some(t => t.function.name === 'CloseNarrativeUnit'));
                return tool('ReadNarrativeUnits', {level:'stage'});
            }
            if (step === 2) {
                const {units, revision} = JSON.parse(request.messages.at(-1).content);
                end = units[2].to;
                return tool('CloseNarrativeUnit', {level:'stage', from:units[0].from, to:end, revision,
                    reason:'铁剑完成交付', evidence:{floor:end, quote:'你拿到了铁剑。'}});
            }
            assert.equal(JSON.parse(request.messages.at(-1).content).status, 'staged');
            return {text:'前三轮已构成一个阶段。'};
        } }, onFinish: async () => { confirmed = await saveMaintenanceSession(session); return confirmed; } });
    assert.equal(outcome.saved, 1);
    assert.equal(confirmed.impact.summary, true);
    const node = disk().storySummary.summaryHistory.at(-1).reviewLayers[0];
    assert.equal(node.end, end - 1); assert.equal(node.text, '交易告一段落');
    host.generate = async ({updateContext}) => {
        assert.equal(updateContext.background.summaries.find(unit => unit.level === 'stage').summary, node.text);
        assert.equal(updateContext.background.summaries.length, 5); // Imported baseline plus stage and three later rounds.
        return JSON.stringify({ events: [], factUpdates: [], summary:'后续', worldUpdate: unifiedBlock(updateContext) });
    };
    assert.equal((await mod.runSummaryGeneration(appendSourceTurn(), {trigger:{}})).success, true);
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
