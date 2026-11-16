import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, beforeEach, test } from 'node:test';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { createTestModuleUrl } from './helpers/bundle-module.js';
import { usesStoryRecall } from '../generate/recall-policy.js';
import { createRecallReuse } from '../generate/recall-reuse.js';
import { isVectorApiConfigured } from '../vector/llm/api-config-policy.js';
import { rankRawChunks } from '../vector/retrieval/raw-ranking.js';
import { injectEntities, reset as resetTokenizer, tokenizeForIndex } from '../vector/utils/tokenizer.js';
import { db, chunksTable, chunkVectorsTable, metaTable } from '../data/db.js';
import * as runtime from '../vector/runtime/runtime.js';
import { searchRawRecords } from '../vector/storage/raw-recall-store.js';
import { resolveAgentAuth, composeAuthorizedFetch } from '../../agent-core/provider-auth.js';
import { fetchWithExtras } from '../../../shared/common/request-extras.js';
import { usableAgentConnection } from '../../text-api/model.js';
import { assertPlannerPresetReady } from '../../story-planner/preset.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const host = globalThis.__keylessGroupTest = {
    vectorConfig: {},
    context: { chatId: 'chat-1', chat: [] },
    store: { json: {}, summaryHistory: [] },
};

const shims = {
    'extensions.js': 'export const getContext = () => globalThis.__keylessGroupTest.context;',
    'debug-core.js': 'export const xbLog = { isEnabled: () => false, info() {}, warn() {}, error() {}, debug() {} };',
    'modules/story-summary/data/config.js': 'export const getVectorConfig = () => globalThis.__keylessGroupTest.vectorConfig; export const getTextFilterRules = () => [];',
    'modules/story-summary/data/store.js': 'export const getPublishedSummaryStore = () => globalThis.__keylessGroupTest.store; export const isFloorMemoryOmitted = () => false;',
    'modules/text-api/call-stats.js': 'export const featureCalls = { start: () => () => {} };',
};

const bundled = await build({
    stdin: {
        resolveDir: root,
        contents: [
            "export { embed } from './modules/story-summary/vector/llm/siliconflow.js';",
            "export { rerank, testRerankService } from './modules/story-summary/vector/llm/reranker.js';",
            "export { callLLM, testL0Service } from './modules/story-summary/vector/llm/llm-service.js';",
            "export { testOnlineService, getEngineFingerprint } from './modules/story-summary/vector/utils/embedder.js';",
            "export { repairMissingChunks } from './modules/story-summary/vector/pipeline/chunk-repair.js';",
            "export { inspectRawVectorStatus } from './modules/story-summary/vector/pipeline/raw-vector-status.js';",
            "export { recallRawMemory } from './modules/story-summary/vector/retrieval/raw-recall.js';",
            "export { db, metaTable, chunkVectorsTable } from './modules/story-summary/data/db.js';",
            "export { inputDigest } from './modules/story-summary/vector/utils/vector-input-digest.js';",
        ].join('\n'),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [{
        name: 'keyless-group-shims',
        setup(api) {
            api.onResolve({ filter: /.*/ }, args => {
                const relative = path.relative(root, path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/');
                const key = Object.hasOwn(shims, relative) ? relative : path.basename(args.path);
                return Object.hasOwn(shims, key) ? { path: key, namespace: 'host' } : null;
            });
            api.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: shims[args.path], resolveDir: root }));
        },
    }],
});

// eslint-disable-next-line no-unsanitized/method -- Local test bundle, no external code.
const mod = await import(await createTestModuleUrl(bundled.outputFiles[0].text));
const originalFetch = globalThis.fetch;

beforeEach(async () => {
    globalThis.fetch = originalFetch;
    resetTokenizer();
    host.vectorConfig = {};
    host.context = { chatId: 'chat-1', chat: [] };
    host.store = { json: {}, summaryHistory: [] };
    for (const table of db.tables) await table.clear();
    for (const table of mod.db.tables) await table.clear();
    await runtime.shutdownRecallRuntime();
});

after(async () => {
    globalThis.fetch = originalFetch;
    resetTokenizer();
    await runtime.shutdownRecallRuntime();
    db.close();
    mod.db.close();
});

