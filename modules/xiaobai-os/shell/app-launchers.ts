import appIds from './app-catalog.json';
import type { XiaobaiOsAppDescriptor } from '../types.js';
import { AGENT_API_APP_DESCRIPTOR } from '../apps/agent-api/descriptor.js';
import { MAP_APP_DESCRIPTOR } from '../apps/map/descriptor.js';
import { WORLD_APP_DESCRIPTOR } from '../apps/world/descriptor.js';
import { DICE_APP_DESCRIPTOR } from '../apps/dice/descriptor.js';

export interface XiaobaiOsAppLauncher extends XiaobaiOsAppDescriptor {
    icon: string;
}

// Presentation only: both the host shortcut panel and desktop can read this
// catalog without importing Vue, APP components, or APP runtimes.
const launchers: readonly XiaobaiOsAppLauncher[] = [
    { ...DICE_APP_DESCRIPTOR, icon: new URL('../apps/dice/ui/icon.svg', import.meta.url).href },
    { ...AGENT_API_APP_DESCRIPTOR, icon: new URL('../apps/agent-api/ui/icon.svg', import.meta.url).href },
    { ...MAP_APP_DESCRIPTOR, icon: new URL('../apps/map/ui/icon.svg', import.meta.url).href },
    { ...WORLD_APP_DESCRIPTOR, icon: new URL('../apps/world/ui/icon.svg', import.meta.url).href },
];

export const xiaobaiOsLaunchers: readonly XiaobaiOsAppLauncher[] = Object.freeze(appIds.map(id => {
    const app = launchers.find(item => item.id === id);
    if (!app) { throw new Error(`missing_shell_app:${id}`); }
    return Object.freeze(app);
}));
