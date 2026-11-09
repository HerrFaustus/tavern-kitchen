import { memoryDigest } from '../story-summary/data/memory-policy.js';

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
                tx.onabort = () => reject(failure || tx.error || new Error('旧札记恢复中断'));
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
                tx.onabort = () => reject(failure || tx.error || new Error('札记暂存中断'));
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
        async put(note) {
            const tx = (await db()).transaction('notes','readwrite'), store = tx.objectStore('notes');
            return new Promise((resolve,reject) => {
                let saved;
                const get = store.get(note.id);
                get.onsuccess = () => {
                    if (get.result) { saved = get.result; return; }
                    const rows = store.index('owner').getAll(note.owner);
                    rows.onsuccess = () => {
                        saved = {...note,revision:rows.result.reduce((n,r)=>Math.max(n,r.revision),0)+1};
                        store.add(saved);
                    };
                };
                tx.oncomplete = () => resolve(saved); tx.onabort = () => reject(tx.error || new Error('札记保存中断'));
            });
        },
    };
}
