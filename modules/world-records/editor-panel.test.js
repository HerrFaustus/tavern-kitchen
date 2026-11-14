import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { parseHTML } from 'linkedom';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createWorldEditorPanel } from './editor-panel.js';
import { RELATION_PREFIX } from './person-fields.js';

async function setupFixture(section = 'people', initialOps = []) {
    const storage = createWorldStorage({ dbName: `tk-editor-test-${section}-${Date.now()}-${Math.random()}` });
    let owner = JSON.stringify(['default-user', 'story-1']);
    const service = createWorldService({ storage, getIdentity: () => owner });
    await service.ensure('故事一');
    const base = await service.read();
    if (initialOps.length) {
        await service.commit(service.command(base, initialOps, '初始化'));
    }
    const { document, window } = parseHTML('<!doctype html><html><body><div id="profile-content"><div class="prof-name">林晚</div></div><section id="world-editor"></section></body></html>');
    const root = document.getElementById('world-editor');
    const panel = createWorldEditorPanel({ service, getIdentity: () => owner, section });
    panel.mount(root);
    panel.show(await service.read());
    return {
        document,
        window,
        root,
        panel,
        service,
        storage,
        setOwner(next) { owner = next; },
        async waitIdle() {
            for (let i = 0; i < 40; i++) {
                await new Promise(resolve => setTimeout(resolve, 5));
                const alert = root.querySelector('[role="alert"]')?.textContent;
                if (alert) return { ok: false, message: alert };
                if (!panel.isEditing()) return { ok: true };
            }
            return { ok: false, message: root.querySelector('[role="status"], [role="alert"]')?.textContent || 'timed out' };
        },
        clickButton(label) {
            const btn = [...root.querySelectorAll('button')].find(item => item.textContent.trim() === label);
            assert.ok(btn, `Missing button: ${label}`);
            btn.click();
        },
        setField(labelText, value) {
            const fields = [...root.querySelectorAll('label.tk-world-editor-field')];
            const field = fields.find(node => {
                const text = node.querySelector('span')?.textContent.trim() || '';
                return text === labelText || text.startsWith(`${labelText}（`);
            }) || fields.find(node => node.querySelector('span')?.textContent.includes(labelText));
            assert.ok(field, `Missing field: ${labelText}`);
            const controls = [...field.querySelectorAll('input, select, textarea')];
            const control = controls.find(node => !node.hidden) || controls[0];
            if (control.tagName === 'SELECT') {
                for (const option of control.options) {
                    if (option.value === value) {
                        option.selected = true;
                        option.setAttribute('selected', '');
                    } else {
                        option.removeAttribute('selected');
                    }
                }
                const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')
                    || Object.getOwnPropertyDescriptor(control, 'value');
                if (!descriptor || descriptor.writable || typeof descriptor.set === 'function') {
                    control.value = value;
                }
            } else {
                control.value = value;
            }
            control.dispatchEvent(new window.Event('input', { bubbles: true }));
            control.dispatchEvent(new window.Event('change', { bubbles: true }));
        },
        submit() {
            const form = root.querySelector('form.tk-world-editor-form');
            assert.ok(form, 'Missing active editor form');
            form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        },
    };
}

test('people editor creates person, updates field and binds directed relationship via world service', async t => {
    const f = await setupFixture('people');
    t.after(() => f.storage.close());

    f.clickButton('+ 新增人物');
    f.setField('名称', '林晚');
    f.setField('别名', '小晚，晚姑娘');
    f.submit();
    assert.deepEqual(await f.waitIdle(), { ok: true });

    let state = await f.service.read();
    const hero = state.entities.find(item => item.name === '林晚');
    assert.ok(hero);
    assert.deepEqual(hero.aliases, ['小晚', '晚姑娘']);

    f.clickButton('+ 新增人物');
    f.setField('名称', '沈砚');
    f.submit();
    assert.deepEqual(await f.waitIdle(), { ok: true });

    f.clickButton('设置属性');
    f.setField('属性名', '身份');
    f.setField('值', '巡夜司司丞');
    f.submit();
    assert.deepEqual(await f.waitIdle(), { ok: true });

    state = await f.service.read();
    assert.equal(state.entities.find(item => item.id === hero.id)?.fields['身份'].value, '巡夜司司丞');

    f.clickButton('绑定关系');
    const mentor = state.entities.find(item => item.name === '沈砚');
    f.setField('甲方人物', hero.id);
    f.setField('乙方人物', mentor.id);
    f.setField('关系身份', '师父');
    f.submit();
    assert.deepEqual(await f.waitIdle(), { ok: true });

    state = await f.service.read();
    const rel = state.entities.find(item => item.id === hero.id)?.fields[`${RELATION_PREFIX}${mentor.id}`];
    assert.deepEqual(rel.value, { entityId: mentor.id, role: '师父' });
});

test('situation editor commits atomic purchase transactions and preserves form state on errors', async t => {
    const f = await setupFixture('situation', [
        { type: 'create', id: 'hero', name: '林晚', kind: 'person', aliases: [], source: { module: 'manual', key: 'k1', label: 'setup' } },
        { type: 'create', id: 'smith', name: '铁匠', kind: 'person', aliases: [], source: { module: 'manual', key: 'k2', label: 'setup' } },
        { type: 'create', id: 'sword', name: '玄铁剑', kind: 'item', aliases: [], source: { module: 'manual', key: 'k3', label: 'setup' } },
        { type: 'set', id: 'f1', entityId: 'hero', field: 'coins', value: 12, nature: 'established_fact', source: { module: 'manual', key: 'k4', label: 'setup' } },
        { type: 'set', id: 'f2', entityId: 'smith', field: 'coins', value: 3, nature: 'established_fact', source: { module: 'manual', key: 'k5', label: 'setup' } },
        { type: 'set', id: 'f3', entityId: 'sword', field: 'owner', value: { entityId: 'smith' }, nature: 'established_fact', source: { module: 'manual', key: 'k6', label: 'setup' } },
    ]);
    t.after(() => f.storage.close());

    f.clickButton('登记交易');
    f.setField('买方', 'hero');
    f.setField('卖方', 'smith');
    f.setField('物品', 'sword');
    f.setField('价格（金币）', '999');
    f.submit();
    const failResult = await f.waitIdle();
    assert.equal(failResult.ok, false);
    assert.equal(f.panel.isEditing(), true);

    f.setField('价格（金币）', '5');
    f.submit();
    assert.deepEqual(await f.waitIdle(), { ok: true });

    assert.equal(f.panel.isEditing(), false);
    const state = await f.service.read();
    assert.equal(state.entities.find(item => item.id === 'hero').fields.coins.value, 7);
    assert.equal(state.entities.find(item => item.id === 'smith').fields.coins.value, 8);
    assert.equal(state.entities.find(item => item.id === 'sword').fields.owner.value.entityId, 'hero');

    f.panel.reset();
    assert.equal(f.root.hidden, true);
});
