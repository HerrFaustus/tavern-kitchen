// 酒馆后厨 0.1 — Based on LittleWhiteBox by biex.
import { installFloorSummaries } from '../modules/story-summary/floor-summary.js';
import { createModuleEvents, event_types } from './event-manager.js';
import { extension_settings, getContext } from '../../../../extensions.js';
import * as hostScript from '../../../../../script.js';
import { getCurrentUserHandle } from '../../../../user.js';
import { EXT_ID } from './constants.js';
import { buildEntryUrl } from './build-assets.js';
import { createExtensionDrawer } from './extension-drawer.js';
import { createDefaultXiaobaiOsSettings, prepareXiaobaiOsSettings, initXiaobaiOs, mountWorldEvolution, openXiaobaiOs } from '../modules/xiaobai-os/index.js';
import { observeAsyncCallback } from '../shared/common/async-errors.js';
import { requireTurnRuntime } from '../modules/world-records/turn-runtime.js';
const { saveSettings } = hostScript;

const settings = extension_settings[EXT_ID] ??= {
    enabled: true,
    storySummary: { enabled: true },
    enaPlanner: { enabled: false },
    xiaobaiOs: createDefaultXiaobaiOsSettings(),
};
(settings.storySummary ??= {}).enabled = true;
window.isTavernKitchenEnabled = settings.enabled;
const cleanups = new Map();
window.registerKitchenModuleCleanup = (id, cleanup) => cleanups.set(id, cleanup);

let memory;
let planner;
let worldArchive;
let kitchen;
let readyResolve;
const featureReady = new Promise(resolve => { readyResolve = resolve; });
let startupError;
async function requireFeatures() {
    await featureReady;
    if (!settings.enabled) throw new Error('后厨已停用，请在扩展设置中启用并刷新。');
    if (startupError) throw startupError;
}

function showError(error) {
    console.error('[TavernKitchen]', error);
    window.toastr?.error(error?.message || '后厨操作失败，请查看控制台。');
}

async function loadBridge(entry, id) {
    if (document.getElementById(id)) return;
    const src = await buildEntryUrl(entry);
    await new Promise((resolve, reject) => {
        const script = Object.assign(document.createElement('script'), { id, type: 'module', src });
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error(`后厨宿主桥接加载失败：${entry}`)); };
        document.head.appendChild(script);
    });
}

function mountExtensionDrawer() {
    const host = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    if (!host || document.getElementById('tavern-kitchen-extension')) return;
    host.append(createExtensionDrawer({
        enabled: settings.enabled !== false,
        onToggleEnabled(enabled) {
            const previous = settings.enabled;
            settings.enabled = enabled;
            Promise.resolve(saveSettings()).then(() => location.reload()).catch(error => {
                settings.enabled = previous;
                showError(error);
            });
        },
        onOpen: () => kitchen.open('settings'),
    }));
}

