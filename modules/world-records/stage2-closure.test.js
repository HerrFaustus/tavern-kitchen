import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { applyCommand, canonical, emptyWorld, fieldValue, forkWorld } from './domain.js';
import { historicalWorld } from './historical.js';
import { currentTurns } from './turn-ledger.js';
import { openingOperations } from './opening-projection.js';
import { initializeOpening } from './opening.js';
import { buildAuthorityContext } from './authority.js';
import { turnOperations } from './turn-actions.js';
import { createFloorProcessing } from './turn-processing.js';
import { renderFloorStatus, resolveFailureRoute } from '../../core/floor-status.js';
import { createWorldRecoveryPanel } from './recovery-panel.js';
import { createWorldEditorPanel } from './editor-panel.js';
import { worldStoryRecords } from './world-story-state.js';

const testSource = { module: 'manual', key: 'stage2', label: 'Stage 2 人工测试' };
const makeCmd = (state, operations, id = `cmd-${state.version}`) => ({
    id,
    worldId: state.worldId,
    branchId: state.branchId,
    expectedVersion: state.version,
    at: `2026-11-16T00:00:${String(state.version).padStart(2, '0')}Z`,
    title: `测试命令 ${state.version}`,
    operations,
});

function createDom(html = '<html><body><div id="root"></div></body></html>') {
    const { document, window } = parseHTML(html);
    const origCreate = document.createElement.bind(document);
    document.createElement = (tag, ...args) => {
        const node = origCreate(tag, ...args);
        if (tag === 'select') {
            let current = '';
            Object.defineProperty(node, 'value', {
                get: () => current,
                set: next => { current = String(next); },
            });
        }
        node.focus ||= () => {};
        return node;
    };
    return { document, window };
}

