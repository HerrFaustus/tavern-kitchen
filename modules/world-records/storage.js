import { invariant } from './domain.js';

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
            transaction.onabort = () => reject(failure || transaction.error || new Error('世界档案未保存，请重试'));
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
                            branches.put(next.state); bindings.put(next.state.branchId, identity);
                            transaction.objectStore('owners').put({ branchId: next.state.branchId, identity, title: next.state.title, version: next.state.version });
                        }
                        result = next?.result;
                    } catch (error) { abort(error); }
                };
                if (!found.result) finish(null);
                else { const read = branches.get(found.result); read.onsuccess = () => { if (!read.result) abort(new Error('世界档案绑定损坏，请从备份恢复')); else finish(read.result); }; }
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
        async select(identity, target, expected, guard) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(['branches', 'bindings', 'owners'], 'readwrite');
                let result, failure;
                tx.onabort = () => reject(failure || tx.error || new Error('分支切换失败'));
                tx.oncomplete = () => resolve(result);
                const found = tx.objectStore('bindings').get(identity);
                found.onsuccess = () => {
                    const current = tx.objectStore('branches').get(found.result || '');
                    current.onsuccess = () => {
                        const owner = tx.objectStore('owners').get(target);
                        owner.onsuccess = () => {
                            const branch = tx.objectStore('branches').get(target);
                            branch.onsuccess = () => {
                                try {
                                    invariant(guard(), '对话已切换');
                                    invariant(current.result?.branchId === expected.branchId && current.result.version === expected.version, '档案已更新，请重新加载');
                                    invariant(owner.result?.identity === identity && branch.result, '该分支不属于当前对话');
                                    tx.objectStore('bindings').put(target, identity); result = branch.result;
                                } catch (error) { failure = error; tx.abort(); }
                            };
                        };
                    };
                };
            });
        },
        async close() { if (opening) (await opening).close(); opening = null; },
    };
}
