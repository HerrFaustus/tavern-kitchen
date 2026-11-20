import { createKitchenWorkspace } from './kitchen-workspace.js';
import { registerGenerateInterceptor, unregisterGenerateInterceptor } from '../shared/common/generate-interceptor.js';
import { clearAgentNotice, installAgentStatus, showAgentNotice } from './agent-status.js';
import { installSendLock } from './send-lock.js';

const FOREGROUND_GENERATION = new Set(['normal', 'continue', 'group', 'regenerate', 'swipe']);

/** Mount chrome and the fail-closed gate before importing host adapters or reading settings. */
export function startKitchenBootstrap({ documentTarget = document, loadRuntime = () => import('./kitchen-runtime.js') } = {}) {
    const workspace = createKitchenWorkspace({ documentTarget });
    const stopAgentStatus = installAgentStatus(documentTarget);
    let state = 'loading';
    let startupError = null;
    const showLoading = () => {
        if (state !== 'loading') return;
        showAgentNotice({ message: '后厨正在启动，启动完成前已锁定正文发送', pinned: true });
    };
    const showStartupFailure = () => {
        const error = startupError || new Error('后厨启动失败');
        showAgentNotice({ level: 'error', message: `后厨启动失败，发送已锁定：${error.message || error}。请重试。`, error, pinned: true,
            retry: () => documentTarget.defaultView.location.reload() });
    };
    const sendLock = installSendLock({
        documentTarget,
        getState: () => ({
            locked: state !== 'ready',
            needsGate: false,
            reason: state === 'failed'
                ? '后厨启动失败，发送已锁定，请先在上方横栏重试'
                : '后厨正在启动，启动完成前已锁定发送',
        }),
        onBlocked: () => {
            if (state === 'failed') showStartupFailure();
            else showLoading();
        },
    });
    registerGenerateInterceptor('kitchen-bootstrap', async (_chat, _size, abort, type) => {
        if (!FOREGROUND_GENERATION.has(type || 'normal') || state === 'ready') return;
        if (state === 'failed') showStartupFailure();
        else showLoading();
        abort(true);
    }, -1000);
    showLoading();
    const ready = Promise.resolve().then(loadRuntime).then(runtime => runtime.startKitchen(workspace)).then(() => {
        state = 'ready';
        sendLock.dispose();
        clearAgentNotice();
    }).catch(error => {
        state = 'failed';
        startupError = error;
        sendLock.sync();
        workspace.failStartup(error);
        showStartupFailure();
        console.error('[TavernKitchen] startup', error);
    });
    return { workspace, ready, dispose() {
        unregisterGenerateInterceptor('kitchen-bootstrap');
        sendLock.dispose();
        stopAgentStatus();
    } };
}
