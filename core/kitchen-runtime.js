import { createKitchenCards } from '../modules/kitchen-data/card.js';
// 酒馆后厨 0.1 — Based on LittleWhiteBox by biex.
import { installFloorSummaries } from '../modules/story-summary/floor-summary.js';
import { createModuleEvents, event_types } from './event-manager.js';
import { extension_settings, getContext } from '../../../../extensions.js';
import * as hostScript from '../../../../../script.js';
import { getCurrentUserHandle } from '../../../../user.js';
import { EXT_ID } from './constants.js';
import { buildEntryUrl } from './build-assets.js';
import { panelEnabled, usePanelSettings, savePanelPrompt } from './panel-policy.js';
import { mountPanelControls } from './panel-controls.js';
import { createExtensionDrawer } from './extension-drawer.js';
import { createDefaultXiaobaiOsSettings, prepareXiaobaiOsSettings, initXiaobaiOs, cleanupXiaobaiOs, setXiaobaiOsEnabled, mountWorldEvolution, openXiaobaiOs } from '../modules/xiaobai-os/index.js';
import { createOpeningHost } from '../modules/world-records/opening-host.js';
import { requireTurnRuntime } from '../modules/world-records/turn-runtime.js';
const { saveSettings } = hostScript;

const settings = extension_settings[EXT_ID] ??= {
    enabled: true,
    storySummary: { enabled: true },
    enaPlanner: { enabled: false },
    xiaobaiOs: createDefaultXiaobaiOsSettings(),
};
(settings.storySummary ??= {}).enabled = true;
settings.enabled ??= true;
settings.enaPlanner ??= {enabled:false};
usePanelSettings(settings, (key,value) => enqueue(() => saveValue(settings.panelPrompts ??= {},key,value)));
window.isTavernKitchenEnabled = settings.enabled;
let clearWorldPrompt, stopWorld, floorPanels;
let settingsQueue = Promise.resolve();
function enqueue(work) {
    const next = settingsQueue.then(work);
    settingsQueue = next.then(() => undefined, () => undefined);
    return next;
}
async function saveValue(target,key,value) {
    const previous = target[key];
    if (value === undefined) delete target[key]; else target[key] = value;
    try { if (await saveSettings() === false) throw new Error('酒馆未能保存设置，请重试。'); }
    catch (error) { if (previous === undefined) delete target[key]; else target[key] = previous; throw error; }
}
async function updatePanel(id,enabled) {
    await featureReady;
    const master = id === 'enabled';
    await saveValue(master ? settings : (settings.panels ??= {}),id,enabled);
    window.isTavernKitchenEnabled = settings.enabled;
    if (master && enabled) await startWorld();
    if (master && !enabled) { stopWorld?.(); cleanupXiaobaiOs(); }
    if (master || id === 'opening') worldArchive?.initialize?.cancel?.();
    if (master || id === 'memory' || id === 'proofreading') await memory?.refreshPanelState(id);
    if (master || id === 'planner') await syncPlanner();
    configureWorkspace();
    clearWorldPrompt?.();
    if (master || id === 'memory') floorPanels?.schedule();
    if (master && enabled && settings.xiaobaiOs?.enabled) await initXiaobaiOs();
}
async function syncPlanner() {
    if (!panelEnabled('planner')) { planner?.dispose(); planner = null; return; }
    if (planner || !worldArchive) return;
    const { installPlanner } = await import('../modules/story-planner/host.js');
    planner = installPlanner({snapshot:worldArchive.plannerSnapshot,getContext,settings:settings.enaPlanner,saveSettings});
}
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
    if (!settings.enabled) throw new Error('后厨已停用，请在任一功能面板恢复酒馆后厨。');
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
    host.append(createExtensionDrawer({onOpen: () => kitchen.open()}));
}

