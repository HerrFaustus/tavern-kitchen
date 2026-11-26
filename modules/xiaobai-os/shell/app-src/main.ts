import { createApp } from 'vue';
import App from './App.vue';
import type { XiaobaiOsFrameBridge } from './frame-bridge.js';
import './styles/index.css';

export function mountXiaobaiOsApp(target: HTMLElement, bridge: XiaobaiOsFrameBridge): () => void {
    const app = createApp(App, { bridge });
    app.mount(target);
    return () => {
        app.unmount();
    };
}
