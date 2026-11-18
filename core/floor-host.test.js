import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { preflightOrderedFloorAgents } from './floor-status.js';
import { createTestModuleUrl } from '../modules/story-summary/tests/helpers/bundle-module.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const shims = {
    'core/event-manager.js': `
        export const event_types = Object.fromEntries(['GENERATION_STARTED','MESSAGE_RECEIVED','GENERATION_ENDED',
            'GROUP_WRAPPER_FINISHED','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','CHAT_CHANGED','GENERATION_STOPPED']
            .map(name => [name, name]));
        export const createModuleEvents = () => ({
            on: (name, fn) => { (globalThis.__fh.listeners[name] ??= []).push(fn); },
            cleanup() {},
        });`,
    'core/panel-controls.js': 'export const requireAgent = async () => {};',
    'shared/common/generate-interceptor.js': `
        export const registerGenerateInterceptor = (id, fn) => globalThis.__fh.interceptors.push({ id, fn });
        export const unregisterGenerateInterceptor = id => {
            if (globalThis.__fh) globalThis.__fh.interceptors = globalThis.__fh.interceptors.filter(item => item.id !== id);
        };`,
    'modules/story-summary/data/chat-identity.js': 'export const getChatIdentity = () => "identity-1";',
    'modules/story-summary/data/turn-bounds.js': `
        export const getUpdateAndSimulationBounds = chat => ({ stableEnd: chat.length - 1, simulationEnd: chat.length - 1, updateEnd: chat.length - 1 });`,
    'modules/world-records/turn-processing.js': `
        export const createFloorProcessing = options => { globalThis.__fh.queueOptions = options; return globalThis.__fh.queue; };`,
    'modules/world-records/turn-actions.js': `
        export const taskDefinitions = { memory:['总结'], overview:['总览'], people:['人物'], places:['地点'],
            situation:['局势'], suspense:['悬念'], simulation:['推演'], chapter:['章节整理'] };`,
    'modules/text-api/host.js': 'export const generateFeatureText = async () => ({ text: "" });',
    'core/chapter-processing.js': 'export const createChapterProcessing = () => ({});',
    'core/floor-status.js': `
        export const preflightOrderedFloorAgents = options => globalThis.__fh.preflight(options);
        export const resolveFailureRoute = () => 'data';`,
    'core/opening-gate.js': `
        export const OPENING_GATE_TYPES = new Set(['normal','continue','group']);
        export const OPENING_SKIP_KEY = 'skip';
        export const openingGateNeeded = () => globalThis.__fh.opening.needed;
        export const askOpening = options => {
            globalThis.__fh.opening.progress = options.onProgress;
            return Promise.resolve(globalThis.__fh.opening.outcome);
        };`,
    'core/agent-status.js': `
        export const showAgentNotice = notice => { globalThis.__fh.notices.push(notice); return globalThis.__fh.notices.length; };
        export const clearAgentNotice = id => { globalThis.__fh.clears.push(id ?? null); };
        export const setAgentIdleStatus = status => { (globalThis.__fh.idleStatuses ??= []).push(status); };`,
};

async function loadFloorHost() {
    const out = await build({
        stdin: { resolveDir: root, contents: "export { installFloorHost } from './core/floor-host.js';" },
        bundle: true, write: false, format: 'esm', platform: 'node',
        plugins: [{
            name: 'floor-host-shims',
            setup(api) {
                api.onResolve({ filter: /.*/ }, args => {
                    if (args.kind === 'entry-point') return null;
                    const target = path.isAbsolute(args.path) ? args.path
                        : args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path) : path.join(root, args.path);
                    const rel = path.relative(root, target).replace(/\\/g, '/');
                    return shims[rel] ? { path: rel, namespace: 'shim' } : null;
                });
                api.onLoad({ filter: /.*/, namespace: 'shim' }, args => ({ contents: shims[args.path], loader: 'js' }));
            },
        }],
    });
    // eslint-disable-next-line no-unsanitized/method -- Generated local test bundle with fixed host shims; no external source.
    return import(await createTestModuleUrl(out.outputFiles[0].text));
}

function harness() {
    const interceptors = [];
    const state = {
        listeners: {}, interceptors, queueCalls: [], notices: [], clears: [],
        opening: { needed: false, outcome: 'initialized', progress: null },
        preflight: async () => true,
        queue: {
            settle: async options => { state.queueCalls.push(['settle', options]); },
            invalidate: () => state.queueCalls.push(['invalidate']),
            cancelGeneration: () => state.queueCalls.push(['cancel']),
            beforeGeneration: async callback => { state.queueCalls.push(['before']); await callback(); },
        },
    };
    globalThis.__fh = state;
    const previous = { document: globalThis.document, window: globalThis.window };
    globalThis.document = { querySelector: () => null, body: {} };
    globalThis.window = new EventTarget();
    const restore = () => {
        globalThis.document = previous.document;
        globalThis.window = previous.window;
        delete globalThis.__fh;
    };
    return { state, restore };
}

test('preflight failures always ask the host to abort immediately', async () => {
    const aborts = [];
    const allowed = await preflightOrderedFloorAgents({
        floor: 1,
        checkAgent: async agent => { if (agent === 'update') throw new Error('总结 Agent 未绑定'); },
        render() {},
        abort: value => aborts.push(value),
    });
    assert.equal(allowed, false);
    assert.deepEqual(aborts, [true]);
});

