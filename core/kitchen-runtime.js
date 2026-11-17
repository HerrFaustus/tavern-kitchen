import { floorTasks, installFloorHost } from './floor-host.js';
import { getUpdateAndSimulationBounds } from '../modules/story-summary/data/turn-bounds.js';
import { isRangeSourceCurrent } from '../modules/story-summary/data/turn-source.js';
import { createKitchenCards } from '../modules/kitchen-data/card.js';
import { createArchiveCleanup } from '../modules/kitchen-data/archive-cleanup.js';
// 酒馆后厨 0.1 — Based on LittleWhiteBox by biex.
import { installFloorSummaries } from '../modules/story-summary/floor-summary.js';
import { createModuleEvents, event_types } from './event-manager.js';
import { extension_settings, getContext } from '../../../../extensions.js';
import * as hostScript from '../../../../../script.js';
import { getCurrentUserHandle } from '../../../../user.js';
import { EXT_ID } from './constants.js';
import { buildEntryUrl } from './build-assets.js';
import { usePanelSettings } from './panel-policy.js';
import { requireAgent } from './panel-controls.js';
import { createExtensionDrawer } from './extension-drawer.js';
import { createDefaultXiaobaiOsSettings, prepareXiaobaiOsSettings, initXiaobaiOs, cleanupXiaobaiOs, setXiaobaiOsEnabled, mountWorldSettings, openXiaobaiOs } from '../modules/xiaobai-os/index.js';
import { createOpeningHost } from '../modules/world-records/opening-host.js';
import { requireTurnRuntime } from '../modules/world-records/turn-runtime.js';
import { runUpgradeSelfCheck } from './upgrade-selfcheck.js';
const { saveSettings } = hostScript;

const settings = extension_settings[EXT_ID] ??= {
    enabled: true,
    storySummary: { enabled: true },
    enaPlanner: { enabled: true, onChapter: true },
    xiaobaiOs: createDefaultXiaobaiOsSettings(),
};
(settings.storySummary ??= {}).enabled = true;
settings.enabled = true;
settings.enaPlanner ??= { enabled: true, onChapter: true };
settings.enaPlanner.enabled = true;
settings.enaPlanner.onChapter = true;
usePanelSettings(settings);
window.isTavernKitchenEnabled = settings.enabled;
let stopWorld, stopWorldSettings, floorHost;
const notifiedUpgradeSelfChecks = new Set();
async function runStartupUpgradeSelfCheck() {
    const ctx = getContext();
    const chatId = String(ctx?.chatId || '');
    if (!chatId) return null;
    try {
        const worldState = worldArchive?.service?.read
            ? await worldArchive.service.read().catch(() => null)
            : null;
        const vectorStatus = memory?.inspectCurrentVectorStatusForUpgrade
            ? await memory.inspectCurrentVectorStatusForUpgrade().catch(() => null)
            : null;
        const report = await runUpgradeSelfCheck({
            storySummary: null,
            chat: Array.isArray(ctx?.chat) ? ctx.chat : [],
            worldState,
            vectorStatus,
        });
        if (!report.ok && report.notices.length) {
            const noticeKey = `${chatId}::${report.notices.join('|')}`;
            if (!notifiedUpgradeSelfChecks.has(noticeKey)) {
                notifiedUpgradeSelfChecks.add(noticeKey);
                console.warn('[TavernKitchen] 升级自检发现需要人工处理的项:', report.notices);
                globalThis.toastr?.warning?.(report.notices.join('\n'), '酒馆后厨 · 升级自检提示');
            }
        }
        return report;
    } catch (error) {
        console.warn('[TavernKitchen] 升级自检执行异常:', error);
        return null;
    }
}
async function syncPlanner() {
    if (!settings.enabled) { planner?.dispose(); planner = null; return; }
    if (planner || !worldArchive) return;
    const { installPlanner } = await import('../modules/story-planner/host.js');
    planner = installPlanner({snapshot:worldArchive.plannerSnapshot,loadSnapshot:worldArchive.loadPlannerSnapshot,
        isVisible:() => kitchen.isActive('planner'),getContext,settings:settings.enaPlanner,saveSettings,
        enabled:() => true, checkBinding:() => requireAgent('planner'), visitBinding:kitchen.visitBinding});
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
        recall: async () => {
            await requireFeatures();
            if (!kitchen.isActive('recall')) return;
            if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
            memory.openStoryMemorySettings('recall');
        },
        'settings-memory': async () => {
            await requireFeatures();
            if (!kitchen.isActive('settings-memory')) return;
            if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
            memory.openStoryMemorySettings('settings-memory');
        },
        'settings-world': async () => {
            await requireFeatures();
            if (!kitchen.isActive('settings-world')) return;
            if (!settings.xiaobaiOs?.enabled) await setXiaobaiOsEnabled(true);
            const mount = kitchen.getMount('settings-world');
            if (!mount) return;
            stopWorldSettings?.();
            stopWorldSettings = mountWorldSettings(mount);
        },
        planner: async () => {
            await requireFeatures();
            if (!kitchen.isActive('planner')) return;
            if (!planner) throw new Error('编剧模块尚未准备好，请刷新后重试。');
            await planner.open(kitchen.getMount('planner'));
        },
    };
    for (const id of ['situation', 'people', 'relations']) actions[id] = async () => {
        await requireFeatures();
        if (!kitchen.isActive(id)) return;
        if (!memory) throw new Error('剧情记忆尚未准备好，请刷新后重试。');
        memory.openStoryWorld(id === 'situation' ? 'world' : id);
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
        initializeWorld:async () => { await requireFeatures(); await requireAgent('update'); return worldArchive.initialize({manual:true}); },
        toggleDrawer: hostScript.doNavbarIconClick,
    });
}
function installChatListener() {
    const events = createModuleEvents('kitchen-workspace');
    events.on(event_types.CHAT_CHANGED, () => {
        stopWorldSettings?.();
        stopWorldSettings = null;
        kitchen.reset();
        worldArchive?.reset();
        runStartupUpgradeSelfCheck().catch(() => null);
    });
}

