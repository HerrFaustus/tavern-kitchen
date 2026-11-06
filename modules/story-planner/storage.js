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
