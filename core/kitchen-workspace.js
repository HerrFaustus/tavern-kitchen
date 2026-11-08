import { extensionFolderPath } from './constants.js';
import { observeBackgroundTask } from '../shared/common/async-errors.js';

let workspace;
let nativeControls;

/** Read real host controls so custom Tavern themes also reach isolated frames. */
function syncNativeControls(target) {
    if (!nativeControls?.isConnected) {
        nativeControls = document.createElement('div');
        nativeControls.id = 'tk-native-controls';
        nativeControls.inert = true;
        nativeControls.setAttribute('aria-hidden', 'true');
        nativeControls.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:-10000px;top:0;';
        for (const [name, tag, classes] of [['button', 'button', 'menu_button'], ['selected', 'button', 'menu_button active'], ['disabled', 'button', 'menu_button'], ['field', 'input', 'text_pole'], ['heading', 'div', 'standoutHeader inline-drawer-header']]) {
            const control = document.createElement(tag);
            control.dataset.control = name; control.className = classes;
            if (tag === 'button') { control.type = 'button'; control.textContent = '后厨'; }
            if (name === 'disabled') control.disabled = true;
            nativeControls.append(control);
        }
        document.body.append(nativeControls);
    }
    const properties = ['background-color', 'background-image', 'color', 'border', 'border-radius', 'padding', 'font-size', 'font-family', 'font-weight', 'line-height', 'filter', 'opacity'];
    for (const control of nativeControls.children) {
        const style = getComputedStyle(control);
        for (const property of properties) target.style.setProperty(`--tk-${control.dataset.control}-${property}`, style.getPropertyValue(property));
    }
}
export const KITCHEN_TABS = [['overview', '主角'], ['world', '世界'], ['memory', '剧情'], ['planner', '规划'], ['settings', 'API 设置']];
export const KITCHEN_ROUTES = {
    overview: [['overview', '主角']],
    memory: [['memory', '剧情时间线'], ['suspense', '悬念簿'], ['proofreading', '剧情校对'], ['memory-settings', '剧情设置']],
    world: [['people', '人物'], ['map', '地图'], ['situation', '局势'], ['lore', '设定'], ['opening','世界初始化']],
    planner: [['planner', '剧情规划']],
    settings: [['settings', 'API 设置']],
};
const routeAliases = new Map([['world', 'people'], ['world-engine', 'situation'], ['world-records', 'situation'], ['summaries', 'memory-settings'], ['relations', 'people'], ['agent-api', 'settings']]);
const canonicalRoute = id => routeAliases.get(id) || id;
const parentOf = id => KITCHEN_TABS.find(([key]) => KITCHEN_ROUTES[key].some(([route]) => route === id))?.[0];
const worldTabs = new Set(['map', 'agent-api', 'settings']);
const memoryTabs = new Set(['memory', 'proofreading', 'situation', 'lore', 'people', 'relations', 'memory-settings']);
export const getKitchenMount = id => workspace?.getMount(id) ?? null;
export const openKitchenTab = id => workspace?.open(id);
export const closeKitchenWorkspace = () => workspace?.close();

