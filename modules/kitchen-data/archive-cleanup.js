import { createWorldStorage, parseWorldArchiveIdentity } from '../world-records/storage.js';
import { createNoteStore } from '../story-planner/storage.js';

const REQUEST_TIMEOUT_MS = 8000;

function normalizeChatKey(raw) {
    return String(raw ?? '').trim().replace(/\.jsonl$/i, '');
}

function ownerStoryPrefix(kind, ownerId) {
    return `${kind}:${String(ownerId ?? '')}`;
}

function makeStoryKey(kind, ownerId, chatKey) {
    return `${ownerStoryPrefix(kind, ownerId)}:${chatKey}`;
}

async function fetchJsonPost(fetchFn, getRequestHeaders, url, body) {
    if (typeof fetchFn !== 'function') {
        return { ok: false, networkError: true, status: 0, data: null };
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
        const headers = {
            'Content-Type': 'application/json',
            ...(typeof getRequestHeaders === 'function' ? getRequestHeaders() : {}),
        };
        const response = await fetchFn(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response || response.status >= 500) {
            return { ok: false, networkError: true, status: response?.status || 500, data: null };
        }
        let data = null;
        try {
            data = await response.json();
        } catch {
            return { ok: false, networkError: true, status: response.status, data: null };
        }
        return { ok: !!response.ok, networkError: false, status: response.status, data };
    } catch {
        return { ok: false, networkError: true, status: 0, data: null };
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
}

function buildActiveOwnerKey(context) {
    if (!context) return '';
    if (context.groupId != null) return ownerStoryPrefix('group', context.groupId);
    const activeChar = Array.isArray(context.characters) ? context.characters?.[context.characterId] : null;
    const avatar = activeChar?.avatar ?? context.characterId;
    return avatar != null && avatar !== '' ? ownerStoryPrefix('character', avatar) : '';
}

function extractChatNameSet(rows) {
    const set = new Set();
    for (const item of rows) {
        const key = normalizeChatKey(typeof item === 'string' ? item : (item?.file_name ?? item?.chat_id ?? ''));
        if (key) set.add(key);
    }
    return set;
}

export function createArchiveCleanup({
    getContext = () => ({}),
    getRequestHeaders = () => ({}),
    fetchFn = globalThis.fetch,
    worldStorage,
    getWorldStorage,
    noteStore,
    getNoteStore,
    memoryStore,
} = {}) {
    async function withStores(fn) {
        const externalWorld = worldStorage || getWorldStorage?.() || null;
        const ownedWorld = externalWorld ? null : createWorldStorage();
        const activeWorld = externalWorld || ownedWorld;
        const activeNotes = noteStore || getNoteStore?.() || createNoteStore();
        try {
            return await fn({ activeWorld, activeNotes });
        } finally {
            if (ownedWorld) {
                await ownedWorld.close().catch(error => console.warn('[archive-cleanup] close world storage failed', error));
            }
        }
    }
    async function verifyCharacterChats(avatar, characterCache) {
        if (characterCache.has(avatar)) return characterCache.get(avatar);
        const res = await fetchJsonPost(fetchFn, getRequestHeaders, '/api/characters/chats', { avatar_url: avatar });
        let result;
        if (!res.networkError && res.ok && Array.isArray(res.data)) {
            result = { state: 'ok', chats: extractChatNameSet(res.data) };
        } else if (res.networkError) {
            result = { state: 'network-error', chats: null };
        } else {
            // 部分精简/模拟宿主可能未实现 /api/characters/chats，改由 /api/chats/get 逐项兜底核对
            result = { state: 'unsupported', chats: null };
        }
        characterCache.set(avatar, result);
        return result;
    }

    async function verifyCharacterChatDirect(avatar, characterName, chatKey) {
        const res = await fetchJsonPost(fetchFn, getRequestHeaders, '/api/chats/get', {
            ch_name: String(characterName || ''),
            file_name: chatKey,
            avatar_url: avatar,
        });
        if (res.networkError) return 'unknown';
        if (res.ok && Array.isArray(res.data) && res.data.length > 0) return 'live';
        if (res.data && res.data.error) return 'orphan';
        return 'orphan';
    }

    async function verifyGroupChat(ownerId, chatKey, groups) {
        if (!Array.isArray(groups)) return 'unknown';
        const group = groups.find(g => String(g?.id ?? '') === String(ownerId));
        if (group) {
            const listed = Array.isArray(group.chats) && group.chats.some(c => normalizeChatKey(c) === chatKey);
            if (listed || normalizeChatKey(group.chat_id) === chatKey) return 'live';
        }
        const res = await fetchJsonPost(fetchFn, getRequestHeaders, '/api/chats/group/get', { id: chatKey });
        if (res.networkError) return 'unknown';
        if (res.ok && Array.isArray(res.data) && res.data.length > 0) return 'live';
        return 'orphan';
    }

    async function resolveStoryStatus({ kind, ownerId, chatKey, context, characterCache }) {
        if (!chatKey) return 'unknown';
        const activeChatKey = normalizeChatKey(context?.chatId);
        const activeOwner = buildActiveOwnerKey(context);
        if (activeChatKey && activeChatKey === chatKey && activeOwner === ownerStoryPrefix(kind, ownerId)) {
            return 'live';
        }

        const characters = Array.isArray(context?.characters) ? context.characters : null;
        const groups = Array.isArray(context?.groups) ? context.groups : null;

        if (kind === 'group') {
            return verifyGroupChat(ownerId, chatKey, groups);
        }

        if (kind === 'character') {
            if (!characters) return 'unknown';
            const character = characters.find(c => String(c?.avatar ?? '') === String(ownerId));
            const listed = await verifyCharacterChats(ownerId, characterCache);
            if (listed.state === 'ok') {
                return listed.chats.has(chatKey) ? 'live' : 'orphan';
            }
            if (listed.state === 'network-error') {
                return 'unknown';
            }
            // /api/characters/chats 不可用时，逐条核对 /api/chats/get
            return verifyCharacterChatDirect(ownerId, character?.name, chatKey);
        }

        return 'unknown';
    }

    /**
     * 当 SillyTavern 删除聊天时，安全级联清理 TavernKitchen_Memory / TavernKitchen_WorldArchive / TavernKitchen.StoryPlanner。
     * WHY: SillyTavern 的 CHAT_DELETED 仅携带文件名而非角色目录；若多角色同名，不能盲删他人档案。
     * DO NOT: 发现 distinctOwners.size > 1 且无法通过服务端核验出唯一缺失方时，绝不删除 WorldArchive 或 StoryPlanner 记录。
     */
    async function cascadeDeleteChat(chatId, { kind, skipMemory = false } = {}) {
        const rawId = String(chatId ?? '').trim();
        const targetChat = normalizeChatKey(rawId);
        if (!targetChat) {
            return { deletedWorldIdentities: [], deletedNotes: 0, memoryCleared: false, ambiguous: false };
        }

        return withStores(async ({ activeWorld, activeNotes }) => {
            const [worldRecords, noteOwners] = await Promise.all([
                activeWorld ? activeWorld.listArchiveRecords() : Promise.resolve({ owners: [], branchKeys: [], bindings: [] }),
                activeNotes ? activeNotes.listAllOwners() : Promise.resolve([]),
            ]);

            const worldByStory = new Map();
            const notesByStory = new Map();
            const ownerMetaByStory = new Map();

            const collectIdentity = (identityStr) => {
                const parsed = parseWorldArchiveIdentity(identityStr);
                if (!parsed) return null;
                if (normalizeChatKey(parsed.chatId) !== targetChat) return null;
                if (kind && parsed.kind !== kind) return null;
                const storyKey = makeStoryKey(parsed.kind, parsed.ownerId, targetChat);
                ownerMetaByStory.set(storyKey, { kind: parsed.kind, ownerId: parsed.ownerId, chatKey: targetChat });
                return { storyKey, identityStr };
            };

            for (const row of worldRecords.owners || []) {
                const hit = collectIdentity(row?.identity);
                if (!hit) continue;
                if (!worldByStory.has(hit.storyKey)) worldByStory.set(hit.storyKey, new Set());
                worldByStory.get(hit.storyKey).add(hit.identityStr);
            }
            for (const binding of worldRecords.bindings || []) {
                const hit = collectIdentity(binding?.identity);
                if (!hit) continue;
                if (!worldByStory.has(hit.storyKey)) worldByStory.set(hit.storyKey, new Set());
                worldByStory.get(hit.storyKey).add(hit.identityStr);
            }
            for (const noteGroup of noteOwners || []) {
                const hit = collectIdentity(noteGroup?.identity);
                if (!hit) continue;
                if (!notesByStory.has(hit.storyKey)) notesByStory.set(hit.storyKey, new Set());
                notesByStory.get(hit.storyKey).add(noteGroup.owner);
            }

            const matchedStories = [...ownerMetaByStory.keys()];
            let storiesToDelete = matchedStories;
            let ambiguous = false;

            if (matchedStories.length > 1) {
                const context = getContext?.() || {};
                const characterCache = new Map();
                const statuses = await Promise.all(matchedStories.map(async storyKey => {
                    const meta = ownerMetaByStory.get(storyKey);
                    const status = await resolveStoryStatus({
                        kind: meta.kind,
                        ownerId: meta.ownerId,
                        chatKey: meta.chatKey,
                        context,
                        characterCache,
                    });
                    return { storyKey, status };
                }));
                const orphans = statuses.filter(item => item.status === 'orphan').map(item => item.storyKey);
                const unknowns = statuses.filter(item => item.status === 'unknown');
                if (orphans.length > 0 && unknowns.length === 0) {
                    storiesToDelete = orphans;
                } else {
                    storiesToDelete = [];
                    ambiguous = true;
                }
            }

            const targetWorldIdentities = new Set();
            const targetNoteOwners = new Set();
            for (const storyKey of storiesToDelete) {
                for (const id of worldByStory.get(storyKey) || []) targetWorldIdentities.add(id);
                for (const owner of notesByStory.get(storyKey) || []) targetNoteOwners.add(owner);
            }

            const worldList = [...targetWorldIdentities];
            const noteList = [...targetNoteOwners];

            if (worldList.length && activeWorld) {
                await activeWorld.deleteIdentities(worldList);
            }
            let deletedNotes = 0;
            if (noteList.length && activeNotes) {
                deletedNotes = await activeNotes.deleteByOwners(noteList);
            }

            let memoryCleared = false;
            if (!ambiguous && !skipMemory && memoryStore) {
                const memoryIds = [...new Set([rawId, targetChat].filter(Boolean))];
                for (const memId of memoryIds) {
                    await memoryStore.clearChatData(memId);
                }
                memoryCleared = true;
            } else if (skipMemory && memoryStore && rawId !== targetChat && !ambiguous) {
                await memoryStore.clearChatData(targetChat);
            }

            return {
                deletedWorldIdentities: worldList,
                deletedNotes,
                memoryCleared,
                ambiguous,
            };
        });
    }

    return {
        cascadeDeleteChat,
    };
}
