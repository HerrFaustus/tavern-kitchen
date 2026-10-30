// 酒馆后厨 0.1 — Based on LittleWhiteBox by biex.
import { installFloorSummaries } from '../modules/story-summary/floor-summary.js';
import { createModuleEvents, event_types } from './event-manager.js';
import { DOMPurify } from '../../../../../lib.js';
import { extension_settings, getContext } from '../../../../extensions.js';
import * as hostScript from '../../../../../script.js';
import { getCurrentUserHandle } from '../../../../user.js';
import { EXT_ID, extensionFolderPath } from './constants.js';
import { buildEntryUrl } from './build-assets.js';
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
    if (!settings.enabled) throw new Error('后厨已停用，请在设置中启用并保存刷新。');
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

async function mountSettings() {
    const response = await fetch(`${extensionFolderPath}/settings.html`);
    if (!response.ok) throw new Error(`后厨设置页加载失败：${response.status}`);
    const fragment = document.createElement('div');
    fragment.innerHTML = DOMPurify.sanitize(await response.text());
    const root = fragment.firstElementChild;
    const shortcut = document.createElement('button');
    shortcut.type = 'button'; shortcut.className = 'menu_button'; shortcut.textContent = '打开酒馆后厨';
    shortcut.addEventListener('click', () => kitchen.open('settings'));
    document.getElementById('extensions_settings')?.append(shortcut);
    for (const input of root.querySelectorAll('[data-feature]')) {
        input.checked = input.dataset.feature === 'enabled' ? settings.enabled : !!settings[input.dataset.feature]?.enabled;
    }
    root.querySelector('[data-action="apply"]').addEventListener('click', observeAsyncCallback(async () => {
        const previous = structuredClone(settings);
        try {
            for (const input of root.querySelectorAll('[data-feature]')) {
                const key = input.dataset.feature;
                if (key === 'enabled') settings.enabled = input.checked;
                else (settings[key] ??= {}).enabled = input.checked;
            }
            await saveSettings();
            location.reload();
        } catch (error) {
            Object.assign(settings, previous);
            showError(error);
        }
    }, { source: import.meta.url, operation: 'save-settings' }));
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
            if (!memory) throw new Error('剧情模块尚未启用，请在设置中开启并保存刷新。');
            memory.openStoryMemory();
        },
        'memory-settings': async () => {
            await requireFeatures();
            if (!kitchen.isActive('memory-settings')) return;
            if (!memory) throw new Error('请先启用剧情模块并保存刷新，再配置剧情设置。');
            memory.openStoryMemorySettings();
        },
        planner: async () => {
            await requireFeatures();
            if (!kitchen.isActive('planner')) return;
            if (!planner) throw new Error('规划尚未启用，请在设置中开启并保存刷新。');
            window.tavernKitchenEnaPlanner?.openSettings();
        },
        variables: async () => {
            await requireFeatures();
            if (!kitchen.isActive('variables')) return;
            if (!variables) throw new Error('变量面板尚未启用，请在设置中开启并保存刷新。');
            variables.getVariablesPanelInstance()?.open();
        },
    };
    for (const id of ['situation', 'lore', 'people', 'relations']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!memory) throw new Error('请先启用记忆记录功能并保存刷新，再查看已记录的世界状态。');
        memory.openStoryWorld(id === 'situation' ? 'world' : id);
    };
    for (const id of ['map', 'world-engine', 'dice', 'agent-api']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!settings.xiaobaiOs?.enabled) throw new Error('世界相关板块尚未启用，请在设置中开启并保存刷新。');
        if (!await openXiaobaiOs(id === 'world-engine' ? 'world' : id)) throw new Error('此板块尚未准备好，请重试。');
    };
    kitchen.configure({ actions, settingsElement: root, toggleDrawer: hostScript.doNavbarIconClick, onVisibility(visible, tab) {
        const instance = variables?.getVariablesPanelInstance();
        if (!visible || tab !== 'variables') instance?.stopWatcher();
    } });
    const events = createModuleEvents('kitchen-workspace');
    events.on(event_types.CHAT_CHANGED, () => { kitchen.reset(); worldArchive?.reset(); });
}

export async function startKitchen(workspace) {
    kitchen = workspace;
    try {
    await prepareXiaobaiOsSettings();
    await mountSettings();
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
    worldArchive = createWorldArchive({ getContext, getAccountId: getCurrentUserHandle, getMemorySnapshot: () => memory?.getFloorSummarySnapshot(),
        getMount: id => kitchen.getMount(id), isVisible: id => kitchen.isActive(id), navigate: id => { kitchen.open(id).catch(showError); }, onError: showError });
    window.registerKitchenModuleCleanup('world-records', () => worldArchive.dispose());
    } catch (error) { startupError = error; throw error; } finally { readyResolve(); }
}