/** Same-origin feature frames inherit the host theme without sharing their DOM globals. */
export function bindKitchenFrame(frame) {
    // Do not paint an unthemed document while its first host palette is being applied.
    frame.style.visibility = 'hidden';
    frame.addEventListener('load', () => {
        const doc = frame.contentDocument;
        if (!doc) return;
        doc.documentElement.classList.add('tk-embedded', 'tk-follow-host');
        doc.documentElement.dataset.kitchenTheme = 'host';
        doc.documentElement.removeAttribute('data-theme');
        let link = doc.getElementById('tk-embedded-styles');
        const preloaded = !!link;
        if (!link) {
            link = doc.createElement('link'); link.id = 'tk-embedded-styles';
            link.rel = 'stylesheet';
            link.href = new URL(`${extensionFolderPath}/core/kitchen-embedded.css`, document.baseURI).href;
            doc.head.append(link);
        }
        const sync = () => {
            const theme = getComputedStyle(document.body);
            for (const key of ['SmartThemeBodyColor', 'SmartThemeEmColor', 'SmartThemeQuoteColor', 'SmartThemeBorderColor', 'SmartThemeBlurTintColor', 'SmartThemeChatTintColor', 'SmartThemeShadowColor']) {
                doc.documentElement.style.setProperty(`--${key}`, theme.getPropertyValue(`--${key}`));
            }
            doc.documentElement.style.setProperty('--tk-font', theme.fontFamily);
            doc.documentElement.style.setProperty('--tk-font-size', theme.fontSize);
            doc.documentElement.style.setProperty('--tk-text-shadow', theme.textShadow);
            doc.documentElement.style.setProperty('--tk-color-scheme', theme.colorScheme);
            doc.documentElement.style.setProperty('--tk-motion-duration', theme.getPropertyValue('--animation-duration-2x').trim() || '200ms');
            syncNativeControls(doc.documentElement);
            doc.dispatchEvent(new doc.defaultView.CustomEvent('kitchen-theme-change'));
        };
        sync();
        const reveal = () => { if (frame.contentDocument === doc) { frame.style.removeProperty('visibility'); frame.dataset.kitchenFrameReady = 'true'; } };
        const stylesheetFailed = () => {
            const error = doc.createElement('p'); error.setAttribute('role', 'alert');
            error.textContent = '后厨界面样式加载失败，请刷新酒馆重试。';
            doc.body.replaceChildren(error); reveal();
        };
        if (link.sheet) reveal();
        else if (preloaded) stylesheetFailed();
        else {
            link.addEventListener('load', reveal, { once: true });
            link.addEventListener('error', stylesheetFailed, { once: true });
        }
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

export function createKitchenWorkspace({ actions = {}, settingsElement, featureSwitches = {}, onToggleFeature = () => {}, onVisibility = () => {}, toggleDrawer, documentTarget = document }) {
    if (workspace) return workspace;
    const doc = documentTarget;
    const panel = doc.createElement('section');
    panel.id = 'tk-workspace';
    panel.className = 'drawer-content closedDrawer fillRight';
    panel.setAttribute('aria-label', '酒馆后厨');
    const header = doc.createElement('header');
    header.className = 'tk-workspace-header';
    const title = doc.createElement('h2');
    title.textContent = '酒馆后厨';
    const close = doc.createElement('button');
    close.type = 'button'; close.className = 'menu_button tk-close';
    close.setAttribute('aria-label', '收起酒馆后厨'); close.title = '收起';
    const closeIcon = doc.createElement('i'); closeIcon.className = 'fa-solid fa-chevron-up'; closeIcon.setAttribute('aria-hidden', 'true'); close.append(closeIcon);
    header.append(title, close);
    const tabs = doc.createElement('nav');
    tabs.className = 'tk-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '后厨板块');
    const subnav = doc.createElement('nav'); subnav.className = 'tk-subnav'; subnav.setAttribute('aria-label', '板块内导航');
    const featureBar = doc.createElement('div'); featureBar.className = 'tk-feature-switches'; featureBar.hidden = true;
    const body = doc.createElement('div'); body.className = 'tk-workspace-body'; body.id = 'tk-workspace-content'; body.setAttribute('role', 'tabpanel');
    const mounts = new Map(), buttons = new Map();
    for (const [id, label] of KITCHEN_TABS) {
        const button = doc.createElement('button');
        button.type = 'button'; button.id = `tk-tab-${id}`; button.textContent = label; button.className = 'menu_button';
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', 'false');
        button.setAttribute('aria-controls', body.id); button.tabIndex = -1;
        button.addEventListener('click', () => navigate(id));
        tabs.append(button); buttons.set(id, button);
    }
    for (const [id, label] of Object.values(KITCHEN_ROUTES).flat()) {
        const mount = doc.createElement('div');
        mount.id = `tk-panel-${id}`; mount.className = 'tk-tab-panel'; mount.hidden = true;
        mount.setAttribute('role', 'region'); mount.setAttribute('aria-label', label);
        mounts.set(id, mount); body.append(mount);
    }
    const worldMount = doc.createElement('div');
    worldMount.id = 'tk-world-mount';
    worldMount.hidden = true; worldMount.setAttribute('role', 'region');
    body.append(worldMount);
    const memoryMount = doc.createElement('div'); memoryMount.id = 'tk-memory-mount'; memoryMount.hidden = true; body.append(memoryMount);
    if (settingsElement) mounts.get('settings').append(settingsElement);
    const evolution = doc.createElement('section');
    evolution.hidden = true; evolution.className = 'tk-evolution';
    let stopEvolution;
    panel.append(header, tabs, subnav, featureBar, body, evolution);
    const entry = doc.createElement('div'); entry.id = 'tk-topbar'; entry.className = 'drawer';
    const trigger = doc.createElement('button');
    trigger.type = 'button'; trigger.className = 'drawer-toggle tk-topbar-toggle';
    trigger.title = '酒馆后厨'; trigger.setAttribute('aria-label', '酒馆后厨');
    trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'false');
    const icon = doc.createElement('span'); icon.className = 'drawer-icon fa-solid fa-door-open fa-fw closedIcon'; icon.setAttribute('aria-hidden', 'true');
    trigger.append(icon); entry.append(trigger, panel);
    const inject = () => {
        const holder = doc.getElementById('top-settings-holder');
        if (!holder) return false;
        const persona = doc.getElementById('persona-management-button');
        const characters = doc.getElementById('rightNavHolder') || doc.getElementById('rightNavDrawerIcon')?.closest('.drawer');
        if (entry.parentElement === holder && (characters?.parentElement === holder ? entry.nextElementSibling === characters : persona?.parentElement === holder ? persona.nextElementSibling === entry : true)) return true;
        holder.insertBefore(entry, characters?.parentElement === holder ? characters : persona?.parentElement === holder ? persona.nextElementSibling : null);
        return true;
    };
    inject();
    const entryObserver = new doc.defaultView.MutationObserver(records => {
        if (!entry.isConnected || records.some(record => record.target === entry.parentElement)) inject();
    });
    entryObserver.observe(doc.body, { childList: true, subtree: true });
    let active = null, previousFocus = null, generation = 0, visible = false, pendingOpen = null;
    const isOpen = () => panel.classList.contains('openDrawer');
    const setOpen = (element, open) => {
        element.classList.toggle('openDrawer', open); element.classList.toggle('closedDrawer', !open);
        const drawerIcon = element.parentElement?.querySelector('.drawer-icon');
        drawerIcon?.classList.toggle('openIcon', open); drawerIcon?.classList.toggle('closedIcon', !open);
    };
    const syncVisibility = () => {
        const open = isOpen(); trigger.setAttribute('aria-expanded', String(open));
        panel.inert = !open;
        if (visible === open) return;
        visible = open;
        if (!open) generation += 1;
        if (!open) { stopEvolution?.(); stopEvolution = undefined; evolution.replaceChildren(); evolution.hidden = true; }
        onVisibility(open, active);
    };
    panel.inert = true;
    // Native outside-click, other drawers and host shortcuts can close us directly.
    const drawerObserver = new doc.defaultView.MutationObserver(syncVisibility);
    drawerObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
    const ensureOpen = async () => {
        if (isOpen()) return;
        if (!pendingOpen) {
            previousFocus = doc.activeElement;
            pendingOpen = Promise.resolve().then(async () => {
                if (typeof toggleDrawer === 'function') await toggleDrawer.call(trigger);
                else {
                    for (const other of doc.querySelectorAll('.openDrawer:not(.pinnedOpen)')) setOpen(other, false);
                    setOpen(panel, true);
                }
            }).finally(() => { pendingOpen = null; syncVisibility(); });
        }
        await pendingOpen;
    };
    const report = (mount, error, id) => {
        const message = doc.createElement('div'); message.className = 'tk-panel-message'; message.setAttribute('role', 'status');
        const text = doc.createElement('p'); text.textContent = error?.message || '暂时无法打开此板块。';
        const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'menu_button'; retry.textContent = '重试';
        retry.addEventListener('click', () => { active = null; navigate(id); });
        const settings = doc.createElement('button'); settings.type = 'button'; settings.className = 'menu_button'; settings.textContent = '前往 API 设置';
        settings.addEventListener('click', () => navigate('settings'));
        message.append(text, retry, settings); mount.prepend(message);
    };
    const navigate = id => observeBackgroundTask(api.open(id), { source: import.meta.url, operation: 'open-workspace' });
    let visiblePanel = id => id !== 'opening';
    let configurePanel;
    const routesFor = parent => KITCHEN_ROUTES[parent].filter(([id]) => visiblePanel(id));
    const firstRoute = () => KITCHEN_TABS.flatMap(([parent]) => routesFor(parent))[0]?.[0];
    const buildSubnav = parent => {
        subnav.replaceChildren();
        subnav.dataset.section = parent;
        for (const [route, label] of routesFor(parent)) {
            const button = doc.createElement('button');
            button.type = 'button';
            button.className = 'menu_button';
            button.textContent = label;
            button.dataset.route = route;
            button.addEventListener('click', () => navigate(route));
            subnav.append(button);
        }
    };
    let initializeWorld, panelSettings;
    const renderFeatureBar = id => {
        const items = featureSwitches[id] || [];
        featureBar.replaceChildren(); featureBar.hidden = !items.length;
        if (configurePanel) configurePanel(id, featureBar);
        if ((id === 'opening' || !configurePanel && parentOf(id) === 'world') && initializeWorld) {
            featureBar.hidden = false;
            const button = doc.createElement('button');
            button.type = 'button'; button.className = 'menu_button'; button.textContent = '初始化世界';
            const status = doc.createElement('span'); status.setAttribute('role','status');
            const initialize = async () => {
                button.disabled = true; status.textContent = '正在读取开局资料…';
                try { status.textContent = await initializeWorld(); }
                catch (error) { status.textContent = error.message || '初始化失败，请重试'; }
                finally { button.disabled = false; }
            };
            button.addEventListener('click',() => observeBackgroundTask(initialize(),{source:import.meta.url,operation:'initialize-world'}));
            featureBar.append(button,status);
        }
        for (const item of items) {
            const label = doc.createElement('label'); label.className = 'tk-feature-switch';
            const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = !!item.checked;
            input.addEventListener('change', () => onToggleFeature(item.key, input.checked, item));
            const text = doc.createElement('span'); text.textContent = item.label;
            label.append(input, text); featureBar.append(label);
        }
    };
    const api = {
        configure(options) {
            initializeWorld = options.initializeWorld;
            actions = options.actions;
            configurePanel = options.configurePanel;
            if (options.visiblePanel) visiblePanel = options.visiblePanel;
            for (const [parent,button] of buttons) button.hidden = !routesFor(parent).length;
            const available = firstRoute();
            if (options.panelSettings && panelSettings !== options.panelSettings) {
                panelSettings?.remove();
                panelSettings = options.panelSettings;
                panel.insertBefore(panelSettings, tabs);
            }
            entry.hidden = !available && !panelSettings;
            tabs.hidden = body.hidden = !available;
            delete subnav.dataset.section;
            toggleDrawer = options.toggleDrawer;
            onVisibility = options.onVisibility || (() => {});
            if (options.featureSwitches) featureSwitches = options.featureSwitches;
            if (options.onToggleFeature) onToggleFeature = options.onToggleFeature;
            if (options.settingsElement) mounts.get('settings').replaceChildren(options.settingsElement);
            if (!available) {
                generation++;
                active = null;
                subnav.hidden = featureBar.hidden = evolution.hidden = true;
                stopEvolution?.(); stopEvolution = undefined;
                if (panelSettings) panelSettings.open = true;
                else api.close();
                return;
            }
            if (!active && isOpen()) { navigate(available); return; }
            if (active && isOpen()) { const id = visiblePanel(active) ? active : available; active = null; navigate(id); }
            else if (active) renderFeatureBar(active);
        },
        failStartup(error) {
            for (const [id] of Object.values(KITCHEN_ROUTES).flat()) {
                const mount = api.getMount(id);
                mount.querySelector('.tk-panel-message')?.remove();
                const message = doc.createElement('div'); message.className = 'tk-panel-message'; message.setAttribute('role', 'alert');
                const text = doc.createElement('p'); text.textContent = `后厨加载失败：${error?.message || '请刷新后重试。'}`;
                const reload = doc.createElement('button'); reload.type = 'button'; reload.className = 'menu_button'; reload.textContent = '重新加载';
                reload.addEventListener('click', () => doc.defaultView.location.reload());
                message.append(text, reload); mount.replaceChildren(message);
                mount.removeAttribute('aria-busy');
                actions[id] = () => { throw error; };
            }
        },
        showEvolution(mount) {
            stopEvolution?.(); evolution.hidden = false;
            stopEvolution = mount(evolution);
        },
        getMount(id) {
            const route = canonicalRoute(id);
            return worldTabs.has(route) ? worldMount : memoryTabs.has(route) ? memoryMount : mounts.get(route);
        },
        isActive: id => isOpen() && active === canonicalRoute(id),
        async open(id = active || 'overview') {
            id = canonicalRoute(id);
            if (!visiblePanel(id)) id = routesFor(parentOf(id) || 'overview')[0]?.[0] || firstRoute();
            if (!id) {
                if (panelSettings) { panelSettings.open = true; await ensureOpen(); }
                return;
            }
            const parent = parentOf(id);
            if (!parent) return;
            const wasClosed = !isOpen();
            if (active === id && !wasClosed) return;
            const token = ++generation;
            await ensureOpen();
            if (token !== generation || !isOpen()) return;
            active = id;
            for (const [key, button] of buttons) {
                button.setAttribute('aria-selected', String(key === parent)); button.tabIndex = key === parent ? 0 : -1;
                button.classList.toggle('active', key === parent);
            }
            body.setAttribute('aria-labelledby', `tk-tab-${parent}`);
            for (const [key, mount] of mounts) mount.hidden = key !== id || worldTabs.has(key) || memoryTabs.has(key);
            worldMount.hidden = !worldTabs.has(id);
            memoryMount.hidden = !memoryTabs.has(id);
            worldMount.setAttribute('aria-label', Object.values(KITCHEN_ROUTES).flat().find(([key]) => key === id)?.[1] || '世界工具');
            // Retain focused controls when switching routes inside one section.
            if (subnav.dataset.section !== parent) buildSubnav(parent);
            for (const button of subnav.querySelectorAll('button[data-route]')) {
                button.setAttribute('aria-pressed', String(button.dataset.route === id));
                button.classList.toggle('active', button.dataset.route === id);
            }
            subnav.hidden = routesFor(parent).length < 2;
            stopEvolution?.(); stopEvolution = undefined; evolution.replaceChildren(); evolution.hidden = true;
            renderFeatureBar(id);
            onVisibility(true, id);
            if (wasClosed) buttons.get(parent).focus({ preventScroll: true });
            const mount = api.getMount(id); mount.querySelector('.tk-panel-message')?.remove();
            mount.setAttribute('aria-busy', 'true');
            const loading = !mount.childElementCount ? doc.createElement('p') : null;
            if (loading) { loading.className = 'tk-panel-message'; loading.setAttribute('role', 'status'); loading.textContent = '正在加载后厨…'; mount.append(loading); }
            if (!actions[id] && id !== 'settings') return;
            Promise.resolve().then(() => actions[id]?.()).catch(error => {
                if (token === generation) report(mount, error, id);
            }).finally(() => { loading?.remove(); mount.removeAttribute('aria-busy'); });
        },
        close() {
            generation += 1;
            if (pendingOpen) void pendingOpen.then(() => { setOpen(panel, false); syncVisibility(); });
            setOpen(panel, false); syncVisibility();
            (previousFocus?.isConnected ? previousFocus : trigger).focus({ preventScroll: true });
        },
        reset() { active = null; api.close(); generation += 1; },
    };
    close.addEventListener('click', api.close);
    trigger.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); isOpen() || pendingOpen ? api.close() : navigate(); });
    tabs.addEventListener('keydown', event => {
        const ids = [...buttons.keys()].filter(id => !buttons.get(id).hidden); const index = ids.indexOf(event.target.id?.replace('tk-tab-', ''));
        if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        buttons.get(ids[next]).focus(); navigate(ids[next]);
    });
    panel.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault(); api.close();
    });
    workspace = api;
    return api;
}
