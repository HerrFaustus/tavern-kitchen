// 酒馆后厨 0.1 — Based on LittleWhiteBox by biex.
import { installFloorSummaries } from '../modules/story-summary/floor-summary.js';
import { createModuleEvents, event_types } from './event-manager.js';
import { extension_settings, getContext } from '../../../../extensions.js';
import * as hostScript from '../../../../../script.js';
import { getCurrentUserHandle } from '../../../../user.js';
import { EXT_ID } from './constants.js';
import { buildEntryUrl } from './build-assets.js';
import { createExtensionDrawer } from './extension-drawer.js';
import { createDefaultXiaobaiOsSettings, prepareXiaobaiOsSettings, initXiaobaiOs, openXiaobaiOs, isDiceContinuationPending } from '../modules/xiaobai-os/index.js';
import { configureL0ContinuationCheck } from '../modules/story-summary/vector/pipeline/l0-eligibility.js';
import { observeAsyncCallback } from '../shared/common/async-errors.js';
const { saveSettings } = hostScript;

const settings = extension_settings[EXT_ID] ??= {
    enabled: true,
    storySummary: { enabled: true },
    enaPlanner: { enabled: false },
    variablesCore: { enabled: true },
    variablesPanel: { enabled: true },
    variablesMode: '1.0',
    xiaobaiOs: createDefaultXiaobaiOsSettings(),
};
window.isTavernKitchenEnabled = settings.enabled;
const cleanups = new Map();
window.registerKitchenModuleCleanup = (id, cleanup) => cleanups.set(id, cleanup);
configureL0ContinuationCheck(isDiceContinuationPending);
let memory;
let planner;
let variables;
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
    const story = featureSwitch('storySummary', '启用剧情模块');
    const planner = featureSwitch('enaPlanner', '启用剧情规划');
    const os = featureSwitch('xiaobaiOs', '启用地图、世界与 API');
    return {
        memory: [story], 'memory-settings': [story],
        planner: [planner],
        variables: [featureSwitch('variablesCore', '变量更新与回滚'), featureSwitch('variablesPanel', '变量查看面板')],
        map: [os], 'world-engine': [os], dice: [os], settings: [os],
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
        world: async () => {
            await requireFeatures();
            if (kitchen.isActive('world')) await worldArchive.open('world');
        },
        'world-management': async () => {
            await requireFeatures();
            if (kitchen.isActive('world-management')) await worldArchive.open('world-management');
        },
        memory: async () => {
            await requireFeatures();
            if (!kitchen.isActive('memory')) return;
            if (!memory) throw new Error('剧情模块尚未启用，请在剧情板块中开启并刷新。');
            memory.openStoryMemory();
        },
        'memory-settings': async () => {
            await requireFeatures();
            if (!kitchen.isActive('memory-settings')) return;
            if (!memory) throw new Error('请先启用剧情模块并刷新，再配置剧情设置。');
            memory.openStoryMemorySettings();
        },
        planner: async () => {
            await requireFeatures();
            if (!kitchen.isActive('planner')) return;
            if (!planner) throw new Error('剧情规划尚未启用，请在规划板块中开启并刷新。');
            window.tavernKitchenEnaPlanner?.openSettings();
        },
        variables: async () => {
            await requireFeatures();
            if (!kitchen.isActive('variables')) return;
            if (!variables) throw new Error('变量面板尚未启用，请在变量板块中开启并刷新。');
            variables.getVariablesPanelInstance()?.open();
        },
    };
    for (const id of ['situation', 'lore', 'people', 'relations']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!memory) throw new Error('请先启用剧情模块并刷新，再查看已记录的世界状态。');
        memory.openStoryWorld(id === 'situation' ? 'world' : id);
    };
    for (const id of ['map', 'world-engine', 'dice', 'settings', 'agent-api']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!settings.xiaobaiOs?.enabled) throw new Error('地图、世界与 API 尚未启用，请在对应板块中开启并刷新。');
        const appId = id === 'world-engine' ? 'world' : id === 'settings' || id === 'agent-api' ? 'agent-api' : id;
        if (!await openXiaobaiOs(appId)) throw new Error('此板块尚未准备好，请重试。');
    };
    kitchen.configure({
        actions, featureSwitches: buildFeatureSwitches(),
        onToggleFeature: (key, enabled) => observeAsyncCallback(toggleFeature(key, enabled), { source: import.meta.url, operation: 'toggle-feature' }),
        toggleDrawer: hostScript.doNavbarIconClick,
        onVisibility(visible, tab) {
            const instance = variables?.getVariablesPanelInstance();
            if (!visible || tab !== 'variables') instance?.stopWatcher();
        },
    });
    const events = createModuleEvents('kitchen-workspace');
    events.on(event_types.CHAT_CHANGED, () => { kitchen.reset(); worldArchive?.reset(); });
}

export async function startKitchen(workspace) {
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
    if (settings.storySummary?.enabled) {
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
    }
    if (settings.variablesCore?.enabled || settings.variablesPanel?.enabled) {
        const commands = await import('../modules/variables/var-commands.js');
        const events = await import('../modules/variables/varevent-editor.js');
        commands.initVarCommands();
        events.initVareventEditor();
        if (settings.variablesCore?.enabled) (await import('../modules/variables/variables-core.js')).initVariablesCore();
        if (settings.variablesPanel?.enabled) {
            variables = await import('../modules/variables/variables-panel.js');
            await variables.initVariablesPanel();
        }
    }
    if (settings.enaPlanner?.enabled) {
        planner = await import('../modules/ena-planner/ena-planner.js');
        await planner.initEnaPlanner();
    }
    if (settings.xiaobaiOs?.enabled) await initXiaobaiOs();
    const { createWorldArchive } = await import('../modules/world-records/host.js');
    let removeWorldGeneration;
    worldArchive = createWorldArchive({ getContext, getAccountId: getCurrentUserHandle, getMemorySnapshot: () => memory?.getFloorSummarySnapshot(),
        getMount: id => kitchen.getMount(id), isVisible: id => kitchen.isActive(id), navigate: id => { kitchen.open(id).catch(showError); }, onError: showError,
        onAuthorityChange: () => { removeWorldGeneration?.clear(); memory?.invalidateWorldContext(); } });
    const { installWorldAuthorityGeneration } = await import('../modules/world-records/generation-host.js');
    removeWorldGeneration = installWorldAuthorityGeneration({ getContext, prepare: worldArchive.prepare, onError: showError });
    window.registerKitchenModuleCleanup('world-records', () => { removeWorldGeneration(); worldArchive.dispose(); });
    } catch (error) { startupError = error; throw error; } finally { readyResolve(); }
}
