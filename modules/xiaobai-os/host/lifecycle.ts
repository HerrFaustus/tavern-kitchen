import {
    createXiaobaiOsFrameBridge,
    type XiaobaiOsFrameBridgeOptions,
    type XiaobaiOsHostFrameBridge,
    type XiaobaiOsHostFrameMessage,
} from './frame-bridge.js';
import type { XiaobaiOsAppDescriptor, XiaobaiOsAppRuntimeRouter } from '../types.js';
import type { CapturedChatBinding } from '../kernel/contracts.js';
import { createStorageId } from '../kernel/identity.js';
import type { AppStatus } from '../kernel/execution-scope.js';

const STYLE_ID = 'tavernKitchen-os-host-styles';
const HOST_ID = 'tk-tool-host';
const IFRAME_ID = 'tavernKitchen-os-iframe';

type UnknownRecord = Record<string, unknown>;

export interface XiaobaiOsLifecycleSnapshot {
    theme?: 'light' | 'dark';
}

type XiaobaiOsWindow = Window & {
    MutationObserver?: typeof MutationObserver;
};

export interface XiaobaiOsLifecycleOptions {
    onFrameCreated?: (frame: HTMLIFrameElement) => void;
    embeddedMount?: () => HTMLElement | null;
    onEmbeddedClose?: () => void;
    documentTarget?: Document;
    windowTarget?: XiaobaiOsWindow;
    stylesheetHref?: string;
    frameSrc?: string;
    subscribeChatChanged?: (handler: () => void) => () => void;
    subscribeAppDescriptorsChanged?: (handler: () => void) => () => void;
    subscribeAppStatusChanged?: (handler: (appId: string, status: AppStatus) => void) => () => void;
    getInitSnapshot?: () => XiaobaiOsLifecycleSnapshot | null;
    getAppDescriptors?: () => readonly XiaobaiOsAppDescriptor[];
    getAppStatuses?: () => Readonly<Record<string, AppStatus>>;
    captureChatBinding?: () => CapturedChatBinding | null;
    isChatBindingCurrent?: (captured: CapturedChatBinding) => boolean | Promise<boolean>;
    createActivationToken?: () => string;
    appRuntime?: Partial<XiaobaiOsAppRuntimeRouter>;
    bridgeFactory?: (options: XiaobaiOsFrameBridgeOptions) => XiaobaiOsHostFrameBridge;
    onError?: (error: unknown) => void;
}

export interface XiaobaiOsLifecycle {
    init: () => boolean;
    open: (appId?: string) => boolean;
    closeWindow: (reason?: string) => Promise<void>;
    cleanup: () => Promise<void>;
    isInitialized: () => boolean;
    isOpen: () => boolean;
}

interface ActiveApp {
    appId: string;
    activationToken: string;
    binding: CapturedChatBinding | null;
    generation: number;
}

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Manages the retained tools inside the shared Kitchen workspace.
 *
 */
