import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTestModuleUrl } from './helpers/bundle-module.js';
import { buildSummaryAssistantDocPrompt, resolveSummaryStyle } from '../data/generation-rules.js';

// Contracts: custom instructions survive save/reload and are used on the next
// request; reset follows built-ins; failed saves do not publish unsaved settings.
// Failures silently lose user configuration or send the wrong model protocol.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const state = globalThis.__summaryStyleTest = { disk: null, requests: [], dropStyle: false };
after(() => { delete globalThis.__summaryStyleTest; });
const shims = {
    'modules/text-api/host.js': 'export const generateFeatureText = async (_, request) => { globalThis.__summaryStyleTest.requests.push(request); return {text: "{}"}; };',
    'modules/text-api/repository.js': 'export const getProfileSnapshot=()=>null; export const getTextApiRepository = async () => ({load: async () => {}});',
    'core/debug-core.js': 'export const xbLog = {info(){},warn(){},error(){}};',
    'core/server-storage.js': `const state = globalThis.__summaryStyleTest;
        export const CommonSettingStorage = {
            async setAndSave(_, value) { state.disk = structuredClone(value); if (state.dropStyle) state.disk.prompts.summaryStyle = ''; },
            clearCache() {}, async getStrict() { return structuredClone(state.disk); }
        };`,
    'modules/story-summary/data/config-local-cache.js': 'export const SUMMARY_CONFIG_LOCAL_STORAGE_KEY="isolated-summary-test"; export const writeSummaryConfigLocalCache=()=>{};',
};
const bundle = await build({
    stdin: { resolveDir: root, contents: `export * from './modules/story-summary/data/config.js';
        export { generateSummary } from './modules/story-summary/generate/llm.js';` },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'summary-style-host-boundaries', setup(api) {
        api.onResolve({ filter: /extensions\.js$/ }, () => ({ path: 'extensions', namespace: 'stub' }));
        api.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const extension_settings = {};', loader: 'js' }));
        api.onLoad({ filter: /\.js$/ }, args => {
            const relative = path.relative(root, args.path).replaceAll('\\', '/');
            if (shims[relative]) return { contents: shims[relative], loader: 'js' };
        });
    } }],
});
// eslint-disable-next-line no-unsanitized/method -- Imports only our locally bundled test module.
const config = await import(await createTestModuleUrl(bundle.outputFiles[0].text));
const input = { existingSummary: 'Existing episode', existingFacts: [], newHistoryText: '#2 New dialogue', historyRange: '2-2', existingEventCount: 1 };

test('built-in summary instructions and protocol stay active while legacy saved prompts are ignored', async () => {
    config.applySummaryPanelConfigSnapshot({});
    await config.generateSummary(input);
    const baseline = state.requests.at(-1).messages;
    const baselinePrompts = config.getSummaryPrompts();
    assert.equal(baseline.length, 11);
    const legacy = { ...config.getSummaryPanelConfig(), prompts: { summaryStyle: '自定义文风', round: '动作', stage: '因果', chapter: '主线' } };
    await config.saveSummaryPanelConfigVerified(legacy);
    config.applySummaryPanelConfigSnapshot({});
    const loaded = await config.loadConfigFromServer();
    assert.equal(loaded.prompts, undefined);
    await config.generateSummary(input);
    const messages = state.requests.at(-1).messages;
    assert.deepEqual(messages.map(({role}) => role), baseline.map(({role}) => role));
    messages.forEach((message, i) => {
        assert.deepEqual(message, i === 2
            ? { ...baseline[i], content: buildSummaryAssistantDocPrompt() } : baseline[i]);
    });
    assert.deepEqual(config.getSummaryPrompts(), {
        ...baselinePrompts, summaryAssistantDocPrompt: buildSummaryAssistantDocPrompt(),
    });
    assert.equal(resolveSummaryStyle('  '), resolveSummaryStyle());
});
