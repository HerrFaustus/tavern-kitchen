// 酒馆后厨 0.1 — Based on LittleWhiteBox by biex.
import { extension_settings } from '../../../extensions.js';
import { saveSettings, chat } from '../../../../script.js';
import { EXT_ID, extensionFolderPath } from './core/constants.js';
import { buildEntryUrl } from './core/build-assets.js';
import { createDefaultXiaobaiOsSettings, prepareXiaobaiOsSettings, initXiaobaiOs, openXiaobaiOs, isDiceContinuationPending } from './modules/xiaobai-os/index.js';
import { configureL0ContinuationCheck } from './modules/story-summary/vector/pipeline/l0-eligibility.js';
import { observeAsyncCallback } from './shared/common/async-errors.js';

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
    $('#extensions_settings').append(await response.text());
    const root = document.getElementById('tavern-kitchen-settings');
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
        memory: () => {
            if (!memory || !chat.length) throw new Error('请启用记忆、刷新页面并进入一段聊天。');
            memory.openStoryMemory();
        },
        planner: () => {
            if (!planner) throw new Error('请先勾选剧情规划，保存并刷新。');
            window.tavernKitchenEnaPlanner?.openSettings();
        },
        world: () => openXiaobaiOs(),
    };
    for (const [name, action] of Object.entries(actions)) {
        const button = root.querySelector(`[data-action="${name}"]`);
        button.disabled = !settings.enabled;
        button.addEventListener('click', () => { void Promise.resolve().then(action).catch(showError); });
    }
}

jQuery(observeAsyncCallback(async () => {
    await prepareXiaobaiOsSettings();
    await mountSettings();
    if (!settings.enabled) return;
    for (const [entry, id] of [
        ['runtime/call-generate', 'tk-call-generate'],
        ['runtime/worldbook', 'tk-worldbook'],
        ['runtime/context', 'tk-context'],
    ]) await loadBridge(entry, id);
    if (settings.storySummary?.enabled) memory = await import('./modules/story-summary/story-summary.js');
    if (settings.variablesCore?.enabled || settings.variablesPanel?.enabled) {
        const commands = await import('./modules/variables/var-commands.js');
        const events = await import('./modules/variables/varevent-editor.js');
        commands.initVarCommands();
        events.initVareventEditor();
        if (settings.variablesCore?.enabled) (await import('./modules/variables/variables-core.js')).initVariablesCore();
        if (settings.variablesPanel?.enabled) await (await import('./modules/variables/variables-panel.js')).initVariablesPanel();
    }
    if (settings.enaPlanner?.enabled) {
        planner = await import('./modules/ena-planner/ena-planner.js');
        await planner.initEnaPlanner();
    }
    if (settings.xiaobaiOs?.enabled) await initXiaobaiOs();
}, { source: import.meta.url, operation: 'startup' }));