test('group chat type participates in story recall policy and reuse prepare', () => {
    assert.equal(usesStoryRecall('group'), true);
    const reuse = createRecallReuse();
    const chat = [{ mes: '大家好', is_user: true }, { mes: '欢迎进入群聊', name: 'Alice', is_user: false }];
    const { ticket, memory } = reuse.prepare({ chatId: 'group-1', chat }, 'group');
    assert.ok(ticket);
    assert.equal(ticket.chatId, 'group-1');
    assert.equal(ticket.sourceIndex, 1);
    assert.equal(memory, null);
});

test('keyless local endpoints work across agent connections, planner, embed, rerank, l0 and rawRecall', async () => {
    assert.equal(usableAgentConnection({ provider: 'openai-compatible', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1', apiKey: '' }), true);
    assert.doesNotThrow(() => assertPlannerPresetReady({ provider: 'openai-compatible', model: 'qwen2.5', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }));

    const localEmbedCfg = { provider: 'custom', url: 'http://127.0.0.1:11434/v1', model: 'nomic-embed-text', key: '' };
    const localRerankCfg = { provider: 'custom', url: 'http://127.0.0.1:8000/v1', model: 'bge-reranker', key: '' };
    const localL0Cfg = { provider: 'custom', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5', key: '' };
    assert.equal(isVectorApiConfigured(localEmbedCfg), true);
    assert.equal(isVectorApiConfigured({ provider: 'siliconflow', url: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', key: '' }), false);

    host.vectorConfig = {
        enabled: true,
        retrievalMode: 'raw',
        embeddingApi: localEmbedCfg,
        rerankApi: localRerankCfg,
        l0Api: localL0Cfg,
    };

    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
        requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body || '{}')) });
        if (String(url).endsWith('/embeddings')) {
            return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] });
        }
        if (String(url).endsWith('/rerank')) {
            return Response.json({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.4 }] });
        }
        return Response.json({ choices: [{ message: { content: 'OK' } }] });
    };

    const vectors = await mod.embed(['测试文本'], { apiConfig: localEmbedCfg });
    assert.deepEqual(vectors, [[1, 0, 0]]);
    const probe = await mod.testOnlineService('custom', localEmbedCfg);
    assert.deepEqual(probe, { success: true, dims: 3 });

    const ranked = await mod.rerank('钥匙', ['一楼文本', '银钥匙在箱子里'], { topN: 2 });
    assert.equal(ranked.failed, false);
    assert.equal(ranked.results[0].index, 1);
    assert.equal((await mod.testRerankService(localRerankCfg)).success, true);

    const l0Text = await mod.callLLM([{ role: 'user', content: 'hi' }], { apiConfig: localL0Cfg });
    assert.equal(l0Text, 'OK');
    assert.equal((await mod.testL0Service(localL0Cfg)).success, true);

    assert.equal(requests.length, 6);
    assert.ok(requests.every(req => !req.headers.has('authorization')));
});

test('composeAuthorizedFetch preserves user requestExtras while stripping ambient SDK sentinel headers', async () => {
    let captured = null;
    globalThis.fetch = async (url, init) => {
        captured = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body || '{}')) };
        return Response.json({ ok: true });
    };

    const keylessAuth = resolveAgentAuth('openai-compatible', '');
    const extraFetch = fetchWithExtras({
        requestExtras: {
            includeHeaders: 'X-Custom-Tenant: kitchen-local',
            includeBody: 'seed: 42',
        },
    });
    const composed = composeAuthorizedFetch(keylessAuth, extraFetch);
    await composed('http://localhost:11434/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer agent-core-no-auth', 'X-SDK-Leak': 'secret' },
        body: JSON.stringify({ model: 'qwen2.5' }),
    });
    assert.equal(captured.headers.get('authorization'), null);
    assert.equal(captured.headers.get('x-sdk-leak'), null);
    assert.equal(captured.headers.get('x-custom-tenant'), 'kitchen-local');
    assert.equal(captured.body.seed, 42);
    assert.equal(captured.body.model, 'qwen2.5');
});

