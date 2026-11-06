import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createTestModuleUrl } from './helpers/bundle-module.js';
import { entry, uiEntry } from './helpers/story-summary-entry.js';

const fixture = globalThis.__memoryDefaultsTest = { settings: { TavernKitchen: { enabled: false, storySummary: { enabled: false, retained: 'old' } } }, server: null, writes: 0 };
const cached = new Map(), previousStorage = globalThis.localStorage;
globalThis.localStorage = { getItem: key => cached.get(key) || null, setItem: (key, value) => cached.set(key, value), removeItem: key => cached.delete(key) };
after(() => { globalThis.localStorage = previousStorage; delete globalThis.__memoryDefaultsTest; });
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: "export * from './modules/story-summary/data/config.js';" },
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'memory-settings-boundaries', setup(api) {
        api.onResolve({ filter: /(?:extensions|repository|profiles|server-storage|debug-core)\.js$/ }, args => {
            const key = args.path.split('/').at(-1);
            return ['extensions.js', 'repository.js', 'profiles.js', 'server-storage.js', 'debug-core.js'].includes(key) ? { path: key, namespace: 'fixture' } : null;
        });
        api.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: {
            'extensions.js': 'export const extension_settings=globalThis.__memoryDefaultsTest.settings;',
            'repository.js': 'export const getTextApiRepository=async()=>({load:async()=>{}}); export const getProfileSnapshot=()=>({});',
            'profiles.js': 'export const vectorProfiles=(_snapshot,config)=>config;',
            'debug-core.js': 'export const xbLog={warn(){},info(){},error(){}};',
            'server-storage.js': 'const f=globalThis.__memoryDefaultsTest;export const CommonSettingStorage={getStrict:async()=>structuredClone(f.server),setAndSave:async(_key,value)=>{f.writes++;f.server=structuredClone(value);},clearCache(){}};',
        }[args.path] }));
    } }] });
// eslint-disable-next-line no-unsanitized/method -- In-process bundle of the production config, with only storage/profile boundaries replaced.
const mod = await import(await createTestModuleUrl(bundled.outputFiles[0].text));

test('legacy module-off settings cannot disable story memory while the master choice stays intact', () => {
    const settings = mod.getSettings(); assert.equal(settings.storySummary.enabled, true);
    assert.equal(settings.storySummary.retained, 'old'); assert.equal(settings.enabled, false);
});

for (const enabled of [undefined, false, true]) test(`vector defaults and removed summary ranges normalize across save/reload: ${enabled}`, async () => {
    const raw = { summaryWorkflowVersion: 1, proofreadingInterval: 4, proofreadingPrompt: '核对身份', trigger: { enabled: false, timing: 'before_user', interval: 8, delayFloors: 4, maxPerRun: 25 },
        vector: { ...(enabled === undefined ? {} : { enabled }), embeddingApi: { provider: 'custom', url: 'https://fixture.invalid/v1', key: 'fixture-only', model: 'fixture-model' } } };
    const initial = mod.applySummaryPanelConfigSnapshot(raw);
    assert.equal(initial.vector.enabled, true); assert.equal(initial.trigger.delayFloors, 0); assert.equal(initial.trigger.maxPerRun, 100);
    assert.equal(initial.trigger.enabled, false); assert.equal(initial.trigger.interval, 8); assert.equal(initial.trigger.timing, 'before_user');
    const saved = await mod.saveSummaryPanelConfigVerified(raw), loaded = await mod.loadConfigFromServer();
    assert.equal(loaded.proofreadingInterval, 4); assert.equal(loaded.proofreadingPrompt, raw.proofreadingPrompt);
    assert.equal(saved.vector.enabled, true); assert.equal(loaded.vector.enabled, true); assert.equal(mod.getVectorConfig().enabled, true);
    assert.equal(loaded.vector.embeddingApi.key, 'fixture-only'); assert.equal(loaded.vector.embeddingApi.model, 'fixture-model');
    assert.equal(raw.trigger.delayFloors, 4); assert.equal(raw.vector.enabled, enabled);
});

