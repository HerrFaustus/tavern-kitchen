import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createWorldStorage } from '../world-records/storage.js';
import { emptyWorld } from '../world-records/domain.js';
import { createNoteStore } from '../story-planner/storage.js';
import { createArchiveCleanup } from './archive-cleanup.js';

function createFakeMemoryStore(initialChats = {}) {
    const store = new Map(Object.entries(initialChats));
    return {
        store,
        async listChatStorageStats() {
            return [...store.entries()].map(([chatId, data]) => ({
                chatId,
                fingerprint: 'fp-1',
                lastChunkFloor: 5,
                chunks: data.chunks || 2,
                chunkVectors: data.chunkVectors || 2,
                eventVectors: data.eventVectors || 1,
                stateVectors: data.stateVectors || 0,
            }));
        },
        async exportChatMemoryRecords(chatIds = []) {
            return chatIds.filter(id => store.has(id)).map(chatId => ({
                chatId,
                meta: { chatId, fingerprint: 'fp-1', lastChunkFloor: 5 },
                chunks: [{ chatId, floor: 0, text: `摘要-${chatId}` }],
            }));
        },
        async clearChatData(chatId) {
            store.delete(chatId);
        },
    };
}

function makeWorldIdentity(avatar, chatId, kind = 'character') {
    const story = JSON.stringify([kind, avatar, chatId]);
    return JSON.stringify(['default-user', story]);
}

function makeNoteOwner(avatar, chatId, worldId, branchId) {
    return JSON.stringify([makeWorldIdentity(avatar, chatId), worldId, branchId]);
}

test('CHAT_DELETED cascades cleanly across Memory, WorldArchive, and StoryPlanner when unambiguous', async t => {
    const idb = new IDBFactory();
    const prevIdb = globalThis.indexedDB;
    globalThis.indexedDB = idb;
    const worldStorage = createWorldStorage({ indexedDB: idb });
    t.after(async () => {
        await worldStorage.close();
        globalThis.indexedDB = prevIdb;
    });
    const noteStore = createNoteStore();
    const targetIdentity = makeWorldIdentity('hero.png', 'chat-gone');
    const keepIdentity = makeWorldIdentity('hero.png', 'chat-keep');

    await worldStorage.update(targetIdentity, () => ({ state: emptyWorld('w-gone', 'b-gone', '已删聊天') }));
    await worldStorage.update(keepIdentity, () => ({ state: emptyWorld('w-keep', 'b-keep', '保留聊天') }));
    await noteStore.put({
        id: 'n1', owner: makeNoteOwner('hero.png', 'chat-gone', 'w-gone', 'b-gone'), scope: 'chapter', body: '已删札记', floor: 1,
    });
    await noteStore.put({
        id: 'n2', owner: makeNoteOwner('hero.png', 'chat-keep', 'w-keep', 'b-keep'), scope: 'chapter', body: '保留札记', floor: 1,
    });

    const memoryStore = createFakeMemoryStore({
        'chat-gone': { chunks: 4, chunkVectors: 4 },
        'chat-keep': { chunks: 3, chunkVectors: 3 },
    });

    const cleanup = createArchiveCleanup({
        getContext: () => ({ chatId: 'chat-keep', characterId: 0, characters: [{ name: 'Hero', avatar: 'hero.png', chat: 'chat-keep' }], groups: [] }),
        worldStorage,
        noteStore,
        memoryStore,
    });

    const res = await cleanup.cascadeDeleteChat('chat-gone', { kind: 'character' });
    assert.deepEqual(res.deletedWorldIdentities, [targetIdentity]);
    assert.equal(res.deletedNotes, 1);
    assert.equal(res.memoryCleared, true);
    assert.equal(res.ambiguous, false);

    assert.equal(await worldStorage.read(targetIdentity), null);
    assert.ok(await worldStorage.read(keepIdentity));
    assert.equal(memoryStore.store.has('chat-gone'), false);
    assert.equal(memoryStore.store.has('chat-keep'), true);
    const remainingNotes = await noteStore.listAllOwners();
    assert.equal(remainingNotes.length, 1);
    assert.equal(remainingNotes[0].identity, keepIdentity);
});

