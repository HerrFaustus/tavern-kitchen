import { EXT_ID } from '../../../core/constants.js';
import { sameMemory } from '../maintenance/domain.js';
import { runWithAbortDeadline, throwIfSignalAborted, waitForAbortableDelay } from '../../../shared/common/abort-utils.js';
import { isFileUploadUnsupportedStatus } from '../../../shared/common/local-file-mirror.js';

export const METADATA_CONFIRMATION_TIMEOUT_MS = 60_000;
const LARGE_CHAT_CONFIRMATION_TIMEOUT_MS = 8000;
const READ_RETRY_DELAY_MS = 2000;
const READ_RETRY_MAX_DELAY_MS = 10_000;

export class MetadataConfirmationError extends Error {
    constructor(code, uncertain = false, cause) {
        super(code, { cause });
        this.code = code;
        this.uncertain = uncertain;
    }
}

/** SillyTavern's saveMetadata can swallow a failed save. Read only the captured chat target. */
export function createMetadataConfirmation(context, headers, fetcher = fetch) {
    const character = context.characters?.[context.characterId];
    const group = context.groupId != null;
    const endpoint = group ? '/api/chats/group/get' : '/api/chats/get';
    const body = group ? { id: context.chatId } : {
        ch_name: character?.name, file_name: character?.chat, avatar_url: character?.avatar,
    };
    if (!context.chatId || (!group && (!body.file_name || !body.avatar_url))) {
        throw new MetadataConfirmationError('metadata_target_unavailable');
    }
    return async function confirm(
        expected,
        previous = null,
        loadedPrevious = null,
        {
            timeoutMs = METADATA_CONFIRMATION_TIMEOUT_MS,
            savePending = () => false,
            normalize = value => value,
            allowSettledDegrade = () => false,
            isLargeChat = false,
        } = {},
    ) {
        let lastError;
        const canDegrade = () => Boolean(allowSettledDegrade());
        const effectiveTimeoutMs = isLargeChat && canDegrade()
            ? Math.min(timeoutMs, LARGE_CHAT_CONFIRMATION_TIMEOUT_MS)
            : timeoutMs;
        const readBack = async signal => {
            let delay = READ_RETRY_DELAY_MS;
            for (;;) {
                throwIfSignalAborted(signal);
                try {
                    lastError = undefined;
                    const response = await fetcher(endpoint, { method: 'POST', headers: headers(), cache: 'no-store', body: JSON.stringify(body), signal });
                    throwIfSignalAborted(signal);
                    if (!response.ok) {
                        // WHY: Hosts such as TauriTavern may not implement /api/chats/(group/)get.
                        // Only degrade once context.saveMetadata() settled without error; never mask a failed save.
                        if (isFileUploadUnsupportedStatus(response.status) && canDegrade()) {
                            console.warn(`[TavernKitchen] 宿主不支持 ${endpoint} (${response.status})，saveMetadata 已完成，跳过回读确认。`);
                            return structuredClone(expected);
                        }
                        throw Object.assign(new Error('metadata_read_http'), { code: 'metadata_read_http', status: response.status });
                    }
                    const data = await response.json();
                    throwIfSignalAborted(signal);
                    if (!Array.isArray(data) || !data[0]?.chat_metadata) throw Object.assign(new Error('metadata_read_invalid'), { code: 'metadata_read_invalid' });
                    const extension = data[0].chat_metadata.extensions?.[EXT_ID] || {};
                    const persisted = Object.fromEntries(Object.keys(expected).map(key => [key, extension[key]]));
                    const actual = normalize(persisted);
                    const matches = projection => projection && Object.entries(normalize(projection)).every(([key, value]) => sameMemory(actual[key], value));
                    if (matches(expected)) return persisted;
                    if (matches(previous) || matches(loadedPrevious)) {
                        if (!savePending()) throw new MetadataConfirmationError('metadata_not_saved');
                        throw Object.assign(new Error('metadata_save_pending'), { code: 'metadata_save_pending' });
                    }
                    throw new MetadataConfirmationError('metadata_save_conflict', true);
                } catch (error) {
                    if (signal.aborted) throw error;
                    lastError = error;
                    if (isLargeChat && canDegrade()) {
                        if (error instanceof MetadataConfirmationError) throw error;
                        console.warn(`[TavernKitchen] 大对话回读确认失败（saveMetadata 已完成且未报错），已降级放行: ${error?.message || error}`);
                        return structuredClone(expected);
                    }
                }
                // One read at a time. Backoff bounds full-chat transfers on a weak connection.
                await waitForAbortableDelay(delay, signal);
                delay = Math.min(READ_RETRY_MAX_DELAY_MS, delay * 2);
            }
        };
        try { return await runWithAbortDeadline(readBack, { timeoutMs: effectiveTimeoutMs }); }
        catch (error) {
            if (lastError instanceof MetadataConfirmationError) throw lastError;
            if (error instanceof MetadataConfirmationError) throw error;
            if (isLargeChat && canDegrade()) {
                console.warn(`[TavernKitchen] 大对话回读确认超时（saveMetadata 已完成且未报错），已降级放行: ${lastError?.message || error?.message || error}`);
                return structuredClone(expected);
            }
            throw new MetadataConfirmationError('metadata_save_unconfirmed', true, lastError || error);
        }
    };
}
