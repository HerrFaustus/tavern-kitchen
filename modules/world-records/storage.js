import { invariant } from './domain.js';

export function normalizeArchiveStorageError(error, fallbackMessage) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22 || error?.cause?.name === 'QuotaExceededError') {
        return Object.assign(new Error('浏览器本地存储空间已满，无法保存档案。请先在「数据」中清理无用聊天或导出备份。', { cause: error }), { code: 'quota_exceeded' });
    }
    return error || new Error(fallbackMessage);
}

export function parseWorldArchiveIdentity(identity) {
    if (typeof identity !== 'string' || !identity) return null;
    try {
        const pair = JSON.parse(identity);
        if (!Array.isArray(pair) || pair.length < 2) return null;
        const ref = JSON.parse(pair[1]);
        if (!Array.isArray(ref) || ref.length < 3) return null;
        return { user: pair[0], kind: ref[0], ownerId: ref[1], chatId: ref[2] };
    } catch {
        return null;
    }
}

// One read/write transaction owns bindings and the complete branch commit. Browser
// tabs share the same IDB transaction queue; no optimistic local cache is authoritative.
export function createWorldStorage({ indexedDB = globalThis.indexedDB, name = 'TavernKitchen_WorldArchive' } = {}) {
    let opening;
    function open() {
        if (!opening) opening = new Promise((resolve, reject) => {
            invariant(indexedDB, '当前环境不支持世界档案存储');
            const request = indexedDB.open(name, 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('branches', { keyPath: 'branchId' }); request.result.createObjectStore('bindings');
                request.result.createObjectStore('owners', { keyPath: 'branchId' }).createIndex('identity', 'identity');
            };
            request.onerror = () => { opening = null; reject(request.error); };
            request.onblocked = () => { opening = null; reject(new Error('请关闭其他旧版后厨页面后重试')); };
            request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
        });
        return opening;
    }
    async function access(identity, write, transform, guard = () => true) {
        invariant(typeof identity === 'string' && identity.length > 0, '请先选择对话');
        const db = await open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['branches', 'bindings', 'owners'], write ? 'readwrite' : 'readonly');
            const bindings = transaction.objectStore('bindings'), branches = transaction.objectStore('branches');
            let result, failure;
            const abort = error => { failure = error; transaction.abort(); };
            transaction.onabort = () => reject(normalizeArchiveStorageError(failure || transaction.error, '世界档案未保存，请重试'));
            transaction.onerror = () => { failure ||= transaction.error; };
            transaction.oncomplete = () => resolve(result);
            const found = bindings.get(identity);
            found.onsuccess = () => {
                const finish = state => {
                    try {
                        invariant(guard(), '对话已切换，本次操作已取消');
                        const next = transform(state || null);
                        invariant(!next?.then, '存储事务中不能等待外部任务');
                        if (write && next?.state && next.state !== state) {
                            const slot = found.result || (next.slot || next.state.branchId);
                            const stored = slot === next.state.branchId ? next.state : {...next.state, branchId:slot, activeWorldBranch:next.state.branchId};
                            branches.put(stored); bindings.put(slot, identity);
                            transaction.objectStore('owners').put({ branchId: slot, identity, title: next.state.title, version: next.state.version });
                        }
                        result = next?.result;
                    } catch (error) { abort(error); }
                };
                const owners = transaction.objectStore('owners');
                const verify = owners.index('identity').getAll(identity);
                verify.onsuccess = () => {
                    const candidates = verify.result;
                    const missing = () => abort(Object.assign(new Error('旧档的活动世界指针不明确，请核对原存档来源'), {candidates}));
                    if (!found.result && !candidates.length) { finish(null); return; }
                    if (!candidates.some(row => row.branchId === found.result)) { missing(); return; }
                    const read = branches.get(found.result);
                    read.onsuccess = () => { if (!read.result) missing(); else { const value=read.result; if (value.activeWorldBranch) {value.branchId=value.activeWorldBranch;delete value.activeWorldBranch;} finish(value); } };
                };
            };
        });
    }
    return {
        read: identity => access(identity, false, state => ({ result: state })),
        update: (identity, transform, guard) => access(identity, true, transform, guard),
        async list(identity) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('owners'); const request = tx.objectStore('owners').index('identity').getAll(identity);
                request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
        },
        async recoverBinding(identity,target,guard) {
            const db = await open();
            return new Promise((resolve,reject) => {
                const tx = db.transaction(['branches','owners','bindings'],'readwrite');
                const bindings=tx.objectStore('bindings'), branches=tx.objectStore('branches'), owners=tx.objectStore('owners');
                let state, failure;
                tx.onabort=()=>reject(normalizeArchiveStorageError(failure || tx.error, '世界档案未保存，请重试')); tx.oncomplete=()=>resolve(state);
                tx.onerror=()=>{failure ||= tx.error;};
                const candidates=owners.index('identity').getAll(identity);
                candidates.onsuccess=()=>{
                    const current=bindings.get(identity);
                    current.onsuccess=()=>{
                        const original=branches.get(current.result || '');
                        original.onsuccess=()=>{
                            const chosen=branches.get(target);
                            chosen.onsuccess=()=>{try {
                                invariant(guard() && (!original.result || !candidates.result.some(row=>row.branchId===current.result)), '活动世界已确认，请重新读取');
                                invariant(chosen.result && candidates.result.some(row=>row.branchId===target), '旧资料不属于当前聊天');
                                state=chosen.result; bindings.put(target,identity);
                            } catch(error) {failure=error;tx.abort();}};
                        };
                    };
                };
            });
        },
        async listArchiveRecords() {
            const db = await open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['branches', 'bindings', 'owners'], 'readonly');
                const ownersReq = tx.objectStore('owners').getAll();
                const branchKeysReq = tx.objectStore('branches').getAllKeys();
                const bindingsReq = tx.objectStore('bindings').openCursor();
                const bindings = [];
                bindingsReq.onsuccess = () => {
                    const cursor = bindingsReq.result;
                    if (cursor) { bindings.push({ identity: cursor.key, branchId: cursor.value }); cursor.continue(); }
                };
                tx.oncomplete = () => resolve({
                    owners: ownersReq.result || [],
                    branchKeys: branchKeysReq.result || [],
                    bindings,
                });
                tx.onerror = () => reject(tx.error);
            });
        },
        async exportIdentities(identities = [], branchIds = []) {
            const db = await open();
            const wanted = new Set(identities);
            const wantedBranches = new Set(branchIds);
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['branches', 'owners'], 'readonly');
                const ownersReq = tx.objectStore('owners').getAll();
                const branchesStore = tx.objectStore('branches');
                const exported = [];
                tx.onerror = () => reject(tx.error);
                ownersReq.onsuccess = () => {
                    for (const row of ownersReq.result || []) {
                        if (wanted.has(row.identity)) wantedBranches.add(row.branchId);
                    }
                    for (const id of wantedBranches) {
                        const req = branchesStore.get(id);
                        req.onsuccess = () => { if (req.result) exported.push(req.result); };
                    }
                };
                tx.oncomplete = () => resolve(exported);
            });
        },
        async deleteIdentities(identities = [], orphanBranchIds = []) {
            const wanted = new Set(identities);
            const extraBranches = new Set(orphanBranchIds);
            if (!wanted.size && !extraBranches.size) return { deletedBranches: 0, deletedIdentities: 0 };
            const db = await open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['branches', 'bindings', 'owners'], 'readwrite');
                const branches = tx.objectStore('branches'), bindings = tx.objectStore('bindings'), owners = tx.objectStore('owners');
                let deletedBranches = 0, deletedIdentities = 0;
                const branchTargets = new Set(extraBranches);
                for (const identity of wanted) {
                    const bound = bindings.get(identity);
                    bound.onsuccess = () => {
                        if (bound.result) { branchTargets.add(bound.result); bindings.delete(identity); }
                    };
                    const owned = owners.index('identity').getAll(identity);
                    owned.onsuccess = () => {
                        for (const row of owned.result || []) {
                            branchTargets.add(row.branchId);
                            owners.delete(row.branchId);
                        }
                    };
                    deletedIdentities++;
                }
                const finishDeleteBranches = () => {
                    for (const branchId of branchTargets) {
                        branches.delete(branchId);
                        owners.delete(branchId);
                        deletedBranches++;
                    }
                };
                if (!wanted.size) finishDeleteBranches();
                else tx.objectStore('owners').getAll().onsuccess = finishDeleteBranches;
                tx.onabort = () => reject(normalizeArchiveStorageError(tx.error, '世界档案清理失败'));
                tx.onerror = () => reject(normalizeArchiveStorageError(tx.error, '世界档案清理失败'));
                tx.oncomplete = () => resolve({ deletedBranches, deletedIdentities });
            });
        },
        async close() { if (opening) (await opening).close(); opening = null; },
    };
}
