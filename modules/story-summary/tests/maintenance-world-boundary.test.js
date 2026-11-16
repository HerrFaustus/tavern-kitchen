import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemorySession } from '../maintenance/session.js';
import { MEMORY_COLLECTIONS, LEGACY_MEMORY_COLLECTIONS, editMemoryBatch } from '../maintenance/domain.js';
import { validateMaintenanceReceipt } from '../maintenance/history.js';
import { getMemoryMaintenancePrompt, getMemoryChatPrompt } from '../maintenance/prompt.js';
import { createSummaryBaseline } from '../data/summary-history.js';
import { maintenanceFixture } from './fixtures/memory-maintenance.js';

function createWorldBoundaryFixture() {
    const base = maintenanceFixture();
    base.json.facts.push(
        { id: 'f-loc', s: '夏实', p: '所在地', o: '老宅', _addedAt: 23 },
        { id: 'f-coins', s: '夏实', p: '金币', o: '10', _addedAt: 23 },
        { id: 'f-owner', s: '药箱', p: 'owner', o: '旅人', _addedAt: 23 },
        { id: 'f-secret', s: '夏实', p: '真实身份', o: '普通学生', _addedAt: 23 },
        { id: 'f-priv', s: '夏实', p: '秘密', o: '旧的隐藏内容', _addedAt: 23 },
    );
    base.json.storyRecords = [
        { id: 'sr-1', kind: 'situation', title: '城门戒严', status: 'open', description: '夜禁中', _addedAt: 23 },
        { id: 'sr-removed', kind: 'suspense', title: '失踪的钥匙', status: 'open', description: '待查', _addedAt: 23 },
        { id: 'sr-summary', kind: 'suspense', title: '茶杯里的暗号', status: 'open', description: '仅总结侧记录', _addedAt: 23 },
    ];
    base.store = {
        json: base.json,
        lastSummarizedMesId: base.cutoff,
        summaryHistory: [createSummaryBaseline(base.cutoff)],
    };
    const world = {
        schema: 4,
        worldId: 'w-test',
        branchId: 'b-test',
        version: 3,
        sources: {
            memory: {
                records: [{ key: 'char-0', name: '夏实', aliases: ['小夏'] }],
            },
        },
        entities: [
            {
                id: 'e-place',
                kind: 'place',
                name: '东京塔',
                aliases: [],
                bindings: [],
                fields: {},
            },
            {
                id: 'e-natsumi',
                kind: 'person',
                name: '夏实',
                aliases: ['小夏'],
                bindings: [JSON.stringify(['memory', 'char-0'])],
                fields: {
                    location: { value: { entityId: 'e-place' }, nature: 'established_fact' },
                    coins: { value: 88, nature: 'established_fact' },
                    '管理员私有/真实身份': { value: '七号卧底', nature: 'established_fact' },
                },
            },
        ],
        modules: {
            story: {
                version: 1,
                revision: 3,
                records: [
                    {
                        key: 'sr-1',
                        record: { id: 'sr-1', kind: 'situation', title: '城门戒严', status: 'done', description: '凌晨已解除' },
                        nature: 'established_fact',
                        source: { module: 'world', key: 'sr-1', label: '世界推进' },
                        version: 2,
                        eventId: 'evt-w1',
                        start: 0,
                        end: 23,
                    },
                    {
                        key: 'sr-removed',
                        record: { id: 'sr-removed', kind: 'suspense', title: '失踪的钥匙', remove: true },
                        nature: 'established_fact',
                        source: { module: 'world', key: 'sr-removed', label: '世界推进' },
                        version: 2,
                        eventId: 'evt-w2',
                        start: 0,
                        end: 23,
                    },
                    {
                        key: 'sr-world-only',
                        record: { id: 'sr-world-only', kind: 'situation', title: '码头发船', status: 'open', description: 'worldArchive 新增' },
                        nature: 'established_fact',
                        source: { module: 'world', key: 'sr-world-only', label: '世界推进' },
                        version: 3,
                        eventId: 'evt-w3',
                        start: 0,
                        end: 23,
                    },
                ],
                candidates: [],
            },
        },
    };
    return { ...base, world };
}

