export const XIAOBAI_OS_FRAME_SOURCE = 'TavernKitchen-XiaobaiOS';

export interface FrameMessage<T = unknown> {
    source: typeof XIAOBAI_OS_FRAME_SOURCE;
    type: string;
    requestId?: string;
    appId?: string;
    activationToken?: string;
    payload?: T;
}

export interface FrameAppSession {
    appId: string;
    activationToken: string;
}

export class FrameRequestError extends Error {
    constructor(readonly code: 'host_request_not_sent' | 'host_request_timeout', options?: ErrorOptions) {
        super(code, options);
        this.name = 'FrameRequestError';
    }
}

export class HostRequestError extends Error {
    readonly code: string;
    readonly phase: string;
    readonly retryable: boolean;
    readonly requiresAppRetry: boolean;

    constructor(payload: {
        error?: string;
        message?: string;
        phase?: string;
        retryable?: boolean;
        requiresAppRetry?: boolean;
    }) {
        super(payload.message || payload.error || 'host_request_failed');
        this.name = 'HostRequestError';
        this.code = payload.error || 'host_request_failed';
        this.phase = payload.phase || 'host';
        this.retryable = payload.retryable !== false;
        this.requiresAppRetry = payload.requiresAppRetry === true;
    }
}

interface PendingRequest {
    resolve: (payload: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    session: FrameAppSession | null;
}

export interface DirectClientTransport {
    sendToHost: (message: FrameMessage) => void;
    subscribeFromHost: (listener: (message: FrameMessage) => void) => () => void;
}

function createRequestId(): string {
    return `xiaobai-os-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * In-process client bridge for Xiaobai OS apps mounted directly inside the host workspace Shadow DOM.
 */
export function createFrameBridge(transport: DirectClientTransport) {
    const pending = new Map<string, PendingRequest>();
    const subscribers = new Set<(message: FrameMessage) => void>();
    let unsubscribeTransport: (() => void) | null = null;
    let listening = false;
    let appSession: FrameAppSession | null = null;

    function post(type: string, payload: unknown = {}, requestId = ''): void {
        const includeSession = appSession
            && type !== 'app/activate'
            && type !== 'app/retry'
            && type !== 'os/frame-ready'
            && type !== 'os/close';
        const outgoingRequestId = includeSession && !requestId ? createRequestId() : requestId;
        transport.sendToHost({
            source: XIAOBAI_OS_FRAME_SOURCE,
            type,
            requestId: outgoingRequestId,
            ...(includeSession ? appSession : {}),
            payload,
        });
    }

    function settle(message: FrameMessage): boolean {
        const requestId = String(message.requestId || '');
        if (!requestId) {
            return false;
        }
        const request = pending.get(requestId);
        if (!request) {
            return false;
        }
        if (
            request.session
            && (message.appId !== request.session.appId || message.activationToken !== request.session.activationToken)
        ) {
            return false;
        }
        pending.delete(requestId);
        clearTimeout(request.timer);
        const payload = message.payload as {
            ok?: boolean;
            error?: string;
            message?: string;
            phase?: string;
            retryable?: boolean;
            requiresAppRetry?: boolean;
        } | undefined;
        if (payload?.ok === false) {
            request.reject(new HostRequestError(payload));
        } else {
            request.resolve(payload);
        }
        return true;
    }

    function handleIncoming(message: FrameMessage): void {
        if (message?.source !== XIAOBAI_OS_FRAME_SOURCE || typeof message.type !== 'string') {
            return;
        }
        if (settle(message)) {
            return;
        }
        subscribers.forEach(subscriber => subscriber(message));
    }

    function start(): void {
        if (listening) {
            return;
        }
        listening = true;
        unsubscribeTransport = transport.subscribeFromHost(handleIncoming);
        queueMicrotask(() => {
            if (listening) {
                post('os/frame-ready');
            }
        });
    }

    function request(type: string, payload: unknown = {}, timeoutMs = 15_000): Promise<unknown> {
        const requestId = createRequestId();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(requestId);
                reject(new FrameRequestError('host_request_timeout'));
            }, timeoutMs);
            pending.set(requestId, { resolve, reject, timer, session: appSession ? { ...appSession } : null });
            try {
                post(type, payload, requestId);
            } catch (cause) {
                pending.delete(requestId);
                clearTimeout(timer);
                reject(new FrameRequestError('host_request_not_sent', { cause }));
            }
        });
    }

    function setAppSession(session: FrameAppSession): void {
        appSession = Object.freeze({ ...session });
    }

    function clearAppSession(): void {
        const previous = appSession;
        appSession = null;
        if (!previous) { return; }
        for (const [requestId, request] of pending) {
            if (request.session?.activationToken !== previous.activationToken) { continue; }
            clearTimeout(request.timer);
            request.reject(new Error('app_inactive'));
            pending.delete(requestId);
        }
    }

    function getAppSession(): FrameAppSession | null {
        return appSession ? { ...appSession } : null;
    }

    function subscribe(subscriber: (message: FrameMessage) => void): () => void {
        subscribers.add(subscriber);
        return () => subscribers.delete(subscriber);
    }

    function dispose(): void {
        unsubscribeTransport?.();
        unsubscribeTransport = null;
        listening = false;
        subscribers.clear();
        pending.forEach(request => {
            clearTimeout(request.timer);
            request.reject(new Error('frame_bridge_disposed'));
        });
        pending.clear();
        appSession = null;
    }

    return Object.freeze({
        start,
        post,
        request,
        subscribe,
        setAppSession,
        clearAppSession,
        getAppSession,
        dispose,
    });
}

export type XiaobaiOsFrameBridge = ReturnType<typeof createFrameBridge>;