test('loading old disabled server data enables memory without overwriting the server during initialization', async () => {
    fixture.server = { summaryWorkflowVersion: 1, vector: { enabled: false }, trigger: { delayFloors: 20, maxPerRun: 200 } };
    const writes = fixture.writes, loaded = await mod.loadConfigFromServer();
    assert.equal(loaded.vector.enabled, true); assert.equal(loaded.trigger.delayFloors, 0); assert.equal(loaded.trigger.maxPerRun, 100);
    assert.equal(fixture.server.vector.enabled, false); assert.equal(fixture.writes, writes);
});

test('enabling retrieval preserves legacy flat API selections and explicit provider profiles in both host and panel', () => {
    const ui = uiEntry(['normalizeProviderProfiles'], { VECTOR_API_SUPPORTED_PROVIDERS: { embedding: ['siliconflow', 'custom'] },
        VECTOR_API_DEFAULT_MODELS: { embedding: 'default-model' },
        createDefaultProviderProfile: (_provider, model) => ({ url: 'https://default.invalid/v1', key: '', model, modelCache: [] }) });
    const flat = { provider: 'siliconflow', url: 'https://proxy.fixture.invalid/v1', key: 'fixture-key', model: 'chosen-model' };
    for (const api of [flat, { ...flat, providers: { siliconflow: { url: 'https://saved.fixture.invalid/v1', key: 'saved-fixture-key', model: 'saved-model' } } }]) {
        const expected = api.providers?.siliconflow || flat;
        const parsed = mod.applySummaryPanelConfigSnapshot({ vector: { enabled: false, embeddingApi: api } }).vector.embeddingApi;
        const panel = ui.normalizeProviderProfiles('embedding', api).siliconflow;
        for (const key of ['url', 'key', 'model']) { assert.equal(parsed[key], expected[key]); assert.equal(panel[key], expected[key]); }
    }
});

test('manual panel requests cannot restore retired delay or per-run settings', async () => {
    let request;
    const host = entry(['handleFrameMessage'], { isTrustedMessage: () => true, document: { getElementById: () => ({}) }, isStorySummaryEnabledForCurrentChat: () => true,
        currentMesId: null, getContext: () => ({ chatId: 'fixture', chat: Array.from({ length: 10 }, () => ({})) }),
        handleManualGenerate: async (floor, config) => { request = { floor, config }; } });
    await host.handleFrameMessage({ data: { type: 'REQUEST_GENERATE', config: { trigger: { delayFloors: 9, maxPerRun: 1, role: 'user' } } } });
    assert.equal(request.floor, 9); assert.equal(request.config.trigger.delayFloors, 0);
    assert.equal(request.config.trigger.maxPerRun, 100); assert.equal(request.config.trigger.role, 'user');
});

test('five-turn defaults and explicit overrides survive normalized storage', async () => {
    const defaults = mod.applySummaryPanelConfigSnapshot({});
    assert.equal(defaults.ui.keepVisibleCount, 5);
    assert.equal(defaults.ui.recallEarlyOriginal, false);
    assert.equal(defaults.ui.useVectorBoundary, false);
    assert.equal(defaults.memoryMaintenanceEnabled, true);
    assert.equal(defaults.proofreadingInterval, 5);
    const legacy = mod.applySummaryPanelConfigSnapshot({ ui: { keepVisibleCount: 8 } });
    assert.equal(legacy.ui.keepVisibleCount, 4);
    await mod.saveSummaryPanelConfigVerified({ ...legacy, proofreadingInterval: 2, memoryMaintenanceEnabled: false,
        ui: { ...legacy.ui, recallEarlyOriginal: true } });
    const saved = await mod.loadConfigFromServer();
    assert.equal(saved.ui.keepVisibleCount, 4);
    assert.equal(saved.ui.recallEarlyOriginal, true);
    assert.equal(saved.proofreadingInterval, 2);
    assert.equal(saved.memoryMaintenanceEnabled, false);
});