test('5A: MEMORY_COLLECTIONS drops events while preserving internal legacy history/batch compatibility', () => {
    assert.deepEqual(MEMORY_COLLECTIONS, ['facts', 'characters', 'characterAliases', 'anchors', 'storyRecords']);
    assert.ok(LEGACY_MEMORY_COLLECTIONS.includes('events'));

    const current = createWorldBoundaryFixture();
    const session = createMemorySession(current);
    const opening = session.initial();
    assert.deepEqual(opening.memoryDirectory.map(item => item.collection), MEMORY_COLLECTIONS);

    assert.throws(() => session.runTool('ReadMemory', { collection: 'events' }, current), { code: 'invalid_arguments' });
    const rejected = session.runTool('EditMemory', {
        edits: [{ kind: 'edit', collection: 'events', key: 'evt-1', patch: { title: '不应改写' } }],
        evidence: { floor: 2, quote: '看到了机密' },
    }, current);
    assert.equal(rejected.status, 'needs_fix');

    const legacyBatch = editMemoryBatch(
        { json: { events: [{ id: 'evt-legacy', title: '旧标题', summary: '旧经过 (#1)', timeLabel: '今天', participants: [], causedBy: [], memoryRole: '具体经历' }] }, atoms: [] },
        [{ kind: 'edit', collection: 'events', key: 'evt-legacy', patch: { title: '兼容修订' } }],
        10,
    );
    assert.equal(legacyBatch.memory.json.events[0].title, '兼容修订');

    assert.doesNotThrow(() => validateMaintenanceReceipt({
        version: 2,
        id: 'legacy-r',
        runId: 'legacy-run',
        policy: { version: 1, filterRules: [] },
        operations: [{
            kind: 'edit',
            collection: 'events',
            key: 'evt-legacy',
            changes: [{ collection: 'events', key: 'evt-legacy', index: 0, before: { title: 'a' }, after: { title: 'b' } }],
        }],
        coverage: { supplied: [], missingAnchors: [] },
    }));
});

test('5A: unified ReadMemory reflects worldArchive truth, marks readOnly, hides private secrets, and avoids false completion conflicts', () => {
    const current = createWorldBoundaryFixture();
    const session = createMemorySession(current);
    const opening = session.initial();

    assert.equal(JSON.stringify(opening).includes('七号卧底'), false);
    const allFacts = session.runTool('ReadMemory', { collection: 'facts', limit: 20 }, current);
    assert.equal(JSON.stringify(allFacts).includes('七号卧底'), false);
    assert.equal(allFacts.items.some(item => item.key === 'f-secret' || item.key === 'f-priv'), false);
    assert.throws(() => session.runTool('ReadMemory', { collection: 'facts', key: 'f-secret' }, current), { code: 'record_missing' });

    const locFact = allFacts.items.find(item => item.key === 'f-loc');
    assert.equal(locFact.value.o, '东京塔');
    assert.equal(locFact.readOnly, true);
    assert.equal(locFact.owner, 'worldArchive');

    const coinFact = allFacts.items.find(item => item.key === 'f-coins');
    assert.equal(coinFact.value.o, '88');
    assert.equal(coinFact.readOnly, true);
    assert.equal(coinFact.owner, 'worldArchive');

    const ownerFact = allFacts.items.find(item => item.key === 'f-owner');
    assert.equal(ownerFact.readOnly, true);
    assert.equal(ownerFact.owner, 'worldArchive');

    const regularFact = allFacts.items.find(item => item.key === 'f-1');
    assert.equal(regularFact.readOnly, undefined);
    assert.equal(regularFact.owner, undefined);

    const stories = session.runTool('ReadMemory', { collection: 'storyRecords', limit: 20 }, current);
    const sr1 = stories.items.find(item => item.key === 'sr-1');
    assert.equal(sr1.value.status, 'done');
    assert.equal(sr1.readOnly, true);
    assert.equal(sr1.owner, 'worldArchive');

    const srWorldOnly = stories.items.find(item => item.key === 'sr-world-only');
    assert.equal(srWorldOnly.value.title, '码头发船');
    assert.equal(srWorldOnly.readOnly, true);
    assert.equal(srWorldOnly.owner, 'worldArchive');
    assert.equal(stories.items.some(item => item.key === 'sr-removed'), false);

    const srSummary = stories.items.find(item => item.key === 'sr-summary');
    assert.equal(srSummary.readOnly, undefined);

    session.runTool('CompleteMaintenance', { from: 1, to: 24 }, current);
    assert.doesNotThrow(() => session.assertCurrent(current));
});

