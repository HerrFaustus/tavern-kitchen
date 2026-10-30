import type { Component } from 'vue';
import appIds from './app-catalog.json';
import type { XiaobaiOsAppDescriptor } from '../types.js';
import { AGENT_API_APP_DESCRIPTOR } from '../apps/agent-api/descriptor.js';
import { MAP_APP_DESCRIPTOR } from '../apps/map/descriptor.js';
import { WORLD_APP_DESCRIPTOR } from '../apps/world/descriptor.js';
import { DICE_APP_DESCRIPTOR } from '../apps/dice/descriptor.js';
const descriptors = [DICE_APP_DESCRIPTOR, AGENT_API_APP_DESCRIPTOR, MAP_APP_DESCRIPTOR, WORLD_APP_DESCRIPTOR];

interface ComponentModule {
    default: Component;
}

export interface XiaobaiOsAppDefinition extends XiaobaiOsAppDescriptor {
    load(): Promise<Component>;
    resetLoader(): void;
}

export function createAppComponentLoader(importer: () => Promise<ComponentModule>): {
    load(): Promise<Component>;
    reset(): void;
} {
    let loaded: Component | null = null;
    let pending: Promise<Component> | null = null;
    return Object.freeze({
        load() {
            if (loaded) { return Promise.resolve(loaded); }
            pending ??= importer().then(module => {
                if (!module?.default) { throw new Error('app_component_missing'); }
                loaded = module.default;
                return loaded;
            }).catch(error => {
                pending = null;
                throw error;
            });
            return pending;
        },
        reset() {
            loaded = null;
            pending = null;
        },
    });
}

const importers: Readonly<Record<string, () => Promise<ComponentModule>>> = Object.freeze({
    dice: () => import('../apps/dice/ui/DiceApp.vue'),
    'agent-api': () => import('../apps/agent-api/ui/AgentApiApp.vue'),
    map: () => import('../apps/map/ui/MapApp.vue'),
    world: () => import('../apps/world/ui/WorldApp.vue'),
});

export const xiaobaiOsApps: readonly XiaobaiOsAppDefinition[] = Object.freeze(appIds.map(id => {
    const app = descriptors.find(item => item.id === id);
    if (!app) { throw new Error(`missing_shell_app:${id}`); }
    const importer = importers[app.id];
    if (!importer) { throw new Error(`missing_shell_app:${app.id}`); }
    const loader = createAppComponentLoader(importer);
    return Object.freeze({ ...app, load: loader.load, resetLoader: loader.reset });
}));

export const XIAOBAI_OS_SHELL_APP_IDS = Object.freeze(xiaobaiOsApps.map(app => app.id));
