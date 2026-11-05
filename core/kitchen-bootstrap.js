import { createKitchenWorkspace } from './kitchen-workspace.js';

/** Mount chrome before importing host adapters or reading any settings. */
export function startKitchenBootstrap({ documentTarget = document, loadRuntime = () => import('./kitchen-runtime.js') } = {}) {
    const workspace = createKitchenWorkspace({ documentTarget });
    const ready = Promise.resolve().then(loadRuntime).then(runtime => runtime.startKitchen(workspace)).catch(error => {
        workspace.failStartup(error);
        console.error('[TavernKitchen] startup', error);
    });
    return { workspace, ready };
}