function setControlValue(control, window, value) {
    if (control.tagName === 'SELECT') {
        for (const option of control.options) {
            if (option.value === value) {
                option.selected = true;
                option.setAttribute('selected', '');
            } else {
                option.removeAttribute('selected');
            }
        }
        const desc = Object.getOwnPropertyDescriptor(control, 'value')
            || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value');
        if (!desc || desc.writable || typeof desc.set === 'function') {
            control.value = value;
        }
    } else {
        control.value = value;
    }
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
    control.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('domain supports clear_field, merge_entities, delete_entity, coins claim validation and Schema 4 forkWorld replay', () => {
    let state = emptyWorld('w1', 'main', '清河');
    state = applyCommand(state, makeCmd(state, [
        { type: 'create', id: 'hero', kind: 'person', name: '主角', source: testSource },
        { type: 'create', id: 'ally1', kind: 'person', name: '沈清', aliases: ['阿清'], source: testSource },
        { type: 'create', id: 'ally2', kind: 'person', name: '沈姑娘', aliases: ['沈清姑娘'], source: testSource },
        { type: 'create', id: 'sword', kind: 'item', name: '青锋剑', source: testSource },
        { type: 'set', entityId: 'hero', field: 'coins', value: 20, source: testSource },
        { type: 'set', entityId: 'ally1', field: '身份', value: '暗卫', source: testSource },
        { type: 'set', entityId: 'ally2', field: '去向', value: '城南', source: testSource },
        { type: 'set', entityId: 'sword', field: 'owner', value: { entityId: 'ally2' }, source: testSource },
        { type: 'bind', entityId: 'ally2', binding: JSON.stringify(['memory', 'person:沈姑娘']), source: testSource },
        { type: 'claim', id: 'cl-1', entityId: 'ally2', field: '秘密', value: '夜探城门', nature: 'rumor', source: testSource },
        { type: 'claim', id: 'cl-loop', entityId: 'ally2', field: '关系:ally1', value: { entityId: 'ally1', role: '同门' }, nature: 'hypothesis', source: testSource },
    ])).state;

    assert.throws(
        () => applyCommand(state, makeCmd(state, [{ type: 'claim', id: 'bad-coin', entityId: 'hero', field: 'coins', value: -5, nature: 'rumor', source: testSource }])),
        /金币/,
    );
    state = applyCommand(state, makeCmd(state, [{ type: 'clear_field', entityId: 'ally1', field: '身份' }])).state;
    assert.equal(state.entities.find(e => e.id === 'ally1').fields['身份'], undefined);

    state = applyCommand(state, makeCmd(state, [{ type: 'merge_entities', sourceId: 'ally2', targetId: 'ally1' }])).state;
    const merged = state.entities.find(e => e.id === 'ally1');
    assert.equal(state.entities.some(e => e.id === 'ally2'), false);
    assert.ok(merged.aliases.includes('沈姑娘'));
    assert.ok(merged.aliases.includes('沈清姑娘'));
    assert.ok(merged.bindings.includes(JSON.stringify(['memory', 'person:沈姑娘'])));
    assert.equal(fieldValue(merged, '去向'), '城南');
    assert.equal(fieldValue(state.entities.find(e => e.id === 'sword'), 'owner').entityId, 'ally1');
    assert.equal(state.claims.find(c => c.id === 'cl-1').entityId, 'ally1');
    assert.equal(state.claims.find(c => c.id === 'cl-loop'), undefined);

    state = applyCommand(state, makeCmd(state, [{ type: 'delete_entity', entityId: 'ally1' }])).state;
    assert.equal(state.entities.some(e => e.id === 'ally1'), false);
    assert.equal(fieldValue(state.entities.find(e => e.id === 'sword'), 'owner'), undefined);
    assert.equal(state.claims.find(c => c.id === 'cl-1'), undefined);

    const forked = forkWorld(state, state.version, 'branch-check', { verifyFullHistory: true });
    assert.equal(canonical(forked.entities), canonical(state.entities));
    assert.equal(canonical(forked.claims), canonical(state.claims));
});

test('historicalWorld skips null-turn events and handles Schema 4 partial deltas and deleted entities', async t => {
    const storage = createWorldStorage({ indexedDB: new IDBFactory() });
    t.after(() => storage.close());
    const chat = [
        { is_user: true, name: '主角', send_date: 'u1', mes: '走到城东。' },
        { is_user: false, name: '旁白', send_date: 'a1', mes: '城东有青竹酒馆和一盏铜灯。' },
        { is_user: true, name: '主角', send_date: 'u2', mes: '次日再去南市。' },
        { is_user: false, name: '旁白', send_date: 'a2', mes: '南市开张了。' },
    ];
    const service = createWorldService({ storage, getIdentity: () => 'hist-s2' });
    let state = await service.syncTurns(chat);
    const [turn1, turn3] = currentTurns(state);

    // v1 (floor 1): create tavern + lantern
    state = (await service.commit(service.effectCommand(state, turn1.id, 'ef-create', [
        { type: 'create', id: 'tavern', kind: 'place', name: '青竹酒馆', source: { module: 'turn-update', key: 'ef-create', label: '第 2 楼' } },
        { type: 'create', id: 'lantern', kind: 'item', name: '旧铜灯', source: { module: 'turn-update', key: 'ef-create', label: '第 2 楼' } },
        { type: 'set', entityId: 'tavern', field: '看板', value: '竹叶青', source: { module: 'turn-update', key: 'ef-create', label: '第 2 楼' } },
    ], '初记青竹酒馆'))).state;
    // v2 (floor 3): future-floor event triggers fork before v2 in historicalWorld(state, 1)
    state = (await service.commit(service.effectCommand(state, turn3.id, 'ef-market', [
        { type: 'create', id: 'market', kind: 'place', name: '南市', source: { module: 'turn-update', key: 'ef-market', label: '第 4 楼' } },
    ], '南市开张'))).state;
    // v3 (manual at === null): manual note after floor 3 — must be skipped without crashing when reconstructing floor 1
    state = (await service.commit(service.command(state, [
        { type: 'set', entityId: 'market', field: '备注', value: '人工补充', source: testSource },
    ], '人工备注'))).state;
    // v4 (floor 1 backfill): partial Schema 4 delta adding a field on tavern + deleting transient lantern (after === null)
    state = (await service.commit(service.effectCommand(state, turn1.id, 'ef-backfill', [
        { type: 'set', entityId: 'tavern', field: '夜灯', value: '长明', source: { module: 'turn-update', key: 'ef-backfill', label: '第 2 楼回补' } },
        { type: 'delete_entity', entityId: 'lantern' },
    ], '回补第2楼'))).state;

    const atFloor1 = historicalWorld(state, 1);
    assert.equal(atFloor1.entities.some(e => e.id === 'tavern'), true);
    assert.equal(atFloor1.entities.some(e => e.id === 'market'), false);
    assert.equal(atFloor1.entities.some(e => e.id === 'lantern'), false);
    assert.equal(fieldValue(atFloor1.entities.find(e => e.id === 'tavern'), '夜灯'), '长明');

    const atFloor3 = historicalWorld(state, 3);
    assert.equal(atFloor3.entities.some(e => e.id === 'market'), true);
});

test('opening projection persists numeric coins and private secret/rumor/condition claims hidden from NPC prompts and clean on re-run', async t => {
    const storage = createWorldStorage({ indexedDB: new IDBFactory() });
    t.after(() => storage.close());
    const service = createWorldService({ storage, getIdentity: () => 'opening-stage2' });
    const inputs = [
        {
            key: 'book',
            label: '设定书',
            text: '旅人自带十二枚银币。店主暗中向官府密报。若鸣钟三次则全城戒严。街角传闻黑市夜间开张。',
        },
        {
            key: 'opening',
            label: '开场',
            text: '旅人走进青竹酒馆，店主柜台后站着。',
        },
    ];
    let omitClaims = false;
    const run = async (extra = {}) => initializeOpening({
        readInput: async () => ({ player: '旅人', inputs: structuredClone(inputs) }),
        service,
        write: async messages => JSON.stringify(JSON.parse(messages[1].content).sources.flatMap(source => {
            if (source.label === '开场') {
                return [
                    { part: source.part, quote: source.text, kind: 'place', name: '青竹酒馆', value: '城东酒馆' },
                    { part: source.part, quote: source.text, kind: 'person', name: '店主', value: '柜台老板' },
                ];
            }
            const baseRows = [
                { part: source.part, quote: source.text, kind: 'person', name: '旅人', field: '金币', value: '12' },
            ];
            return omitClaims ? baseRows : [
                ...baseRows,
                { part: source.part, quote: source.text, kind: 'secret', name: '店主', field: '暗线', value: '暗中向官府密报' },
                { part: source.part, quote: source.text, kind: 'rumor', name: '青竹酒馆', field: '夜市传闻', value: '黑市夜间开张' },
                { part: source.part, quote: source.text, kind: 'condition', name: '旅人', field: '戒严触发', value: '若鸣钟三次则全城戒严' },
            ];
        })),
        guard: () => true,
        project: openingOperations,
        oldChat: false,
        ...extra,
    });

    await run();
    let state = await service.read();
    const hero = state.entities.find(e => e.name === '旅人');
    assert.equal(hero.fields.coins.value, 12);
    assert.equal(hero.fields.description, undefined);
    assert.equal(state.claims.filter(c => c.status === 'pending').length, 3);
    const secretClaim = state.claims.find(c => c.field.startsWith('秘密') || c.field.startsWith('管理员私有/'));
    assert.ok(secretClaim);
    const prompt = buildAuthorityContext(state, '青竹酒馆 店主', 4000, '旅人');
    assert.doesNotMatch(prompt, /暗中向官府密报|黑市夜间开张|若鸣钟三次/);

    // Re-running with oldChat: false and updated inputs without those claims withdraws stale OPENING claims
    omitClaims = true;
    inputs[0].text += '（修订）';
    await run({ oldChat: false });
    state = await service.read();
    assert.equal(state.claims.filter(c => c.status === 'pending' && c.source?.module === 'world-opening').length, 0);
    assert.equal(state.claims.filter(c => c.status === 'withdrawn' && c.source?.module === 'world-opening').length, 3);
});

test('turnOperations filters kinds, emits ambiguity/resolvedRefs, creates claims for non-established creates, honors reviewed bypasses and blocks coins', () => {
    let state = emptyWorld('w-turn', 'main', '清河');
    state = applyCommand(state, makeCmd(state, [
        { type: 'create', id: 'hero', kind: 'person', name: '主角', source: testSource },
        { type: 'set', entityId: 'hero', field: 'coins', value: 30, source: testSource },
        { type: 'create', id: 'lin1', kind: 'person', name: '林氏', source: testSource },
        { type: 'create', id: 'lin2', kind: 'person', name: '林氏', source: testSource },
        { type: 'create', id: 'jade', kind: 'item', name: '玉佩', source: testSource },
        { type: 'set', entityId: 'jade', field: 'owner', value: { entityId: 'lin1' }, source: testSource },
    ])).state;

    const source = {
        module: 'turn',
        key: 'f1',
        label: '第 1 楼',
        messages: [
            { floor: 0, role: 'user', text: '我递出五金币买下玉佩。' },
            { floor: 1, role: 'assistant', text: '林氏收下五金币，把玉佩交给主角，林氏还提到一只锦盒。' },
        ],
    };

    // Ambiguity metadata + disambiguation via resolvedRefs
    assert.throws(
        () => turnOperations(state, [{ task: 'people', type: 'set', target: '林氏', field: '身份', value: '掌柜', quote: '林氏收下五金币', floor: 1 }], { source, playerName: '主角', effectId: 'ef1', commandId: 'c1' }),
        err => {
            assert.equal(err.ambiguity?.ref, '林氏');
            assert.equal(err.ambiguity?.candidates.length, 2);
            return true;
        },
    );
    const resolvedOps = turnOperations(
        state,
        [{ task: 'people', type: 'set', target: '林氏', field: '身份', value: '掌柜', quote: '林氏收下五金币', floor: 1 }],
        { source, playerName: '主角', effectId: 'ef2', commandId: 'c2', resolvedRefs: { 林氏: 'lin1' } },
    );
    assert.ok(resolvedOps.some(op => op.type === 'set' && op.entityId === 'lin1' && op.field === '身份'));

    // __create_new__ for homonym + non-established_fact create emits 存在 + 剧情意义 claims
    const rumoredOps = turnOperations(
        state,
        [{ task: 'people', type: 'create', ref: 'boxRef', kind: 'item', name: '锦盒', importance: '一只锦盒', nature: 'rumor', quote: '林氏还提到一只锦盒', floor: 1 }],
        { source, playerName: '主角', effectId: 'ef3', commandId: 'c3', resolvedRefs: { boxRef: '__create_new__' } },
    );
    assert.ok(rumoredOps.some(op => op.type === 'claim' && op.field === '存在' && op.nature === 'rumor'));
    assert.ok(rumoredOps.some(op => op.type === 'claim' && op.field === '剧情意义' && op.nature === 'rumor'));

    // knownBy enforces person kind (rejects item ref, accepts person id)
    assert.throws(
        () => turnOperations(
            state,
            [{ task: 'peopleEvolution', type: 'set', target: 'lin1', field: '去向', value: '北门', result: '林氏动身', knownBy: ['玉佩'], quote: '林氏收下五金币', floor: 1 }],
            { source, playerName: '主角', effectId: 'ef4a', commandId: 'c4a' },
        ),
        /知情范围/,
    );
    const knownOps = turnOperations(
        state,
        [{ task: 'peopleEvolution', type: 'set', target: 'lin1', field: '去向', value: '北门', result: '林氏动身', knownBy: ['lin2'], quote: '林氏收下五金币', floor: 1 }],
        { source, playerName: '主角', effectId: 'ef4b', commandId: 'c4b' },
    );
    assert.deepEqual(knownOps[0].source.knownBy, ['lin2']);

    // reviewed bypasses allow edited non-verbatim quote, priceEdited+positive int trade, and existing item importance, while keeping coins blocked
    const reviewedOps = turnOperations(
        state,
        [
            { task: 'people', type: 'set', target: 'jade', field: 'description', value: '双鱼纹玉佩', quote: '人工复核补充：确认玉佩纹样', floor: 1 },
            { task: 'overview', type: 'trade', direction: 'buy', counterparty: 'lin1', item: 'jade', price: 6, priceEdited: true, paymentQuote: '人工核对按六金币成交', quote: '人工核对买下玉佩', floor: 1 },
        ],
        { source, playerName: '主角', effectId: 'ef5', commandId: 'c5', reviewed: true },
    );
    assert.ok(reviewedOps.some(op => op.type === 'purchase' && op.price === 6));
    assert.throws(
        () => turnOperations(
            state,
            [{ task: 'people', type: 'set', target: 'hero', field: 'coins', value: 99, quote: '人工核对改金币', floor: 1 }],
            { source, playerName: '主角', effectId: 'ef6', commandId: 'c6', reviewed: true },
        ),
        /钱包变动须通过主角交易核算/,
    );
});

test('turn-processing emits verified_noop on zero-op accepted review and floor-status handles inline edit + disambiguation + retry', async t => {
    const chat = [
        { is_user: true, name: '主角', send_date: 'u1', mes: '我看向林氏。' },
        { is_user: false, name: '旁白', send_date: 'a1', mes: '林氏整理好茶具。' },
    ];
    const storage = createWorldStorage({ indexedDB: new IDBFactory() });
    t.after(() => storage.close());
    const service = createWorldService({ storage, getIdentity: () => 'queue-s2' });
    const state = await service.ensure();
    await service.commit(service.command(state, [
        { type: 'create', id: 'hero', kind: 'person', name: '主角', source: testSource },
        { type: 'create', id: 'lin1', kind: 'person', name: '林氏', source: testSource },
        { type: 'create', id: 'lin2', kind: 'person', name: '林氏', source: testSource },
        { type: 'set', entityId: 'lin1', field: '身份', value: '掌柜', source: testSource },
    ], '初始化'));

    let storeObj = {};
    let retried = false;
    const queue = createFloorProcessing({
        read: () => ({ owner: 'queue-s2', playerName: '主角', chat, end: 1 }),
        store: () => storeObj,
        tasks: () => [{ key: 'people', group: 'update', label: '人物' }],
        getService: () => service,
        requireAgent: async () => {},
        async save(source, check, apply) {
            check();
            const next = structuredClone(storeObj);
            const entry = (next.floorWork ??= {})[source.end] ??= { source, digest: source.digest, done: [] };
            apply(entry, next);
            check();
            storeObj = next;
        },
        generate: async () => ({
            text: JSON.stringify({
                changes: [{ task: 'people', type: 'create', ref: 'linRef', kind: 'person', name: '林氏', floor: 1, quote: '林氏整理好茶具' }],
            }),
        }),
        review: {},
        chapter: {},
        status: () => {},
    });

    await assert.rejects(queue.settle(), /有多个同称对象|对象不唯一/);
    const entry = storeObj.floorWork[1];
    const [effectId] = Object.keys(entry.review);
    assert.equal(entry.review[effectId].ambiguity?.ref, 'linRef');
    assert.ok(entry.review[effectId].ambiguity?.candidates.some(c => c.id === '__create_new__'));
    assert.equal(resolveFailureRoute({ message: '待核 proposals 未处理' }), 'situation');
    assert.equal(resolveFailureRoute({ message: '世界版本冲突' }), 'world');
    assert.equal(resolveFailureRoute({ message: '原文来源不一致' }), 'data');

    const { document, window } = createDom();
    let retryCount = 0;
    const node = renderFloorStatus({
        doc: document,
        info: { floor: 1, message: entry.review[effectId].reason, error: { message: entry.review[effectId].reason } },
        hasChat: true,
        entry,
        readOwner: () => 'queue-s2',
        isCurrentFailure: () => true,
        onRetry: async () => {
            retryCount += 1;
            retried = true;
            await queue.settle();
        },
        onOpenAgent: () => {},
        onOpenRecovery: () => {},
        onSaveFloorWork: async (_source, guard, apply) => {
            guard();
            apply(storeObj.floorWork[1]);
        },
    });
    const refSelect = node.querySelector('select[data-review-ref="linRef"]');
    assert.ok(refSelect);
    setControlValue(refSelect, window, 'lin1');
    const quoteInput = node.querySelector('input[data-review-field="quote"]');
    assert.ok(quoteInput);
    setControlValue(quoteInput, window, '人工核对：确认为已有 lin1');
    const confirmCheck = node.querySelector('input[data-review-confirmed]');
    confirmCheck.checked = true;
    const applyBtn = [...node.querySelectorAll('button')].find(b => b.textContent === '应用修改并重试');
    applyBtn.click();
    for (let i = 0; i < 60; i += 1) {
        if (retried && !storeObj.floorWork[1].review) break;
        await setImmediate();
    }
    assert.equal(retryCount, 1);
    assert.equal(storeObj.floorWork[1].review, undefined);
    assert.equal(storeObj.floorWork[1].editedGroups, undefined);
    assert.equal(storeObj.floorWork[1].resolvedRefs, undefined);
    const updated = await service.read();
    assert.ok(updated.receipts.some(r => r.origin?.effectId === effectId));
    assert.equal(updated.entities.filter(e => e.name === '林氏').length, 2);
});

test('recovery panel previews Schema 4 deletions without crashing and compensates World DB if restoreMemory fails', async t => {
    const { document, window } = createDom('<html><body><section id="history" hidden></section></body></html>');
    const storage = createWorldStorage({ indexedDB: new IDBFactory() });
    t.after(() => storage.close());
    const service = createWorldService({ storage, getIdentity: () => 'rec-s2' });
    let state = await service.ensure();
    state = (await service.commit(service.command(state, [
        { type: 'create', id: 'sword', kind: 'item', name: '残剑', source: testSource },
        { type: 'set', entityId: 'sword', field: 'description', value: '锈迹斑斑', source: testSource },
    ], '铸剑'))).state;
    const keepVersion = state.version;
    state = (await service.commit(service.command(state, [
        { type: 'clear_field', entityId: 'sword', field: 'description' },
        { type: 'delete_entity', entityId: 'sword' },
    ], '毁剑'))).state;

    const root = document.querySelector('#history');
    const panel = createWorldRecoveryPanel({
        service,
        getIdentity: () => 'rec-s2',
        getStamp: () => 'stamp-1',
        previewMemory: () => ({ fromFloor: 0 }),
        restoreMemory: async () => { throw new Error('摘要回退失败'); },
    });
    panel.mount(root);
    await panel.refresh();
    const verSelect = root.querySelector('[aria-label="恢复到的世界版本"]');
    setControlValue(verSelect, window, String(keepVersion));
    [...root.querySelectorAll('button')].find(b => b.textContent === '恢复到此版本').click();
    assert.doesNotThrow(() => root.textContent);
    assert.match(root.textContent, /残剑/);
    [...root.querySelectorAll('button')].find(b => b.textContent === '确认恢复').click();
    for (let i = 0; i < 60; i += 1) {
        if (root.querySelector('[role="alert"]')) break;
        await setImmediate();
    }
    assert.match(root.querySelector('[role="alert"]')?.textContent || '', /摘要回退失败/);
    const afterFailure = await service.read();
    assert.equal(afterFailure.version, state.version);
    assert.equal(afterFailure.entities.length, 0);
});

test('editor panel closes manual CRUD: clear_field, merge_entities, delete_entity, resolve claim, coins ledger and story record CRUD', async t => {
    const storage = createWorldStorage({ indexedDB: new IDBFactory() });
    t.after(() => storage.close());
    let owner = 'ed-s2';
    const service = createWorldService({ storage, getIdentity: () => owner });
    await service.ensure('手工维护');
    let base = await service.read();
    base = (await service.commit(service.command(base, [
        { type: 'create', id: 'hero', kind: 'person', name: '林晚', source: testSource },
        { type: 'create', id: 'dup', kind: 'person', name: '晚姑娘', source: testSource },
        { type: 'set', entityId: 'hero', field: 'coins', value: 15, source: testSource },
        { type: 'set', entityId: 'hero', field: '身份', value: '学徒', source: testSource },
        { type: 'set', entityId: 'dup', field: '旧籍', value: '江南', source: testSource },
        { type: 'claim', id: 'claim-1', entityId: 'hero', field: '称号', value: '司夜使', nature: 'hypothesis', source: testSource },
    ], '初始化'))).state;

    const { document, window } = createDom('<!doctype html><html><body><section id="world-editor"></section></body></html>');
    const root = document.getElementById('world-editor');
    const memorySnapshot = { enabled: true, store: { json: { storyRecords: [] } } };
    const panel = createWorldEditorPanel({
        service,
        getIdentity: () => owner,
        section: 'situation',
        getPlayerName: () => '林晚',
        getMemorySnapshot: () => memorySnapshot,
    });
    panel.mount(root);
    panel.show(base);

    const waitIdle = async () => {
        for (let i = 0; i < 60; i += 1) {
            await setImmediate();
            const alert = root.querySelector('[role="alert"]')?.textContent;
            if (alert) return { ok: false, message: alert };
            if (!panel.isEditing()) return { ok: true };
        }
        return { ok: false, message: 'timeout' };
    };
    const click = text => {
        const btn = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
        assert.ok(btn, `Missing button: ${text}`);
        btn.click();
    };
    const setField = (labelText, value) => {
        const fields = [...root.querySelectorAll('label.tk-world-editor-field')];
        const field = fields.find(n => (n.querySelector('span')?.textContent.trim() || '') === labelText)
            || fields.find(n => n.querySelector('span')?.textContent.includes(labelText));
        assert.ok(field, `Missing field: ${labelText}`);
        const ctrl = [...field.querySelectorAll('input, select, textarea')].find(n => !n.hidden) || field.querySelector('input, select, textarea');
        setControlValue(ctrl, window, value);
    };
    const checkBox = text => {
        const field = [...root.querySelectorAll('label.tk-world-editor-field')].find(n => n.textContent.includes(text));
        assert.ok(field, `Missing checkbox: ${text}`);
        const box = field.querySelector('input[type="checkbox"]');
        box.checked = true;
        box.dispatchEvent(new window.Event('change', { bubbles: true }));
    };
    const submit = () => root.querySelector('form.tk-world-editor-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // 1. Generic 设置属性 rejects coins
    click('设置属性');
    setField('目标对象', 'hero');
    setField('属性名（如 身份、owner、location）', '金币');
    setField('值', '999');
    submit();
    assert.equal((await waitIdle()).ok, false);
    click('取消');

    // 2. 调整余额 ledger updates protagonist coins safely
    click('调整余额');
    setField('账户人物', 'hero');
    setField('调整方式', 'add');
    setField('金额 / 目标余额（金币）', '5');
    setField('调整原因（必填）', '清点钱袋');
    checkBox('确认写入本次金币余额变动');
    submit();
    assert.deepEqual(await waitIdle(), { ok: true });
    assert.equal((await service.read()).entities.find(e => e.id === 'hero').fields.coins.value, 20);

    // 3. 裁决候选 resolves pending claim
    click('裁决候选（1）');
    setField('裁决结果', 'accepted');
    submit();
    assert.deepEqual(await waitIdle(), { ok: true });
    assert.equal((await service.read()).entities.find(e => e.id === 'hero').fields['称号'].value, '司夜使');

    // 4. 清空属性 clears non-coins field
    click('清空属性');
    setField('目标对象', 'hero');
    setField('要清空的属性', '身份');
    submit();
    assert.deepEqual(await waitIdle(), { ok: true });
    assert.equal((await service.read()).entities.find(e => e.id === 'hero').fields['身份'], undefined);

    // 5. 合并对象 merges dup -> hero
    click('合并对象');
    setField('被合并（将删除）的对象', 'dup');
    setField('保留并合入的目标对象', 'hero');
    checkBox('确认不可逆合并并移除被合并对象');
    submit();
    assert.deepEqual(await waitIdle(), { ok: true });
    const afterMerge = await service.read();
    assert.equal(afterMerge.entities.some(e => e.id === 'dup'), false);
    assert.equal(afterMerge.entities.find(e => e.id === 'hero').fields['旧籍'].value, '江南');

    // 6. 维护剧情记录 add -> edit -> delete + 删除对象
    click('维护剧情记录');
    setField('记录类型', 'situation');
    setField('标题', '夜间宵禁');
    setField('具体描述', '城门酉时关闭');
    setField('影响范围', '清河');
    submit();
    assert.deepEqual(await waitIdle(), { ok: true });
    let records = worldStoryRecords(await service.read(), []);
    assert.equal(records.length, 1);
    const createdId = records[0].id;

    click('维护剧情记录');
    setField('操作类型', 'edit');
    setField('选择现有记录', createdId);
    setField('具体描述', '城门改为戌时关闭');
    submit();
    assert.deepEqual(await waitIdle(), { ok: true });
    records = worldStoryRecords(await service.read(), []);
    assert.equal(records[0].description, '城门改为戌时关闭');

    click('维护剧情记录');
    setField('操作类型', 'delete');
    setField('选择现有记录', createdId);
    checkBox('确认删除该条剧情记录');
    submit();
    assert.deepEqual(await waitIdle(), { ok: true });
    assert.equal(worldStoryRecords(await service.read(), []).length, 0);

    click('删除对象');
    setField('要删除的对象', 'hero');
    checkBox('确认永久删除该对象及指向它的引用和候选');
    submit();
    assert.deepEqual(await waitIdle(), { ok: true });
    assert.equal((await service.read()).entities.length, 0);
});