async function startWorld() {
    if (worldArchive) return;
    const { createWorldArchive } = await import('../modules/world-records/host.js');
    let removeWorldGeneration;
    worldArchive = createWorldArchive({ getContext, ordered:true, active:() => floorTasks(settings).some(s => s.group === 'update' || s.group === 'simulation'), recoverMemory: () => memory, createOpening:createOpeningHost, getAmbientPreferences: () => ({
            ...settings.xiaobaiOs?.apps?.world,
            peopleEvolution: true,
            subscribed: true,
            sceneryEvolution: true,
            encounterFrequency: settings.xiaobaiOs?.apps?.world?.encounterFrequency ?? 'occasional',
            injectToStory: true,
        }), getAccountId: getCurrentUserHandle, getMemorySnapshot: () => memory?.getWorldMemorySnapshot(),
        getMount: id => kitchen.getMount(id), isVisible: id => kitchen.isActive(id), onError: showError,
        onAuthorityChange: () => { removeWorldGeneration?.clear(); memory?.invalidateWorldContext(); } });
    const { installWorldAuthorityGeneration } = await import('../modules/world-records/generation-host.js');
    removeWorldGeneration = installWorldAuthorityGeneration({ getContext, prepare: (query, type) => {
        const tasks = floorTasks(settings).map(step => step.key).filter(key => !['memory','chapter'].includes(key));
        return tasks.length ? worldArchive.prepareInjection(query, type, tasks) : '';
    }, prepareSimulation: type => {
        const snapshot = memory?.getFloorSummarySnapshot?.(true);
        const store = snapshot?.store, chat = snapshot?.chat || [];
        if (!snapshot?.enabled || !store || !chat.length || snapshot.invalidFrom != null || store.summaryInvalid || store.sourceRollbackFromFloor != null) return '';
        const ceiling = ['swipe', 'regenerate'].includes(type) ? chat.length - 2 : chat.length - 1;
        if (ceiling < 0) return '';
        const { simulationEnd, updateEnd } = getUpdateAndSimulationBounds(chat, ceiling);
        if (simulationEnd < 0 || simulationEnd <= updateEnd || simulationEnd <= (store.lastSummarizedMesId ?? -1)) return '';
        const sim = store.floorSimulations?.[simulationEnd];
        const simText = typeof sim?.text === 'string' ? sim.text.trim() : '';
        if (!simText) return '';
        const candidate = chat[simulationEnd]?.swipe_id ?? 0;
        if (sim.candidate != null && sim.candidate !== candidate) return '';
        const start = Number.isInteger(sim.start) ? sim.start : (chat[simulationEnd - 1]?.is_user ? simulationEnd - 1 : simulationEnd);
        if (!isRangeSourceCurrent({ start, end: simulationEnd, digest: sim.digest }, chat)) return '';
        return `[以下为紧邻上轮正文的只读后台延伸（非主楼原文，严禁复述或当成玩家行动）]\n${simText}\n[后台延伸结束：请作为已自然衔接上述背景的叙述者续写]`;
    }, onError: showError });
    stopWorld = () => {
        worldArchive.initialize?.cancel?.();
        removeWorldGeneration();
        worldArchive.dispose();
        worldArchive = null; stopWorld = null;
    };
    window.registerKitchenModuleCleanup('world-records',() => stopWorld?.());
}