test('5A: EditMemory blocks worldArchive-owned facts, storyRecords, secrets and structured fields with world_owned', () => {
    const current = createWorldBoundaryFixture();
    const session = createMemorySession(current);
    const ev = { floor: 2, quote: '看到了机密' };

    for (const badEdit of [
        { kind: 'edit', collection: 'facts', key: 'f-loc', patch: { o: '拉萨' } },
        { kind: 'delete', collection: 'facts', key: 'f-coins' },
        { kind: 'edit', collection: 'facts', key: 'f-owner', patch: { o: '旁人' } },
        { kind: 'edit', collection: 'facts', key: 'f-secret', patch: { o: '暴露' } },
        { kind: 'edit', collection: 'facts', key: 'f-1', patch: { p: '金币', o: '999' } },
        { kind: 'edit', collection: 'storyRecords', key: 'sr-1', patch: { status: 'open' } },
        { kind: 'delete', collection: 'storyRecords', key: 'sr-world-only' },
        { kind: 'edit', collection: 'storyRecords', key: 'sr-removed', patch: { status: 'open' } },
    ]) {
        const res = session.runTool('EditMemory', { edits: [badEdit], evidence: ev }, current);
        assert.equal(res.status, 'needs_fix', JSON.stringify(badEdit));
        assert.equal(res.rejected[0].code, 'world_owned', JSON.stringify(res));
    }

    const okSummaryStory = session.runTool('EditMemory', {
        edits: [
            { kind: 'edit', collection: 'facts', key: 'f-1', patch: { o: '仍只是听说，未查证' } },
            { kind: 'edit', collection: 'storyRecords', key: 'sr-summary', patch: { status: 'done', reason: '已查明' } },
        ],
        evidence: ev,
    }, current);
    assert.equal(okSummaryStory.status, 'staged', JSON.stringify(okSummaryStory));
});

test('5A: EditMemory enforces filtered story evidence on non-empty edits and allows empty no-ops', () => {
    const current = createWorldBoundaryFixture();
    current.chat[1].mes = '夏实说：<think>内心秘密片段</think>“听说我可能因为看到了机密。”<kitchen_summary>{"summary":"protocol"}</kitchen_summary>';
    const session = createMemorySession({
        ...current,
        filterRules: [{ start: '<think>', end: '</think>' }],
    });

    const noop = session.runTool('EditMemory', { edits: [] }, current);
    assert.equal(noop.status, 'unchanged');

    const missing = session.runTool('EditMemory', {
        edits: [{ kind: 'edit', collection: 'facts', key: 'f-1', patch: { o: '缺证据' } }],
    }, current);
    assert.equal(missing.status, 'needs_fix');
    assert.equal(missing.rejected[0].code, 'invalid_evidence');

    const filteredOut = session.runTool('EditMemory', {
        edits: [{ kind: 'edit', collection: 'facts', key: 'f-1', patch: { o: '引用被过滤块' } }],
        evidence: { floor: 2, quote: '内心秘密片段' },
    }, current);
    assert.equal(filteredOut.status, 'needs_fix');
    assert.equal(filteredOut.rejected[0].code, 'invalid_evidence');

    const protocolLeak = session.runTool('EditMemory', {
        edits: [{ kind: 'edit', collection: 'facts', key: 'f-1', patch: { o: '引用协议块' } }],
        evidence: { floor: 2, quote: '"summary":"protocol"' },
    }, current);
    assert.equal(protocolLeak.status, 'needs_fix');
    assert.equal(protocolLeak.rejected[0].code, 'invalid_evidence');

    const outOfRange = session.runTool('EditMemory', {
        edits: [{ kind: 'edit', collection: 'facts', key: 'f-1', patch: { o: '越界楼层' } }],
        evidence: { floor: current.cutoff + 2, quote: 'anything' },
    }, current);
    assert.equal(outOfRange.status, 'needs_fix');
    assert.equal(outOfRange.rejected[0].code, 'source_boundary');

    current.chat[0] = { is_system: true, extra: { type: 'meta' }, mes: '系统控制段' };
    const metaFloor = session.runTool('EditMemory', {
        edits: [{ kind: 'edit', collection: 'facts', key: 'f-1', patch: { o: '系统段' } }],
        evidence: { floor: 1, quote: '系统控制段' },
    }, current);
    assert.equal(metaFloor.status, 'needs_fix');
    assert.equal(metaFloor.rejected[0].code, 'source_missing');

    const valid = session.runTool('EditMemory', {
        edits: [{ kind: 'edit', collection: 'facts', key: 'f-1', patch: { o: '只因疑似看到机密' } }],
        evidence: { floor: 2, quote: '看到了机密' },
    }, current);
    assert.equal(valid.status, 'staged');
});

test('5A: prompt exposes confidentiality, worldArchive readOnly boundary, evidence rules, and destructive bulk confirmation', () => {
    const autoPrompt = getMemoryMaintenancePrompt();
    const chatPrompt = getMemoryChatPrompt();
    for (const text of [autoPrompt, chatPrompt]) {
        assert.match(text, /confidential|保密/i);
        assert.match(text, /管理员私有\//);
        assert.match(text, /worldArchive/i);
        assert.match(text, /world-records/);
        assert.match(text, /evidence/);
    }
    assert.match(chatPrompt, /deleting 3 or more/i);
    assert.match(chatPrompt, /confirm/i);
});