test('a hard-blocked opening cancellation stays latched through an empty-queue kick and aborts with true', async t => {
    const f = harness();
    const { installFloorHost } = await loadFloorHost();
    let worldReady = false;
    const host = installFloorHost({
        settings: { xiaobaiOs: { apps: { world: {} } } },
        getContext: () => ({ chatId: 'c1', name1: '主角', chat: [{ is_user: true, mes: '出发。' }] }),
        memory: { getPublishedSummaryStore: () => ({}), saveFloorWork: async () => {}, saveFloorSimulation: async () => {}, reconcileSettledFloorChunks: async () => {} },
        archive: () => worldReady ? { service: { read: async () => null }, initialize: async () => {} } : null,
        planner: () => ({ onChapter: async () => {} }),
        workspace: {},
    });
    t.after(() => { host.dispose(); f.restore(); });
    const interceptor = f.state.interceptors.find(item => item.id === 'ordered-floors').fn;

    // No work ran during install because the archive was not ready yet.
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(f.state.queueCalls, []);
    worldReady = true;
    f.state.opening = { needed: true, outcome: 'cancel', progress: null };
    const aborts = [];
    await interceptor([], 0, value => aborts.push(value), 'normal');
    assert.deepEqual(aborts, [true]);
    assert.equal(f.state.notices.at(-1).level, 'error');
    assert.equal(f.state.notices.at(-1).pinned, true);
    assert.match(f.state.notices.at(-1).message, /已取消世界初始化/);

    // A later empty-queue kick must not clear the pinned failure.
    for (const listener of f.state.listeners.MESSAGE_RECEIVED || []) listener();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.state.queueCalls.some(call => call[0] === 'settle'), false);
    assert.deepEqual(f.state.clears, []);

    // Retrying through the retry button (queue settle) or settings change is allowed.
    globalThis.window.dispatchEvent(new Event('tavernKitchen:floor-settings'));
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.state.queueCalls.some(call => call[0] === 'settle'), true);
});

test('the pre-send queue interrupt forwards the host abort flag instead of swallowing it', async t => {
    const f = harness();
    const { installFloorHost } = await loadFloorHost();
    f.state.queue.beforeGeneration = async callback => { f.state.queueCalls.push(['before']); await callback(); };
    const host = installFloorHost({
        settings: { xiaobaiOs: { apps: { world: {} } } },
        getContext: () => ({ chatId: 'c1', name1: '主角', chat: [{ is_user: true, mes: '出发。' }] }),
        memory: { getPublishedSummaryStore: () => ({}), saveFloorWork: async () => {}, saveFloorSimulation: async () => {}, reconcileSettledFloorChunks: async () => {} },
        archive: () => ({ service: { read: async () => null }, initialize: async () => {} }),
        planner: () => ({ onChapter: async () => {} }),
        workspace: {},
    });
    t.after(() => { host.dispose(); f.restore(); });
    const interceptor = f.state.interceptors.find(item => item.id === 'ordered-floors').fn;
    const aborts = [];
    await interceptor([], 0, value => aborts.push(value), 'normal');
    // The callback runs without an argument; the default must be the immediate abort.
    assert.deepEqual(aborts, [true]);
});

test('summarizeFloor settles unsettled floors without wiping simulation prose and rewinds world state properly on rerun', async t => {
    const f = harness();
    const { installFloorHost } = await loadFloorHost();
    let store = {
        lastSummarizedMesId: -1,
        summaryHistory: [],
        floorSimulations: { 1: { floor: 1, text: '已有推演正文' } },
    };
    const rewinds = [], resets = [];
    const worldSnapshot = { worldId: 'w1', branchId: 'b1', version: 3, sources: { 'turn:t1': { id: 't1', source: { end: 1 } } },
        events: [{ version: 1, origin: { sourceId: 't1' }, effects: [] }, { version: 2, origin: { sourceId: 't1' }, effects: [] }] };
    const host = installFloorHost({
        settings: { xiaobaiOs: { apps: { world: {} } } },
        getContext: () => ({ chatId: 'c1', name1: '主角', chat: [
            { is_user: true, mes: '进门。' },
            { is_user: false, mes: '店主看过来。', send_date: 'a1' },
        ] }),
        memory: {
            getPublishedSummaryStore: () => store,
            saveFloorWork: async () => {},
            saveFloorSimulation: async () => {},
            reconcileSettledFloorChunks: async () => {},
            resetFloorForRerun: async floor => { resets.push(floor); },
        },
        archive: () => ({ service: {
            read: async () => worldSnapshot,
            rewind: async (expected, version) => { rewinds.push({ expected, version }); },
        }, initialize: async () => {} }),
        planner: () => ({ onChapter: async () => {} }),
        workspace: { open() {} },
    });
    t.after(() => { host.dispose(); f.restore(); });

    assert.match(f.state.idleStatuses.at(-1).message, /已总结 0 楼，待总结 1 楼/);
    assert.ok(f.state.idleStatuses.at(-1).actions.some(a => a.label === '手动总结'));

    await host.summarizeFloor(1);
    assert.deepEqual(resets, []);
    assert.equal(f.state.queueCalls.some(c => c[0] === 'settle'), true);

    // Settled floor reruns and passes full world object (not world.version) to worldService.rewind.
    store = {
        lastSummarizedMesId: 1,
        summaryHistory: [{ kind: 'batch', previousEndMesId: -1, endMesId: 1, summary: '已总结' }],
        floorWork: { 1: { done: ['memory', 'overview', 'people', 'places', 'situation', 'suspense'] } },
    };
    await host.summarizeFloor(1);
    assert.deepEqual(resets, [1]);
    assert.equal(rewinds.length, 1);
    assert.equal(rewinds[0].expected, worldSnapshot);
    assert.equal(rewinds[0].version, 0);
});
