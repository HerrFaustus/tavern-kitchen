import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { createWorldOverview } from './overview.js';

const entity = { id: 'ferryman', name: '老渡工', kind: 'person', aliases: [], bindings: [], source: { label: '剧情记忆' }, fields: { description: { value: '在渡口撑船三十年。', version: 1, source: { label: '玩家确认' } } } };
const state = {
    title: '白桦镇', version: 3, entities: [entity],
    claims: [
        { id: 'c1', entityId: 'ferryman', field: 'description', status: 'pending' },
        { id: 'c2', entityId: 'ferryman', field: 'location', status: 'pending' },
    ],
    events: [{ version: 3, at: '2026-10-30 14:20', title: '登记渡工', effects: [{ type: 'entity', id: 'ferryman', before: null, after: entity }] }],
};

test('world overview keeps one management action and does not repeat category jumps', t => {
    const { document } = parseHTML('<html><body><main></main></body></html>');
    const original = globalThis.document; globalThis.document = document; t.after(() => { globalThis.document = original; });
    const routes = [], view = createWorldOverview({ navigate: route => routes.push(route) });
    view.mount(document.querySelector('main')); view.show(state);
    const buttons = [...document.querySelectorAll('button')];
    assert.equal(buttons.filter(button => /^查看(人物|地图|局势|设定)$/u.test(button.textContent)).length, 0);
    assert.doesNotMatch(document.body.textContent, /处理来源记录/u);
    const manage = buttons.find(button => button.textContent.includes('管理世界'));
    assert.ok(manage);
    assert.match(manage.textContent, /2 条待确认/u);
    manage.click();
    assert.deepEqual(routes, ['world-management']);
});
