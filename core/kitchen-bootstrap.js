import { createKitchenWorkspace } from './kitchen-workspace.js';

/** Mount chrome before importing host adapters or reading any settings. */
export function startKitchenBootstrap({ documentTarget = document, loadRuntime = () => import('./kitchen-runtime.js') } = {}) {
    const loading = documentTarget.createElement('p');
    loading.className = 'tk-panel-message'; loading.setAttribute('role', 'status');
    loading.textContent = '正在加载后厨设置…';
    const workspace = createKitchenWorkspace({ documentTarget, settingsElement: loading });
    const ready = Promise.resolve().then(loadRuntime).then(runtime => runtime.startKitchen(workspace)).catch(error => {
        workspace.failStartup(error);
        console.error('[TavernKitchen] startup', error);
    });
    return { workspace, ready };
}
