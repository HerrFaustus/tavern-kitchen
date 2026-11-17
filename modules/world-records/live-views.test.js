import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { IDBFactory } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { createWorldArchive } from './host.js';
import { notifyWorldSourcesChanged } from './sources.js';

function setup(t, { ordered = true } = {}) {
    const previousIndexedDB = globalThis.indexedDB, previousDocument = globalThis.document;
    globalThis.indexedDB = new IDBFactory();
    const { document } = parseHTML('<html><body><div id="overview"></div><div id="suspense"></div></body></html>');
    globalThis.document = document;
    const context = { chatId: 'story', name1: '主角', characterId: 0, characters: [{ avatar: 'hero.png' }],
        chat: [{ is_user: true, mes: '出发。' }, { is_user: false, mes: '城主看向你。' }] };
    let snapshot = { enabled: true, store: { summaryHistory: [], json: {} } };
    const mounts = { overview: document.getElementById('overview'), suspense: document.getElementById('suspense') };
    const archive = createWorldArchive({
        getContext: () => context, ordered, getAccountId: () => 'account', getMemorySnapshot: () => snapshot,
        getMount: id => mounts[id], isVisible: id => id === 'overview' || id === 'suspense',
        onError: error => { throw error; },
    });
    t.after(async () => {
        archive.dispose();
        await setImmediate();
        globalThis.indexedDB = previousIndexedDB;
        globalThis.document = previousDocument;
    });
    return {
        context, archive, mounts,
        setRecords(storyRecords) {
            snapshot = { enabled: true, store: { summaryHistory: [], lastSummarizedMesId: 1, json: { storyRecords } } };
        },
    };
}

const records = [
    { id: 'plan:night', kind: 'plan', holders: ['主角'], title: '夜探城主府', description: '查明城主底细', status: 'open', reason: '', due: '', _addedAt: 1 },
    { id: 'suspense:lord', kind: 'suspense', title: '城主隐瞒了什么', description: '府库账目对不上', status: 'open', reason: '', due: '', _addedAt: 1 },
];

test('ordered host republishes into the open protagonist and suspense pages instead of leaving them stale', async t => {
    const f = setup(t);
    await f.archive.service.ensure();
    await f.archive.open('overview');
    await f.archive.open('suspense');
    assert.doesNotMatch(f.mounts.overview.textContent, /夜探城主府/);
    assert.doesNotMatch(f.mounts.suspense.textContent, /城主隐瞒了什么/);

    f.setRecords(records);
    // A read publishes onChanged; no page action or reopen is involved.
    await f.archive.service.read();
    assert.match(f.mounts.overview.textContent, /夜探城主府/);
    assert.match(f.mounts.suspense.textContent, /城主隐瞒了什么/);
});

test('world-source notifications refresh visible read-only pages even when the archive is ordered', async t => {
    const f = setup(t);
    await f.archive.service.ensure();
    await f.archive.open('overview');
    await f.archive.open('suspense');
    f.setRecords(records);

    notifyWorldSourcesChanged();
    for (let i = 0; i < 10 && !f.mounts.overview.textContent.includes('夜探城主府'); i++) await setImmediate();
    assert.match(f.mounts.overview.textContent, /夜探城主府/);
    assert.match(f.mounts.suspense.textContent, /城主隐瞒了什么/);
});
