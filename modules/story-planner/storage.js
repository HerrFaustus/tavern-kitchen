import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { normalizeArchiveStorageError } from '../world-records/storage.js';

export function parsePlannerOwner(owner) {
    if (typeof owner !== 'string' || !owner || owner === 'legacy-note-claims') return null;
    if (!owner.startsWith('[')) {
        return { owner, identity: owner, worldId: null, branchId: null, legacy: true };
    }
    try {
        const parsed = JSON.parse(owner);
        if (Array.isArray(parsed) && parsed.length === 3 && typeof parsed[0] === 'string') {
            return { owner, identity: parsed[0], worldId: parsed[1], branchId: parsed[2], legacy: false };
        }
    } catch (error) {
        console.warn('[story-planner] parsePlannerOwner failed', error);
    }
    return { owner, identity: owner, worldId: null, branchId: null, legacy: true };
}

// Immutable publications. The unique key also deduplicates simultaneous tabs.
export function createNoteStore() {
    let opening;
    const db = () => opening ??= new Promise((resolve,reject) => {
        const request = indexedDB.open('TavernKitchen.StoryPlanner',1);
        request.onupgradeneeded = () => request.result.createObjectStore('notes',{keyPath:'id'}).createIndex('owner','owner');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { opening = null; reject(request.error); };
    });
    return {
        // Older card imports wrote notes under the chat identity instead of the
        // planner's world/branch identity. Claim that legacy set once so it
        // cannot silently migrate again into a different branch.
        async recoverLegacy(legacyOwner, owner, guard) {
            if (!legacyOwner || !owner || legacyOwner === owner) return;
            const tx = (await db()).transaction('notes','readwrite'), store = tx.objectStore('notes');
            const marker = 'legacy-note-claim:' + memoryDigest(legacyOwner);
            const signature = note => memoryDigest(Object.fromEntries(Object.entries(note).filter(([key]) => !['id','owner','recoveredLegacy'].includes(key))));
            return new Promise((resolve,reject) => {
                let failure;
                const abort = error => { failure = error; tx.abort(); };
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(normalizeArchiveStorageError(failure || tx.error, '旧札记恢复中断'));
                const claim = store.get(marker);
                claim.onsuccess = () => {
                    if (claim.result) return;
                    const legacy = store.index('owner').getAll(legacyOwner);
                    legacy.onsuccess = () => {
                        if (!legacy.result.length) return;
                        const existing = store.index('owner').getAll(owner);
                        existing.onsuccess = () => {
                            try {
                                if (!guard()) throw new Error('聊天或世界分支已变化');
                                const present = new Set(existing.result.map(signature));
                                for (const note of legacy.result) {
                                    const key = signature(note);
                                    if (present.has(key)) continue;
                                    present.add(key);
                                    store.put({ ...structuredClone(note), owner, id:'recovered:' + memoryDigest([owner,note.id]), recoveredLegacy:true });
                                }
                                store.put({ id:marker, owner:'legacy-note-claims', target:owner });
                            } catch (error) { abort(error); }
                        };
                    };
                };
            });
        },
        async putImported(owner, notes, guard) {
            const tx = (await db()).transaction('notes','readwrite');
            return new Promise((resolve,reject) => {
                let failure;
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(normalizeArchiveStorageError(failure || tx.error, '札记暂存中断'));
                try {
                    if (!guard()) throw new Error('聊天已切换');
                    for (const note of notes) {
                        if (note.owner !== owner) throw new Error('札记归属不匹配');
                        tx.objectStore('notes').put(note);
                    }
                } catch (error) { failure = error; tx.abort(); }
            });
        },
        async list(owner) {
            const store = (await db()).transaction('notes').objectStore('notes');
            return new Promise((resolve,reject) => {
                const request = store.index('owner').getAll(owner);
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
        },
        async put(note, guard = () => true) {
            const tx = (await db()).transaction('notes','readwrite'), store = tx.objectStore('notes');
            return new Promise((resolve,reject) => {
                let saved, failure;
                const get = store.get(note.id);
                get.onsuccess = () => {
                    if (get.result) { saved = get.result; return; }
                    const rows = store.index('owner').getAll(note.owner);
                    rows.onsuccess = () => {
                        if (!guard()) { tx.abort(); return; }
                        saved = {...note,revision:rows.result.reduce((n,r)=>Math.max(n,r.revision),0)+1};
                        try {
                            store.add(saved);
                        } catch (error) {
                            failure = error;
                            tx.abort();
                        }
                    };
                };
                tx.onerror = () => { failure ||= tx.error; };
                tx.oncomplete = () => resolve(saved); tx.onabort = () => reject(normalizeArchiveStorageError(failure || tx.error, '札记保存中断'));
            });
        },
        async listAllOwners() {
            const store = (await db()).transaction('notes').objectStore('notes');
            return new Promise((resolve, reject) => {
                const map = new Map();
                const req = store.openCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (!cursor) { resolve([...map.values()]); return; }
                    const row = cursor.value;
                    if (row?.owner && row.owner !== 'legacy-note-claims') {
                        const meta = map.get(row.owner) || { ...parsePlannerOwner(row.owner), count: 0 };
                        meta.count++;
                        map.set(row.owner, meta);
                    }
                    cursor.continue();
                };
                req.onerror = () => reject(req.error);
            });
        },
        async exportByOwners(owners = []) {
            if (!owners.length) return [];
            const store = (await db()).transaction('notes').objectStore('notes');
            const out = [];
            for (const owner of new Set(owners)) {
                const rows = await new Promise((resolve, reject) => {
                    const req = store.index('owner').getAll(owner);
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => reject(req.error);
                });
                out.push(...rows);
            }
            return out;
        },
        async deleteByOwners(owners = []) {
            const targets = new Set(owners.filter(Boolean));
            if (!targets.size) return 0;
            const tx = (await db()).transaction('notes', 'readwrite');
            const store = tx.objectStore('notes');
            let deleted = 0;
            return new Promise((resolve, reject) => {
                for (const owner of targets) {
                    const req = store.index('owner').getAllKeys(owner);
                    req.onsuccess = () => {
                        for (const key of req.result || []) { store.delete(key); deleted++; }
                    };
                    const claimKey = 'legacy-note-claim:' + memoryDigest(owner);
                    store.delete(claimKey);
                }
                const claims = store.index('owner').getAll('legacy-note-claims');
                claims.onsuccess = () => {
                    for (const claim of claims.result || []) {
                        if (targets.has(claim.target)) store.delete(claim.id);
                    }
                };
                tx.oncomplete = () => resolve(deleted);
                tx.onabort = () => reject(normalizeArchiveStorageError(tx.error, '札记清理中断'));
                tx.onerror = () => reject(normalizeArchiveStorageError(tx.error, '札记清理中断'));
            });
        },
    };
}
