import { buildMapPromptBlock } from '../../../domains/map/projection.js';
import type { MapDomainV1 } from '../../../domains/map/types.js';
import type { XiaobaiOsAppRuntime } from '../../../types.js';

export interface MapPromptEventHandlers {
    readonly generationStarted: () => void;
    readonly intercept: (chat?: unknown, generationType?: string) => void;
    readonly requestBuilt: () => void;
    readonly generationEnded: () => void;
    readonly generationStopped: () => void;
}

export interface MapPromptRuntimeDependencies {
    readonly readCurrentMap: () => MapDomainV1 | null;
    readonly setPrompt: (value: string) => void;
    readonly subscribe: (handlers: MapPromptEventHandlers) => () => void;
    readonly onError?: (error: unknown) => void;
}

export type MapPromptRuntime = Pick<
    XiaobaiOsAppRuntime,
    'startBackground' | 'stopBackground' | 'handleChatChanged' | 'cancelAll'
>;

// The interceptor receives the actual host chat for this request, including swipe/regeneration edits.
function turnText(chat: unknown, type: string): string {
    if (!Array.isArray(chat)) { return ''; }
    const messages = chat.filter(message => message && !message.is_system && typeof message.mes === 'string');
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].is_user) {
            return type === 'continue' ? messages.slice(i).map(message => message.mes).join('\n') : messages[i].mes;
        }
    }
    return type === 'continue' ? messages.at(-1)?.mes ?? '' : '';
}

export function createMapPromptRuntime({
    readCurrentMap,
    setPrompt,
    subscribe,
    onError = error => console.error('[TavernKitchen] Map prompt runtime failed', error),
}: MapPromptRuntimeDependencies): MapPromptRuntime {
    let unsubscribe: (() => void) | null = null;

    function clearPrompt(): void {
        setPrompt('');
    }

    function intercept(chat?: unknown, generationType = 'normal'): void {
        clearPrompt();
        try {
            const map = readCurrentMap();
            if (!map) {return;}
            const prompt = buildMapPromptBlock(map, turnText(chat, generationType));
            if (prompt) {setPrompt(prompt);}
        } catch (error) {
            clearPrompt();
            onError(error);
        }
    }

    function startBackground(): void {
        if (!unsubscribe) {
            unsubscribe = subscribe({
                generationStarted: clearPrompt,
                intercept,
                requestBuilt: clearPrompt,
                generationEnded: clearPrompt,
                generationStopped: clearPrompt,
            });
        }
    }

    function stopBackground(): void {
        unsubscribe?.();
        unsubscribe = null;
        clearPrompt();
    }

    return Object.freeze({
        startBackground,
        stopBackground,
        handleChatChanged: clearPrompt,
        cancelAll: clearPrompt,
    });
}
