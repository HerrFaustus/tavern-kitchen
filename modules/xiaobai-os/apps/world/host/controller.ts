import type { MaintenanceRunner } from '../../../capabilities/maintenance/runner.js';
import type { XiaobaiOsAppActivationContext, XiaobaiOsAppRuntime } from '../../../types.js';
import type { WorldService } from '../application/service.js';
import type { WorldClientState } from '../types.js';
import { createEmptyWorld } from '../../../domains/world/types.js';
import { worldStatusMessage } from './status.js';
import type { XiaobaiOsSettingsRepository } from '../../../host/settings-repository.js';

interface Dependencies {
    world: WorldService;
    settings: Pick<XiaobaiOsSettingsRepository, 'read' | 'subscribe' | 'setWorldPreference'>;
    maintenance: Pick<MaintenanceRunner, 'startRebuild' | 'cancelRequested' | 'invalidateAutomatic' | 'getStatus' | 'subscribeStatus'>;
    getChatIdentity(): string;
    checkAgent?: () => Promise<boolean>;
}

export function createWorldController({ world, settings, maintenance, getChatIdentity }: Dependencies): XiaobaiOsAppRuntime {
    let activation: { chatIdentity: string; context: XiaobaiOsAppActivationContext; busy: boolean } | null = null;
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeStatus: (() => void) | undefined;
    let unsubscribeSettings: (() => void) | undefined;
    function state(): WorldClientState {
        const chatIdentity = getChatIdentity();
        if (!chatIdentity) {
            return { chatIdentity: '', world: createEmptyWorld(), settings: settings.read()!.apps.world,
                writeState: 'ready', pendingSave: false, maintenance: 'idle',
                message: '选择一段对话后，可以查看和更新这段故事的后台动态。' };
        }
        const view = world.readCurrent();
        if (!chatIdentity || view.chatIdentity !== chatIdentity) { throw new Error('聊天已切换，请重新打开世界。'); }
        const status = maintenance.getStatus('world', chatIdentity);
        const recovered = !view.pendingSave && view.writeState === 'ready' && status.reason === 'save-unconfirmed';
        return { chatIdentity, world: view.world, settings: settings.read()!.apps.world,
            writeState: view.writeState, pendingSave: view.pendingSave,
            maintenance: recovered ? 'idle' : status.state,
            message: recovered ? '已加载保存的新闻。'
                : status.message === 'unchanged' && view.writeState === 'ready' && !view.world.news.length
                    ? '还没有新闻，等故事展开后再来看看。'
                    : worldStatusMessage(view.writeState, status, view.pendingSave) };
    }
    const isCurrent = (current: NonNullable<typeof activation>) => activation === current
        && current.context.isCurrent() && getChatIdentity() === current.chatIdentity;
    function publish(): void {
        if (activation && isCurrent(activation)) {
            try { activation.context.post('world/state', { state: state() }); }
            catch { activation.context.post('world/error', { message: '新闻暂时加载不了，请重试。' }); }
        }
    }
    function cancel(reason: string): void {
        maintenance.cancelRequested('world', reason);
        maintenance.invalidateAutomatic('world', reason);
    }
    const deactivate = () => { activation = null; };
    return {
        activate(context) {
            const initial = state();
            activation = { chatIdentity: initial.chatIdentity, context, busy: false };
            return initial;
        },
        deactivate,
        cancelForeground: deactivate,
        cancelAll(reason) { cancel(reason); deactivate(); },
        handleWindowClosed: deactivate,
        handleChatChanged() { cancel('chat-changed'); deactivate(); },
        startBackground() {
            unsubscribeData ??= world.subscribe(publish);
            unsubscribeStatus ??= maintenance.subscribeStatus((id, identity) => {
                if (id === 'world' && identity === getChatIdentity()) { publish(); }
            });
            if (!unsubscribeSettings) {
                let previous = settings.read()!.apps.world;
                unsubscribeSettings = settings.subscribe(next => {
                    const current = next.apps.world;
                    if ((previous.subscribed && !current.subscribed) || (previous.peopleEvolution && !current.peopleEvolution)) { cancel('unsubscribed'); }
                    previous = current;
                    publish();
                });
            }
        },
        stopBackground() {
            cancel('world-stopped');
            deactivate();
            unsubscribeData?.(); unsubscribeStatus?.(); unsubscribeSettings?.();
            unsubscribeData = undefined; unsubscribeStatus = undefined; unsubscribeSettings = undefined;
        },
        async handleMessage(message) {
            const payload = message.payload as { chatIdentity?: unknown; enabled?: unknown } | undefined;
            const current = activation;
            if (!current?.chatIdentity || !isCurrent(current) || payload?.chatIdentity !== current.chatIdentity) {
                throw new Error('聊天已切换，请重新打开世界。');
            }
            if (current.busy) { throw new Error('正在处理上一次操作，请稍候。'); }
            current.busy = true;
            let notice = '';
            const guard = () => isCurrent(current);
            try {
                if (message.type === 'world/read') { await world.refreshCurrent(); }
                else if (message.type === 'world/confirm-save') { await world.confirmPending(); }
                else if (message.type === 'world/adopt-server-state') { await world.adoptServerState(); }
                else {
                    if (message.type === 'world/refresh' || message.type === 'world/subscribe' || message.type === 'world/background') {
                        throw new Error('世界见闻与剧情演进已由统一后厨队列（simulation）维护；请前往「设定 → 世界推演」调整全局偏好。');
                    } else { throw new Error('未知的世界操作。'); }
                }
                if (!guard()) { throw new Error('页面已切换。'); }
                return { state: state(), message: notice };
            } finally { current.busy = false; }
        },
    };
}
