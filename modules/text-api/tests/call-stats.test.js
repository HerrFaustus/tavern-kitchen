import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { build } from 'esbuild';
import { createCallStats, countRemoteRequest, featureCalls } from '../call-stats.js';
import { testTextConnection } from '../runtime.js';
import { createPreset } from '../model.js';
import { createTestModuleUrl } from '../../story-summary/tests/helpers/bundle-module.js';

test('one counted request and one failed connection test have two dispatches and only the supplied usage',async()=>{
    featureCalls.clear();
    const report=await countRemoteRequest('world',async dispatch=>{
        dispatch();
        return {text:'已推演。',usage:{prompt_tokens:7,completion_tokens:4}};
    });
    assert.equal(report.text,'已推演。');
    const preset=createPreset('host','代理测试');
    const generateHost=async()=>{throw new Error('HTTP 503');};
    await assert.rejects(testTextConnection(preset,{signal:AbortSignal.abort()},{generateHost}));
    await assert.rejects(testTextConnection(preset,{},{generateHost}),/503/);
    const stats=featureCalls.snapshot();assert.deepEqual(stats.tasks,{simulation:1});
    assert.equal(stats.features.world.calls,1);assert.equal(stats.features.world.failures,0);
    assert.deepEqual(stats.features.world.usage,{inputTokens:7,outputTokens:4});
    assert.equal(stats.features['test-text'].calls,1);assert.equal(stats.features['test-text'].failures,1);
    assert.equal(stats.features['test-text'].usage,undefined);assert.equal(stats.recent.length,2);
    featureCalls.clear();
});

test('session totals outlive 100 recent details and clearing excludes outstanding old calls', () => {
    let tick = 0;
    const stats = createCallStats({ timer: () => tick, now: () => 1000 + tick });
    for (let i = 0; i < 105; i++) {
        const end = stats.start('summary');
        tick += 2;
        end({ prompt_tokens: 1, completion_tokens: 2, secret: 'never copy' });
    }
    const result = stats.snapshot();
    assert.deepEqual(result.features.summary, { calls: 105, failures: 0, totalMs: 210, lastError: '', lastAt: 1210,
        usage: { inputTokens: 105, outputTokens: 210 } });
    assert.equal(result.recent.length, 100);
    assert.equal(result.recent[0].at, 1012);
    result.features.summary.calls = 0;
    assert.equal(stats.snapshot().features.summary.calls, 105);
    const pending = stats.start('planner');
    stats.clear();
    pending();
    assert.deepEqual(stats.snapshot(), { features: {}, recent: [] });
});

