import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
    DEFAULT_LEAF_KEEP_RECENT,
    layerSignature,
    planNextCompression,
    selectInjectionNodes,
    summaryLayers,
    thresholdForLevel,
} from '../data/summary-layers.js';
import { runRecursiveCompressionCascade } from '../generate/layer-cascade.js';
import { captureRangeSource } from '../data/turn-source.js';
import { buildTimelineTree, selectTimelineTree } from '../timeline-tree.js';
import { createTestModuleUrl } from './helpers/bundle-module.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function loadPromptModule() {
    const shims = {
        'extensions.js': 'export const getContext = () => globalThis.__compressionPromptCtx;',
        'modules/story-summary/data/store.js': `
            export const getPublishedSummaryStore = () => globalThis.__compressionPromptStore;
            export const getFacts = () => globalThis.__compressionPromptStore?.json?.facts || [];
        `,
        'modules/story-summary/data/config.js': `
            export const getVectorConfig = () => ({ enabled: false });
            export const getSummaryPanelConfig = () => ({ ui: { hideSummarized: true, keepVisibleCount: 0 } });
            export const getSettings = () => ({ storySummary: { enabled: true } });
        `,
        'modules/story-summary/vector/storage/chunk-store.js': 'export const getMeta = async () => null;',
        'modules/story-summary/vector/retrieval/raw-recall.js': 'export const recallRawMemory = async () => ({ chunks: [] });',
        'modules/story-summary/vector/retrieval/entity-lexicon.js': 'export const buildTrustedCharacters = () => new Set();',
    };
    const out = await build({
        entryPoints: [path.join(root, 'modules/story-summary/generate/prompt.js')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        plugins: [{
            name: 'prompt-shims',
            setup(buildCtx) {
                buildCtx.onResolve({ filter: /.*/ }, args => {
                    const target = args.path.startsWith('.')
                        ? path.resolve(args.resolveDir, args.path)
                        : path.join(root, args.path);
                    const rel = path.relative(root, target).replace(/\\/g, '/');
                    if (shims[rel]) return { path: rel, namespace: 'shim' };
                    if (args.path.endsWith('/extensions.js') || args.path === 'extensions.js') return { path: 'extensions.js', namespace: 'shim' };
                    return null;
                });
                buildCtx.onLoad({ filter: /.*/, namespace: 'shim' }, args => ({ contents: shims[args.path], loader: 'js' }));
            },
        }],
    });
    const url = await createTestModuleUrl(out.outputFiles[0].text);
    // eslint-disable-next-line no-unsanitized/method -- Generated local test bundle with fixed host shims; no external source.
    return import(url);
}

