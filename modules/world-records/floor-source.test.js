import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { captureRangeSource } from '../story-summary/data/turn-source.js';
import { worldFieldSource } from './authority-context.js';
import { createSummaryArchive } from '../story-summary/archive-view.js';

function worldFixture() {
    const chat = [
        { is_user: true, name: '旅人', mes: '出发。' },
        { is_user: false, name: '城主', mes: '城主看向你。' },
    ];
    const source = captureRangeSource(chat, 0, 1);
    const world = { branchId: 'b1', sources: { 'turn:t1': { id: 't1', status: 'current', source } }, receipts: [], events: [] };
    return { chat, world, source };
}

test('a summary card floor request returns the live original prose only while its narrative turn is current', () => {
    const f = worldFixture();
    const context = { chatId: 'c1', chat: f.chat };
    const request = { key: 'floor:1', floor: 1, chatId: 'c1', branchId: 'b1' };
    const result = worldFieldSource(f.world, context, request);
    assert.equal(result.floor, 1);
    assert.equal(result.name, '城主');
    assert.equal(result.text, '城主看向你。');

    f.chat[1].mes = '城主移开了视线。';
    const stale = worldFieldSource(f.world, { chatId: 'c1', chat: f.chat }, request);
    assert.equal(stale.floor, undefined);
    assert.equal(stale.text, undefined);

    f.world.sources['turn:t1'].status = 'superseded';
    assert.equal(worldFieldSource(f.world, context, request).floor, undefined);
});

test('the situation page floor-source helper opens the shared dialog and asks the host for that floor', t => {
    const previousDocument = globalThis.document;
    const { document } = parseHTML(`<html><body>
        <dialog id="archive-detail"><h3 id="archive-detail-title"></h3><div id="archive-detail-body"></div></dialog>
        <button id="archive-order"></button><button id="archive-close"></button><button id="archive-people-back"></button>
    </body></html>`);
    const detail = document.getElementById('archive-detail');
    globalThis.document = document;
    t.after(() => { globalThis.document = previousDocument; });
    detail.showModal = () => { detail.open = true; };
    detail.close = () => { detail.open = false; };
    const messages = [];
    const archive = createSummaryArchive({
        getData: () => ({ chatId: 'c1', branchId: 'b1', rounds: [], facts: [], storyRecords: [] }),
        hasChat: () => true, getSelectedCharacter: () => '',
        onSelectCharacter() {}, onTimelineChange() {}, onFactsChange() {},
        postMsg: (type, data) => messages.push({ type, ...data }),
        setHtml() {}, h: value => String(value ?? ''),
    });

    archive.openFloorSource(3);
    assert.equal(detail.open, true);
    assert.equal(document.getElementById('archive-detail-title').textContent, '第 4 楼原文');
    assert.equal(document.getElementById('archive-detail-body').textContent, '正在读取原楼…');
    assert.deepEqual(messages.at(-1), { type: 'WORLD_FIELD_SOURCE', key: 'floor:3', floor: 3, chatId: 'c1', branchId: 'b1' });

    archive.showFieldSource({ key: 'floor:3', chatId: 'c1', branchId: 'b1', floor: 3, name: '城主', text: '城主看向你。' });
    assert.match(document.getElementById('archive-detail-body').textContent, /第 4 楼 · 城主/);
    assert.match(document.getElementById('archive-detail-body').textContent, /城主看向你。/);

    document.getElementById('archive-detail-body').textContent = '未变化';
    archive.showFieldSource({ key: 'floor:2', chatId: 'c1', branchId: 'b1', floor: 2, text: '别的楼' });
    assert.equal(document.getElementById('archive-detail-body').textContent, '未变化');
});
