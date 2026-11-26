import {
    createDirectXiaobaiOsBridge,
    type XiaobaiOsDirectBridgeOptions,
    type XiaobaiOsHostFrameBridge,
    type XiaobaiOsHostFrameMessage,
} from './direct-bridge.js';
import type { XiaobaiOsFrameBridge } from '../shell/app-src/frame-bridge.js';
import type { XiaobaiOsAppDescriptor, XiaobaiOsAppRuntimeRouter } from '../types.js';
import type { CapturedChatBinding } from '../kernel/contracts.js';
import { createStorageId } from '../kernel/identity.js';
import type { AppStatus } from '../kernel/execution-scope.js';

const HOST_ID = 'tk-tool-host';

type UnknownRecord = Record<string, unknown>;

export interface XiaobaiOsLifecycleSnapshot {
    theme?: 'light' | 'dark';
}

export type XiaobaiOsSurfaceMount = (
    target: HTMLElement,
    shadowRoot: ShadowRoot,
    bridge: XiaobaiOsFrameBridge,
) => Promise<() => void> | (() => void);

export interface XiaobaiOsLifecycleOptions {
    onSurfaceCreated?: (host: HTMLElement, surface: HTMLElement) => (() => void) | void;
    mountApp?: XiaobaiOsSurfaceMount;
    embeddedMount?: () => HTMLElement | null;
    onEmbeddedClose?: () => void;
    onNavigateKitchen?: (route: string, detail?: UnknownRecord) => void;
    onOpenWideMap?: (payload: UnknownRecord, onSelectPlace: (placeKey: string) => void) => void;
    documentTarget?: Document;
    windowTarget?: Window;
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
    bridgeFactory?: (options: XiaobaiOsDirectBridgeOptions) => XiaobaiOsHostFrameBridge;
    onError?: (error: unknown) => void;
}

