import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { createWorldPanel } from './panel.js';

const entity = { id: 'ferryman', name: '老渡工', kind: 'person', aliases: ['渡工'], bindings: [], source: { label: '剧情记忆' }, fields: { description: { value: '在渡口撑船三十年。', version: 1, source: { label: '玩家确认' } } } };
const state = {
    title: '白桦镇', version: 3, branchId: 'branch-fixture', entities: [entity],
    claims: [
        { id: 'c1', entityId: 'ferryman', field: 'description', status: 'pending', nature: 'rumor', value: '似乎认识守卫', source: { label: '剧情记忆' } },
        { id: 'c2', entityId: 'ferryman', field: 'location', status: 'pending', nature: 'belief', value: '渡口', source: { label: '剧情记忆' } },
        { id: 'c3', entityId: 'ferryman', field: 'owner', status: 'pending', nature: 'rumor', value: '渡船', source: { label: '剧情记忆' } },
    ],
    events: [{ version: 3, at: '2026-10-30 14:20', title: '登记渡工', effects: [{ type: 'entity', id: 'ferryman', before: null, after: entity }] }],
};
const service = { command: () => ({}), commit: async () => state, read: async () => state, fork: async () => state, branches: async () => [], restore: async () => state, selectBranch: async () => state };

test('world management keeps creation and search primary while rare actions stay in more', t => {
    const { document } = parseHTML('<html><body><main></main></body></html>');
    const original = globalThis.document; globalThis.document = document; t.after(() => { globalThis.document = original; });
    // linkedom exposes select.value as a getter; the panel writes it like a browser select.
    const createElement = document.createElement.bind(document);
    document.createElement = (tag, ...args) => {
        const element = createElement(tag, ...args);
        if (String(tag).toLowerCase() === 'select') {
            let value = '';
            Object.defineProperty(element, 'value', { configurable: true, get: () => value, set: next => { value = String(next); } });
        }
        return element;
    };
    const panel = createWorldPanel({ service, sync: async () => state, getIdentity: () => 'fixture' });
    panel.mount(document.querySelector('main')); panel.show(state);
    assert.match(document.querySelector('.tk-record-status').textContent, /3 条待确认/u);
    assert.equal([...document.querySelectorAll('.tk-record-primary-actions > .menu_button')].map(button => button.textContent).join(','), '新增对象');
    const more = document.querySelector('.tk-record-more');
    assert.ok(more);
    assert.equal(more.querySelector('summary').textContent, '更多操作');
    assert.deepEqual([...more.querySelectorAll('button')].map(button => button.textContent), ['同步来源', '登记交易', '重新加载']);
    assert.ok(document.querySelector('.tk-record-filters input[type="search"]'));
    assert.equal([...document.querySelectorAll('.tk-record-results button')].map(button => button.textContent).join(','), '老渡工 · 人物');
});

test('world proposals expose values, natures and evidence as text, distinguish stale records and never apply on view', t => {
    const { document } = parseHTML('<html><body><main></main></body></html>');
    const original = globalThis.document; globalThis.document = document; t.after(() => { globalThis.document = original; });
    const createElement = document.createElement.bind(document);
    document.createElement = (tag, ...args) => {
        const element = createElement(tag, ...args);
        if (tag === 'select') { let value = ''; Object.defineProperty(element, 'value', { get: () => value, set: next => { value = next; } }); }
        return element;
    };
    let writes = 0;
    const panel = createWorldPanel({ service: { ...service, commit: async () => { writes++; return state; } }, sync: async () => state, getIdentity: () => 'fixture' });
    const update = { source: { start: 2, end: 3 }, proposals: [
        { type: 'field', entityId: entity.id, field: 'description', before: { present: true, value: '旧描述' }, value: '<img src=x onerror=alert(1)>', nature: 'rumor', evidence: { floor: 3, quote: '渡工听到了传闻' } },
        { type: 'entity', kind: 'person', name: '信使', aliases: [], nature: 'creative_proposal', evidence: { floor: 3, quote: '有人自称信使' } },
        { type: 'story', record: { id: 'knowledge', kind: 'knowledge', person: '老渡工', certainty: 'believed', content: '信使说的是真的', evidence: '听说', learnedAt: '' }, nature: 'belief', evidence: { floor: 3, quote: '渡工相信了' } },
    ], conflicts: [], acknowledgedReceipts: ['already-paid'] };
    const snapshot = { ...state, sources: { 'update:fixture': { kind: 'independent_world_update', status: 'ready', update } } };
    panel.mount(document.querySelector('main')); panel.show(snapshot);
    const box = document.querySelector('.tk-record-proposals');
    assert.match(box.textContent, /世界变化提案（3 条）/); assert.match(box.textContent, /旧描述 → <img/);
    assert.match(box.textContent, /传闻/); assert.match(box.textContent, /角色认知/); assert.match(box.textContent, /第 4 楼「渡工听到了传闻」/);
    assert.equal(box.querySelector('img'), null); assert.match(box.textContent, /未重复执行/); assert.equal(writes, 0);
    box.querySelector('button').click(); assert.equal(document.querySelector('[aria-label="档案详情"] h3').textContent, '老渡工'); assert.equal(writes, 0);
    snapshot.sources['update:fixture'].status = 'stale'; panel.show(snapshot); assert.match(document.querySelector('.tk-record-proposals').textContent, /世界已变化，需重新核对/);
    snapshot.sources['update:fixture'].status = 'retracted'; panel.show(snapshot); assert.equal(document.querySelector('.tk-record-proposals'), null);
});
