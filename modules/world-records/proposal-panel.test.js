import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createWorldPanel } from './panel.js';
import { buildUpdateContext, worldUpdates } from './update-context.js';
import { prepareWorldUpdate } from './update-result.js';
import { isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { buildAuthorityContext } from './authority.js';

async function setup(t, extra = [], transform = value => value) {
    const { document, window } = parseHTML('<html><body><main></main></body></html>');
    const previous = globalThis.document; globalThis.document = document; t.after(() => { globalThis.document = previous; });
    const createElement = document.createElement.bind(document);
    document.createElement = (tag, ...args) => {
        const element = createElement(tag, ...args);
        if (tag === 'select') { let value = ''; Object.defineProperty(element, 'value', { get: () => value, set: next => { value = next; } }); }
        element.focus ||= () => {}; return element;
    };
    const storage = createWorldStorage({ indexedDB: new IDBFactory() }); t.after(() => storage.close());
    const chat = [{ mes: '买剑', is_user: true, send_date: 'u' }, { mes: '主角支付五金币，获得铁剑，听到信使自称忠诚。', send_date: 'a' }];
    const history = []; let sequence = 0;
    const service = createWorldService({ storage, getIdentity: () => 'panel', id: () => `panel-${++sequence}`,
        isUpdateSourceCurrent: update => !!update && isRangeSourceCurrent(update.source, chat),
        isSourceCurrent: turn => !!turn && isRangeSourceCurrent(turn.source, chat), getReviewContext: () => ({ available: true, history, storyRecords: [] }) });
    let state = await service.syncTurns(chat);
    const source = { module: 'manual', key: 'seed', label: '开局' };
    state = (await service.commit(service.command(state, [{ type: 'create', id: 'hero', name: '主角', kind: 'person', source },
        { type: 'set', entityId: 'hero', field: 'coins', value: 10, source }], '开局'))).state;
    const receipt = service.memorySourceReceipt(state, chat, 0, 1), context = buildUpdateContext(state, { json: {}, summaryHistory: [] }, chat, receipt);
    const update = prepareWorldUpdate({ basis: { worldId: state.worldId, branchId: state.branchId, version: state.version },
        proposals: transform([{ type: 'field', entityId: 'hero', field: 'coins', before: { present: true, value: 10 }, value: 5, nature: 'established_fact', evidence: { floor: 1, quote: '支付五金币' } }, ...extra]),
        acknowledgedReceipts: context.executionReceipts.map(item => item.commandId), conflicts: [] }, context);
    history.push({ worldUpdate: update, sourceReceipt: receipt, summary: '买下铁剑', endMesId: 1 });
    state = await service.syncTurns(chat, { history });
    const panel = createWorldPanel({ service, sync: () => service.read(), getIdentity: () => 'panel' }); panel.mount(document.querySelector('main')); panel.show(state);
    const click = (text, root = document) => { const button = [...root.querySelectorAll('button')].find(item => item.textContent === text); assert.ok(button, text); button.click(); return button; };
    const submit = () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const input = (name, value) => { const control = document.querySelector(`[aria-label="${name}"]`); assert.ok(control, name); control.value = value; control.dispatchEvent(new window.Event('input', { bubbles: true })); };
    const ready = async predicate => { for (let i = 0; i < 60; i++) { if (predicate()) return; await setImmediate(); } assert.fail(document.querySelector('.tk-record-status')?.textContent); };
    return { document, panel, service, source, state, chat, history, click, submit, input, ready, requestId: receipt.id };
}

test('actual panel confirmation writes once, disables duplicate clicks and displays the durable result', async t => {
    const f = await setup(t); let calls = 0; const commit = f.service.commit;
    f.service.commit = command => { calls++; return commit(command); };
    const button = f.click('确认写入'); assert.equal(button.disabled, true); button.click();
    await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    const state = await f.service.read(); assert.equal(state.entities[0].fields.coins.value, 5); assert.equal(calls, 1);
    assert.match(f.document.querySelector('.tk-record-proposals').textContent, /已写入/);
    assert.equal([...f.document.querySelectorAll('button')].some(item => item.textContent === '确认写入'), false);
});

test('actual panel edits and confirms the new value while keeping the original proposal readable', async t => {
    const f = await setup(t); f.click('修改'); f.input('新值', '4'); f.input('处理说明（可选）', '修正成交价'); f.submit();
    await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    const state = await f.service.read(), record = worldUpdates(state)[0];
    assert.equal(state.entities[0].fields.coins.value, 4); assert.equal(record.update.proposals[0].value, 5); assert.equal(record.reviews[0].proposal.value, 4);
    assert.match(f.document.querySelector('.tk-record-proposals').textContent, /已修改/);
    assert.match(f.document.querySelector('.tk-record-proposals').textContent, /修正成交价/);
});

test('actual panel rejection records its reason without applying a world effect', async t => {
    const f = await setup(t); f.click('拒绝'); f.input('处理说明（可选）', '没有成交'); f.submit();
    await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    const state = await f.service.read(); assert.equal(state.entities[0].fields.coins.value, 10); assert.equal(worldUpdates(state)[0].reviews[0].action, 'rejected');
    assert.match(f.document.querySelector('.tk-record-proposals').textContent, /已拒绝/);
});

test('a concurrent write preserves the edit form; rechecking shows the new before value', async t => {
    const f = await setup(t); f.click('修改'); f.input('新值', '7');
    await f.service.commit(f.service.command(f.state, [{ type: 'set', entityId: 'hero', field: 'coins', value: 12, source: f.source }], '人工改动'));
    f.submit(); await f.ready(() => f.document.querySelector('.tk-record-status').getAttribute('role') === 'alert');
    assert.equal(f.document.querySelector('[aria-label="新值"]').value, '7'); assert.equal((await f.service.read()).entities[0].fields.coins.value, 12);
    f.panel.show(await f.service.read()); f.click('核对并确认');
    assert.match(f.document.querySelector('form').textContent, /当前值：12/);
    f.input('新值', '7'); f.submit(); await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    assert.equal((await f.service.read()).entities[0].fields.coins.value, 7);
});

for (const afterWrite of [false, true]) test(`panel retry reuses its command when failure occurs ${afterWrite ? 'after' : 'before'} a successful commit`, async t => {
    const f = await setup(t), commit = f.service.commit, ids = []; let fail = true;
    f.service.commit = async command => {
        ids.push(command.id);
        if (!afterWrite && fail) { fail = false; throw Error('保存暂时不可用，请重试'); }
        const result = await commit(command);
        if (afterWrite && fail) { fail = false; throw Error('保存结果未显示，请重试'); }
        return result;
    };
    f.click('确认写入'); await f.ready(() => f.document.querySelector('.tk-record-status').getAttribute('role') === 'alert');
    f.click('确认写入'); await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    const state = await f.service.read(); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
    assert.equal(state.version, f.state.version + 1); assert.equal(worldUpdates(state)[0].reviews.length, 1);
});

test('a delayed source notification cannot let the visible confirmation button apply stale prose', async t => {
    const f = await setup(t); f.chat[1].mes = '没有买剑。'; f.click('确认写入');
    await f.ready(() => f.document.querySelector('.tk-record-status').getAttribute('role') === 'alert');
    assert.match(f.document.querySelector('.tk-record-status').textContent, /来源已变化/);
    assert.equal((await f.service.read()).entities[0].fields.coins.value, 10);
});

test('structured knowledge editing feeds the current world context without promoting belief to a world fact', async t => {
    const f = await setup(t, [{ type: 'story', record: { id: 'belief', kind: 'knowledge', person: '主角', content: '信使忠诚', certainty: 'believed', evidence: '信使自称', learnedAt: '' }, before: { present: false }, nature: 'belief', evidence: { floor: 1, quote: '自称忠诚' } }]);
    const row = [...f.document.querySelectorAll('details[data-proposal-key]')].find(item => item.dataset.proposalKey === `${f.requestId}/1`);
    f.click('修改', row); f.input('认知内容', '信使可能撒谎'); f.submit();
    await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    const state = await f.service.read(), prompt = buildAuthorityContext(state, '主角');
    assert.match(prompt, /信使可能撒谎/); assert.match(prompt, /不是世界真相/);
    assert.equal(state.modules.story.records[0].nature, 'belief'); assert.equal(state.entities[0].fields['认知'], undefined);
});

test('an emptied number is a validation error and never becomes an unintended zero balance', async t => {
    const f = await setup(t); f.click('修改'); f.input('新值', ''); f.submit();
    await f.ready(() => f.document.querySelector('.tk-record-status').getAttribute('role') === 'alert');
    assert.match(f.document.querySelector('.tk-record-status').textContent, /数值不能留空/);
    assert.equal((await f.service.read()).entities[0].fields.coins.value, 10);
});

const groupedExtra = { type: 'field', entityId: 'hero', field: 'description', before: { present: false }, value: '铁剑的新主人', nature: 'established_fact', evidence: { floor: 1, quote: '获得铁剑' } };
const groupAll = proposals => proposals.map(proposal => ({ ...proposal, groupId: 'trade', certainty: 'explicit' }));

test('actual grouped editor modifies every sibling in one transaction and retains its source and original values', async t => {
    const f = await setup(t, [groupedExtra], groupAll); f.click('修改');
    const groups = [...f.document.querySelectorAll('form fieldset')]; assert.equal(groups.length, 2);
    const coins = groups[0].querySelector('[aria-label="新值"]'); coins.value = '4';
    const description = groups[1].querySelector('[aria-label="新值"]'); description.value = '铁剑主人（核对后）';
    f.input('处理说明（可选）', '一起核对'); f.submit();
    await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    const state = await f.service.read(), record = worldUpdates(state)[0];
    assert.equal(state.version, f.state.version + 1); assert.equal(state.entities[0].fields.coins.value, 4);
    assert.equal(state.entities[0].fields.description.value, '铁剑主人（核对后）');
    assert.equal(new Set(record.reviews.map(review => review.commandId)).size, 1); assert.equal(record.update.proposals[0].value, 5);
});

test('rejecting from a grouped item rejects the full dependency group without applying any effects', async t => {
    const f = await setup(t, [groupedExtra], groupAll); f.click('拒绝');
    assert.match(f.document.querySelector('form').textContent, /2 条关联变化将一起拒绝/);
    f.input('处理说明（可选）', '交易未完成'); f.submit();
    await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    const state = await f.service.read(); assert.equal(state.entities[0].fields.coins.value, 10);
    assert.equal(state.entities[0].fields.description, undefined);
    assert.deepEqual(worldUpdates(state)[0].reviews.map(review => review.action), ['rejected', 'rejected']);
});

test('manual same-turn toolbar combines independent legacy proposals and keeps the full form on a stale submission', async t => {
    const f = await setup(t, [groupedExtra]); f.click('核对本轮全部变化（2 条）');
    f.input('新值', '3');
    await f.service.commit(f.service.command(f.state, [{ type: 'set', entityId: 'hero', field: 'coins', value: 12, source: f.source }], '并发人工变化'));
    f.submit(); await f.ready(() => f.document.querySelector('.tk-record-status').getAttribute('role') === 'alert');
    assert.equal(f.document.querySelectorAll('form fieldset').length, 2); assert.equal(f.document.querySelector('[aria-label="新值"]').value, '3');
    assert.equal(worldUpdates(await f.service.read())[0].reviews, undefined);
});

test('automatic results display their mode while uncertain items keep modification and rejection controls', async t => {
    const f = await setup(t, [groupedExtra], proposals => proposals.map((proposal, index) => ({ ...proposal, groupId: `g${index}`, certainty: index ? 'uncertain' : 'explicit' })));
    f.panel.show(await f.service.autoConfirm());
    assert.match(f.document.querySelector('.tk-record-proposals').textContent, /已自动写入/);
    const row = [...f.document.querySelectorAll('details[data-proposal-key]')].find(item => item.dataset.proposalKey === `${f.requestId}/1`);
    assert.ok([...row.querySelectorAll('button')].some(button => button.textContent === '修改'));
    assert.ok([...row.querySelectorAll('button')].some(button => button.textContent === '拒绝'));
    f.click('拒绝', row); f.submit(); await f.ready(() => f.document.querySelector('.tk-record-status').textContent === '已保存');
    assert.equal(worldUpdates(await f.service.read())[0].reviews[1].action, 'rejected');
});
