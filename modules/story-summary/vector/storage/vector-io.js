// Transport only: both destinations use the same cache package and restore transaction.
import { getContext } from '../../../../../../../extensions.js';
import { getRequestHeaders } from '../../../../../../../../script.js';
import { createVectorPackage, restoreVectorPackage } from './package/service.js';
import { packageError, PACKAGE_PROGRESS } from './package/messages.js';
import {
    base64ToUint8Array,
    getLocalFileMirror,
    isFileUploadUnsupportedStatus,
    uint8ArrayToBase64,
} from '../../../../shared/common/local-file-mirror.js';

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
// 二进制 Uint8Array → base64（分块处理，避免 btoa 栈溢出）
function uint8ToBase64(uint8) {
    const CHUNK = 0x8000;
    let result = '';
    for (let i = 0; i < uint8.length; i += CHUNK) {
        result += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
    }
    return btoa(result);
}

// 服务器备份文件名
function getBackupFilename(chatId) {
    // chatId 可能含中文/特殊字符，ST 只接受 [a-zA-Z0-9_-]
    // 用简单 hash 生成安全文件名
    let hash = 0;
    for (let i = 0; i < chatId.length; i++) {
        hash = ((hash << 5) - hash + chatId.charCodeAt(i)) | 0;
    }
    const safe = (hash >>> 0).toString(36);
    return `LWB_VectorBackup_${safe}.zip`;
}


function targetOptions(options = {}) {
    const targetChatId = options.targetChatId || getContext()?.chatId;
    if (!targetChatId) throw packageError('no_chat');
    if (getContext()?.chatId !== targetChatId) throw packageError('chat_changed');
    if (options.signal?.aborted || options.isCurrent?.() === false) throw packageError('cancelled');
    return { ...options, targetChatId };
}

export async function exportVectors(onProgress) {
    const { bytes, chatId, ...counts } = await createVectorPackage(onProgress);
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `vectors_${chatId.slice(0, 8)}_${timestamp}.zip`;
    onProgress?.(PACKAGE_PROGRESS.download);
    downloadBlob(new Blob([bytes]), filename);
    return { filename, size: bytes.byteLength, ...counts };
}

export async function importVectors(file, onProgress, options = {}) {
    const target = targetOptions(options);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return restoreVectorPackage(bytes, onProgress, target);
}

export async function backupToServer(onProgress, options = {}) {
    const { bytes, chatId, ...counts } = await createVectorPackage(onProgress);
    const filename = getBackupFilename(chatId);
    const mirror = options.localMirror === undefined ? getLocalFileMirror() : options.localMirror;
    const base64 = uint8ArrayToBase64(bytes);
    onProgress?.(PACKAGE_PROGRESS.upload);
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: filename, data: base64 }),
    });
    let serverPath = null;
    let mirroredLocally = false;
    if (!res.ok) {
        if (isFileUploadUnsupportedStatus(res.status) && mirror?.isAvailable()) {
            await mirror.put(filename, base64, {
                contentType: 'application/zip',
                encoding: 'base64',
                authoritativeFallback: true,
            });
            serverPath = `user/files/${filename}`;
            mirroredLocally = true;
            console.warn(`[TavernKitchen] 宿主不支持 /api/files/upload (${res.status})，向量备份 ${filename} 已保存至浏览器 IndexedDB 本地镜像。`);
        } else if (isFileUploadUnsupportedStatus(res.status)) {
            const error = packageError('server_failed', { status: res.status });
            error.message = `当前宿主不支持 /api/files/upload（HTTP ${res.status}）且 IndexedDB 不可用，请改用“导出向量包（.zip）”本地下载`;
            throw error;
        } else {
            throw packageError('server_failed', { status: res.status });
        }
    } else {
        if (mirror?.isAvailable()) {
            try { await mirror.delete(filename); }
            catch (error) { console.debug({ source: import.meta.url, operation: 'cleanupMirror' }, error); }
        }
        const uploaded = await res.json();
        serverPath = typeof uploaded?.path === 'string' ? uploaded.path : null;
    }
    try {
        await upsertManifestEntry({
            filename,
            serverPath,
            size: bytes.byteLength,
            chatId,
            backupTime: new Date().toISOString(),
        }, { localMirror: mirror });
    } catch (cause) {
        throw packageError('backup_manifest_failed', { filename }, cause);
    }
    return { filename, size: bytes.byteLength, mirroredLocally, ...counts };
}

