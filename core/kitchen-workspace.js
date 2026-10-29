import { extensionFolderPath } from './constants.js';

let workspace;
export const KITCHEN_TABS = [
    ['memory', '记忆'], ['planner', '规划'], ['variables', '变量'],
    ['map', '地图'], ['world', '世界'], ['dice', '骰子'], ['agent-api', 'API'], ['settings', '设置'],
];
const worldTabs = new Set(['map', 'world', 'dice', 'agent-api']);
export const getKitchenMount = id => workspace?.getMount(id) ?? null;
export const openKitchenTab = id => workspace?.open(id);
export const closeKitchenWorkspace = () => workspace?.close();

/** Same-origin feature frames inherit the host theme without sharing their DOM globals. */
export function bindKitchenFrame(frame) {
    frame.addEventListener('load', () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        doc.documentElement.classList.add('tk-embedded');
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL(`${extensionFolderPath}/core/kitchen-embedded.css`, document.baseURI).href;
        doc.head.append(link);
        const sync = () => {
            const theme = getComputedStyle(document.body);
            for (const key of ['SmartThemeBodyColor', 'SmartThemeEmColor', 'SmartThemeQuoteColor', 'SmartThemeBorderColor', 'SmartThemeBlurTintColor', 'SmartThemeChatTintColor']) {
                doc.documentElement.style.setProperty(`--${key}`, theme.getPropertyValue(`--${key}`));
            }
            doc.documentElement.style.setProperty('--tk-font', theme.fontFamily);
        };
        sync();
        const observer = new MutationObserver(sync);
        for (const target of [document.documentElement, document.body]) observer.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        const stop = new MutationObserver(() => {
            if (frame.isConnected) return;
            observer.disconnect();
            stop.disconnect();
        });
        stop.observe(document.body, { childList: true, subtree: true });
        frame.contentWindow.addEventListener('pagehide', () => { observer.disconnect(); stop.disconnect(); }, { once: true });
    });
}

function chefIcon(doc) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const shape = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', 'M7 14a4.5 4.5 0 1 1 .6-8.96 4.7 4.7 0 0 1 8.8 0A4.5 4.5 0 1 1 17 14v6H7v-6Zm0 3h10M10 13v1m4-1v1');
    svg.append(shape);
    return svg;
}

