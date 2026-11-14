import assert from 'node:assert/strict';
import { createTestModuleUrl } from './helpers/bundle-module.js';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createVectorMaintenanceScheduler } from '../vector/pipeline/maintenance-scheduler.js';
import { createMessageSourceTracker } from '../data/message-sources.js';
import { createTurnQueue } from '../../../core/turn-queue.js';
import { entry } from './helpers/story-summary-entry.js';

// Acceptance: automatic maintenance starts only after host readiness + paint + quiet delay;
// continuation is not lost, navigation cancels it, and an idle L2 probe performs no recovery.
// Cost: blocked chat UI, repeated IO, or permanently missing anchors.
const built = await build({
    entryPoints: [fileURLToPath(new URL('../../../core/after-ai-gate.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'after-ai-host', setup(api) {
        api.onResolve({ filter: /(?:extensions|debug-core)\.js$/ }, ({ path }) => ({ path, namespace: 'host' }));
        api.onLoad({ filter: /.*/, namespace: 'host' }, ({ path }) => ({ contents: path.endsWith('extensions.js')
            ? 'export const getContext=()=>globalThis.__afterAiTest.context;'
            : 'export const xbLog={info(){},warn(){}};' }));
    } }],
});
// eslint-disable-next-line no-unsanitized/method -- Locally built production module with host boundaries replaced.
const { waitForAfterAiReady } = await import(await createTestModuleUrl(built.outputFiles[0].text));

function readinessFixture(t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const keys = ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', '__afterAiTest'];
    const original = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    t.after(() => { scheduler.clear(); for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    } });
    const context = { chatId: 'fixture', chat: [{ mes: 'old reply', is_user: false, send_date: 'unchanged' }] };
    const stop = { isConnected: true, hidden: false };
    const frames = new Map();
    let frameId = 0;
    Object.assign(globalThis, {
        __afterAiTest: { context },
        document: { body: { dataset: { generating: 'true' } }, getElementById: () => stop },
        window: { getComputedStyle: () => ({ display: stop.hidden ? 'none' : 'block' }) },
        requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
    });
    const runs = [];
    const scheduler = createVectorMaintenanceScheduler({ getContext: () => context,
        isStale: chatId => chatId !== context.chatId, getQuietWaitMs: () => 0,
        waitForReady: waitForAfterAiReady, run: chatId => runs.push(chatId) });
    return { context, stop, runs, scheduler,
        async advance(ms) { await nextTurn(); t.mock.timers.tick(ms); await nextTurn(); },
        async frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); await nextTurn(); },
    };
}

test('the five-second maintenance delay starts after host completion and two frames, not the AI event', async t => {
    const f = readinessFixture(t);
    f.scheduler.schedule(5000);
    await f.advance(10_000);
    assert.deepEqual(f.runs, []);
    delete document.body.dataset.generating;
    await f.advance(5000); // Stop button is still visible.
    assert.deepEqual(f.runs, []);
    f.stop.hidden = true;
    await f.advance(100);
    await f.frame();
    await f.advance(5000); // One frame is not enough.
    assert.deepEqual(f.runs, []);
    await f.frame();
    await f.advance(4999);
    assert.deepEqual(f.runs, []);
    await f.advance(1);
    assert.deepEqual(f.runs, ['fixture']);
});

test('a continuation on the same floor schedules once; duplicate completion and render hints do not', async t => {
    const f = readinessFixture(t);
    delete document.body.dataset.generating; f.stop.hidden = true;
    const tracker = createMessageSourceTracker(); tracker.reset(f.context);
    const complete = entry(['notifyStorySummaryAfterAi'], {
        getContext: () => f.context, messageSources: tracker, MODULE_ID: 'summary',
        isStorySummaryEnabledForCurrentChat: () => true, getVectorConfig: () => ({ enabled: true }),
        rememberVectorMaintenance() {}, notifyAfterAiHint() {}, AUTO_L0_BACKFILL_DELAY_MS: 5000,
        scheduleAutoL0Backfill: (...args) => f.scheduler.schedule(...args),
    });
    for (const suffix of [' first continuation', ' second continuation']) {
        f.context.chat[0].mes += suffix;
        complete.notifyStorySummaryAfterAi(0, 'message_received');
        complete.notifyStorySummaryAfterAi(0, 'generation_ended');
        complete.notifyStorySummaryAfterAi(0, 'character_message_rendered');
        await f.frame(); await f.frame(); await f.advance(5000);
    }
    assert.deepEqual(f.runs, ['fixture', 'fixture']);
});

for (const cancel of ['replace', 'disable', 'switch']) test(`pending readiness is cancelled on ${cancel}`, async t => {
    const f = readinessFixture(t);
    f.scheduler.schedule(5000);
    if (cancel === 'switch') f.context.chatId = 'another';
    else if (cancel === 'disable') f.scheduler.clear();
    else f.scheduler.schedule(5000);
    delete document.body.dataset.generating; f.stop.hidden = true;
    await f.advance(100); await f.frame(); await f.frame(); await f.advance(5000);
    assert.deepEqual(f.runs, cancel === 'replace' ? ['fixture'] : []);
});

test('switching away and back cancels the old delay immediately, before deferred chat initialization', async t => {
    const f = readinessFixture(t);
    delete document.body.dataset.generating; f.stop.hidden = true;
    f.scheduler.schedule(5000);
    await f.frame(); await f.frame(); await f.advance(4999);
    const noop = () => {};
    const change = entry(['handleChatChange'], {
        getContext: () => f.context, vectorMaintenanceScheduler: f.scheduler,
        messageSources: { switchChat: () => false }, embeddingConnection: { cancel: noop },
        serviceTests: { cancel: noop }, memoryMaintenance: { reset: noop },
        cancelRecallAndClearPrompt: noop, cancelActiveSummaryExecution: noop,
        cancelEmbeddingWriteTasks: noop, cancelPendingHide: noop, scheduleWithChatGuard: noop,
        activeSummaryExecution: null, activeChatId: 'fixture',
        extension_prompts: {}, FLOOR_PROMPT_KEY: 'floor-test', mainReplySummary: { reset: noop },
    });
    f.context.chatId = 'another'; change.handleChatChange();
    f.context.chatId = 'fixture'; change.handleChatChange();
    await f.advance(5000);
    assert.deepEqual(f.runs, []);
});

test('only an enabled floor task can consume an accepted reply; legacy timing never starts a second task', async () => {
    let checks = 0, calls = 0;
    const chat = [{is_user:true,mes:'等待'}, {mes:'收到',send_date:'a'}];
    const queue = createTurnQueue({read:()=>({owner:'fixture',chat,end:1}), tasks:()=>[], complete:()=>{ checks++; }, execute:()=>{ calls++; }});
    await queue.settle();
    await queue.beforeGeneration(()=>assert.fail('disabled task stopped the host'));
    assert.deepEqual([checks,calls],[0,0]);
});
