import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { createPlanner } from './runtime.js';
import {
    plannerSnapshot,
    prepareWriterRequest,
    publishNotes,
    reviewReason,
} from './notes.js';
import { createPlannerSettings } from './settings-view.js';
import { emptyWorld } from '../world-records/domain.js';
import { preflightOrderedFloorAgents, renderFloorStatus } from '../../core/floor-status.js';
import { requireAgent } from '../../core/panel-controls.js';
import { captureRangeSource } from '../story-summary/data/turn-source.js';

function memoryNoteStore() {
    let rows = [];
    let rev = 1;
    return {
        async list(owner) {
            return rows.filter(r => r.owner === owner);
        },
        async put(note, fresh) {
            if (fresh && !fresh()) throw new Error('stale snapshot');
            const saved = { ...structuredClone(note), revision: rev++ };
            rows = [...rows, saved];
            return saved;
        },
    };
}

function makeWorld(version = 1, fields = {}, entitiesExtra = []) {
    return {
        ...emptyWorld('w-closure', 'main', '测试世界'),
        version,
        entities: [
            {
                id: 'lin',
                kind: 'person',
                name: '林深',
                aliases: ['林兄'],
                fields: {
                    身份: { value: '客栈账房' },
                    ...fields,
                },
            },
            ...entitiesExtra,
        ],
    };
}

function makeMemory({ summaryHistory = [], storyRecords = [] } = {}) {
    return {
        enabled: true,
        store: {
            summaryHistory,
            json: { storyRecords },
        },
    };
}

function makeChat() {
    return [
        { mes: '雨夜里客栈灯火摇曳。', is_user: false, name: '叙述者', send_date: '2026-11-16T00:00:00Z' },
        { mes: '林深低声清点账册。', is_user: true, name: '你', send_date: '2026-11-16T00:01:00Z' },
    ];
}

test('9A.1: publishNotes refreshes global essay when reason is chapter even if global dependency digests did not change', async () => {
    const world = makeWorld(1);
    const chat = makeChat();
    const memory = makeMemory();
    const snap1 = plannerSnapshot(world, memory, chat, 'owner-chapter');
    const openingRaw = JSON.stringify({
        global: {
            entities: { characters: [{ target: '林深', commentary: '初章', prediction: '观望', suggestion: '守住账房' }] },
            dependencies: [{ entityId: 'lin', field: '身份' }],
        },
        chapter: {
            entities: { characters: [{ target: '林深', commentary: '第一夜', prediction: '谨慎', suggestion: '先试探' }] },
            dependencies: [{ entityId: 'lin', field: '身份' }],
        },
    });
    const prev = publishNotes(openingRaw, null, snap1, 'opening');

    // Simulate advancing to a new chapter boundary while global dependency (`lin.身份`) stays identical.
    const nextSnap = {
        ...plannerSnapshot(world, memory, chat, 'owner-chapter'),
        boundary: 'boundary:chapter-2',
    };
    assert.equal(reviewReason(prev, nextSnap), 'chapter');

    // Omitting global on chapter boundary must be rejected rather than silently preserving stale global prose.
    assert.throws(
        () => publishNotes(JSON.stringify({ chapter: prev.chapter }), prev, nextSnap, 'chapter'),
        { message: '札记格式无效' },
    );

    const chapterRaw = JSON.stringify({
        global: {
            entities: { characters: [{ target: '林深', commentary: '次章全局更新', prediction: '入局', suggestion: '暗查货单' }] },
            dependencies: [{ entityId: 'lin', field: '身份' }],
        },
        chapter: {
            entities: { characters: [{ target: '林深', commentary: '次章简报', prediction: '赴约', suggestion: '带好路引' }] },
            dependencies: [{ entityId: 'lin', field: '身份' }],
        },
    });
    const published = publishNotes(chapterRaw, prev, nextSnap, 'chapter');
    assert.match(published.global.text, /次章全局更新/);
    assert.match(published.chapter.text, /次章简报/);
});

