import { createKitchenWorkspace } from './kitchen-workspace.js';
import { registerGenerateInterceptor, unregisterGenerateInterceptor } from '../shared/common/generate-interceptor.js';
import { clearAgentNotice, installAgentStatus, showAgentNotice } from './agent-status.js';

const FOREGROUND_GENERATION = new Set(['normal', 'continue', 'group', 'regenerate', 'swipe']);

/** Mount chrome and the fail-closed gate before importing host adapters or reading settings. */
export function startKitchenBootstrap({ documentTarget = document, loadRuntime = () => import('./kitchen-runtime.js') } = {}) {
    const workspace = createKitchenWorkspace({ documentTarget });
    const stopAgentStatus = installAgentStatus(documentTarget);
    let state = 'loading';
    let startupError = null;
    const showLoading = () => {
        if (state !== 'loading') return;
        showAgentNotice({ message: '后厨正在启动，启动完成前已暂停正文生成', pinned: true });
    };
    registerGenerateInterceptor('kitchen-bootstrap', async (_chat, _size, abort, type) => {
        if (!FOREGROUND_GENERATION.has(type || 'normal') || state === 'ready') return;
        if (state === 'failed') {
            const error = startupError || new Error('后厨启动失败');
            showAgentNotice({ level: 'error', message: `后厨启动失败，已中止发送：${error.message || error}。请重试。`, error, pinned: true,
                retry: () => documentTarget.defaultView.location.reload() });
        } else {
            showLoading();
        }
        abort(true);
    }, -1000);
    showLoading();
    const ready = Promise.resolve().then(loadRuntime).then(runtime => runtime.startKitchen(workspace)).then(() => {
        state = 'ready';
        clearAgentNotice();
    }).catch(error => {
        state = 'failed';
        startupError = error;
        workspace.failStartup(error);
        showAgentNotice({ level: 'error', message: `后厨启动失败：${error?.message || error}。正文生成已锁定，请重试。`, error, pinned: true,
            retry: () => documentTarget.defaultView.location.reload() });
        console.error('[TavernKitchen] startup', error);
    });
    return { workspace, ready, dispose() {
        unregisterGenerateInterceptor('kitchen-bootstrap');
        stopAgentStatus();
    } };
}