test('feature generation and the API page share scrubbed success, failure and abort diagnostics', async () => {
    const mocks = {
        'script.js': 'export const getRequestHeaders=()=>({}); export const main_api="openai-compatible";',
        'openai.js': 'export const oai_settings={}; export const getChatCompletionModel=()=>"";',
        'secrets.js': 'export const findSecret=()=>""; export const SECRET_KEYS={};',
        'repository.js': 'export const getTextApiRepository=()=>{throw Error("repository unavailable")};',
        'streaming-generation.js': 'export const streamingGeneration={startRawGeneration:()=>({completion:"OK"})};',
        'tavern-import.js': 'export const importCurrentTavernApi=()=>{}; export const snapshotTavernApi=()=>{throw Error("不是聊天补全")};',
        'provider-config.js': 'export const createAgentAdapter=config=>({chat:()=>{throw Error("HTTP 403 "+config.apiKey+" "+encodeURIComponent(config.apiKey))}});',
    };
    const bundle = await build({ stdin: { contents:
        'export {generateFeatureText} from "./modules/text-api/host.js"; export {handleProfileRequest} from "./modules/text-api/profile-service.js";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'local-provider', setup(api) {
        api.onResolve({ filter: /(?:script|repository|streaming-generation|tavern-import|provider-config|openai|secrets)\.js$/ }, args => {
            const path = args.path.split('/').pop();
            return Object.hasOwn(mocks, path) ? { path, namespace: 'fixture' } : null;
        });
        api.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
    } }] });
    // eslint-disable-next-line no-unsanitized/method -- The URL points to the local test bundle above.
    const { generateFeatureText, handleProfileRequest } = await import(await createTestModuleUrl(bundle.outputFiles[0].text));
    const apiKey = 'fixture+/secret', preset = createPreset('p','P',{ provider: 'openai-compatible', baseUrl: 'https://fixture.invalid', model: 'fixture', apiKey });
    const options = { messages: [] };
    assert.deepEqual(await generateFeatureText('summary', options, createPreset('h','H')), { text: 'OK' });
    await assert.rejects(generateFeatureText('planner', options, preset), /HTTP 403 \[redacted\] \[redacted\]/);
    await assert.rejects(generateFeatureText('opening', { ...options, signal: AbortSignal.abort() }, preset), { name: 'AbortError' });
    await assert.rejects(generateFeatureText('summary', options), /repository unavailable/);
    const stats = await handleProfileRequest({ action: 'call-stats' });
    assert.equal(stats.features.summary.calls, 1);
    assert.equal(stats.features.summary.failures, 0);
    assert.equal(stats.features.planner.lastError, 'HTTP 403');
    assert.equal(stats.features.opening, undefined);
    assert.equal(stats.recent.length, 2);
    assert.deepEqual(stats.tasks,{update:1,planner:1});
    assert.ok(stats.recent.every(row => row.ms >= 0 && row.at > 0));
    assert.doesNotMatch(JSON.stringify(stats), /secret|fixture|redacted/);
    assert.deepEqual(await handleProfileRequest({ action: 'clear-call-stats' }), { features: {}, recent: [] });
});

test('host direct generation omits inherited chat openai_max_tokens and preserves finishReason and truncated', async () => {
    const seen = [];
    const mocks = {
        'script.js': 'export const getRequestHeaders=()=>({}); export const main_api="openai";',
        'openai.js': 'export const oai_settings={ chat_completion_source:"custom", custom_url:"https://host.test/v1", openai_max_tokens:8192, temp_openai:0.7, stream_openai:false }; export const getChatCompletionModel=()=>"host-thinking-model";',
        'secrets.js': 'export const findSecret=async()=>"host-secret"; export const SECRET_KEYS={ CUSTOM:"custom" };',
        'repository.js': 'export const getTextApiRepository=()=>{throw Error("unused")};',
        'streaming-generation.js': 'export const streamingGeneration={};',
        'provider-config.js': 'export const createAgentAdapter=config=>({ chat: async task => { globalThis.__hostDirectSeen.push({ config, task }); return { text:"{}", finishReason:"length", completion:"incomplete", truncated:true, usage:{ prompt_tokens:10, completion_tokens:20 } }; } });',
    };
    globalThis.__hostDirectSeen = seen;
    try {
        const bundle = await build({ stdin: { contents: 'export {generateFeatureText} from "./modules/text-api/host.js";', resolveDir: process.cwd() },
            bundle: true, write: false, platform: 'node', format: 'esm',
            plugins: [{ name: 'host-direct-fixture', setup(api) {
                api.onResolve({ filter: /(?:script|repository|streaming-generation|provider-config|openai|secrets)\.js$/ }, args => {
                    const name = args.path.split('/').pop();
                    return Object.hasOwn(mocks, name) ? { path: name, namespace: 'fixture' } : null;
                });
                api.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
            } }] });
        // eslint-disable-next-line no-unsanitized/method -- Local in-memory test bundle only.
        const { generateFeatureText } = await import(await createTestModuleUrl(bundle.outputFiles[0].text));
        const result = await generateFeatureText('summary', { messages: [{ role: 'user', content: 'hi' }] }, createPreset('@host', '同酒馆主 API'));
        assert.equal(seen.length, 1);
        assert.equal(seen[0].task.maxTokens, undefined);
        assert.equal(result.finishReason, 'length');
        assert.equal(result.truncated, true);
        assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 20 });
    } finally {
        delete globalThis.__hostDirectSeen;
    }
});
