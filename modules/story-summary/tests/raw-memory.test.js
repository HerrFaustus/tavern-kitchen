import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRawChunks } from '../vector/retrieval/raw-ranking.js';
import { inputDigest } from '../vector/utils/vector-input-digest.js';
import { prepareMemoryTags, memoryTagsByFloor } from '../data/memory-tags.js';
import { captureRangeSource, isRangeSourceCurrent } from '../data/turn-source.js';
import { memoryDigest } from '../data/memory-policy.js';
import { getRawEntityVocabulary } from '../vector/retrieval/raw-vocabulary.js';
import { selectChunksForRepair } from '../vector/pipeline/chunk-repair-policy.js';
import { plotBackgroundItems } from '../generate/plot-background.js';

const chunk = (floor, text, tags = []) => ({ chunkId: `c-${floor}-0`, floor, chunkIdx: 0, text, tags });
const record = (item, extra = {}) => ({ chunkId: item.chunkId, fingerprint: 'test', vector: [1, 0],
    sourceHash: inputDigest('chunk', item.text), ...extra });

test('raw retrieval works without scenes or events and fuses keyword/tag and vector candidates once', () => {
    const documents = [chunk(0, '把它锁进柜子。', ['银钥匙', '旧钟楼']), chunk(1, '钥匙在石头下面。'), chunk(2, '无关的天气。')];
    const result = rankRawChunks(documents, [record(documents[1])], { fingerprint: 'test', queryVector: [1, 0], queryTerms: ['银钥匙'] });
    assert.deepEqual(new Set(result.chunks.map(item => item.floor)), new Set([0, 1]));
    assert.equal(result.stats.usableVectors, 1);
    assert.equal(result.chunks.find(item => item.floor === 0).text, documents[0].text, 'tags locate original evidence instead of becoming evidence');
    assert.equal(result.chunks.some(item => Object.hasOwn(item, 'tags')), false);
});

test('wrong source, model, dimensions and damaged vectors never contribute dense evidence', () => {
    const documents = Array.from({ length: 5 }, (_, floor) => chunk(floor, `钥匙 ${floor}`));
    const records = [record(documents[0], { sourceHash: inputDigest('chunk', '旧候选') }),
        record(documents[1], { fingerprint: 'old' }), record(documents[2], { dims: 3 }),
        record(documents[3], { vector: new ArrayBuffer(3) }), record(documents[4], { vector: [NaN, 0] })];
    const result = rankRawChunks(documents, records, { fingerprint: 'test', queryVector: [1, 0], queryTerms: ['钥匙'] });
    assert.equal(result.stats.usableVectors, 0);
    assert.equal(result.chunks.length, 5, 'keyword retrieval still uses current prose');
    assert.equal(rankRawChunks(documents, records, { fingerprint: 'test', queryVector: [1, 0] }).chunks.length, 0);
});

test('the fused raw pool is bounded and cannot repeat one chunk through multiple channels', () => {
    const documents = Array.from({ length: 120 }, (_, floor) => chunk(floor, 'silver key'));
    const result = rankRawChunks(documents, documents.map(item => record(item)), { fingerprint: 'test', queryVector: [1, 0], queryTerms: ['silver'], limit: 40 });
    assert.equal(result.chunks.length, 40);
    assert.equal(new Set(result.chunks.map(item => item.chunkId)).size, 40);
});

test('turn tags retain a version and follow the exact source revision, without a second identity ledger', () => {
    const chat = [{ mes: '银钥匙在旧钟楼。', name: 'Alice', send_date: '2026-11-05' }];
    const memoryTags = prepareMemoryTags({ memoryTags: { characters: ['Alice', 'Alice'], locations: ['旧钟楼'], keywords: ['银钥匙'] } });
    assert.equal(memoryTags.version, 1);
    assert.deepEqual(memoryTags.characters, ['Alice']);
    const store = { summaryHistory: [{ sourceReceipt: { source: captureRangeSource(chat, 0, 0) }, memoryTags }] };
    assert.ok(memoryTagsByFloor(store, chat).get(0).includes('银钥匙'));
    chat[0].mes = '钥匙已经被带走。';
    assert.equal(memoryTagsByFloor(store, chat).size, 0);
    assert.throws(() => prepareMemoryTags({ memoryTags: { characters: 'Alice' } }), /标签/);
});

test('raw vocabulary uses current plot records and aliases without reading historical scene atoms', () => {
    const vocabulary = getRawEntityVocabulary({ json: { characters: { main: ['Alice'] }, storyRecords: [{ kind: 'scene', location: '钟楼', participants: ['Bob'] }],
        characterAliases: [{ from: '小爱', to: 'Alice' }] } }, { name1: '玩家', name2: 'Alice' });
    assert.equal(vocabulary.displayMap.get('小爱'), 'Alice');
    assert.ok(vocabulary.lexicon.has('bob'));
    assert.equal(vocabulary.lexicon.has('玩家'), false);
});

test('raw repair migrates vectors without a captured source and repairs changed prose only once', () => {
    const current = chunk(0, '新版正文');
    const old = { ...current, text: '旧版正文' };
    const valid = { ...record(current), valid: true };
    assert.deepEqual(selectChunksForRepair([current], [old], [valid], 'test', { verifySource: true }), [current]);
    assert.deepEqual(selectChunksForRepair([current], [current], [{ ...valid, sourceHash: undefined }], 'test', { verifySource: true }), [current]);
    assert.deepEqual(selectChunksForRepair([current], [current], [valid], 'test', { verifySource: true }), []);
});

test('plot background is independent of recall hits, excludes visible prose and cannot revive a stale source via old events', () => {
    const chat = [{ mes: '过去的行动。', send_date: '2026-11-05' }, { mes: '最近的行动。', send_date: '2026-11-06' }];
    const source = captureRangeSource(chat, 0, 0);
    const store = { summaryHistory: [{ previousEndMesId: -1, endMesId: 0, summary: '已经达成承诺。', sourceReceipt: { source } }],
        json: { events: [{ title: '重复事件', summary: '同一承诺 (#1)' }, { title: '近期事件', summary: '最近的行动 (#2)' }] } };
    assert.deepEqual(plotBackgroundItems(store, chat, 0).map(item => item.text), ['已经达成承诺。']);
    chat[0].mes = '已经改写的过去。';
    assert.deepEqual(plotBackgroundItems(store, chat, 0), []);
});

test('message visibility is not a source revision, including old hidden-message receipts', () => {
    const chat = [{ mes: '原文没有改写。', send_date: '2026-11-05' }];
    const source = captureRangeSource(chat, 0, 0);
    const legacy = structuredClone(source); legacy.messages[0].role = 'system';
    legacy.digest = memoryDigest(legacy.messages.map(({ floor, ...message }) => message));
    chat[0].is_system = true;
    assert.equal(captureRangeSource(chat, 0, 0).digest, source.digest);
    assert.equal(isRangeSourceCurrent(source, chat), true);
    assert.equal(isRangeSourceCurrent(legacy, chat), true);
    chat[0].is_system = false;
    assert.equal(isRangeSourceCurrent(legacy, chat), true);
    chat[0].is_user = true;
    assert.equal(isRangeSourceCurrent(legacy, chat), false, 'a real author-role change is still a revision');
});