export async function startKitchen(workspace) {
    requireTurnRuntime();
    kitchen = workspace;
    try {
    await prepareXiaobaiOsSettings();
    if (!settings.xiaobaiOs?.enabled) await setXiaobaiOsEnabled(true);
    configureWorkspace();
    installChatListener();
    for (const [entry, id] of [
        ['runtime/call-generate', 'tk-call-generate'],
        ['runtime/worldbook', 'tk-worldbook'],
        ['runtime/context', 'tk-context'],
    ]) await loadBridge(entry, id);
    if (settings.enabled) await startWorld();
    memory = await import('../modules/story-summary/story-summary.js');
    memory.configureArchiveCleanup(createArchiveCleanup({
        getContext,
        getRequestHeaders: hostScript.getRequestHeaders,
        getWorldStorage: () => worldArchive?.storage,
        getNoteStore: () => worldArchive?.noteStore,
        memoryStore: memory.archiveMemoryStore(),
    }));
    // WHY: 2A retires main-reply <kitchen_summary> extraction and bypass generation;
    // panel summarizeFloor routes single-floor rerun through floorHost when installed.
    const panels = installFloorSummaries({ getSnapshot: memory.getFloorSummarySnapshot,
        summarizeFloor: floor => (floorHost ? floorHost.rerunFloor(floor) : memory.summarizeFloorOnDemand(floor)),
        openMemory: floor => memory.openStoryMemory(floor) });
    const floorEvents = createModuleEvents('kitchen-floor-summaries');
    floorEvents.on(event_types.CHAT_CHANGED, panels.reset);
    for (const key of ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'MORE_MESSAGES_LOADED']) {
        if (event_types[key]) floorEvents.on(event_types[key], panels.schedule);
    }
    window.registerKitchenModuleCleanup('kitchen-floor-summaries', () => { panels.dispose(); floorEvents.cleanup(); });
    
    await syncPlanner();
    if (worldArchive) {
        floorHost = installFloorHost({ settings, getContext, memory, archive:() => worldArchive, planner:() => planner, workspace:kitchen });
        memory.configureFloorRunner(floorHost);
    }
    window.registerKitchenModuleCleanup('ordered-floors', () => {
        memory?.configureFloorRunner?.(null);
        floorHost?.dispose();
    });
    window.registerKitchenModuleCleanup('story-planner',() => planner?.dispose());
    window.registerKitchenModuleCleanup('world-settings', () => { stopWorldSettings?.(); stopWorldSettings = null; });
    window.registerKitchenModuleCleanup('xiaobai-os', cleanupXiaobaiOs);
    if (settings.enabled && settings.xiaobaiOs?.enabled) await initXiaobaiOs();
    configureWorkspace();
    await runStartupUpgradeSelfCheck();
    } catch (error) { startupError = error; throw error; } finally { readyResolve(); }
}
