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