test('getEngineFingerprint distinguishes custom URLs and dims while keeping default SiliconFlow legacy compatible', async () => {
    assert.equal(mod.getEngineFingerprint({}), 'siliconflow:BAAI/bge-m3:1024');
    assert.equal(
        mod.getEngineFingerprint({ embeddingApi: { provider: 'siliconflow', url: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' } }),
        'siliconflow:BAAI/bge-m3:1024',
    );
    const localA = mod.getEngineFingerprint({ embeddingApi: { provider: 'custom', url: 'http://localhost:11434/v1/', model: 'bge-m3' } });
    const localB = mod.getEngineFingerprint({ embeddingApi: { provider: 'custom', url: 'http://127.0.0.1:8080/v1', model: 'bge-m3' } });
    const dims768 = mod.getEngineFingerprint({ embeddingApi: { provider: 'custom', url: 'http://localhost:11434/v1', model: 'bge-m3', dims: 768 } });
    const dims1536 = mod.getEngineFingerprint({ embeddingApi: { provider: 'custom', url: 'http://localhost:11434/v1', model: 'bge-m3', dims: 1536 } });
    assert.notEqual(localA, localB);
    assert.notEqual(localA, dims768);
    assert.notEqual(dims768, dims1536);

    const fp = mod.getEngineFingerprint({ embeddingApi: { provider: 'custom', url: 'http://localhost:11434/v1', model: 'bge-m3' } });
    const text = '她走进旧档案室。';
    await mod.metaTable.put({ chatId: 'dims-chat', fingerprint: fp, dims: 3, lastChunkFloor: 0 });
    await mod.chunkVectorsTable.put({
        chatId: 'dims-chat',
        chunkId: 'c-0-0',
        fingerprint: fp,
        sourceHash: mod.inputDigest('chunk', text),
        vector: new Float32Array([1, 0, 0]).buffer,
        dims: 3,
    });
    const configChangedStatus = await mod.inspectRawVectorStatus('dims-chat', [{ mes: text }], {
        embeddingApi: { provider: 'custom', url: 'http://localhost:11434/v1', model: 'bge-m3', dims: 4 },
    });
    assert.equal(configChangedStatus.fingerprintMismatch, true);

    await mod.metaTable.put({ chatId: 'dims-chat', fingerprint: fp, dims: 4, lastChunkFloor: 0 });
    const sameFpDimsStatus = await mod.inspectRawVectorStatus('dims-chat', [{ mes: text }], {
        embeddingApi: { provider: 'custom', url: 'http://localhost:11434/v1', model: 'bge-m3' },
    });
    assert.equal(sameFpDimsStatus.dimsMismatch, true);
    assert.equal(sameFpDimsStatus.fingerprintMismatch, true);
});

test('warmRecallRuntime initializes session backend, searchRawRecords uses indexed lookup and degrades non-fatally', async t => {
    await metaTable.put({ chatId: 'warm-chat', fingerprint: 'custom:http://localhost:11434/v1:m:auto', lastChunkFloor: 1 });
    await chunksTable.put({ chatId: 'warm-chat', chunkId: 'c-0-0', floor: 0, text: '桌面上一把铁剑。' });
    await chunkVectorsTable.bulkPut([
        { chatId: 'warm-chat', chunkId: 'c-0-0', fingerprint: 'fp', sourceHash: 'h', vector: new Float32Array([1, 0]).buffer, dims: 2 },
        { chatId: 'warm-chat', chunkId: 'c-999-0', fingerprint: 'fp', sourceHash: 'h', vector: new Float32Array([1, 0]).buffer, dims: 2 },
    ]);

    const warm = await runtime.warmRecallRuntime('warm-chat', { reason: 'unit-warmup' });
    assert.equal(warm.ready, true);
    assert.equal(warm.skipped, false);
    assert.equal(warm.reason, 'unit-warmup');
    assert.equal(warm.stats.chunks, 1);

    const whereCalls = [];
    const origWhere = chunkVectorsTable.where.bind(chunkVectorsTable);
    t.mock.method(chunkVectorsTable, 'where', index => {
        whereCalls.push(index);
        return origWhere(index);
    });
    const docs = [{ chunkId: 'c-0-0', floor: 0, chunkIdx: 0, text: '铁剑在木桌上' }];
    const ok = await searchRawRecords('warm-chat', docs, { queryVector: [1, 0], queryTerms: ['铁剑'], fingerprint: 'fp' });
    assert.deepEqual(whereCalls, ['[chatId+chunkId]']);
    assert.equal(ok.chunks.length, 1);

    t.mock.method(chunkVectorsTable, 'where', () => {
        throw new Error('IDB transaction aborted');
    });
    const warnMock = t.mock.method(console, 'warn', () => {});
    const fallback = await searchRawRecords('warm-chat', docs, { queryVector: [1, 0], queryTerms: ['铁剑'], fingerprint: 'fp' });
    assert.equal(fallback.chunks.length, 1);
    assert.equal(fallback.stats.status, 'raw-vector-read-fallback');
    assert.match(fallback.stats.vectorReadError, /IDB transaction aborted/);
    assert.equal(warnMock.mock.callCount(), 1);
});

test('recallRawMemory reports honest mode and rerankStatus on empty return and rerank failure', async () => {
    const emptyRes = await mod.recallRawMemory({ enabled: true }, { hiddenThrough: -1 });
    assert.equal(emptyRes.mode, 'none');
    assert.equal(emptyRes.rerankStatus, 'disabled');

    host.context = {
        chatId: 'rerank-fail-chat',
        chat: [
            { mes: '银钥匙放在柜子里。', name: 'Alice', is_user: false },
            { mes: '旧怀表也放在柜子里。', name: 'Bob', is_user: false },
            { mes: '柜子里面有什么？', is_user: true },
        ],
    };
    const fp = mod.getEngineFingerprint({});
    await mod.metaTable.put({ chatId: 'rerank-fail-chat', fingerprint: fp, lastChunkFloor: 1, dims: 2 });
    globalThis.fetch = async url => {
        if (String(url).endsWith('/rerank')) return new Response('boom', { status: 502 });
        return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
    };
    host.vectorConfig = {
        enabled: true,
        retrievalMode: 'raw',
        embeddingApi: { provider: 'siliconflow', key: 'k' },
        rerankApi: { provider: 'custom', url: 'http://localhost:8000/v1', model: 'reranker', key: '' },
    };
    const recalled = await mod.recallRawMemory(host.vectorConfig, { hiddenThrough: 1 });
    assert.equal(recalled.mode, 'hybrid');
    assert.equal(recalled.reranked, false);
    assert.equal(recalled.rerankStatus, 'failed');
});

test('repairMissingChunks commits lastChunkFloor and dims incrementally per completed batch', async () => {
    const chat = Array.from({ length: 24 }, (_, idx) => ({ mes: `Floor ${idx} obsidian note.`, is_user: false }));
    const vectorConfig = { embeddingApi: { provider: 'custom', url: 'http://127.0.0.1:11434/v1', model: 'bge-m3', key: '' } };
    let batchNum = 0;
    globalThis.fetch = async (_url, init) => {
        batchNum += 1;
        if (batchNum === 2) return new Response('rate limit', { status: 429 });
        const body = JSON.parse(String(init.body));
        return Response.json({
            data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })),
        });
    };

    const result = await mod.repairMissingChunks({ chatId: 'repair-inc', chat, vectorConfig });
    assert.equal(result.success, false);
    assert.equal(result.repaired, 20);
    const meta = await mod.metaTable.get('repair-inc');
    assert.equal(meta.lastChunkFloor, 19);
    assert.equal(meta.dims, 3);
});

test('single-char CJK tokens (剑/茶/毒) survive tokenization and keyword ranking while stopwords remain filtered', () => {
    injectEntities(new Set(['茶', '剑']));
    assert.ok(tokenizeForIndex('茶').includes('茶'));
    assert.ok(tokenizeForIndex('剑').includes('剑'));
    assert.ok(tokenizeForIndex('İbrahim与Alice arrived').includes('与') === false);

    const ranked = rankRawChunks(
        [
            { chunkId: 'c-0-0', floor: 0, chunkIdx: 0, text: '桌上放着茶，但没有剑。' },
            { chunkId: 'c-1-0', floor: 1, chunkIdx: 0, text: '外面在下雨。' },
        ],
        [],
        { queryTerms: ['茶'] },
    );
    assert.deepEqual(ranked.chunks.map(c => c.chunkId), ['c-0-0']);
});