function configureWorkspace() {
    mountExtensionDrawer();
    const actions = {
        opening: async () => { await requireFeatures(); },
        overview: async () => {
            await requireFeatures();
            if (kitchen.isActive('overview')) await worldArchive.open('overview');
        },
        clues: async () => {
            await requireFeatures();
            if (kitchen.isActive('clues')) await worldArchive.open('clues');
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
        data: async () => {
            await requireFeatures();
            if (!kitchen.isActive('data')) return;
            memory.configureKitchenCards(createKitchenCards({
                memory: memory.kitchenCardMemory(), world: worldArchive.cardData,
                isCurrent: identity => memory.kitchenCardMemory().read().identity === identity,
            }));
            memory.openStoryMemorySettings('data');
            worldArchive.showRecovery(kitchen.getMount('data')?.querySelector('iframe'));
        },
        proofreading: async () => {
            await requireFeatures();
            if (!kitchen.isActive('proofreading')) return;
            if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
            memory.openStoryMemorySettings('proofreading');
        },
        planner: async () => {
            await requireFeatures();
            if (!kitchen.isActive('planner')) return;
            if (!planner) throw new Error('请在本面板下方启用编剧。');
            await planner.open(kitchen.getMount('planner'), kitchen.getControls());
        },
    };
    for (const id of ['situation', 'people', 'relations']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
        memory.openStoryWorld(id === 'situation' ? 'world' : id);
        if (id === 'situation') worldArchive.showProposals(kitchen.getMount(id)?.querySelector('iframe'));
        if (id === 'people' || id === 'situation') kitchen.showEvolution(parent => mountWorldEvolution(parent, id, kitchen.getMount(id)?.querySelector('iframe')), id === 'people');
    };
    for (const id of ['map', 'settings', 'agent-api']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!settings.xiaobaiOs?.enabled) await setXiaobaiOsEnabled(true);
        const appId = id === 'settings' || id === 'agent-api' ? 'agent-api' : id;
        if (!await openXiaobaiOs(appId)) throw new Error('此板块尚未准备好，请重试。');
    };
    kitchen.configure({
        actions, visiblePanel:() => true,
        panelSwitch:(id,label) => {
            const paused = settings.enabled === false;
            const key = paused ? 'enabled' : id;
            return {
                enabled:panelEnabled(id),
                label:paused ? '恢复酒馆后厨（已整体停用）' : '启用' + label,
                change:value => enqueue(() => updatePanel(key,value)),
            };
        },
        configurePanel:(id,bar) => mountPanelControls(id,bar,settings,savePanelPrompt,undefined,kitchen.getSettingSections()),
        initializeWorld:async () => { await requireFeatures(); return worldArchive.initialize({manual:true}); },
        toggleDrawer: hostScript.doNavbarIconClick,
    });
}
function installChatListener() {
    const events = createModuleEvents('kitchen-workspace');
    events.on(event_types.CHAT_CHANGED, () => { kitchen.reset(); worldArchive?.reset(); });
}

async function startWorld() {
    if (worldArchive) return;
    const { createWorldArchive } = await import('../modules/world-records/host.js');
    let removeWorldGeneration;
    worldArchive = createWorldArchive({ getContext, createOpening:createOpeningHost, getAmbientPreferences: () => settings.xiaobaiOs?.enabled ? {
            ...settings.xiaobaiOs.apps?.world,
            peopleEvolution:panelEnabled('people') && settings.xiaobaiOs.apps?.world?.peopleEvolution,
            subscribed:panelEnabled('situation') && settings.xiaobaiOs.apps?.world?.subscribed,
            encounterFrequency:panelEnabled('situation') ? settings.xiaobaiOs.apps?.world?.encounterFrequency : 'off',
        } : { encounterFrequency: 'off' }, getAccountId: getCurrentUserHandle, getMemorySnapshot: () => memory?.getWorldMemorySnapshot(),
        getMount: id => kitchen.getMount(id), isVisible: id => kitchen.isActive(id), onError: showError,
        onAuthorityChange: () => { removeWorldGeneration?.clear(); memory?.invalidateWorldContext(); } });
    const { installWorldAuthorityGeneration } = await import('../modules/world-records/generation-host.js');
    removeWorldGeneration = installWorldAuthorityGeneration({ getContext, prepare:query => settings.enabled ? worldArchive.prepare(query) : '', onError: showError });
    stopWorld = () => {
        worldArchive.initialize?.cancel?.();
        removeWorldGeneration();
        worldArchive.dispose();
        worldArchive = null; clearWorldPrompt = null; stopWorld = null;
    };
    window.registerKitchenModuleCleanup('world-records',() => stopWorld?.());
    
    clearWorldPrompt = removeWorldGeneration.clear;
}

export async function startKitchen(workspace) {
    requireTurnRuntime();
    kitchen = workspace;
    try {
    await prepareXiaobaiOsSettings();
    configureWorkspace();
    installChatListener();
    for (const [entry, id] of [
        ['runtime/call-generate', 'tk-call-generate'],
        ['runtime/worldbook', 'tk-worldbook'],
        ['runtime/context', 'tk-context'],
    ]) await loadBridge(entry, id);
    await import('./panel-prompt-catalog.js');
    if (settings.enabled) await startWorld();
    memory = await import('../modules/story-summary/story-summary.js');
    const panels = installFloorSummaries({ getSnapshot: memory.getFloorSummarySnapshot,
        updateFloor: memory.updateFloorSummary, extractFloor: memory.extractMainReplySummary,
        summarizeFloor: memory.summarizeFloorOnDemand,
        openMemory: floor => memory.openStoryMemory(floor) });
    floorPanels = panels;
    const floorEvents = createModuleEvents('kitchen-floor-summaries');
    floorEvents.on(event_types.CHAT_CHANGED, panels.reset);
    for (const key of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'MORE_MESSAGES_LOADED']) {
        if (event_types[key]) floorEvents.on(event_types[key], panels.schedule);
    }
    window.registerKitchenModuleCleanup('kitchen-floor-summaries', () => { panels.dispose(); floorEvents.cleanup(); });
    
    await syncPlanner();
    window.registerKitchenModuleCleanup('story-planner',() => planner?.dispose());
    if (settings.enabled && settings.xiaobaiOs?.enabled) await initXiaobaiOs();
    configureWorkspace();
    } catch (error) { startupError = error; throw error; } finally { readyResolve(); }
}
