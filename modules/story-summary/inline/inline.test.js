import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { parseHTML } from 'linkedom';
import { extractFloorPayload, floorSource, prepareFloorPayload, stripFloorProtocol, isNarrativeReply } from './protocol.js';
import { createFloorSummaryController } from './controller.js';
import { createFloorPanel } from './panel.js';
import { installFloorDisplayFilter } from './host-regex.js';
import { applyTextFilterRules } from '../data/text-filter-rules.js';
import { floorCoverageEnd } from './ledger.js';
import { entry } from '../tests/helpers/story-summary-entry.js';
import { buildFloorProtocol } from './protocol.js';

const payload = { summary: '贝拉抵达渡口。', timeStart: '午后', timeEnd: '黄昏', date: '2026-10-30', location: '渡口',
    updates: { storyUpdates: [{ id: 'p1', kind: 'person', name: '贝拉', presence: 'present' }] } };
const raw = value => `正文<kitchen_summary>${JSON.stringify(value)}</kitchen_summary>`;
test('main reply payload is bounded and incomplete/duplicate/invalid blocks never become a summary', () => {
    assert.equal(extractFloorPayload('正文').status, 'missing');
    assert.equal(extractFloorPayload('<kitchen_summary>{"summary":"正在输出').status, 'incomplete');
    assert.equal(extractFloorPayload(raw(payload) + raw(payload)).status, 'invalid');
    assert.equal(extractFloorPayload(raw({ ...payload, updates: { unexpected: [] } })).status, 'invalid');
    assert.equal(extractFloorPayload(raw({ summary: 'x'.repeat(120001) })).status, 'invalid');
    assert.equal(extractFloorPayload(raw(payload)).payload.summary, payload.summary);
    assert.equal(stripFloorProtocol(raw(payload)), '正文');
    assert.equal(applyTextFilterRules(raw(payload), []), '正文');
});
test('source and event provenance are bound to the actual reply and preceding user, with stable event IDs', () => {
    const chat = [{ mes: '旧故事' }, { mes: '过去看看', is_user: true }, { mes: raw(payload), swipe_id: 0 }];
    const source = floorSource(chat, 2);
    assert.equal(source.start, 1);
    const result = prepareFloorPayload(payload, {}, source);
    assert.match(result.events[0].summary, /\(#2-3\)$/);
    assert.equal(result.storyUpdates.find(record => record.kind === 'clock').label, '黄昏');
    assert.equal(result.storyUpdates.find(record => record.kind === 'scene').location, '渡口');
    assert.equal(prepareFloorPayload(payload, {}, source, ['evt-6']).events[0].id, 'evt-6');
    chat[2].swipe_id = 1;
    assert.notEqual(floorSource(chat, 2).digest, source.digest);
    chat[2].swipe_id = 0; chat[1].mes = '不要过去';
    assert.notEqual(floorSource(chat, 2).digest, source.digest);
});
test('review mode and malformed replies perform no model calls or metadata writes; chat changes cancel a queued edit', async () => {
    let context = { chatId: 'a', characterId: 1, chat: [{ is_user: true, mes: '走吧' }, { mes: raw(payload) }] };
    let writes = 0, release;
    const pending = new Promise(resolve => { release = resolve; });
    const controller = createFloorSummaryController({ getContext: () => context, enabled: () => true,
        getConfig: () => ({ enabled: true, review: true }), ensureSources: () => pending,
        read: () => ({ storySummary: {} }), merge: () => assert.fail('unexpected merge'), commit: () => { writes++; } });
    assert.equal((await controller.ingest(1)).pending, true); assert.equal(writes, 0);
    const writing = controller.update(1, { payload, stage: true });
    await Promise.resolve(); context = { ...context, chatId: 'b' }; release();
    await assert.rejects(writing, /变化|切换/); assert.equal(writes, 0);
});
test('native regex hides only the protocol in display and outgoing prompts while keeping raw chat editable', () => {
    const settings = { regex: [{ id: 'user-rule' }] }, remove = installFloorDisplayFilter(settings);
    const rule = settings.regex.at(-1);
    assert.equal(rule.markdownOnly, true); assert.equal(rule.promptOnly, true); assert.equal(rule.runOnEdit, true);
    const expression = new RegExp(rule.findRegex.slice(1, -3), 'gi');
    assert.equal(raw(payload).replace(expression, ''), '正文');
    remove(); assert.deepEqual(settings.regex, [{ id: 'user-rule' }]);
});
test('coverage never jumps over old unsummarized replies or a deleted floor', () => {
    const store = { lastSummarizedMesId: 7, summaryHistory: [{ kind: 'baseline', endMesId: 1 },
        { endMesId: 3, floorEntry: { source: { start: 2 } } },
        { endMesId: 7, floorEntry: { source: { start: 6 } } }] };
    assert.equal(floorCoverageEnd(store), 3);
    store.summaryHistory[1].floorEntry.deleted = true;
    assert.equal(floorCoverageEnd(store), 1);
});
test('floor panel uses two-line preview, editable grouped entries and explicit approval without unsafe markup', async () => {
    const { document } = parseHTML('<html><body></body></html>');
    const calls = [], snapshot = { enabled: true, chat: [{ mes: raw({ ...payload, summary: '<img src=x onerror=alert(1)>' }) }], store: {} };
    const panel = createFloorPanel({ doc: document, floor: 0, schedule() {}, openMemory() {},
        updateFloor: async (...args) => calls.push(args), extractFloor: async () => ({ status: 'missing' }) });
    document.body.append(panel.node); panel.refresh(snapshot);
    assert.equal(panel.node.querySelector('.tk-fp-toggle').getAttribute('aria-expanded'), 'false');
    panel.node.querySelector('.tk-fp-toggle').click();
    assert.equal(panel.node.querySelector('.tk-fp-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(panel.node.querySelectorAll('img').length, 0);
    assert.match(panel.node.querySelector('.tk-fp-group').textContent, /贝拉/);
    panel.node.querySelector('.tk-fp-summary').click();
    const textarea = panel.node.querySelector('textarea'); textarea.value = '已审查的摘要';
    panel.node.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1); assert.equal(calls[0][1].payload.summary, '已审查的摘要'); assert.equal(calls[0][1].stage, true);
});

test('main mode disables both automatic summary entrypoints and injects only into story generation', async () => {
    const prompts = {}, config = { inlineSummary: { enabled: true } };
    const mod = entry(['scheduleAutoSummary', 'maybeAutoRunSummary', 'injectMainReplySummary'], {
        getSummaryPanelConfig: () => config, extension_prompts: prompts, FLOOR_PROMPT_KEY: 'floor',
        AUTO_SUMMARY_DELAY_MS: 10,
        usesStoryRecall: type => type === 'normal', isStorySummaryEnabledForCurrentChat: () => true,
        ensureFloorSources: async () => {}, getPublishedSummaryStore: () => ({}), buildFloorProtocol,
        extension_prompt_types: { IN_CHAT: 1 }, extension_prompt_roles: { SYSTEM: 0 },
        getContext: () => assert.fail('main mode must not schedule an independent summary'),
    });
    mod.scheduleAutoSummary('after_ai'); await mod.maybeAutoRunSummary('before_user');
    await mod.injectMainReplySummary([], 0, null, 'normal'); assert.match(prompts.floor.value, /<kitchen_summary>/);
    await mod.injectMainReplySummary([], 0, null, 'quiet'); assert.equal(prompts.floor, undefined);
    config.inlineSummary.enabled = false;
    await mod.injectMainReplySummary([], 0, null, 'normal'); assert.equal(prompts.floor, undefined);
});

test('changing source while an editor is open blocks stale save and cancel reloads the current view', () => {
    const { document } = parseHTML('<html><body></body></html>'); let scheduled = 0;
    const snapshot = { chat: [{ mes: raw(payload) }], store: {} };
    const panel = createFloorPanel({ doc: document, floor: 0, schedule() { scheduled++; } });
    document.body.append(panel.node); panel.refresh(snapshot); panel.node.querySelector('.tk-fp-toggle').click();
    panel.node.querySelector('.tk-fp-summary').click();
    snapshot.chat[0].mes = raw({ ...payload, summary: '新回复' }); panel.refresh(snapshot);
    assert.equal(panel.node.querySelector('[type="submit"]').disabled, true);
    [...panel.node.querySelectorAll('button')].find(node => node.textContent === '取消').click(); panel.refresh(snapshot);
    assert.ok(scheduled); assert.equal(panel.node.querySelector('.tk-fp-preview').textContent, '新回复');
});

test('re-extraction cannot silently discard unsaved edits; cancelling retains the form value', () => {
    const { document } = parseHTML('<html><body></body></html>'); let extracts = 0;
    const panel = createFloorPanel({ doc: document, floor: 0, schedule() {}, extractFloor: async () => { extracts++; } });
    document.body.append(panel.node); panel.refresh({ chat: [{ mes: raw(payload) }], store: {} });
    panel.node.querySelector('.tk-fp-toggle').click(); panel.node.querySelector('.tk-fp-summary').click();
    panel.node.querySelector('textarea').value = '尚未保存的修订';
    panel.node.querySelector('[aria-label^="重新提取"]').click();
    assert.equal(extracts, 0); assert.match(panel.node.querySelector('.tk-fp-extract-confirm').textContent, /覆盖人工修改/);
    [...panel.node.querySelectorAll('button')].find(node => node.textContent === '取消重新提取').click();
    assert.equal(panel.node.querySelector('textarea').value, '尚未保存的修订'); assert.equal(extracts, 0);
});

test('native system notices are not narrative floors, while hidden real replies still are', () => {
    assert.equal(isNarrativeReply({ mes: '系统通知', is_system: true, extra: { type: 'narrator' } }), false);
    assert.equal(floorSource([{ mes: '系统通知', is_system: true, extra: { type: 'comment' } }], 0), null);
    assert.equal(isNarrativeReply({ mes: '角色的旧回复', is_system: true }), true);
    const parsed = prepareFloorPayload({ summary: '场景变化', updates: { arcUpdates: [{ name: '贝拉', trajectory: '寻找线索', progress: 30 }] } }, {}, { start: 0, floor: 0 });
    assert.equal(parsed.events[0].memoryRole, '具体经历'); assert.equal(parsed.arcUpdates[0].progress, 0.3);
    assert.equal(prepareFloorPayload({ summary: '保留楼尾文字', updates: { events: [] } }, {}, { start: 0, floor: 0 }, [], [], true).events.length, 0);
});
