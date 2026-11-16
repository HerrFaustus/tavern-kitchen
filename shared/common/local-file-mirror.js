const FILE_MIRROR_DB_NAME = 'TavernKitchen_FileMirror';
const FILE_MIRROR_STORE_NAME = 'files';
const FILE_MIRROR_DB_VERSION = 1;
const UNSUPPORTED_FILE_ENDPOINT_STATUSES = new Set([404, 405, 501]);

let defaultMirrorInstance = null;
let defaultMirrorIndexedDb = null;

/**
 * Determine whether an HTTP status indicates the host lacks `/api/files/*` endpoints.
 *
 * @param {unknown} status
 * @returns {boolean}
 */
export function isFileUploadUnsupportedStatus(status) {
    return UNSUPPORTED_FILE_ENDPOINT_STATUSES.has(Number(status));
}

/**
 * Determine whether a thrown upload/delete error indicates missing `/api/files/*` support.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isFileUploadUnsupportedError(error) {
    if (!error || typeof error !== 'object') return false;
    const status = /** @type {{ status?: unknown, code?: unknown }} */ (error).status;
    if (isFileUploadUnsupportedStatus(status)) return true;
    const msg = error instanceof Error ? error.message : String(error);
    return /\b(404|405|501)\b/.test(msg);
}

/**
 * Encode binary bytes to base64 safely in both browser and Node runtimes.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function uint8ArrayToBase64(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError('Expected Uint8Array');
    }
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

/**
 * Decode a base64 string into binary bytes safely in both browser and Node runtimes.
 *
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToUint8Array(base64) {
    if (typeof base64 !== 'string') {
        throw new TypeError('Expected base64 string');
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Create an IndexedDB-backed local mirror for hosts (such as TauriTavern) that do not
 * implement SillyTavern's `/api/files/upload` or `/api/files/delete` endpoints.
 *
 * @param {{ indexedDB?: IDBFactory | null, dbName?: string }} [options]
 * @returns {{
 *   isAvailable: () => boolean,
 *   get: (name: string) => Promise<{ name: string, content: string, contentType: string, encoding: string, authoritativeFallback: boolean, updatedAt: number } | null>,
 *   put: (name: string, content: string, meta?: { contentType?: string, encoding?: string, authoritativeFallback?: boolean }) => Promise<boolean>,
 *   delete: (name: string) => Promise<boolean>,
 *   list: (prefix?: string) => Promise<Array<{ name: string, content: string, contentType: string, encoding: string, authoritativeFallback: boolean, updatedAt: number }>>,
 *   close: () => Promise<void>
 * }}
 */
export function createLocalFileMirror({
    indexedDB = typeof globalThis !== 'undefined' ? globalThis.indexedDB : null,
    dbName = FILE_MIRROR_DB_NAME,
} = {}) {
    /** @type {Promise<IDBDatabase> | null} */
    let dbPromise = null;

    const isAvailable = () => Boolean(indexedDB && typeof indexedDB.open === 'function');

    const openDb = () => {
        if (!isAvailable()) {
            return Promise.resolve(null);
        }
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(dbName, FILE_MIRROR_DB_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(FILE_MIRROR_STORE_NAME)) {
                        db.createObjectStore(FILE_MIRROR_STORE_NAME, { keyPath: 'name' });
                    }
                };
                request.onsuccess = () => {
                    const db = request.result;
                    db.onversionchange = () => {
                        db.close();
                        dbPromise = null;
                    };
                    resolve(db);
                };
                request.onerror = () => {
                    dbPromise = null;
                    reject(request.error || new Error('Failed to open TavernKitchen_FileMirror IndexedDB'));
                };
                request.onblocked = () => {
                    dbPromise = null;
                    reject(new Error('TavernKitchen_FileMirror IndexedDB open blocked'));
                };
            } catch (error) {
                dbPromise = null;
                reject(error);
            }
        });
        return dbPromise;
    };

    /**
     * @param {string} name
     */
    const get = async (name) => {
        const key = String(name || '');
        if (!key || !isAvailable()) return null;
        try {
            const db = await openDb();
            if (!db) return null;
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(FILE_MIRROR_STORE_NAME, 'readonly');
                const store = tx.objectStore(FILE_MIRROR_STORE_NAME);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error || new Error('IndexedDB mirror read failed'));
            });
        } catch {
            return null;
        }
    };

    /**
     * @param {string} name
     * @param {string} content
     * @param {{ contentType?: string, encoding?: string, authoritativeFallback?: boolean }} [meta]
     */
    const put = async (name, content, meta = {}) => {
        const key = String(name || '');
        if (!key || !isAvailable()) return false;
        const db = await openDb();
        if (!db) return false;
        const record = {
            name: key,
            content: typeof content === 'string' ? content : String(content ?? ''),
            contentType: meta.contentType || 'application/json',
            encoding: meta.encoding || 'utf8',
            authoritativeFallback: Boolean(meta.authoritativeFallback),
            updatedAt: Date.now(),
        };
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(FILE_MIRROR_STORE_NAME, 'readwrite');
            const store = tx.objectStore(FILE_MIRROR_STORE_NAME);
            store.put(record);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB mirror write failed'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB mirror write aborted'));
        });
    };

    /**
     * @param {string} name
     */
    const del = async (name) => {
        const key = String(name || '');
        if (!key || !isAvailable()) return false;
        const db = await openDb();
        if (!db) return false;
        return await new Promise((resolve, reject) => {
            let existed = false;
            const tx = db.transaction(FILE_MIRROR_STORE_NAME, 'readwrite');
            const store = tx.objectStore(FILE_MIRROR_STORE_NAME);
            const getReq = store.get(key);
            getReq.onsuccess = () => {
                existed = Boolean(getReq.result);
                store.delete(key);
            };
            getReq.onerror = () => reject(getReq.error || new Error('IndexedDB mirror delete check failed'));
            tx.oncomplete = () => resolve(existed);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB mirror delete failed'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB mirror delete aborted'));
        });
    };

    /**
     * @param {string} [prefix]
     */
    const list = async (prefix = '') => {
        if (!isAvailable()) return [];
        try {
            const db = await openDb();
            if (!db) return [];
            const all = await new Promise((resolve, reject) => {
                const tx = db.transaction(FILE_MIRROR_STORE_NAME, 'readonly');
                const store = tx.objectStore(FILE_MIRROR_STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => reject(req.error || new Error('IndexedDB mirror list failed'));
            });
            if (!prefix) return all;
            return all.filter(item => typeof item?.name === 'string' && item.name.startsWith(prefix));
        } catch {
            return [];
        }
    };

    const close = async () => {
        if (!dbPromise) return;
        const pending = dbPromise;
        dbPromise = null;
        try {
            const db = await pending;
            if (db && typeof db.close === 'function') {
                db.close();
            }
        } catch (error) {
            console.debug({ source: import.meta.url, operation: 'closeMirror' }, error);
        }
    };

    return {
        isAvailable,
        get,
        put,
        delete: del,
        list,
        close,
    };
}

/**
 * Return a lazily created default local file mirror bound to the active global IndexedDB.
 *
 * @returns {ReturnType<typeof createLocalFileMirror>}
 */
export function getLocalFileMirror() {
    const currentIdb = typeof globalThis !== 'undefined' ? globalThis.indexedDB : null;
    if (!defaultMirrorInstance || defaultMirrorIndexedDb !== currentIdb) {
        defaultMirrorIndexedDb = currentIdb;
        defaultMirrorInstance = createLocalFileMirror({ indexedDB: currentIdb });
    }
    return defaultMirrorInstance;
}