test('CHAT_DELETED refuses to guess when multiple characters share same bare chat filename while offline', async t => {
    const idb = new IDBFactory();
    const prevIdb = globalThis.indexedDB;
    globalThis.indexedDB = idb;
    const worldStorage = createWorldStorage({ indexedDB: idb });
    t.after(async () => {
        await worldStorage.close();
        globalThis.indexedDB = prevIdb;
    });
    const noteStore = createNoteStore();

    const idA = makeWorldIdentity('alice.png', 'Greeting 1');
    const idB = makeWorldIdentity('bob.png', 'Greeting 1');
    await worldStorage.update(idA, () => ({ state: emptyWorld('wA', 'bA', 'Alice') }));
    await worldStorage.update(idB, () => ({ state: emptyWorld('wB', 'bB', 'Bob') }));

    const cleanup = createArchiveCleanup({
        getContext: () => ({ characters: [{ avatar: 'alice.png' }, { avatar: 'bob.png' }], groups: [] }),
        fetchFn: async () => { throw new Error('offline'); },
        worldStorage,
        noteStore,
        memoryStore: createFakeMemoryStore({ 'Greeting 1': { chunks: 1 } }),
    });

    const res = await cleanup.cascadeDeleteChat('Greeting 1');
    assert.equal(res.ambiguous, true);
    assert.deepEqual(res.deletedWorldIdentities, []);
    assert.ok(await worldStorage.read(idA));
    assert.ok(await worldStorage.read(idB));
});

test('scanOrphanArchives separates orphan vs offline unknown vs live and exports backup before cleanup', async t => {
    const idb = new IDBFactory();
    const prevIdb = globalThis.indexedDB;
    globalThis.indexedDB = idb;
    const worldStorage = createWorldStorage({ indexedDB: idb });
    t.after(async () => {
        await worldStorage.close();
        globalThis.indexedDB = prevIdb;
    });
    const noteStore = createNoteStore();

    const liveId = makeWorldIdentity('alice.png', 'live-chat');
    const orphanId = makeWorldIdentity('alice.png', 'deleted-chat');
    const offlineCharId = makeWorldIdentity('offline.png', 'maybe-offline');

    await worldStorage.update(liveId, () => ({ state: emptyWorld('w-live', 'b-live', '活跃剧情') }));
    await worldStorage.update(orphanId, () => ({ state: emptyWorld('w-orphan', 'b-orphan', '孤儿剧情') }));
    await worldStorage.update(offlineCharId, () => ({ state: emptyWorld('w-unknown', 'b-unknown', '未知剧情') }));
    await noteStore.put({
        id: 'n-orphan', owner: makeNoteOwner('alice.png', 'deleted-chat', 'w-orphan', 'b-orphan'), scope: 'chapter', body: '孤儿札记', floor: 2,
    });

    const memoryStore = createFakeMemoryStore({
        'live-chat': { chunks: 2, chunkVectors: 2 },
        'deleted-chat': { chunks: 5, chunkVectors: 5 },
    });

    const cleanup = createArchiveCleanup({
        getContext: () => ({
            chatId: 'live-chat',
            characterId: 0,
            characters: [
                { name: 'Alice', avatar: 'alice.png', chat: 'live-chat' },
                { name: 'Offline', avatar: 'offline.png', chat: 'other' },
            ],
            groups: [],
        }),
        fetchFn: async (_url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.avatar_url === 'alice.png') {
                return { ok: true, status: 200, json: async () => [{ file_name: 'live-chat.jsonl' }] };
            }
            if (body.avatar_url === 'offline.png') {
                return { ok: false, status: 503, json: async () => ({}) };
            }
            return { ok: true, status: 200, json: async () => [] };
        },
        worldStorage,
        noteStore,
        memoryStore,
    });

    const scan = await cleanup.scanOrphanArchives();
    assert.equal(scan.summary.orphanCount, 1);
    assert.equal(scan.summary.unknownCount, 1);
    assert.equal(scan.summary.liveCount, 1);

    const orphanItem = scan.items.find(i => i.status === 'orphan');
    assert.equal(orphanItem.chatId, 'deleted-chat');
    assert.equal(orphanItem.counts.worlds, 1);
    assert.equal(orphanItem.counts.notes, 1);
    assert.equal(orphanItem.counts.memoryChunks, 5);

    const backup = await cleanup.exportArchiveBackup([orphanItem]);
    assert.equal(backup.format, 'TavernKitchenArchiveBackup');
    assert.equal(backup.data.worlds.length, 1);
    assert.equal(backup.data.notes.length, 1);
    assert.equal(backup.data.memory.length, 1);

    const cleaned = await cleanup.cleanupSelectedArchives([orphanItem]);
    assert.equal(cleaned.worldIdentities, 1);
    assert.equal(cleaned.notes, 1);
    assert.equal(cleaned.memoryChats, 1);

    assert.equal(await worldStorage.read(orphanId), null);
    assert.ok(await worldStorage.read(liveId));
    assert.ok(await worldStorage.read(offlineCharId));
    assert.equal(memoryStore.store.has('deleted-chat'), false);
    assert.equal(memoryStore.store.has('live-chat'), true);
});
