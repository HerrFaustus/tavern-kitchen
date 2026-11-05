import assert from 'node:assert/strict';
import { beforeEach, after, test } from 'node:test';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import { createTestModuleUrl } from './helpers/bundle-module.js';
import { inputDigest } from '../vector/utils/vector-input-digest.js';
import { captureRangeSource } from '../data/turn-source.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const host = globalThis.__rawRecallTest = {};
const shims = {
    'extensions.js': 'export const getContext=()=>globalThis.__rawRecallTest.context;',
    'debug-core.js': 'export const xbLog={info(){},warn(){},error(){},debug(){}};',
    'modules/story-summary/data/store.js': 'export const getPublishedSummaryStore=()=>globalThis.__rawRecallTest.store;',
    'modules/story-summary/data/config.js': 'export const getTextFilterRules=()=>[];',
    'modules/story-summary/vector/runtime/runtime.js': `export { searchRawRecords as searchRawRecallRuntime } from './modules/story-summary/vector/storage/raw-recall-store.js';
        export const applyRecallRuntimeMutationBestEffort=()=>{}; export const clearRecallRuntime=async()=>{};`,
    'modules/story-summary/vector/utils/embedder.js': 'export const getEngineFingerprint=()=>"test:model"; export const embed=(...args)=>globalThis.__rawRecallTest.embed(...args);',
    'modules/story-summary/vector/utils/tokenizer.js': 'export const injectEntities=()=>{}; export const getTokenizerSnapshot=()=>({tokenizeForIndex:text=>text.toLowerCase().split(/[^a-z]+/).filter(term=>term.length>2),extractEntities:()=>["Alice"]});',
    'modules/story-summary/vector/llm/reranker.js': 'export const rerank=(...args)=>globalThis.__rawRecallTest.rerank(...args);',
};
const bundled = await build({
    stdin: { resolveDir: root, contents: `export * from './modules/story-summary/vector/retrieval/raw-recall.js';
        export { chunkMessage } from './modules/story-summary/vector/pipeline/chunk-text.js';
        export { db, metaTable, chunkVectorsTable, eventVectorsTable, stateVectorsTable } from './modules/story-summary/data/db.js';` },
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'raw-recall-boundaries', setup(api) {
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
const config = { enabled: true, retrievalMode: 'raw', embeddingApi: { key: 'fixture' }, rerankApi: {} };
beforeEach(async () => {
    for (const table of mod.db.tables) await table.clear();
    Object.assign(host, { context: { chatId: 'raw-test', chat: [
        { mes: 'I asked about the silver key.', is_user: true },
        { mes: 'Alice put the silver key under the stone.', name: 'Alice', send_date: '2026-11-05' },
        { mes: 'The weather is calm.', is_user: true }, { mes: 'A quiet evening.', name: 'Alice' },
        { mes: 'silver key', is_user: true },
    ] }, store: { json: {}, summaryHistory: [] }, embeddings: [], reranks: [] });
    host.embed = async texts => { host.embeddings.push(texts); return [[1, 0]]; };
    host.rerank = async (query, documents) => {
        host.reranks.push({ query, documents });
        return { failed: false, results: documents.map((_, index) => ({ index, relevance_score: index })) };
    };
    await mod.metaTable.put({ chatId: 'raw-test', fingerprint: 'test:model', lastChunkFloor: 1 });
    const chunk = mod.chunkMessage(1, host.context.chat[1])[0];
    await mod.chunkVectorsTable.put({ chatId: 'raw-test', chunkId: chunk.chunkId, fingerprint: 'test:model', sourceHash: inputDigest('chunk', chunk.text), vector: new Float32Array([1, 0]).buffer, dims: 2 });
});
after(() => mod.db.close());

test('real raw retrieval reads no retired vector tables and uses one query embedding and one optional rerank pool', async t => {
    for (const table of [mod.eventVectorsTable, mod.stateVectorsTable]) t.mock.method(table, 'where', () => assert.fail('retired channel read'));
    let leases = 0;
    const result = await mod.recallRawMemory({ ...config, rerankApi: { key: 'fixture' } }, { hiddenThrough: 1,
        withQueryEmbedding: async request => { leases++; return request(); } });
    assert.equal(host.embeddings.length, 1); assert.equal(host.embeddings[0].length, 1); assert.equal(leases, 1);
    assert.equal(host.reranks.length, 1);
    assert.deepEqual(new Set(result.chunks.map(chunk => chunk.floor)), new Set([0, 1]));
    assert.ok(result.chunks.every(chunk => chunk.sourceHash && chunk.candidate));
    assert.equal(result.stats.usableVectors, 1);
});

test('one failed embedding falls back to keywords immediately, without another semantic or embedding request', async () => {
    host.embed = async texts => { host.embeddings.push(texts); throw Error('offline'); };
    const result = await mod.recallRawMemory(config, { hiddenThrough: 1 });
    assert.equal(host.embeddings.length, 1);
    assert.ok(result.chunks.some(chunk => chunk.floor === 1));
    assert.equal(result.stats.denseHits, 0);
});

test('a model change keeps keyword recall available without buying a query for incompatible vectors', async () => {
    await mod.metaTable.put({ chatId: 'raw-test', fingerprint: 'old:model' });
    const result = await mod.recallRawMemory(config, { hiddenThrough: 1 });
    assert.equal(host.embeddings.length, 0);
    assert.equal(result.stats.usableVectors, 0);
    assert.ok(result.chunks.length);
});

test('optional rerank failure preserves the fused candidate pool', async () => {
    host.rerank = async () => { throw Error('rerank offline'); };
    const result = await mod.recallRawMemory({ ...config, rerankApi: { key: 'fixture' } }, { hiddenThrough: 1 });
    assert.equal(result.chunks.length, 2);
    assert.equal(host.embeddings.length, 1);
});

test('confirmed Chinese tags can locate a detail when tokenization provides no matching word', async () => {
    host.context.chat[1].mes = '她把它锁进柜子。';
    host.context.chat[4].mes = '我之前那把银钥匙放在哪里了？';
    host.store.summaryHistory = [{ sourceReceipt: { source: captureRangeSource(host.context.chat, 0, 1) },
        memoryTags: { version: 1, characters: [], locations: [], times: [], keywords: ['银钥匙'] } }];
    const result = await mod.recallRawMemory({ ...config, embeddingApi: {} }, { hiddenThrough: 1 });
    assert.ok(result.chunks.some(chunk => chunk.floor === 1));
    assert.equal(host.embeddings.length, 0);
});

for (const mutation of ['edit', 'candidate', 'chat']) test(`raw recall rejects a stale ${mutation} after an asynchronous model result`, async () => {
    host.embed = async () => {
        if (mutation === 'edit') host.context.chat[1].mes = 'The key was moved.';
        if (mutation === 'candidate') host.context.chat[1].send_date = '2026-11-06';
        if (mutation === 'chat') host.context = { ...host.context, chatId: 'other' };
        return [[1, 0]];
    };
    await assert.rejects(mod.recallRawMemory(config, { hiddenThrough: 1 }), { name: 'AbortError' });
});

test('recent visible prose and explicitly omitted old floors do not reappear through raw recall', async () => {
    host.store.summaryHistory = [{ floorEntry: { floor: 1, omitted: true } }];
    const result = await mod.recallRawMemory({ ...config, embeddingApi: {} }, { hiddenThrough: 1 });
    assert.deepEqual(result.chunks.map(chunk => chunk.floor), [0]);
    assert.equal(host.embeddings.length, 0);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(mod.recallRawMemory(config, { hiddenThrough: 1, signal: cancelled.signal }), { name: 'AbortError' });
});

test('regeneration excludes the AI answer being replaced from both query and raw candidates', async () => {
    host.context.chat[4] = { mes: 'obsolete silver key answer', name: 'Alice', is_user: false };
    const result = await mod.recallRawMemory(config, { hiddenThrough: 4, excludeLastAi: true });
    assert.ok(result.chunks.every(chunk => chunk.floor < 4));
    assert.equal(host.embeddings[0][0].includes('obsolete'), false);
});