test('9A.2: createPlanner falls back once from partial rewrite to full rewrite when partial diff misses or overflows targets', async () => {
    let world = makeWorld(1);
    const chat = makeChat();
    const memory = makeMemory();
    const store = memoryNoteStore();

    const snap1 = plannerSnapshot(world, memory, chat, 'owner-fallback');
    const openingNote = publishNotes(JSON.stringify({
        global: {
            entities: { characters: [{ target: '林深', commentary: '全局', prediction: '稳', suggestion: '观察' }] },
            dependencies: [{ entityId: 'lin', field: 'name' }],
        },
        chapter: {
            entities: {
                characters: [
                    { target: '林深', commentary: '初态', prediction: '守夜', suggestion: '盘账' },
                    { target: '客栈', commentary: '安静', prediction: '无事', suggestion: '留神' },
                ],
            },
            dependencies: [{ entityId: 'lin', field: '身份' }],
        },
    }), null, snap1, 'opening');
    const savedInitial = await store.put(openingNote);

    world = makeWorld(2, { 身份: { value: '暗线账房' } });
    const modesSeen = [];
    const runtime = createPlanner({
        snapshot: () => plannerSnapshot(world, memory, chat, 'owner-fallback'),
        store,
        status: () => {},
        async write(messages) {
            const payload = JSON.parse(messages[1].content);
            modesSeen.push(payload.mode || 'full');
            if (payload.mode === 'partial') {
                // Intentionally return malformed/missing target so mergePartialChapter rejects and triggers fallback.
                return JSON.stringify({
                    chapter: { entities: { characters: [] }, dependencies: [] },
                });
            }
            return JSON.stringify({
                global: savedInitial.global,
                chapter: {
                    entities: {
                        characters: [
                            { target: '林深', commentary: '全量回退完成', prediction: '暗查', suggestion: '谨慎应对' },
                        ],
                    },
                    dependencies: [{ entityId: 'lin', field: '身份' }],
                },
            });
        },
    });

    const chapterText = await runtime.prepare();
    assert.deepEqual(modesSeen, ['partial', 'full']);
    assert.match(chapterText, /全量回退完成/);
    const rows = await store.list(snap1.owner);
    assert.equal(rows.length, 2);
});

test('9A.3: publishNotes blocks structured, nested array/object, clause, and punctuated paraphrases of private fields', () => {
    const world = makeWorld(1, {
        '管理员私有/底细': {
            value: {
                真实身份: '苍鹰密探',
                接头暗号: ['夜枭3号', { alias: '灰隼' }],
                说明: '暗中勾结北境，真名=陆九',
                密码: 9527,
            },
        },
    });
    const snap = plannerSnapshot(world, makeMemory(), makeChat(), 'owner-secret');

    const tryPublish = chapterText => publishNotes(JSON.stringify({
        global: { text: '全局说明', dependencies: [] },
        chapter: { text: chapterText, dependencies: [] },
    }), null, snap, 'opening');

    for (const leaked of [
        '他其实是苍鹰 密·探。',
        '今晚暗号是「夜枭3号」。',
        '注意代号：灰 隼。',
        '据查他暗中勾结北境。',
        '密室口令写着 9527。',
        '账簿里提到了陆九。',
    ]) {
        assert.throws(() => tryPublish(leaked), { message: '章节稿含管理员私有资料' }, `expected block for ${leaked}`);
    }

    const clean = tryPublish('林深只是一名客栈账房，今晚小心应对即可。');
    assert.match(clean.chapter.text, /客栈账房/);
});