export interface XiaobaiOsLifecycle {
    init: () => boolean;
    open: (appId?: string, detail?: UnknownRecord | null) => boolean;
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
 * Manages retained Xiaobai OS tools (Map & API settings) mounted directly in-page inside an Open Shadow DOM surface.
 */
export function createXiaobaiOsLifecycle({
    onSurfaceCreated,
    mountApp,
    embeddedMount,
    onEmbeddedClose,
    onNavigateKitchen,
    onOpenWideMap,
    documentTarget = document,
    windowTarget = window,
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
    bridgeFactory = createDirectXiaobaiOsBridge,
    onError = (error) => console.error('[TavernKitchen] 后厨工作台 运行失败', error),
}: XiaobaiOsLifecycleOptions = {}): XiaobaiOsLifecycle {
    let initialized = false;
    let initialAppId: string | null = null;
    let pendingFocus: { appId: string; detail: UnknownRecord } | null = null;
    let container: HTMLDivElement | null = null;
    let bridge: XiaobaiOsHostFrameBridge | null = null;
    let unmountSurfaceApp: (() => void) | null = null;
    let unbindSurfaceTheme: (() => void) | null = null;
    let unsubscribeChatChanged: (() => void) | null = null;
    let unsubscribeAppDescriptorsChanged: (() => void) | null = null;
    let unsubscribeAppStatusChanged: (() => void) | null = null;
    let listeningThemeEvent = false;
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

    function handleThemeChanged(): void {
        if (!bridge?.isReady()) {
            return;
        }
        const snapshot = getInitSnapshot();
        bridge.post('os/theme-changed', { theme: snapshot?.theme || 'light' });
    }

    function startThemeListener(): void {
        if (listeningThemeEvent) { return; }
        listeningThemeEvent = true;
        documentTarget.addEventListener('kitchen-theme-change', handleThemeChanged);
    }

    function stopThemeListener(): void {
        if (!listeningThemeEvent) { return; }
        listeningThemeEvent = false;
        documentTarget.removeEventListener('kitchen-theme-change', handleThemeChanged);
    }

    async function closeWindow(reason = 'closed'): Promise<void> {
        initialAppId = null;
        pendingFocus = null;
        generation += 1;
        const deactivation = deactivateActiveApp(reason);
        unmountSurfaceApp?.();
        unmountSurfaceApp = null;
        unbindSurfaceTheme?.();
        unbindSurfaceTheme = null;
        bridge?.dispose();
        bridge = null;
        windowOpenPromise = null;
        stopThemeListener();
        if (reason === 'frame-close') { onEmbeddedClose?.(); }
        container?.remove();
        container = null;
        await Promise.all([
            deactivation,
            Promise.resolve().then(() => appRuntime.handleWindowClosed?.(reason)).catch(reportError),
        ]);
    }

    async function handleFrameReady(frameBridge: XiaobaiOsHostFrameBridge, openGeneration: number): Promise<void> {
        try {
            await windowOpenPromise;
        } catch (error) {
            if (openGeneration === generation && frameBridge === bridge) {
                frameBridge.post('os/error', { message: error instanceof Error ? error.message : String(error) });
            }
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
        if (type === 'os/navigate-kitchen') {
            const route = isRecord(payload) && typeof payload.route === 'string' ? payload.route : '';
            const detail = isRecord(payload) && isRecord(payload.detail) ? payload.detail : undefined;
            if (route) { onNavigateKitchen?.(route, detail); }
            return;
        }
        if (type === 'os/open-wide-map') {
            const currentForMap = activeApp;
            if (currentForMap?.appId === 'map' && isRecord(payload)) {
                onOpenWideMap?.(payload, placeKey => {
                    if (openGeneration === generation && frameBridge === bridge && activeApp === currentForMap && bridge.isReady()) {
                        bridge.post('map/focus-place', { placeKey }, '', currentForMap);
                    }
                });
            }
            return;
        }
        if (type === 'os/consume-focus') {
            const currentForFocus = activeApp;
            if (currentForFocus && pendingFocus && pendingFocus.appId === currentForFocus.appId) {
                const detail = pendingFocus.detail;
                pendingFocus = null;
                frameBridge.post(`${currentForFocus.appId}/focus-place`, detail, '', currentForFocus);
            }
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
                if (pendingApp === candidate) { pendingApp = null; }
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
            let result: unknown;
            if (['map', 'world'].includes(messageAppId) && type === messageAppId + '/model-profile') {
                const data = isRecord(payload) ? payload : {};
                if (!['load', 'mutate'].includes(String(data.action))) { throw new Error('未知的模型配置操作'); }
                if (data.action === 'mutate' && (!isRecord(data.mutation) || data.mutation.type !== 'select')) {
                    throw new Error('请在 API 配置页面编辑配置');
                }
                const { handleProfileRequest } = await import('../../text-api/profile-service.js');
                result = await handleProfileRequest({ ...data, feature: 'world' });
            } else {
                result = await appRuntime.handleMessage?.(messageAppId, { type, requestId, payload });
            }
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
        return initialized;
    }

    function open(appId?: string, detail?: UnknownRecord | null): boolean {
        if (!canOpen()) { return false; }
        if (appId && !getAppDescriptors().some(app => app.id === appId)) { return false; }
        // Embedded tools must never fall back to the legacy desktop/modal during startup.
        const mount = embeddedMount?.();
        if (!appId || !mount?.isConnected) { return false; }
        pendingFocus = detail && isRecord(detail) ? { appId, detail } : null;
        initialAppId = appId || null;
        if (container?.isConnected) {
            if (bridge?.isReady()) {
                bridge.post('os/navigate', { appId: initialAppId });
                initialAppId = null;
                if (pendingFocus && activeApp?.appId === appId) {
                    const nextFocus = pendingFocus.detail;
                    pendingFocus = null;
                    bridge.post(`${appId}/focus-place`, nextFocus, '', activeApp);
                }
            }
            return true;
        }
        generation += 1;
        const openGeneration = generation;
        container = documentTarget.createElement('div');
        container.id = HOST_ID;
        container.className = 'tk-embedded-host';
        container.setAttribute('aria-label', '后厨工具');
        const shadow = container.attachShadow({ mode: 'open' });
        const surface = documentTarget.createElement('div');
        surface.className = 'tk-surface tk-embedded tk-follow-host';
        surface.dataset.kitchenTheme = 'host';
        const surfaceBody = documentTarget.createElement('div');
        surfaceBody.className = 'tk-surface-body';
        const appRoot = documentTarget.createElement('div');
        appRoot.className = 'tk-os-app-root';
        surfaceBody.append(appRoot);
        surface.append(surfaceBody);
        shadow.append(surface);
        mount.append(container);
        const stopTheme = onSurfaceCreated?.(container, surface);
        unbindSurfaceTheme = typeof stopTheme === 'function' ? stopTheme : null;
        const nextBridge = bridgeFactory({
            onReady: (frameBridge) => handleFrameReady(frameBridge, openGeneration),
            onMessage: (message, frameBridge) => handleFrameMessage(message, frameBridge, openGeneration),
        });
        bridge = nextBridge;
        windowOpenPromise = Promise.resolve().then(async () => {
            await appRuntime.handleWindowOpened?.();
        });
        track(windowOpenPromise);
        if (mountApp && nextBridge.clientBridge) {
            const clientBridge = nextBridge.clientBridge;
            track(Promise.resolve().then(async () => {
                const cleanupApp = await mountApp(appRoot, shadow, clientBridge);
                if (openGeneration !== generation || bridge !== nextBridge) {
                    cleanupApp?.();
                    return;
                }
                unmountSurfaceApp = cleanupApp;
            }).catch(error => {
                if (openGeneration === generation && bridge === nextBridge) {
                    const errNode = documentTarget.createElement('p');
                    errNode.setAttribute('role', 'alert');
                    errNode.textContent = '后厨工具界面加载失败，请刷新酒馆重试。';
                    appRoot.replaceChildren(errNode);
                }
                reportError(error);
            }));
        }
        startThemeListener();
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
        unsubscribeChatChanged = subscribeChatChanged(handleChatChanged);
        unsubscribeAppDescriptorsChanged = subscribeAppDescriptorsChanged(handleAppDescriptorsChanged);
        unsubscribeAppStatusChanged = subscribeAppStatusChanged(handleAppStatusChanged);
        windowTarget.addEventListener('pagehide', handlePageHide);
        invoke(() => appRuntime.startBackground?.());
        initialized = true;
        return true;
    }

    async function cleanup(): Promise<void> {
        if (!initialized && !container) {
            return;
        }
        generation += 1;
        const cancellation = Promise.resolve().then(() => appRuntime.cancelAll?.('cleanup'));
        const closing = closeWindow('cleanup');
        stopThemeListener();
        const stopping = Promise.resolve().then(() => appRuntime.stopBackground?.());
        unsubscribeChatChanged?.();
        unsubscribeChatChanged = null;
        unsubscribeAppDescriptorsChanged?.();
        unsubscribeAppDescriptorsChanged = null;
        unsubscribeAppStatusChanged?.();
        unsubscribeAppStatusChanged = null;
        windowTarget.removeEventListener('pagehide', handlePageHide);
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