export async function restoreFromServer(onProgress, options = {}) {
    const target = targetOptions(options);
    const mirror = options.localMirror === undefined ? getLocalFileMirror() : options.localMirror;
    const filename = getBackupFilename(target.targetChatId);
    const mirrorEntry = mirror?.isAvailable() ? await mirror.get(filename) : null;
    onProgress?.(PACKAGE_PROGRESS.fetch);
    const res = await fetch(`/user/files/${filename}`, {
        headers: getRequestHeaders(),
        cache: 'no-cache',
        signal: target.signal,
    });
    let bytes;
    if (isFileUploadUnsupportedStatus(res.status)) {
        if (mirrorEntry && typeof mirrorEntry.content === 'string') {
            bytes = base64ToUint8Array(mirrorEntry.content);
        } else {
            throw packageError(res.status === 404 ? 'backup_missing' : 'server_failed', { status: res.status });
        }
    } else if (!res.ok) {
        throw packageError('server_failed', { status: res.status });
    } else if (mirrorEntry?.authoritativeFallback && typeof mirrorEntry.content === 'string') {
        bytes = base64ToUint8Array(mirrorEntry.content);
    } else {
        bytes = new Uint8Array(await res.arrayBuffer());
    }
    if (!bytes.byteLength) throw packageError('backup_missing');
    return restoreVectorPackage(bytes, onProgress, target);
}

// ═══════════════════════════════════════════════════════════════════════════
// 备份清单管理
// ═══════════════════════════════════════════════════════════════════════════

const BACKUP_MANIFEST = 'LWB_BackupManifest.json';

// Only a missing file is an empty manifest. A failed read must never become
// the starting point for a write that would discard existing backup entries.
async function fetchManifest(options = {}) {
    const mirror = options.localMirror === undefined ? getLocalFileMirror() : options.localMirror;
    let raw;
    try {
        const mirrorEntry = mirror?.isAvailable() ? await mirror.get(BACKUP_MANIFEST) : null;
        const res = await fetch(`/user/files/${BACKUP_MANIFEST}`, {
            headers: getRequestHeaders(),
            cache: 'no-cache',
        });
        if (isFileUploadUnsupportedStatus(res.status)) {
            if (mirrorEntry && typeof mirrorEntry.content === 'string') {
                raw = JSON.parse(mirrorEntry.content);
            } else {
                return [];
            }
        } else if (!res.ok) {
            throw packageError('server_failed', { status: res.status });
        } else if (mirrorEntry?.authoritativeFallback && typeof mirrorEntry.content === 'string') {
            raw = JSON.parse(mirrorEntry.content);
        } else {
            raw = await res.json();
        }
    } catch (cause) {
        throw packageError('backup_manifest_read_failed', {}, cause);
    }
    if (!Array.isArray(raw)) throw packageError('backup_manifest_read_failed');
    const entries = raw.map(normalizeManifestEntry);
    if (entries.some(entry => !entry)) throw packageError('backup_manifest_read_failed');
    return entries;
}

// 标准化单条条目字段；非法 filename 使清单读取失败，可选字段仍可缺省。
function normalizeManifestEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const filename = typeof raw.filename === 'string' ? raw.filename : null;
    if (!filename || !/^LWB_VectorBackup_[a-z0-9]+\.zip$/.test(filename)) return null;
    const rawPath = typeof raw.serverPath === 'string' ? raw.serverPath.replace(/^\/+/, '') : null;
    return {
        filename,
        serverPath: rawPath,
        size: typeof raw.size === 'number' ? raw.size : null,
        chatId: typeof raw.chatId === 'string' ? raw.chatId : null,
        backupTime: typeof raw.backupTime === 'string' ? raw.backupTime : null,
    };
}

// 安全推导/校验 serverPath：缺失时推导，与 filename 不一致时拒绝
function buildSafeServerPath(filename, serverPath) {
    const expected = `user/files/${filename}`;
    if (!serverPath) return expected;
    const normalized = serverPath.replace(/^\/+/, '');
    if (normalized !== expected) {
        throw new Error(`serverPath 不安全: ${serverPath}`);
    }
    return normalized;
}