test('9A.4: serializeFullPayload proportionally trims oversized inputs under WRITER_BUDGET_CHARS while preserving all three pillars', () => {
    const hugeKnowledge = Array.from({ length: 40 }, (_, i) => ({
        kind: 'knowledge',
        person: '林深',
        content: `情报-${i}-` + '甲'.repeat(2500),
        certainty: 'confirmed',
        evidence: '乙'.repeat(2000),
    }));
    const hugeSituations = Array.from({ length: 30 }, (_, i) => ({
        id: `sit-${i}`,
        kind: 'situation',
        title: `局势-${i}`,
        status: 'active',
        description: `局势描述-${i}-` + '丙'.repeat(3000),
        impact: '丁'.repeat(1500),
        _history: [{ text: '戊'.repeat(1500) }],
        _developments: [{ title: `动态-${i}`, body: '己'.repeat(1500) }],
    }));
    const world = makeWorld(1);
    const chat = Array.from({ length: 32 }, (_, idx) => ({
        mes: idx % 2 === 0 ? `第${idx}楼提问` : `第${idx}楼回复` + '辛'.repeat(idx === 31 ? 8000 : 120),
        is_user: idx % 2 === 0,
        name: idx % 2 === 0 ? '你' : '叙述者',
        send_date: `t-${idx}`,
    }));
    const memory = makeMemory({
        summaryHistory: Array.from({ length: 16 }, (_, i) => ({
            kind: 'batch',
            startMesId: i * 2,
            endMesId: i * 2 + 1,
            roundSource: captureRangeSource(chat, i * 2, i * 2 + 1),
            summary: `摘要-${i}-` + '庚'.repeat(4000),
        })),
        storyRecords: [...hugeKnowledge, ...hugeSituations],
    });
    const snap = {
        ...plannerSnapshot(world, memory, chat, 'owner-budget'),
        recalledProse: Array.from({ length: 12 }, (_, i) => ({ floor: i, speaker: '林深', text: `召回-${i}-` + '壬'.repeat(3000) })),
    };
    const originalFirstRecordLen = snap.records[0].content.length;

    const req = prepareWriterRequest(snap, null, 'opening');
    assert.equal(req.mode, 'full');
    assert.ok(JSON.stringify(req.messages).length <= 200000);
    assert.equal(snap.records[0].content.length, originalFirstRecordLen);
    const sent = JSON.parse(req.messages[1].content);
    assert.ok(sent.planningTargets.characters.length >= 1);
    assert.ok(sent.planningTargets.situations.length >= 1);
    assert.ok(sent.layeredSummaries.length + sent.recentSummaries.length >= 1);
    assert.ok(sent.recent.length >= 1);
    assert.ok(sent.recalledProse.length >= 1);
});