function featureSwitch(key, label) {
    return { key, label, checked: !!settings[key]?.enabled };
}
function buildFeatureSwitches() {
    const planner = featureSwitch('enaPlanner', '启用剧情规划');
    const os = featureSwitch('xiaobaiOs', '启用地图、世界与 API');
    return {
        planner: [planner],
        map: [os], settings: [os],
    };
}
async function toggleFeature(key, enabled) {
    const previous = !!settings[key]?.enabled;
    try {
        (settings[key] ??= {}).enabled = enabled;
        await saveSettings();
        location.reload();
    } catch (error) {
        (settings[key] ??= {}).enabled = previous;
        showError(error);
    }
}
function configureWorkspace() {
    mountExtensionDrawer();
    const actions = {
        overview: async () => {
            await requireFeatures();
            if (kitchen.isActive('overview')) await worldArchive.open('overview');
        },
        suspense: async () => {
            await requireFeatures();
            if (kitchen.isActive('suspense')) await worldArchive.open('suspense');
        },
        memory: async () => {
            await requireFeatures();
            if (!kitchen.isActive('memory')) return;
            if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
            memory.openStoryMemory();
        },
        proofreading: async () => {
            await requireFeatures();
            if (!kitchen.isActive('proofreading')) return;
            if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
            memory.openStoryMemorySettings('proofreading');
        },
        'memory-settings': async () => {
            await requireFeatures();
            if (!kitchen.isActive('memory-settings')) return;
            if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
            memory.openStoryMemorySettings();
        },
        planner: async () => {
            await requireFeatures();
            if (!kitchen.isActive('planner')) return;
            if (!planner) throw new Error('剧情规划尚未启用，请在规划板块中开启并刷新。');
            await planner.open(kitchen.getMount('planner'));
        },
    };
    for (const id of ['situation', 'lore', 'people', 'relations']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
        memory.openStoryWorld(id === 'situation' ? 'world' : id);
        if (id === 'people' || id === 'situation') kitchen.showEvolution(parent => mountWorldEvolution(parent, id));
    };
    for (const id of ['map', 'settings', 'agent-api']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!settings.xiaobaiOs?.enabled) throw new Error('地图、世界与 API 尚未启用，请在对应板块中开启并刷新。');
        const appId = id === 'settings' || id === 'agent-api' ? 'agent-api' : id;
        if (!await openXiaobaiOs(appId)) throw new Error('此板块尚未准备好，请重试。');
    };
    kitchen.configure({
        actions, featureSwitches: buildFeatureSwitches(),
        onToggleFeature: (key, enabled) => observeAsyncCallback(toggleFeature(key, enabled), { source: import.meta.url, operation: 'toggle-feature' }),
        toggleDrawer: hostScript.doNavbarIconClick,
    });
    const events = createModuleEvents('kitchen-workspace');
    events.on(event_types.CHAT_CHANGED, () => { kitchen.reset(); worldArchive?.reset(); });
}

export async function startKitchen(workspace) {
    requireTurnRuntime();
    kitchen = workspace;
    try {
    await prepareXiaobaiOsSettings();
    configureWorkspace();
    if (!settings.enabled) return;
    for (const [entry, id] of [
        ['runtime/call-generate', 'tk-call-generate'],
        ['runtime/worldbook', 'tk-worldbook'],
        ['runtime/context', 'tk-context'],
    ]) await loadBridge(entry, id);
    const { createWorldArchive } = await import('../modules/world-records/host.js');
    let removeWorldGeneration;
    worldArchive = createWorldArchive({ getContext, getAmbientPreferences: () => settings.xiaobaiOs?.enabled ? settings.xiaobaiOs.apps?.world || {} : { encounterFrequency: 'off' }, getAccountId: getCurrentUserHandle, getMemorySnapshot: () => memory?.getFloorSummarySnapshot(),
        getMount: id => kitchen.getMount(id), isVisible: id => kitchen.isActive(id), onError: showError,
        onAuthorityChange: () => { removeWorldGeneration?.clear(); memory?.invalidateWorldContext(); } });
    const { installWorldAuthorityGeneration } = await import('../modules/world-records/generation-host.js');
    removeWorldGeneration = installWorldAuthorityGeneration({ getContext, prepare: worldArchive.prepare, onError: showError });
    window.registerKitchenModuleCleanup('world-records', () => { removeWorldGeneration(); worldArchive.dispose(); });
    
    memory = await import('../modules/story-summary/story-summary.js');
    const panels = installFloorSummaries({ getSnapshot: memory.getFloorSummarySnapshot,
        updateFloor: memory.updateFloorSummary, extractFloor: memory.extractMainReplySummary,
        summarizeFloor: memory.summarizeFloorOnDemand,
        openMemory: floor => memory.openStoryMemory(floor) });
    const floorEvents = createModuleEvents('kitchen-floor-summaries');
    floorEvents.on(event_types.CHAT_CHANGED, panels.reset);
    for (const key of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'MORE_MESSAGES_LOADED']) {
        if (event_types[key]) floorEvents.on(event_types[key], panels.schedule);
    }
    window.registerKitchenModuleCleanup('kitchen-floor-summaries', () => { panels.dispose(); floorEvents.cleanup(); });
    
    if (settings.enaPlanner?.enabled) {
        const { installPlanner } = await import('../modules/story-planner/host.js');
        planner = installPlanner({snapshot:worldArchive.plannerSnapshot, getContext, settings:settings.enaPlanner, saveSettings});
        window.registerKitchenModuleCleanup('story-planner',planner.dispose);
    }
    if (settings.xiaobaiOs?.enabled) await initXiaobaiOs();
    } catch (error) { startupError = error; throw error; } finally { readyResolve(); }
}
