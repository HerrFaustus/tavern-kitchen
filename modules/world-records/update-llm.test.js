import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createTestModuleUrl } from '../story-summary/tests/helpers/bundle-module.js';
import { UPDATE_INPUT_LIMIT } from './update-context.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const captured = globalThis.__worldUpdateLLMTest = { calls: [] };
after(() => { delete globalThis.__worldUpdateLLMTest; });
const names = ['SYSTEM', 'ASSISTANT_ASK_SUMMARY', 'ASSISTANT_ASK_CONTENT', 'META_PROTOCOL_START', 'USER_JSON_FORMAT', 'ASSISTANT_CHECK', 'USER_CONFIRM', 'USER_GENERATE'];
const built = await build({ stdin: { resolveDir: root, contents: "export * from './modules/story-summary/generate/llm.js';" },
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'model-boundary', setup(api) {
        api.onResolve({ filter: /(?:data\/config|text-api\/host)\.js$/ }, args => ({ path: args.path.includes('text-api') ? 'model' : 'config', namespace: 'fixture' }));
        api.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'model'
            ? 'export async function generateFeatureText(feature,options){globalThis.__worldUpdateLLMTest.calls.push({feature,...options});return {text:"fixture response"};}'
            : names.map(name => `export const DEFAULT_SUMMARY_${name}_PROMPT=${JSON.stringify(name)};`).join('\n') + '\nexport const getSummaryAssistantDocPrompt=()=>"fixture summary contract";' }));
    } }] });
// eslint-disable-next-line no-unsanitized/method -- Fixed local bundle with an in-process model boundary; no external code.
const mod = await import(await createTestModuleUrl(built.outputFiles[0].text));
const context = () => ({ version: 1, requestId: 'request', basis: { worldId: 'world', branchId: 'branch', version: 8 },
    manifest: { mode: 'full', worldComplete: true }, world: { entities: [{ id: 'distant', fields: { secret: { value: '远方密室中的秘密' } } }] },
    executionReceipts: [{ commandId: 'paid-once' }], background: { hierarchyAvailable: false } });

test('the actual summary model boundary receives all world data and both output contracts in a single call', async () => {
    captured.calls.length = 0; const snapshot = context();
    const response = await mod.generateSummary({ existingSummary: '早期经历', existingFacts: [], newHistoryText: '本轮正文', historyRange: '2–3', updateContext: snapshot });
    assert.equal(response, 'fixture response'); assert.equal(captured.calls.length, 1); assert.equal(captured.calls[0].feature, 'summary');
    const messages = captured.calls[0].messages;
    assert.ok(messages.some(message => message.role === 'system' && message.content.includes('worldUpdate') && message.content.includes('全视读取不授权演化')));
    assert.ok(messages.some(message => message.role === 'system' && message.content.includes('不得把仅从管理员世界资料读到的秘密')));
    const data = messages.find(message => message.content.startsWith('【管理员全视资料'));
    assert.deepEqual(JSON.parse(data.content.slice(data.content.indexOf('\n') + 1)), snapshot);
    assert.match(data.content, /远方密室中的秘密/); assert.ok(messages.some(message => message.content.includes('本轮正文')));
});

test('the combined prompt budget is checked before calling the configured model without truncation', async () => {
    captured.calls.length = 0; const oldSummary = '旧'.repeat(UPDATE_INPUT_LIMIT - 20);
    await assert.rejects(mod.generateSummary({ existingSummary: oldSummary, existingFacts: [], newHistoryText: '本轮', historyRange: '1', updateContext: context() }), /未调用模型或截断/);
    assert.equal(captured.calls.length, 0); assert.equal(oldSummary.length, UPDATE_INPUT_LIMIT - 20);
});

test('source-only manual summaries retain their existing model contract', async () => {
    captured.calls.length = 0;
    await mod.generateSummary({ existingSummary: '旧总结', existingFacts: [], newHistoryText: '本轮', historyRange: '1' });
    assert.equal(captured.calls.length, 1); assert.equal(captured.calls[0].messages.some(message => message.content.startsWith('【管理员全视资料')), false);
});