export function createKitchenWorkspace({ actions, settingsElement, onVisibility = () => {}, documentTarget = document }) {
    if (workspace) return workspace;
    const doc = documentTarget;
    const panel = doc.createElement('section');
    panel.id = 'tk-workspace';
    panel.hidden = true;
    panel.setAttribute('aria-label', '酒馆后厨');
    const header = doc.createElement('header');
    header.className = 'tk-workspace-header';
    const title = doc.createElement('h2');
    title.append(chefIcon(doc), doc.createTextNode('酒馆后厨'));
    const close = doc.createElement('button');
    close.type = 'button'; close.className = 'menu_button tk-close';
    close.textContent = '收起'; close.setAttribute('aria-label', '收起酒馆后厨');
    header.append(title, close);
    const tabs = doc.createElement('nav');
    tabs.className = 'tk-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '后厨板块');
    const body = doc.createElement('div'); body.className = 'tk-workspace-body';
    const mounts = new Map(), buttons = new Map();
    for (const [id, label] of KITCHEN_TABS) {
        const button = doc.createElement('button');
        button.type = 'button'; button.id = `tk-tab-${id}`; button.textContent = label;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', 'false');
        button.setAttribute('aria-controls', worldTabs.has(id) ? 'tk-world-mount' : `tk-panel-${id}`); button.tabIndex = -1;
        button.addEventListener('click', () => api.open(id));
        tabs.append(button); buttons.set(id, button);
        const mount = doc.createElement('div');
        mount.id = `tk-panel-${id}`; mount.className = 'tk-tab-panel'; mount.hidden = true;
        mount.setAttribute('role', 'tabpanel'); mount.setAttribute('aria-labelledby', button.id);
        mounts.set(id, mount); body.append(mount);
    }
    const worldMount = doc.createElement('div');
    worldMount.id = 'tk-world-mount';
    worldMount.hidden = true; worldMount.setAttribute('role', 'tabpanel');
    body.append(worldMount);
    mounts.get('settings').append(settingsElement);
    panel.append(header, tabs, body); doc.body.append(panel);
    const entry = doc.createElement('div'); entry.id = 'tk-topbar'; entry.className = 'drawer';
    const trigger = doc.createElement('button');
    trigger.type = 'button'; trigger.className = 'drawer-toggle tk-topbar-toggle';
    trigger.title = '酒馆后厨'; trigger.setAttribute('aria-label', '酒馆后厨');
    trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'false');
    const icon = doc.createElement('span'); icon.className = 'drawer-icon closedIcon'; icon.append(chefIcon(doc));
    trigger.append(icon); entry.append(trigger);
    const inject = () => {
        const holder = doc.getElementById('top-settings-holder');
        if (!holder) return false;
        const persona = doc.getElementById('persona-management-button');
        holder.insertBefore(entry, persona?.parentElement === holder ? persona : null);
        return true;
    };
    let entryObserver;
    if (!inject()) {
        entryObserver = new MutationObserver(() => { if (inject()) entryObserver.disconnect(); });
        entryObserver.observe(doc.body, { childList: true, subtree: true });
    }
    let active = null, opening = false, previousFocus = null, generation = 0;
    const report = (mount, error, id) => {
        const message = doc.createElement('div'); message.className = 'tk-panel-message'; message.setAttribute('role', 'status');
        const text = doc.createElement('p'); text.textContent = error?.message || '暂时无法打开此板块。';
        const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'menu_button'; retry.textContent = '重试';
        retry.addEventListener('click', () => { active = null; api.open(id); });
        const settings = doc.createElement('button'); settings.type = 'button'; settings.className = 'menu_button'; settings.textContent = '前往设置';
        settings.addEventListener('click', () => api.open('settings'));
        message.append(text, retry, settings); mount.prepend(message);
    };
    const api = {
        getMount: id => worldTabs.has(id) ? worldMount : mounts.get(id),
        isActive: id => !panel.hidden && active === id,
        open(id = active || 'memory') {
            if (!buttons.has(id)) return;
            const wasClosed = panel.hidden;
            if (wasClosed) previousFocus = doc.activeElement;
            panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
            if (active === id && !wasClosed) return;
            const token = ++generation; active = id;
            for (const [key, button] of buttons) {
                button.setAttribute('aria-selected', String(key === id)); button.tabIndex = key === id ? 0 : -1;
                mounts.get(key).hidden = key !== id || worldTabs.has(key);
            }
            worldMount.hidden = !worldTabs.has(id);
            if (worldTabs.has(id)) worldMount.setAttribute('aria-labelledby', `tk-tab-${id}`);
            onVisibility(true, id);
            if (opening) return;
            opening = true;
            const mount = api.getMount(id); mount.querySelector('.tk-panel-message')?.remove();
            mount.setAttribute('aria-busy', 'true');
            Promise.resolve().then(() => actions[id]?.()).catch(error => {
                if (token === generation) report(mount, error, id);
            }).finally(() => { mount.removeAttribute('aria-busy'); });
            opening = false;
            if (wasClosed) buttons.get(id).focus({ preventScroll: true });
        },
        close() {
            if (panel.hidden) return;
            generation += 1;
            panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
            onVisibility(false, active); (previousFocus?.isConnected ? previousFocus : trigger).focus({ preventScroll: true });
        },
        reset() { active = null; api.close(); generation += 1; },
    };
    close.addEventListener('click', api.close);
    trigger.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); panel.hidden ? api.open() : api.close(); });
    tabs.addEventListener('keydown', event => {
        const ids = [...buttons.keys()]; const index = ids.indexOf(event.target.id?.replace('tk-tab-', ''));
        if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        buttons.get(ids[next]).focus(); api.open(ids[next]);
    });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); api.close(); } });
    workspace = api;
    return api;
}