export function createXiaobaiOsLifecycle({
    onFrameCreated,
    embeddedMount,
    onEmbeddedClose,
    documentTarget = document,
    windowTarget = window as XiaobaiOsWindow,
    stylesheetHref,
    frameSrc,
    subscribeChatChanged = () => () => {},
    subscribeAppDescriptorsChanged = () => () => {},
    subscribeAppStatusChanged = () => () => {},
    getInitSnapshot = () => ({}),
    getAppDescriptors = () => [],
    getAppStatuses = () => ({}),
    captureChatBinding = () => null,
    isChatBindingCurrent = () => true,
    createActivationToken = createStorageId,
    appRuntime = {},
    bridgeFactory = createXiaobaiOsFrameBridge,
    onError = (error) => console.error('[TavernKitchen] 后厨工作台 运行失败', error),
}: XiaobaiOsLifecycleOptions = {}): XiaobaiOsLifecycle {
    if (!stylesheetHref || !frameSrc) {
        throw new TypeError('xiaobai OS lifecycle requires stylesheetHref and frameSrc');
    }
    const resolvedStylesheetHref = stylesheetHref;
    const resolvedFrameSrc = frameSrc;

    let initialized = false;
    let initialAppId: string | null = null;
    let container: HTMLDivElement | null = null;
    let iframe: HTMLIFrameElement | null = null;
    let bridge: XiaobaiOsHostFrameBridge | null = null;
    let unsubscribeChatChanged: (() => void) | null = null;
    let unsubscribeAppDescriptorsChanged: (() => void) | null = null;
    let unsubscribeAppStatusChanged: (() => void) | null = null;
    let themeObserver: MutationObserver | null = null;
    let activeApp: ActiveApp | null = null;
    let pendingApp: ActiveApp | null = null;
    let windowOpenPromise: Promise<void> | null = null;
    let generation = 0;
    let appActivationGeneration = 0;
    const pendingOperations = new Set<Promise<unknown>>();

    function sameBinding(left: CapturedChatBinding, right: CapturedChatBinding | null): boolean {
        return !!right
            && left.identityKey === right.identityKey
            && left.binding.kind === right.binding.kind
            && left.binding.ownerLocator === right.binding.ownerLocator
            && left.binding.chatId === right.binding.chatId
            && (!left.reference || left.reference.osId === right.reference?.osId);
    }

    function isLocallyCurrent(app: ActiveApp): boolean {
        const current = captureChatBinding();
        if (app.generation !== appActivationGeneration) { return false; }
        if (!app.binding) { return !current; }
        if (!sameBinding(app.binding, current)) { return false; }
        if (!app.binding.reference && current?.reference) { app.binding = current; }
        return true;
    }

    async function isAppBindingCurrent(app: ActiveApp): Promise<boolean> {
        return app.binding ? await isChatBindingCurrent(app.binding) : !captureChatBinding();
    }

    function reportError(error: unknown): void {
        try {
            onError(error);
        } catch (reportingError) {
            console.error('[TavernKitchen] 后厨工作台 生命周期错误处理失败', { error, reportingError });
        }
    }

    function track(operation: void | Promise<void>): void {
        const promise = Promise.resolve(operation).finally(() => {
            pendingOperations.delete(promise);
        }).catch(reportError);
        pendingOperations.add(promise);
    }

    function invoke(operation: () => void | Promise<void>): void {
        try {
            track(operation());
        } catch (error) {
            reportError(error);
        }
    }

    function appDescriptorsWithStatus(): readonly (XiaobaiOsAppDescriptor & { status: AppStatus })[] {
        const statuses = getAppStatuses();
        return getAppDescriptors().map(descriptor => ({
            ...descriptor,
            status: statuses[descriptor.id] ?? { state: 'loading', phase: 'install' },
        }));
    }

    function addStylesheet(): HTMLLinkElement {
        let stylesheet = documentTarget.getElementById(STYLE_ID) as HTMLLinkElement | null;
        if (stylesheet) {
            return stylesheet;
        }
        stylesheet = documentTarget.createElement('link');
        stylesheet.id = STYLE_ID;
        stylesheet.rel = 'stylesheet';
        stylesheet.href = resolvedStylesheetHref;
        documentTarget.head.append(stylesheet);
        return stylesheet;
    }

    async function deactivateActiveApp(reason: string): Promise<void> {
        appActivationGeneration += 1;
        pendingApp = null;
        if (!activeApp) {
            try {
                await appRuntime.cancelForeground?.(reason);
            } catch (error) {
                reportError(error);
            }
            return;
        }
        const { appId } = activeApp;
        activeApp = null;
        try {
            await appRuntime.deactivate?.(appId, reason);
        } catch (error) {
            reportError(error);
        }
    }

    function handleAppDescriptorsChanged(): void {
        const apps = getAppDescriptors();
        const availableIds = new Set(apps.map(app => app.id));
        if (
            (activeApp && !availableIds.has(activeApp.appId))
            || (pendingApp && !availableIds.has(pendingApp.appId))
        ) {
            invoke(() => deactivateActiveApp('app-disabled'));
        }
        if (bridge?.isReady()) {
            bridge.post('os/apps-changed', { apps: appDescriptorsWithStatus() });
        }
    }

    function handleAppStatusChanged(appId: string, status: AppStatus): void {
        if (status.state === 'failed' && activeApp?.appId === appId) {
            invoke(() => deactivateActiveApp('app-failed'));
        }
        if (bridge?.isReady()) { bridge.post('os/app-state', { appId, status }); }
    }

    async function closeWindow(reason = 'closed'): Promise<void> {
        initialAppId = null;
        generation += 1;
        const deactivation = deactivateActiveApp(reason);
        bridge?.dispose();
        bridge = null;
        windowOpenPromise = null;
        stopThemeObserver();
        if (reason === 'frame-close') { onEmbeddedClose?.(); }
        container?.remove();
        container = null;
        iframe = null;
        await Promise.all([
            deactivation,
            Promise.resolve().then(() => appRuntime.handleWindowClosed?.(reason)).catch(reportError),
        ]);
    }

    function handleThemeChanged(): void {
        if (!bridge?.isReady()) {
            return;
        }
        const snapshot = getInitSnapshot();
        bridge.post('os/theme-changed', { theme: snapshot?.theme || 'light' });
    }

    function startThemeObserver(): void {
        if (themeObserver || typeof windowTarget.MutationObserver !== 'function') {
            return;
        }
        themeObserver = new windowTarget.MutationObserver(handleThemeChanged);
        const options = { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] };
        if (documentTarget.documentElement) {
            themeObserver.observe(documentTarget.documentElement, options);
        }
        if (documentTarget.body) {
            themeObserver.observe(documentTarget.body, options);
        }
    }

    function stopThemeObserver(): void {
        themeObserver?.disconnect();
        themeObserver = null;
    }

    async function handleFrameReady(frameBridge: XiaobaiOsHostFrameBridge, openGeneration: number): Promise<void> {
        try {
            await windowOpenPromise;
        } catch (error) {
            if (openGeneration === generation && frameBridge === bridge) {
                frameBridge.post('os/error', { message: error instanceof Error ? error.message : String(error) });
            }
            // The tracked window-open operation owns error reporting. This waiter
            // only keeps a failed refresh from publishing a stale init snapshot.
            return;
        }
        try {
            const snapshot = await getInitSnapshot();
            if (openGeneration !== generation || frameBridge !== bridge) {
                return;
            }
            frameBridge.post('os/init', {
                ...snapshot,
                apps: appDescriptorsWithStatus(),
                initialAppId,
            });
            initialAppId = null;
        } catch (error) {
            if (openGeneration === generation && frameBridge === bridge) {
                frameBridge.post('os/error', { message: error instanceof Error ? error.message : String(error) });
            }
            reportError(error);
        }
    }

    async function handleFrameMessage(
        message: XiaobaiOsHostFrameMessage,
        frameBridge: XiaobaiOsHostFrameBridge,
        openGeneration: number,
    ): Promise<void> {
        if (openGeneration !== generation || frameBridge !== bridge) {
            return;
        }
        const { type, requestId = '', payload = {} } = message;
        if (type === 'os/close') {
            if (onEmbeddedClose) { onEmbeddedClose(); return; }
            await closeWindow('frame-close');
            return;
        }
        if (type === 'app/deactivate') {
            if (
                activeApp
                && (message.appId !== activeApp.appId || message.activationToken !== activeApp.activationToken)
            ) {
                frameBridge.post('app/deactivated', { ok: false, error: 'app_inactive' }, requestId);
                return;
            }
            await deactivateActiveApp('route-left');
            frameBridge.post('app/deactivated', { ok: true }, requestId);
            return;
        }
        if (type === 'os/app-ui-failure') {
            const current = activeApp;
            if (
                current
                && message.appId === current.appId
                && message.activationToken === current.activationToken
            ) {
                reportError(Object.assign(new Error(`APP ${current.appId} UI failed`), {
                    appId: current.appId,
                    phase: isRecord(payload) ? payload.phase : 'ui-render',
                }));
            }
            return;
        }
        if (type === 'app/retry') {
            const appId = String(isRecord(payload) ? payload.appId || '' : '');
            if (!getAppDescriptors().some(app => app.id === appId) || !appRuntime.retry) {
                frameBridge.post('app/retry-result', { ok: false, error: 'app_unavailable' }, requestId);
                return;
            }
            try {
                await appRuntime.retry(appId);
                frameBridge.post('app/retry-result', { ok: true, appId }, requestId);
            } catch (error) {
                frameBridge.post('app/retry-result', {
                    ok: false,
                    error: isRecord(error) && typeof error.code === 'string' ? error.code : 'app_retry_failed',
                    message: error instanceof Error ? error.message : String(error),
                }, requestId);
            }
            return;
        }
        if (type === 'app/activate') {
            const appId = String(isRecord(payload) ? payload.appId || '' : '');
            const descriptor = getAppDescriptors().find((app) => app.id === appId);
            if (!descriptor) {
                frameBridge.post('app/activation-result', { ok: false, error: 'app_unavailable' }, requestId);
                return;
            }
            const deactivation = deactivateActiveApp('app-switch');
            const activationGeneration = ++appActivationGeneration;
            await deactivation;
            if (activationGeneration !== appActivationGeneration) {
                frameBridge.post('app/activation-result', { ok: false, error: 'activation_cancelled' }, requestId);
                return;
            }
            const binding = captureChatBinding();
            const candidate: ActiveApp = {
                appId,
                activationToken: createActivationToken(),
                binding,
                generation: activationGeneration,
            };
            pendingApp = candidate;
            try {
                const state = await appRuntime.activate?.(appId, {
                    activationToken: candidate.activationToken,
                    isCurrent: () => isLocallyCurrent(candidate)
                        && (pendingApp === candidate || activeApp === candidate),
                    post: (messageType: string, messagePayload: unknown = {}, responseId = '') =>
                        isLocallyCurrent(candidate) && (pendingApp === candidate || activeApp === candidate)
                            ? frameBridge.post(messageType, messagePayload, responseId, candidate)
                            : false,
                });
                const currentStatus = getAppStatuses()[appId];
                if (currentStatus?.state === 'failed') {
                    throw Object.assign(new Error(currentStatus.failure.message), currentStatus.failure);
                }
                if (
                    openGeneration !== generation ||
                    frameBridge !== bridge ||
                    pendingApp !== candidate ||
                    !isLocallyCurrent(candidate) ||
                    !await isAppBindingCurrent(candidate)
                ) {
                    if (
                        openGeneration === generation &&
                        frameBridge === bridge &&
                        appActivationGeneration === activationGeneration + 1
                    ) {
                        invoke(() => appRuntime.cancelForeground?.('activation-cancelled'));
                    }
                    frameBridge.post(
                        'app/activation-result',
                        { ok: false, error: 'activation_cancelled' },
                        requestId,
                    );
                    return;
                }
                pendingApp = null;
                activeApp = candidate;
                frameBridge.post('app/activation-result', {
                    ok: true,
                    appId,
                    activationToken: candidate.activationToken,
                    state: state ?? null,
                }, requestId);
            } catch (error) {
                if (pendingApp === candidate) {pendingApp = null;}
                const cancelled = openGeneration !== generation
                    || frameBridge !== bridge
                    || !isLocallyCurrent(candidate);
                const requiresAppRetry = getAppStatuses()[appId]?.state === 'failed';
                if (!cancelled) { reportError(error); }
                frameBridge.post(
                    'app/activation-result',
                    {
                        ok: false,
                        error: cancelled
                            ? 'activation_cancelled'
                            : isRecord(error) && typeof error.code === 'string'
                            ? error.code
                            : 'app_activation_failed',
                        ...(!cancelled ? {
                            message: error instanceof Error ? error.message : String(error),
                            phase: isRecord(error) && typeof error.phase === 'string' ? error.phase : 'activate',
                            retryable: !isRecord(error) || error.retryable !== false,
                            ...(requiresAppRetry ? { requiresAppRetry: true } : {}),
                        } : {}),
                    },
                    requestId,
                );
            }
            return;
        }
        const current = activeApp;
        if (
            !current
            || message.appId !== current.appId
            || message.activationToken !== current.activationToken
            || !type.startsWith(`${current.appId}/`)
            || !isLocallyCurrent(current)
            || !await isAppBindingCurrent(current)
        ) {
            if (requestId) { frameBridge.post('app/result', { ok: false, error: 'app_inactive' }, requestId); }
            return;
        }
        const messageAppId = current.appId;
        const messageActivationGeneration = current.generation;
        const isMessageActivationCurrent = () =>
            activeApp === current
            && appActivationGeneration === messageActivationGeneration
            && isLocallyCurrent(current);
        try {
            const result = await appRuntime.handleMessage?.(messageAppId, { type, requestId, payload });
            if (requestId && openGeneration === generation && frameBridge === bridge) {
                if (!isMessageActivationCurrent() || !await isAppBindingCurrent(current)) {
                    frameBridge.post(`${messageAppId}/result`, { ok: false, error: 'app_inactive' }, requestId, current);
                } else if (result !== undefined) {
                    frameBridge.post(`${messageAppId}/result`, { ok: true, result }, requestId, current);
                }
            }
        } catch (error) {
            reportError(error);
            if (requestId && openGeneration === generation && frameBridge === bridge) {
                frameBridge.post(
                    `${messageAppId}/result`,
                    {
                        ok: false,
                        error: isMessageActivationCurrent()
                            ? isRecord(error) && typeof error.code === 'string'
                                ? error.code
                                : 'app_request_failed'
                            : 'app_inactive',
                        ...(isMessageActivationCurrent() ? {
                            message: error instanceof Error ? error.message : String(error),
                        } : {}),
                    },
                    requestId,
                    current,
                );
            }
        }
    }

    function canOpen(): boolean {
        if (!initialized) {
            return false;
        }
        return true;
    }

    function open(appId?: string): boolean {
        if (!canOpen()) { return false; }
        if (appId && !getAppDescriptors().some(app => app.id === appId)) { return false; }
        // Embedded tools must never fall back to the legacy desktop/modal during startup.
        const mount = embeddedMount?.();
        if (!appId || !mount?.isConnected) { return false; }
        initialAppId = appId || null;
        if (container?.isConnected) {
            if (bridge?.isReady()) {
                bridge.post('os/navigate', { appId: initialAppId });
                initialAppId = null;
            }
            iframe?.focus();
            return true;
        }
        generation += 1;
        const openGeneration = generation;
        container = documentTarget.createElement('div');
        container.id = HOST_ID;
        container.className = 'tk-embedded-host';
        container.setAttribute('aria-label', '后厨工具');
        iframe = documentTarget.createElement('iframe');
        iframe.id = IFRAME_ID;
        iframe.className = 'tavernKitchen-os-frame';
        onFrameCreated?.(iframe);
        iframe.src = resolvedFrameSrc;
        iframe.title = '后厨工作台';
        iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
        container.append(iframe);
        mount.append(container);
        bridge = bridgeFactory({
            iframe,
            windowTarget,
            onReady: (frameBridge) => handleFrameReady(frameBridge, openGeneration),
            onMessage: (message, frameBridge) => handleFrameMessage(message, frameBridge, openGeneration),
        });
        windowOpenPromise = Promise.resolve().then(async () => {
            await appRuntime.handleWindowOpened?.();
        });
        track(windowOpenPromise);
        startThemeObserver();
        return true;
    }

    function handleChatChanged(): void {
        invoke(async () => {
            await appRuntime.cancelAll?.('chat-changed');
            await closeWindow('chat-changed');
            await appRuntime.handleChatChanged?.();
        });
    }

    function handlePageHide(event: PageTransitionEvent): void {
        if (event.persisted) {
            return;
        }
        cleanup().catch(reportError);
    }

    function init(): boolean {
        if (initialized) {
            return true;
        }
        addStylesheet();
        unsubscribeChatChanged = subscribeChatChanged(handleChatChanged);
        unsubscribeAppDescriptorsChanged = subscribeAppDescriptorsChanged(handleAppDescriptorsChanged);
        unsubscribeAppStatusChanged = subscribeAppStatusChanged(handleAppStatusChanged);
        windowTarget.addEventListener('pagehide', handlePageHide);
        invoke(() => appRuntime.startBackground?.());
        initialized = true;
        return true;
    }

    async function cleanup(): Promise<void> {
        if (!initialized && !container && !documentTarget.getElementById(STYLE_ID)) {
            return;
        }
        generation += 1;
        const cancellation = Promise.resolve().then(() => appRuntime.cancelAll?.('cleanup'));
        const closing = closeWindow('cleanup');
        stopThemeObserver();
        const stopping = Promise.resolve().then(() => appRuntime.stopBackground?.());
        unsubscribeChatChanged?.();
        unsubscribeChatChanged = null;
        unsubscribeAppDescriptorsChanged?.();
        unsubscribeAppDescriptorsChanged = null;
        unsubscribeAppStatusChanged?.();
        unsubscribeAppStatusChanged = null;
        windowTarget.removeEventListener('pagehide', handlePageHide);
        documentTarget.getElementById(STYLE_ID)?.remove();
        initialized = false;
        await Promise.all([cancellation, closing, stopping, ...pendingOperations].map(operation => operation.catch(reportError)));
    }

    return Object.freeze({
        init,
        open,
        closeWindow,
        cleanup,
        isInitialized: () => initialized,
        isOpen: () => !!container?.isConnected,
    });
}