test('9A.5: runtime retries cleanly on snapshot changes, keeps same-snapshot auto-debounce, and rejects manual triggers for UI display', async () => {
    let world = makeWorld(1);
    let chat = makeChat();
    const memory = makeMemory();
    const store = memoryNoteStore();
    let shouldFail = true;
    let calls = 0;

    const statuses = [];
    const runtime = createPlanner({
        snapshot: () => plannerSnapshot(world, memory, chat, 'owner-retry'),
        store,
        status: (msg, retryable) => statuses.push({ msg, retryable }),
        async write() {
            calls++;
            if (shouldFail) throw new Error('上游模型暂时繁忙');
            return JSON.stringify({
                global: { text: '全局恢复', dependencies: [] },
                chapter: { text: '章节恢复成功', dependencies: [] },
            });
        },
    });

    // 1. Automatic call fails -> debounces identical snapshot calls.
    assert.equal(await runtime.prepare(), '');
    assert.equal(calls, 1);
    assert.equal(await runtime.prepare(), '');
    assert.equal(calls, 1);

    // 2. Snapshot world.version change automatically clears stale failure ticket without explicit retry().
    shouldFail = false;
    world = makeWorld(2);
    const recovered = await runtime.prepare();
    assert.equal(calls, 2);
    assert.equal(recovered, '章节恢复成功');

    // 3. Manual trigger (`force: true, throwOnError: true`) rejects so settings-view shows inline failure feedback.
    world = makeWorld(3);
    shouldFail = true;
    await assert.rejects(
        runtime.prepare(undefined, undefined, { force: true, throwOnError: true }),
        { message: '上游模型暂时繁忙' },
    );

    const { document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
    const root = document.getElementById('root');
    createPlannerSettings(root, {
        async prepare() {
            await runtime.prepare(undefined, undefined, { force: true, throwOnError: true });
        },
        async retry() {
            await runtime.prepare(undefined, undefined, { force: true, throwOnError: true });
        },
    });
    const prepBtn = root.querySelector('[data-prepare-note]');
    prepBtn.click();
    await setImmediate();
    await setImmediate();
    assert.match(root.textContent, /上游模型暂时繁忙/);
    assert.ok(statuses.at(-1).retryable);
});

test('9A.6: preflightOrderedFloorAgents blocks missing required agents and warns softly without aborting when planner is missing', async () => {
    const config = {
        presets: [{ id: 'p', kind: 'text', provider: 'openai-compatible', model: 'local', baseUrl: 'http://localhost' }],
        bindings: { summary: 'p', memory: 'p', opening: 'p', world: 'p' },
    };
    const checkAgent = agent => requireAgent(agent, async () => ({ load: async () => config }));

    const rendered = [];
    let aborted = false;
    const allowed = await preflightOrderedFloorAgents({
        floor: 2,
        checkAgent,
        render: info => rendered.push(info),
        abort: () => { aborted = true; },
    });
    assert.equal(allowed, true);
    assert.equal(aborted, false);
    assert.equal(rendered.length, 1);
    assert.equal(rendered[0].error, undefined);
    assert.equal(rendered[0].agent, 'planner');
    assert.match(rendered[0].message, /编剧agent.*正文继续/);

    const { document } = parseHTML('<!doctype html><html><body></body></html>');
    let openedAgent = null;
    const statusEl = renderFloorStatus({
        doc: document,
        info: rendered[0],
        hasChat: true,
        entry: null,
        readOwner: () => 'o',
        isCurrentFailure: () => false,
        onRetry: () => {},
        onOpenAgent: agent => { openedAgent = agent; },
        onOpenRecovery: () => {},
        onSaveFloorWork: async () => {},
    });
    assert.equal(statusEl.getAttribute('role'), 'status');
    const gotoBtn = [...statusEl.querySelectorAll('button')].find(b => b.textContent === '前往设置');
    assert.ok(gotoBtn);
    gotoBtn.click();
    await setImmediate();
    assert.equal(openedAgent, 'planner');

    // Missing required `update` agent must still fail closed and abort.
    const missingUpdateConfig = {
        presets: [{ id: 'p', kind: 'text', provider: 'openai-compatible', model: 'local', baseUrl: 'http://localhost' }],
        bindings: { world: 'p' },
    };
    const blockedRendered = [];
    let blockedAbort = false;
    const blocked = await preflightOrderedFloorAgents({
        floor: 2,
        checkAgent: agent => requireAgent(agent, async () => ({ load: async () => missingUpdateConfig })),
        render: info => blockedRendered.push(info),
        abort: () => { blockedAbort = true; },
    });
    assert.equal(blocked, false);
    assert.equal(blockedAbort, true);
    assert.equal(blockedRendered[0].error.agent, 'update');
});

test('9A.7: createPlanner invokes recall(snap, signal) and includes recalledProse in writerInput payload without plotLines', async () => {
    const world = makeWorld(1);
    const chat = makeChat();
    const memory = makeMemory({
        storyRecords: [{ id: 's1', kind: 'situation', title: '城东戒严', status: 'open', description: '夜间封闭', parties: ['巡夜司'] }],
    });
    const store = memoryNoteStore();
    const recallCalls = [];
    const writeCalls = [];
    const runtime = createPlanner({
        snapshot: () => plannerSnapshot(world, memory, chat, 'owner-recall'),
        store,
        status: () => {},
        async recall(snap, signal) {
            recallCalls.push({ owner: snap.owner, hasSignal: !!signal });
            return [{ floor: 0, speaker: '铁匠', text: '旧年炉火下藏过半块玉佩。' }];
        },
        async write(messages) {
            writeCalls.push(JSON.parse(messages[1].content));
            return JSON.stringify({
                global: {
                    entities: { characters: [{ target: '林深', commentary: '记住旧玉佩', prediction: '追查出处', suggestion: '核对线索' }] },
                    dependencies: [],
                },
                chapter: {
                    entities: { situations: [{ target: '城东戒严', commentary: '夜行受阻', prediction: '绕行小道', suggestion: '结合旧闻探路' }] },
                    dependencies: [],
                },
            });
        },
    });

    const result = await runtime.prepare();
    assert.equal(recallCalls.length, 1);
    assert.equal(recallCalls[0].hasSignal, true);
    assert.equal(writeCalls.length, 1);
    assert.equal(writeCalls[0].recalledProse[0].text, '旧年炉火下藏过半块玉佩。');
    assert.equal('plotLines' in writeCalls[0].planningTargets, false);
    assert.match(result, /城东戒严/);
});