async function loadGeneratorModule() {
    const shims = {
        'extensions.js': 'export const getContext = () => globalThis.__generatorBatchCtx;',
        'core/debug-core.js': 'export const xbLog = { info() {}, warn() {}, error() {}, debug() {} };',
        'modules/story-summary/data/store.js': 'export const addSummarySnapshot=()=>{}; export const getFacts=()=>[]; export const getSummaryStore=()=>null; export const mergeNewData=()=>{}; export const isSummaryConsumable=()=>true; export const isFloorMemoryOmitted=idx=>Boolean(globalThis.__generatorOmitted?.has(idx));',
        'modules/story-summary/data/memory-commit.js': 'export const commitSummaryMemory=async()=>{}; export const readSummaryMemory=async()=>{}; export const waitForMemoryCommit=async()=>{}; export const getMemoryCommitState=()=>"idle";',
        'modules/story-summary/data/config.js': 'export const getTextFilterRules = () => [];',
        'modules/world-records/turn-runtime.js': 'export const prepareMemorySources=async()=>null; export const assertMemorySources=()=>{}; export const validateMemorySources=async()=>{}; export const deliverMemorySources=async()=>{};',
        'modules/story-summary/generate/llm.js': 'export const generateSummary=async()=>""; export const isSummaryGenerationCancelledError=()=>false; export const parseSummaryJson=v=>v;',
    };
    const out = await build({
        entryPoints: [path.join(root, 'modules/story-summary/generate/generator.js')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        plugins: [{
            name: 'generator-shims',
            setup(buildCtx) {
                buildCtx.onResolve({ filter: /.*/ }, args => {
                    const target = args.path.startsWith('.')
                        ? path.resolve(args.resolveDir, args.path)
                        : path.join(root, args.path);
                    const rel = path.relative(root, target).replace(/\\/g, '/');
                    if (shims[rel]) return { path: rel, namespace: 'shim' };
                    if (args.path.endsWith('/extensions.js')) return { path: 'extensions.js', namespace: 'shim' };
                    return null;
                });
                buildCtx.onLoad({ filter: /.*/, namespace: 'shim' }, args => ({ contents: shims[args.path], loader: 'js' }));
            },
        }],
    });
    // eslint-disable-next-line no-unsanitized/method -- Generated local test bundle with fixed host shims; no external source.
    return import(await createTestModuleUrl(out.outputFiles[0].text));
}

function makeRoundsFixture(count) {
    const chat = Array.from({ length: count * 2 }, (_, i) => ({
        is_user: i % 2 === 0,
        mes: `第${i + 1}楼正文。`,
    }));
    const history = Array.from({ length: count }, (_, i) => ({
        endMesId: 2 * i + 1,
        summary: `第${i + 1}轮事件摘要`,
        storyTime: `2026/11/${String((i % 20) + 1).padStart(2, '0')} 10:00`,
        sourceReceipt: {
            id: `round:${i}`,
            source: captureRangeSource(chat, 2 * i, 2 * i + 1),
        },
    }));
    return { chat, store: { summaryHistory: history, json: { storyRecords: [{ id: 'clock', kind: 'clock', label: '11月25日', date: '2026-11-25' }] } } };
}

test('thresholdForLevel and planNextCompression keep newest L0 leaves and cascade up L1 -> L2 -> L3', async () => {
    assert.equal(DEFAULT_LEAF_KEEP_RECENT, 3);
    assert.equal(thresholdForLevel(0), 12);
    assert.equal(thresholdForLevel('stage'), 6);
    assert.equal(thresholdForLevel('chapter'), 3);
    assert.equal(thresholdForLevel('L3'), 3);

    const underLimit = makeRoundsFixture(14);
    assert.equal(planNextCompression(underLimit.store.summaryHistory, { chat: underLimit.chat }), null);

    const atLimit = makeRoundsFixture(15);
    const plan = planNextCompression(atLimit.store.summaryHistory, { chat: atLimit.chat });
    assert.equal(plan.level, 'stage');
    assert.equal(plan.nodes.length, 12);
    assert.equal(plan.start, 0);
    assert.equal(plan.end, 23);

    // 18 * 12 = 216 leaves: with leafKeepRecent=0 cascades 18 L1 -> 3 L2 -> 1 L3 recursively.
    const deep = makeRoundsFixture(216);
    let calls = 0;
    const staged = await runRecursiveCompressionCascade(deep.store, { minDepth:0,
        chat: deep.chat,
        leafKeepRecent: 0,
        maxNodes: 30,
        summarizeLayer: async ({ level, children }) => {
            calls++;
            return `${level}:${children[0].start}-${children.at(-1).end}`;
        },
    });
    assert.equal(calls, 22);
    assert.equal(staged.filter(n => n.level === 'stage').length, 18);
    assert.equal(staged.filter(n => n.level === 'chapter').length, 3);
    assert.equal(staged.filter(n => n.level === 'L3').length, 1);

    deep.store.summaryHistory.at(-1).reviewLayers = staged;
    const { roots, parents } = summaryLayers(deep.store.summaryHistory, [], { chat: deep.chat });
    assert.equal(parents.length, 22);
    assert.equal(roots.length, 1);
    assert.equal(roots[0].level, 'L3');
});

test('selectInjectionNodes downgrades broken ancestors cleanly on partial swipe or visibility boundary and restores when reverted', () => {
    const { chat, store } = makeRoundsFixture(12);
    const { leaves } = summaryLayers(store.summaryHistory, [], { chat });
    const s1Kids = leaves.slice(0, 6);
    const s2Kids = leaves.slice(6, 12);
    const s1 = {
        id: 'stage-1',
        level: 'stage',
        start: s1Kids[0].start,
        end: s1Kids.at(-1).end,
        text: '阶段一合并摘要',
        sourceId: layerSignature(s1Kids),
        childIds: s1Kids.map(k => k.id),
    };
    const s2 = {
        id: 'stage-2',
        level: 'stage',
        start: s2Kids[0].start,
        end: s2Kids.at(-1).end,
        text: '阶段二合并摘要',
        sourceId: layerSignature(s2Kids),
        childIds: s2Kids.map(k => k.id),
    };
    const ch = {
        id: 'chapter-1',
        level: 'chapter',
        start: s1.start,
        end: s2.end,
        text: '第一章总摘要',
        sourceId: layerSignature([s1, s2]),
        childIds: ['stage-1', 'stage-2'],
    };
    store.summaryHistory.at(-1).reviewLayers = [s1, s2, ch];

    assert.deepEqual(selectInjectionNodes(store.summaryHistory, chat, 23).map(n => n.id), ['chapter-1']);

    assert.deepEqual(
        selectInjectionNodes(store.summaryHistory, chat, 15).map(n => n.id),
        ['stage-1', 'round:6', 'round:7'],
    );

    const savedMes = chat[3].mes;
    chat[3].mes = '翻页到另一个支线回复。';
    assert.deepEqual(
        selectInjectionNodes(store.summaryHistory, chat, 23).map(n => n.id),
        ['round:0', 'round:2', 'round:3', 'round:4', 'round:5', 'stage-2'],
    );

    chat[3].mes = savedMes;
    assert.deepEqual(selectInjectionNodes(store.summaryHistory, chat, 23).map(n => n.id), ['chapter-1']);
});

test('buildTimelineTree nests 4-level hierarchies including L3', () => {
    const rounds = Array.from({ length: 4 }, (_, i) => ({
        id: `round-${i}`,
        _addedAt: i,
        origin: { start: i, end: i },
        summary: `轮${i}`,
    }));
    const units = [
        { level: 'stage', start: 0, end: 1, text: 'S1' },
        { level: 'stage', start: 2, end: 3, text: 'S2' },
        { level: 'chapter', start: 0, end: 3, text: 'C1' },
        { level: 'L3', start: 0, end: 3, text: 'Vol1' },
    ];
    const tree = buildTimelineTree(rounds, units);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].level, 'L3');
    assert.equal(tree[0].children[0].level, 'chapter');
    assert.equal(tree[0].children[0].children.length, 2);
});