// 读-改(upsert by filename)-写回-验证，失败最多重试 2 次
async function upsertManifestEntry({ filename, serverPath, size, chatId, backupTime }, options = {}) {
    if (typeof serverPath === 'string') serverPath = serverPath.replace(/^\/+/, '');
    const mirror = options.localMirror === undefined ? getLocalFileMirror() : options.localMirror;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        // 读取现有清单
        const existing = await fetchManifest({ localMirror: mirror });

        // upsert by filename
        const idx = existing.findIndex(e => e.filename === filename);
        const entry = { filename, serverPath, size, chatId, backupTime };
        if (idx >= 0) {
            existing[idx] = entry;
        } else {
            existing.push(entry);
        }

        // 上传清单
        const json = JSON.stringify(existing, null, 2);
        const base64 = uint8ToBase64(new TextEncoder().encode(json));
        const res = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: BACKUP_MANIFEST, data: base64 }),
        });
        if (!res.ok) {
            if (isFileUploadUnsupportedStatus(res.status) && mirror?.isAvailable()) {
                await mirror.put(BACKUP_MANIFEST, json, {
                    contentType: 'application/json',
                    encoding: 'utf8',
                    authoritativeFallback: true,
                });
            } else {
                throw new Error(`清单上传失败: ${res.status}`);
            }
        } else if (mirror?.isAvailable()) {
            try { await mirror.delete(BACKUP_MANIFEST); }
            catch (error) { console.debug({ source: import.meta.url, operation: 'cleanupMirror' }, error); }
        }

        // 写后立即重读验证
        const verified = await fetchManifest({ localMirror: mirror });
        if (verified.some(e => e.filename === filename)) return;

        // 最后一次仍失败才抛出
        if (attempt === MAX_RETRIES - 1) {
            throw new Error('清单写入后验证失败，重试已耗尽');
        }
    }
}

// 删除前校验 + POST /api/files/delete + 更新清单
async function deleteServerBackup(filename, serverPath, options = {}) {
    // 安全校验
    if (!/^LWB_VectorBackup_[a-z0-9]+\.zip$/.test(filename)) {
        throw new Error(`非法文件名: ${filename}`);
    }
    const mirror = options.localMirror === undefined ? getLocalFileMirror() : options.localMirror;
    const safePath = buildSafeServerPath(filename, serverPath || null);

    // 物理删除
    const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ path: safePath }),
    });
    if (!res.ok) {
        if (isFileUploadUnsupportedStatus(res.status) && mirror?.isAvailable()) {
            const existed = await mirror.delete(filename);
            const currentManifest = await fetchManifest({ localMirror: mirror });
            if (!existed && !currentManifest.some(e => e.filename === filename)) {
                const err = new Error(`删除失败: ${res.status}`);
                err.status = res.status;
                err.method = 'DELETE';
                throw err;
            }
        } else {
            const err = new Error(`删除失败: ${res.status}`);
            err.status = res.status;
            err.method = 'DELETE';
            throw err;
        }
    } else if (mirror?.isAvailable()) {
        try { await mirror.delete(filename); }
        catch (error) { console.debug({ source: import.meta.url, operation: 'cleanupMirror' }, error); }
    }

    // 更新清单（删除条目）
    try {
        const existing = await fetchManifest({ localMirror: mirror });
        const filtered = existing.filter(e => e.filename !== filename);
        const json = JSON.stringify(filtered, null, 2);
        const base64 = uint8ToBase64(new TextEncoder().encode(json));
        const upRes = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: BACKUP_MANIFEST, data: base64 }),
        });
        if (!upRes.ok) {
            if (isFileUploadUnsupportedStatus(upRes.status) && mirror?.isAvailable()) {
                await mirror.put(BACKUP_MANIFEST, json, {
                    contentType: 'application/json',
                    encoding: 'utf8',
                    authoritativeFallback: true,
                });
            } else {
                throw new Error('zip 已删除，但清单更新失败，请手动刷新');
            }
        } else if (mirror?.isAvailable()) {
            try { await mirror.delete(BACKUP_MANIFEST); }
            catch (error) { console.debug({ source: import.meta.url, operation: 'cleanupMirror' }, error); }
        }
    } catch (e) {
        // zip 删成功但清单更新失败 → 抛"部分成功"错误
        const partialErr = new Error(e.message || 'zip 已删除，清单同步失败');
        partialErr.partial = true;
        throw partialErr;
    }
}

// 集中判断 404/405/501/method not allowed/unsupported
function isDeleteUnsupportedError(err) {
    if (!err) return false;
    const status = err.status;
    if (status === 404 || status === 405 || status === 501) return true;
    const msg = String(err.message || '').toLowerCase();
    return msg.includes('method not allowed') || msg.includes('unsupported') || msg.includes('not found');
}

export { fetchManifest, deleteServerBackup, isDeleteUnsupportedError, getBackupFilename };
