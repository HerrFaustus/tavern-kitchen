import { createWorldStorage, parseWorldArchiveIdentity } from '../world-records/storage.js';
import { createNoteStore } from '../story-planner/storage.js';

const REQUEST_TIMEOUT_MS = 8000;
const MAX_CHARACTER_SCAN = 30;

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

function collectEntryDetail(entry) {
    const parts = [];
    if (entry.counts.worlds > 0) parts.push(`世界档案×${entry.counts.worlds}`);
    if (entry.counts.danglingBranches > 0) parts.push(`悬空分支×${entry.counts.danglingBranches}`);
    if (entry.counts.notes > 0) parts.push(`编剧札记×${entry.counts.notes}`);
    if (entry.counts.memoryChunks > 0) parts.push(`记忆切片×${entry.counts.memoryChunks}`);
    if (entry.counts.memoryVectors > 0) parts.push(`向量条目×${entry.counts.memoryVectors}`);
    return parts.join(' · ') || '空索引记录';
}

function summarizeItem(entry) {
    return {
        ...entry,
        detail: collectEntryDetail(entry),
    };
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

    async function scanOrphanArchives() {
        return withStores(async ({ activeWorld, activeNotes }) => {
            const context = getContext?.() || {};
            const [worldRecords, noteOwners, memoryRows] = await Promise.all([
                activeWorld ? activeWorld.listArchiveRecords() : Promise.resolve({ owners: [], branchKeys: [], bindings: [] }),
                activeNotes ? activeNotes.listAllOwners() : Promise.resolve([]),
                memoryStore ? memoryStore.listChatStorageStats() : Promise.resolve([]),
            ]);

        const entries = new Map();
        const ensureEntry = (id, defaults) => {
            if (!entries.has(id)) {
                entries.set(id, {
                    id,
                    status: 'unknown',
                    title: defaults.title || id,
                    kind: defaults.kind || 'unknown',
                    ownerId: defaults.ownerId || '',
                    chatId: defaults.chatId || '',
                    worldIdentities: [],
                    danglingBranchIds: [],
                    noteOwners: [],
                    memoryChatIds: [],
                    counts: { worlds: 0, danglingBranches: 0, notes: 0, memoryChunks: 0, memoryVectors: 0 },
                });
            }
            return entries.get(id);
        };

        const addUnique = (arr, val) => {
            if (val && !arr.includes(val)) arr.push(val);
        };

        const referencedBranchIds = new Set();
        const attachWorldIdentity = (identityStr, branchId, title) => {
            if (branchId) referencedBranchIds.add(branchId);
            const parsed = parseWorldArchiveIdentity(identityStr);
            if (parsed) {
                const chatKey = normalizeChatKey(parsed.chatId);
                const id = makeStoryKey(parsed.kind, parsed.ownerId, chatKey);
                const entry = ensureEntry(id, {
                    kind: parsed.kind,
                    ownerId: parsed.ownerId,
                    chatId: parsed.chatId,
                    title: `${title || parsed.chatId} (${parsed.ownerId})`,
                });
                if (!entry.worldIdentities.includes(identityStr)) {
                    entry.worldIdentities.push(identityStr);
                    entry.counts.worlds += 1;
                }
                return;
            }
            const id = `legacy-world:${identityStr || branchId}`;
            const entry = ensureEntry(id, {
                kind: 'legacy',
                title: `未识别的世界档案: ${title || identityStr || branchId}`,
            });
            if (identityStr && !entry.worldIdentities.includes(identityStr)) {
                entry.worldIdentities.push(identityStr);
                entry.counts.worlds += 1;
            }
        };

        for (const owner of worldRecords.owners || []) {
            attachWorldIdentity(owner?.identity, owner?.branchId, owner?.title);
        }
        for (const binding of worldRecords.bindings || []) {
            attachWorldIdentity(binding?.identity, binding?.branchId, '');
        }

        const danglingBranches = (worldRecords.branchKeys || []).filter(branchId => !referencedBranchIds.has(branchId));
        if (danglingBranches.length) {
            const entry = ensureEntry('dangling-world-branches', {
                kind: 'dangling-branch',
                title: '无归属的世界分支快照',
            });
            entry.status = 'orphan';
            entry.danglingBranchIds = [...danglingBranches];
            entry.counts.danglingBranches = danglingBranches.length;
        }

        for (const noteGroup of noteOwners || []) {
            const parsed = noteGroup?.identity ? parseWorldArchiveIdentity(noteGroup.identity) : null;
            if (parsed) {
                const chatKey = normalizeChatKey(parsed.chatId);
                const id = makeStoryKey(parsed.kind, parsed.ownerId, chatKey);
                const entry = ensureEntry(id, {
                    kind: parsed.kind,
                    ownerId: parsed.ownerId,
                    chatId: parsed.chatId,
                    title: `${parsed.chatId} (${parsed.ownerId})`,
                });
                if (!entry.noteOwners.includes(noteGroup.owner)) {
                    entry.noteOwners.push(noteGroup.owner);
                    entry.counts.notes += noteGroup.count || 0;
                }
            } else {
                const id = `legacy-notes:${noteGroup.owner}`;
                const entry = ensureEntry(id, {
                    kind: 'legacy',
                    title: `旧版格式编剧札记: ${noteGroup.owner}`,
                });
                if (!entry.noteOwners.includes(noteGroup.owner)) {
                    entry.noteOwners.push(noteGroup.owner);
                    entry.counts.notes += noteGroup.count || 0;
                }
            }
        }

        // 先核验所有已解析出 kind/ownerId 的故事档案
        const characterCache = new Map();
        const storyEntries = [...entries.values()].filter(e => e.kind === 'character' || e.kind === 'group');
        await Promise.all(storyEntries.map(async entry => {
            entry.status = await resolveStoryStatus({
                kind: entry.kind,
                ownerId: entry.ownerId,
                chatKey: normalizeChatKey(entry.chatId),
                context,
                characterCache,
            });
        }));

        // 核验纯 Memory 库缓存，绝不把共享文件名绑到 orphan 上导致误删活跃缓存
        const characters = Array.isArray(context?.characters) ? context.characters : null;
        const groups = Array.isArray(context?.groups) ? context.groups : null;
        const activeChatKey = normalizeChatKey(context?.chatId);

        const isKnownLiveMemoryKey = (normMemKey) => {
            if (!normMemKey) return true;
            if (activeChatKey && activeChatKey === normMemKey) return true;
            if (characters?.some(c => normalizeChatKey(c?.chat) === normMemKey)) return true;
            if (groups?.some(g => normalizeChatKey(g?.chat_id) === normMemKey
                || (Array.isArray(g?.chats) && g.chats.some(c => normalizeChatKey(c) === normMemKey)))) return true;
            for (const entry of storyEntries) {
                if (entry.status !== 'orphan' && normalizeChatKey(entry.chatId) === normMemKey) return true;
            }
            for (const cached of characterCache.values()) {
                if (cached.state === 'ok' && cached.chats?.has(normMemKey)) return true;
            }
            return false;
        };

        const addMemoryStats = (entry, mem) => {
            addUnique(entry.memoryChatIds, mem.chatId);
            entry.counts.memoryChunks += mem.chunks || 0;
            entry.counts.memoryVectors += (mem.chunkVectors || 0) + (mem.eventVectors || 0) + (mem.stateVectors || 0);
        };

        // 预先查完其余字符数 <= MAX_CHARACTER_SCAN 的角色以提升孤立 Memory 缓存识别率
        let allCharactersVerified = Array.isArray(characters) && characters.length <= MAX_CHARACTER_SCAN;
        if (allCharactersVerified) {
            const pendingUnmatched = memoryRows.filter(mem => {
                const k = normalizeChatKey(mem.chatId);
                return k && !isKnownLiveMemoryKey(k) && !storyEntries.some(e => normalizeChatKey(e.chatId) === k);
            });
            if (pendingUnmatched.length > 0) {
                for (const char of characters) {
                    const avatar = String(char?.avatar ?? '');
                    if (!avatar) continue;
                    const res = await verifyCharacterChats(avatar, characterCache);
                    if (res.state !== 'ok') {
                        allCharactersVerified = false;
                    }
                }
            }
        }

        for (const mem of memoryRows || []) {
            const normMemKey = normalizeChatKey(mem.chatId);
            if (!normMemKey) continue;
            const matchingStories = storyEntries.filter(e => normalizeChatKey(e.chatId) === normMemKey);

            if (matchingStories.length === 1 && !isKnownLiveMemoryKey(normMemKey)) {
                addMemoryStats(matchingStories[0], mem);
                continue;
            }
            if (matchingStories.length >= 1) {
                const target = matchingStories.find(e => e.status === 'live')
                    || matchingStories.find(e => e.status === 'unknown')
                    || matchingStories[0];
                // DO NOT 将共享同名文件的 Memory 挂到孤儿条目上，防止误删活跃角色聊天缓存
                if (target.status !== 'orphan' || !isKnownLiveMemoryKey(normMemKey)) {
                    addMemoryStats(target, mem);
                } else {
                    const isolated = ensureEntry(`memory-live:${normMemKey}`, {
                        kind: 'memory-only',
                        chatId: mem.chatId,
                        title: `活跃召回缓存: ${mem.chatId}`,
                    });
                    isolated.status = 'live';
                    addMemoryStats(isolated, mem);
                }
                continue;
            }

            // 完全没有任何 World / Note 记录的纯 Memory 缓存
            const liveViaLocal = isKnownLiveMemoryKey(normMemKey);
            let status = 'unknown';
            if (liveViaLocal) {
                status = 'live';
            } else if (allCharactersVerified && Array.isArray(groups)) {
                const groupRes = await verifyGroupChat('__unmatched__', normMemKey, groups);
                if (groupRes === 'live') status = 'live';
                else if (groupRes === 'orphan') status = 'orphan';
            }

            const entry = ensureEntry(`memory-only:${normMemKey}`, {
                kind: 'memory-only',
                chatId: mem.chatId,
                title: status === 'orphan'
                    ? `孤立原文与向量缓存: ${mem.chatId}`
                    : status === 'live'
                        ? `召回缓存: ${mem.chatId}`
                        : `未核验的召回缓存: ${mem.chatId}`,
            });
            entry.status = status;
            addMemoryStats(entry, mem);
        }

        const rank = { orphan: 0, unknown: 1, live: 2 };
        const items = [...entries.values()]
            .map(summarizeItem)
            .sort((a, b) => (rank[a.status] - rank[b.status]) || a.title.localeCompare(b.title));

        return {
            scannedAt: Date.now(),
            items,
            summary: {
                total: items.length,
                orphanCount: items.filter(i => i.status === 'orphan').length,
                unknownCount: items.filter(i => i.status === 'unknown').length,
                liveCount: items.filter(i => i.status === 'live').length,
            },
        };
        });
    }

    async function exportArchiveBackup(selectedItems = []) {
        return withStores(async ({ activeWorld, activeNotes }) => {
            const worldIdentities = [];
            const branchIds = [];
            const noteOwners = [];
            const memoryChatIds = [];
            for (const item of selectedItems) {
                for (const id of item?.worldIdentities || []) if (!worldIdentities.includes(id)) worldIdentities.push(id);
                for (const b of item?.danglingBranchIds || []) if (!branchIds.includes(b)) branchIds.push(b);
                for (const o of item?.noteOwners || []) if (!noteOwners.includes(o)) noteOwners.push(o);
                for (const c of item?.memoryChatIds || []) if (!memoryChatIds.includes(c)) memoryChatIds.push(c);
            }

            const [worlds, notes, memory] = await Promise.all([
                (worldIdentities.length || branchIds.length) && activeWorld
                    ? activeWorld.exportIdentities(worldIdentities, branchIds)
                    : Promise.resolve([]),
                noteOwners.length && activeNotes
                    ? activeNotes.exportByOwners(noteOwners)
                    : Promise.resolve([]),
                memoryChatIds.length && memoryStore
                    ? memoryStore.exportChatMemoryRecords(memoryChatIds)
                    : Promise.resolve([]),
            ]);

            return {
                format: 'TavernKitchenArchiveBackup',
                version: 1,
                exportedAt: new Date().toISOString(),
                items: selectedItems.map(item => ({
                    id: item.id,
                    status: item.status,
                    title: item.title,
                    kind: item.kind,
                    chatId: item.chatId,
                })),
                data: { worlds, notes, memory },
            };
        });
    }

    async function cleanupSelectedArchives(selectedItems = []) {
        return withStores(async ({ activeWorld, activeNotes }) => {
            const worldIdentities = [];
            const danglingBranchIds = [];
            const noteOwners = [];
            const memoryChatIds = [];
            for (const item of selectedItems) {
                for (const id of item?.worldIdentities || []) if (!worldIdentities.includes(id)) worldIdentities.push(id);
                for (const b of item?.danglingBranchIds || []) if (!danglingBranchIds.includes(b)) danglingBranchIds.push(b);
                for (const o of item?.noteOwners || []) if (!noteOwners.includes(o)) noteOwners.push(o);
                for (const c of item?.memoryChatIds || []) if (!memoryChatIds.includes(c)) memoryChatIds.push(c);
            }

            const worldResult = (worldIdentities.length || danglingBranchIds.length) && activeWorld
                ? await activeWorld.deleteIdentities(worldIdentities, danglingBranchIds)
                : { deletedBranches: 0, deletedIdentities: 0 };

            const deletedNotes = noteOwners.length && activeNotes
                ? await activeNotes.deleteByOwners(noteOwners)
                : 0;

            if (memoryChatIds.length && memoryStore) {
                await Promise.all(memoryChatIds.map(chatId => memoryStore.clearChatData(chatId)));
            }

            return {
                worldIdentities: worldResult.deletedIdentities,
                danglingBranches: worldResult.deletedBranches,
                notes: deletedNotes,
                memoryChats: memoryChatIds.length,
            };
        });
    }

    return {
        cascadeDeleteChat,
        scanOrphanArchives,
        exportArchiveBackup,
        cleanupSelectedArchives,
    };
}