test('buildRawPrompt allocates plotBudget newest-to-oldest, renders chronologically, and appends relative story time', async () => {
    const mod = await loadPromptModule();
    const longText = '这是一段足够长的历史摘要内容。'.repeat(28);
    const chat = Array.from({ length: 32 }, (_, i) => ({ is_user: i % 2 === 0, mes: `正文${i}` }));
    const history = Array.from({ length: 16 }, (_, i) => ({
        endMesId: 2 * i + 1,
        summary: `条目${i + 1}:${longText}`,
        timeEnd: `2026/11/${String(i + 1).padStart(2, '0')} 10:00`,
        sourceReceipt: { id: `r:${i}`, source: captureRangeSource(chat, 2 * i, 2 * i + 1) },
    }));
    const store = {
        summaryHistory: history,
        lastSummarizedMesId: 31,
        json: {
            facts: [],
            storyRecords: [{ id: 'clock', kind: 'clock', label: '2026年11月17日', date: '2026-11-17' }],
        },
    };
    globalThis.__compressionPromptCtx = { chat, name1: '主角', chatId: 'c1' };
    globalThis.__compressionPromptStore = store;
    const result = mod.buildRawPrompt(store, { chunks: [], focusCharacters: [] }, 31);
    assert.ok(result.includedBackgroundItems < 16);
    assert.ok(result.includedBackgroundItems > 0);
    assert.ok(result.promptText.includes('条目16:'), 'newest summary must survive budget truncation');
    assert.ok(!result.promptText.includes('条目1:'), 'oldest summary should be dropped first');
    assert.ok(result.promptText.includes('昨天·周一'), result.promptText);
    const firstKeptIdx = result.promptText.indexOf('条目15:');
    const newestIdx = result.promptText.indexOf('条目16:');
    assert.ok(firstKeptIdx >= 0 && newestIdx > firstKeptIdx);
});

test('raw prompt protects old protagonist goals, inventory and conditions under both state budgets', async () => {
    const mod = await loadPromptModule();
    const hero = { holders:['旅人'], status:'open', conditions:'须先赎回抵押物', _addedAt:1 };
    const hooks = Array.from({length:100},(_,i)=>({ kind:i%2?'situation':'suspense', title:'新传闻'+i, description:'围观者众多'.repeat(12), status:'open', _addedAt:9+i }));
    const facts = Array.from({length:100},(_,i)=>({ s:'船夫',p:'近况'+i,o:'潮汐变化'.repeat(12),since:10+i }));
    facts.push({s:'银钥匙',p:'保管人',o:'旅人',since:1},{s:'旅人',p:'约束',o:'三日内须还债',since:1});
    const store = { lastSummarizedMesId:120, summaryHistory:[],json:{ facts,storyRecords:[
        ...hooks,{...hero,kind:'goal',title:'恢复航路'},{...hero,kind:'plan',title:'赎回渔船'},
        {kind:'knowledge',person:'船夫',content:'密库口令',certainty:'known',evidence:'偷听'}]} };
    globalThis.__compressionPromptCtx = { chat:[],name1:'旅人' };
    globalThis.__compressionPromptStore = store;
    const {promptText} = mod.buildRawPrompt(store,{chunks:[],focusCharacters:['船夫']},-1);
    for (const expected of ['恢复航路','赎回渔船','须先赎回抵押物','银钥匙','三日内须还债','新传闻']) assert.ok(promptText.includes(expected),expected);
    assert.doesNotMatch(promptText,/密库口令/);
});

