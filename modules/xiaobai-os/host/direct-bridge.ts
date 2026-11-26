import {
    createFrameBridge,
    XIAOBAI_OS_FRAME_SOURCE,
    type FrameMessage,
    type XiaobaiOsFrameBridge,
} from '../shell/app-src/frame-bridge.js';

export { XIAOBAI_OS_FRAME_SOURCE };

export interface XiaobaiOsHostFrameMessage {
    type: string;
    requestId?: string;
    appId?: string;
    activationToken?: string;
    payload?: unknown;
}

export interface XiaobaiOsFrameAppContext {
    appId: string;
    activationToken: string;
}

export interface XiaobaiOsHostFrameBridge {
    post: (
        type: string,
        payload?: unknown,
        requestId?: string,
        app?: XiaobaiOsFrameAppContext,
    ) => boolean;
    isReady: () => boolean;
    dispose: () => void;
    clientBridge?: XiaobaiOsFrameBridge;
}

export interface XiaobaiOsDirectBridgeOptions {
    onReady?: (bridge: XiaobaiOsHostFrameBridge) => void | Promise<void>;
    onMessage?: (message: XiaobaiOsHostFrameMessage, bridge: XiaobaiOsHostFrameBridge) => void | Promise<void>;
}

function createMessageId(): string {
    return `xiaobai-os-host-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Creates a paired in-memory host/client bridge for Xiaobai OS surfaces mounted directly in-page.
 * Preserves the exact readiness gating, activation token isolation and error handling of the
 * former iframe channel without cross-window postMessage serialization.
 */
export function createDirectXiaobaiOsBridge({
    onReady,
    onMessage,
}: XiaobaiOsDirectBridgeOptions = {}): XiaobaiOsHostFrameBridge {
    let ready = false;
    let disposed = false;
    const clientListeners = new Set<(message: FrameMessage) => void>();

    async function handleClientMessage(message: FrameMessage): Promise<void> {
        if (disposed || message?.source !== XIAOBAI_OS_FRAME_SOURCE || typeof message.type !== 'string') {
            return;
        }
        if (message.type === 'os/frame-ready') {
            ready = true;
            await onReady?.(hostBridge);
            return;
        }
        if (!ready) {
            return;
        }
        await onMessage?.(message, hostBridge);
    }

    const clientBridge = createFrameBridge({
        sendToHost(message: FrameMessage) {
            if (disposed) {
                return;
            }
            queueMicrotask(() => {
                if (disposed) {
                    return;
                }
                handleClientMessage(message).catch(error => {
                    console.error('[TavernKitchen] 后厨工作台 消息桥回调失败', error);
                });
            });
        },
        subscribeFromHost(listener) {
            clientListeners.add(listener);
            return () => {
                clientListeners.delete(listener);
            };
        },
    });

    function dispose(): void {
        if (disposed) {
            return;
        }
        disposed = true;
        ready = false;
        clientListeners.clear();
        clientBridge.dispose();
    }

    const hostBridge: XiaobaiOsHostFrameBridge = Object.freeze({
        post(type: string, payload: unknown = {}, requestId = '', app?: XiaobaiOsFrameAppContext) {
            if (disposed || !ready || typeof type !== 'string' || !type) {
                return false;
            }
            const envelope: FrameMessage = {
                source: XIAOBAI_OS_FRAME_SOURCE,
                type,
                requestId: String(requestId || (app ? createMessageId() : '')),
                ...(app ? { appId: app.appId, activationToken: app.activationToken } : {}),
                payload,
            };
            queueMicrotask(() => {
                if (disposed) {
                    return;
                }
                for (const listener of clientListeners) {
                    listener(envelope);
                }
            });
            return true;
        },
        isReady() {
            return ready && !disposed;
        },
        dispose,
        clientBridge,
    });

    return hostBridge;
}