test('planSummaryBatches and buildIncrementalSlice respect character caps without splitting mid-floor', async () => {
    const gen = await loadGeneratorModule();
    const chat = [
        { is_user: true, mes: 'A'.repeat(400) },
        { is_user: false, mes: 'B'.repeat(400) },
        { is_user: true, mes: 'C'.repeat(400) },
        { is_user: false, mes: 'D'.repeat(400) },
        { is_user: false, mes: 'E'.repeat(1200) }, // Single oversized floor still makes progress alone
    ];
    globalThis.__generatorOmitted = new Set();
    globalThis.__generatorBatchCtx = { chat, name1: '玩家', name2: '伙伴' };

    const batches = gen.planSummaryBatches(chat, 0, 4, { maxPerRun: 100, maxChars: 900 });
    assert.deepEqual(batches.map(b => [b.start, b.end]), [[0, 1], [2, 3], [4, 4]]);

    const slice = gen.buildIncrementalSlice(4, -1, 100, 0, [], 900);
    assert.equal(slice.endMesId, 1);
    assert.equal(slice.count, 2);
    assert.equal(slice.hasMoreBatches, true);

    // Oversized single floor at index 4 advances cleanly when start=4
    const nextSlice = gen.buildIncrementalSlice(4, 3, 100, 0, [], 900);
    assert.equal(nextSlice.endMesId, 4);
    assert.equal(nextSlice.count, 1);
    assert.equal(nextSlice.hasMoreBatches, false);
});

test('runRecursiveCompressionCascade rolls L0 -> L1 -> L2 cleanly from minDepth=0 without plotLines and drops cleanly on swipe', async () => {
    const mod = await loadPromptModule();
    const roundCount = thresholdForLevel(0) * thresholdForLevel(1) + DEFAULT_LEAF_KEEP_RECENT;
    const chat = Array.from({ length: roundCount * 2 }, (_, i) => ({ is_user: i % 2 === 0, mes: `正文${i}` }));
    const summaryHistory = Array.from({ length: roundCount }, (_, i) => ({
        endMesId: 2 * i + 1,
        summary: `轮${i}摘要`,
        sourceReceipt: { id: `c:${i}`, source: captureRangeSource(chat, 2 * i, 2 * i + 1) },
    }));
    const staged = await runRecursiveCompressionCascade({ summaryHistory }, {
        minDepth: 0,
        chat,
        summarizeLayer: async ({ level, children }) => `${level}:${children[0].start}-${children.at(-1).end}`,
    });
    assert.equal(staged.filter(n => n.level === 'stage').length, 6);
    assert.equal(staged.filter(n => n.level === 'chapter').length, 1);

    summaryHistory[71].compressionNodes = staged;
    const store = {
        summaryHistory,
        lastSummarizedMesId: roundCount * 2 - 1,
        json: { facts: [], storyRecords: [] },
    };
    globalThis.__compressionPromptCtx = { chat, name1: '主角', chatId: 'c-snap' };
    globalThis.__compressionPromptStore = store;

    const prompt = mod.buildRawPrompt(store, { chunks: [], focusCharacters: [] }, roundCount * 2 - 1);
    assert.match(prompt.promptText, /chapter:0-143/);
    assert.equal('plotLineSnapshots' in staged.find(n => n.level === 'chapter'), false);

    chat[3].mes = '切分支后的全新对话。';
    const afterSwipe = mod.buildRawPrompt(store, { chunks: [], focusCharacters: [] }, roundCount * 2 - 1);
    assert.doesNotMatch(afterSwipe.promptText, /chapter:0-143/);

    const tree = buildTimelineTree([{ id: 'round-0', _addedAt: 0, origin: { start: 0, end: 1 }, summary: '追查北仓' }], [
        { level: 'stage', start: 0, end: 1, text: '阶段正文' },
    ]);
    assert.equal(selectTimelineTree(tree, { query: '北仓' }).length, 1);
});
