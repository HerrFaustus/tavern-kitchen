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
        for (const [name, tag, classes] of [['button', 'button', 'menu_button'], ['selected', 'button', 'menu_button active'], ['disabled', 'button', 'menu_button'], ['field', 'input', 'text_pole'], ['select', 'select', 'text_pole'], ['heading', 'div', 'standoutHeader inline-drawer-header']]) {
            const control = document.createElement(tag);
            control.dataset.control = name; control.className = classes;
            if (tag === 'button') { control.type = 'button'; control.textContent = '后厨'; }
            if (tag === 'select') control.append(new Option('连接', 'connection'));
            if (name === 'disabled') control.disabled = true;
            nativeControls.append(control);
        }
        document.body.append(nativeControls);
    }
    const properties = ['background-color', 'background-image', 'color', 'border', 'border-radius', 'padding', 'font-size', 'font-family', 'font-weight', 'line-height', 'filter', 'opacity', 'height', 'appearance', 'background-position', 'background-size', 'background-repeat'];
    for (const control of nativeControls.children) {
        const style = getComputedStyle(control);
        for (const property of properties) target.style.setProperty(`--tk-${control.dataset.control}-${property}`, style.getPropertyValue(property));
    }
}
export const KITCHEN_TABS = [['overview', '主角'], ['world', '世界'], ['memory', '剧情'], ['planner', '编剧'], ['settings', '设置'], ['data', '数据']];
export const KITCHEN_ROUTES = {
    overview: [['overview', '主角']],
    memory: [['memory', '总结'], ['recall', '召回'], ['suspense', '悬念']],
    world: [['people', '人物'], ['map', '地图'], ['situation', '局势'], ['opening', '世界生成']],
    planner: [['planner', '编剧']],
    settings: [['settings', 'API'], ['settings-memory', '剧情与召回'], ['settings-world', '世界与推演']],
    data: [['data', '数据']],
};
const routeAliases = new Map([
    ['world', 'people'],
    ['world-engine', 'situation'],
    ['world-records', 'situation'],
    ['summaries', 'memory'],
    ['memory-settings', 'settings-memory'],
    ['relations', 'people'],
    ['agent-api', 'settings'],
]);
const canonicalRoute = id => routeAliases.get(id) || id;
const parentOf = id => KITCHEN_TABS.find(([key]) => KITCHEN_ROUTES[key].some(([route]) => route === id))?.[0];
const worldTabs = new Set(['map', 'agent-api', 'settings']);
const memoryTabs = new Set(['data', 'memory', 'recall', 'situation', 'people', 'relations', 'settings-memory']);
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
        const stopControls = workspace?.attachFrame(frame);
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
            stopControls?.();
            stop.disconnect();
        });
        stop.observe(document.body, { childList: true, subtree: true });
        frame.contentWindow.addEventListener('pagehide', () => { observer.disconnect(); stopControls?.(); stop.disconnect(); }, { once: true });
    });
}

export function createKitchenWorkspace({ actions = {}, settingsElement, featureSwitches = {}, onToggleFeature = () => {}, onVisibility = () => {}, toggleDrawer, documentTarget = document }) {
    if (workspace) return workspace;
    const doc = documentTarget;
    const panel = doc.createElement('section');
    panel.id = 'tk-workspace';
    panel.className = 'drawer-content closedDrawer fillRight';
    panel.setAttribute('aria-label', '酒馆后厨');
    const titlebar = doc.createElement('header');
    titlebar.className = 'tk-workspace-titlebar';
    const appTitle = doc.createElement('h3');
    appTitle.className = 'tk-workspace-app-title margin0';
    appTitle.textContent = '酒馆后厨';
    const titleActions = doc.createElement('div');
    titleActions.className = 'tk-titlebar-actions';
    const back = doc.createElement('button');
    back.type = 'button'; back.className = 'menu_button tk-back'; back.hidden = true;
    const close = doc.createElement('button');
    close.type = 'button'; close.className = 'menu_button tk-close';
    close.setAttribute('aria-label', '收起酒馆后厨'); close.title = '收起';
    const closeIcon = doc.createElement('i'); closeIcon.className = 'fa-solid fa-chevron-up'; closeIcon.setAttribute('aria-hidden', 'true'); close.append(closeIcon);
    titleActions.append(back, close);
    titlebar.append(appTitle, titleActions);

    const tabs = doc.createElement('nav');
    tabs.className = 'tk-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '后厨板块');
    const subnav = doc.createElement('nav'); subnav.className = 'tk-subnav'; subnav.setAttribute('aria-label', '板块内导航');
    const featureBar = doc.createElement('div'); featureBar.className = 'tk-feature-switches'; featureBar.hidden = true;
    const body = doc.createElement('div'); body.className = 'tk-workspace-body';
    const page = doc.createElement('div'); page.className = 'tk-panel-page';
    page.id = 'tk-workspace-content'; page.setAttribute('role', 'tabpanel');
    const lastRoute = new Map(), scrollByRoute = new Map();
    const mounts = new Map(), buttons = new Map();
    for (const [id, label] of KITCHEN_TABS) {
        const button = doc.createElement('button');
        button.type = 'button'; button.id = `tk-tab-${id}`; button.textContent = label; button.className = 'menu_button';
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', 'false');
        button.setAttribute('aria-controls', page.id); button.tabIndex = -1;
        button.addEventListener('click', () => navigateSection(id));
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
    const controls = doc.createElement('section');
    controls.className = 'tk-workspace-controls';
    controls.setAttribute('aria-label', '操作');
    controls.hidden = true;
    controls.append(evolution, featureBar);
    page.append(controls, body);
    panel.append(titlebar, tabs, subnav, page);
    controls.id = 'tk-module-native-controls';
    const frames = new Map();
    let returnTo = null, focusRequest = null, stopFocusWatch;
    const stopWatchingFocus = () => { stopFocusWatch?.(); stopFocusWatch = undefined; };
    const syncControls = () => {
        const hasEvolution = !evolution.hidden && evolution.childElementCount > 0;
        const hasActions = featureBar.childElementCount > 0;
        featureBar.hidden = !hasActions;
        controls.hidden = !(hasEvolution || hasActions) || body.hidden;
        page.classList.toggle('tk-page-full', controls.hidden && !body.hidden);
    };
    const isFrameVisible = frame => frame.isConnected && frame.style.visibility !== 'hidden' && (!frame.checkVisibility || frame.checkVisibility());
    const isNodeFocusable = item => item.isConnected && !item.disabled && !item.closest?.('fieldset[disabled]') && (!item.checkVisibility || item.checkVisibility());
    const restoreRequestedFocus = () => {
        if (!focusRequest || focusRequest.route !== active || !isOpen()) return false;
        if (!focusRequest.selector) { focusRequest = null; stopWatchingFocus(); return false; }
        const mount = api.getMount(active);
        const frameDocs = [...frames].filter(([frame]) => mount?.contains(frame) && isFrameVisible(frame)).map(([, s]) => s.document);
        for (const surface of [controls, mount, ...frameDocs]) {
            const node = [...(surface?.querySelectorAll(focusRequest.selector) || [])].find(isNodeFocusable);
            if (!node) continue;
            node.focus(); focusRequest = null; stopWatchingFocus(); return true;
        }
        return false;
    };
    let refreshFocusWatch = () => {};
    const ensureFocusWatch = () => {
        if (restoreRequestedFocus() || !focusRequest || !isOpen()) {
            if (!focusRequest) stopWatchingFocus();
            return;
        }
        if (stopFocusWatch || typeof MutationObserver === 'undefined') { refreshFocusWatch(); return; }
        const observed = new Set();
        const observer = new MutationObserver(() => {
            if (!focusRequest || !isOpen()) { stopWatchingFocus(); return; }
            attachTargets();
            restoreRequestedFocus();
        });
        const watch = (target, options) => {
            if (!target || observed.has(target)) return;
            observed.add(target);
            observer.observe(target, options);
        };
        const attachTargets = () => {
            const mount = focusRequest ? api.getMount(focusRequest.route) : null;
            watch(mount, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'style'] });
            for (const [frame, state] of frames) {
                if (!mount?.contains(frame)) continue;
                watch(frame, { attributes: true, attributeFilter: ['style', 'hidden'] });
                watch(state.document?.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'style'] });
            }
        };
        stopFocusWatch = () => { observer.disconnect(); observed.clear(); refreshFocusWatch = () => {}; };
        refreshFocusWatch = attachTargets;
        attachTargets();
    };
    const visitBinding = (agent, selector) => {
        returnTo = active && parentOf(active) !== 'settings' ? { route: active, selector } : null;
        focusRequest = { route: 'settings', selector: '[data-agent-binding="' + agent + '"]' };
        navigate('settings');
    };
    back.addEventListener('click', () => {
        if (!returnTo) return;
        focusRequest = returnTo; returnTo = null;
        navigate(focusRequest.route);
    });
    const placeControls = () => {
        syncControls();
        if (isOpen()) ensureFocusWatch();
    };

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
        if (entry.parentElement !== holder) holder.append(entry);
        else if (entry !== holder.lastElementChild) {
            // A normal DOM move reloads live iframes. Older WebViews use flex order for this case.
            if (holder.moveBefore) holder.moveBefore(entry, null);
            else if (!entry.querySelector('iframe')) holder.append(entry);
        }
        return true;
    };
    inject();
    const entryObserver = new doc.defaultView.MutationObserver(() => {
        if (!entry.isConnected || entry.nextElementSibling) inject();
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
        message.append(text, retry); mount.prepend(message);
    };
    const navigate = id => observeBackgroundTask(api.open(id), { source: import.meta.url, operation: 'open-workspace' });
    const navigateRefresh = id => observeBackgroundTask(api.open(id, true), { source: import.meta.url, operation: 'refresh-workspace' });
    let visiblePanel = () => true;
    let configurePanel;
    let initializeWorld;
    let configured = Boolean(Object.keys(actions).length);
    const routesFor = parent => KITCHEN_ROUTES[parent].filter(([id]) => visiblePanel(id));
    const navigateSection = parent => navigate(routesFor(parent).some(([route]) => route === lastRoute.get(parent)) ? lastRoute.get(parent) : parent);
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
    const renderFeatureBar = id => {
        controls.replaceChildren(evolution, featureBar);
        back.hidden = !(parentOf(id) === 'settings' && returnTo);
        if (!back.hidden) back.textContent = '返回' + KITCHEN_ROUTES[parentOf(returnTo.route)].find(([key]) => key === returnTo.route)[1];
        featureBar.replaceChildren();
        body.hidden = false;
        const items = featureSwitches[id] || [];
        if (id === 'opening' && initializeWorld) {
            const button = doc.createElement('button');
            button.type = 'button'; button.className = 'menu_button'; button.textContent = '生成世界'; button.dataset.initializeWorld = '';
            const status = doc.createElement('span'); status.setAttribute('role', 'status');
            const initialize = async () => {
                button.disabled = true; status.textContent = '正在读取开局资料…';
                try { status.textContent = await initializeWorld(); }
                catch (error) {
                    status.textContent = error.message || '生成失败，请重试';
                    if (error.agent) {
                        const link = doc.createElement('button'); link.type = 'button'; link.className = 'menu_button'; link.textContent = '前往设置';
                        link.onclick = () => visitBinding(error.agent, '[data-initialize-world]'); status.append(' ', link);
                    }
                } finally { button.disabled = false; }
            };
            button.addEventListener('click', () => observeBackgroundTask(initialize(), { source: import.meta.url, operation: 'initialize-world' }));
            const description = doc.createElement('p');
            description.textContent = '读取本次开局的世界书和首轮输入，生成初始世界记录。';
            const actionRow = doc.createElement('div'); actionRow.className = 'tk-module-actions';
            actionRow.append(button);
            mounts.get('opening').replaceChildren(description, actionRow, status);
        }
        if (configurePanel) configurePanel(id, featureBar);
        for (const item of items) {
            const label = doc.createElement('label'); label.className = 'tk-feature-switch';
            const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = !!item.checked;
            input.addEventListener('change', () => onToggleFeature(item.key, input.checked, item));
            const text = doc.createElement('span'); text.textContent = item.label;
            label.append(input, text); featureBar.append(label);
        }
        syncControls();
    };
    const isWorldMountRoute = route => worldTabs.has(route) && !(route === 'settings' && mounts.get('settings').childElementCount > 0 && !worldMount.childElementCount);
    const api = {
        visitBinding,
        getControls() { return featureBar; },
        getSettingSections() { return { function: controls }; },
        attachFrame(frame) {
            const document = frame.contentDocument;
            if (!document?.body) return () => {};
            frames.set(frame, { document });
            if (focusRequest && isOpen()) ensureFocusWatch();
            return () => {
                if (frames.get(frame)?.document === document) frames.delete(frame);
            };
        },

        configure(options) {
            configured = true;
            initializeWorld = options.initializeWorld;
            actions = options.actions;
            configurePanel = options.configurePanel;
            if (options.visiblePanel) visiblePanel = options.visiblePanel;
            for (const [parent, button] of buttons) button.hidden = !routesFor(parent).length;
            const available = firstRoute();
            entry.hidden = !available;
            tabs.hidden = page.hidden = !available;
            delete subnav.dataset.section;
            toggleDrawer = options.toggleDrawer;
            onVisibility = options.onVisibility || (() => {});
            if (options.featureSwitches) featureSwitches = options.featureSwitches;
            if (options.onToggleFeature) onToggleFeature = options.onToggleFeature;
            if (options.settingsElement) mounts.get('settings').replaceChildren(options.settingsElement);
            if (!available) {
                generation++;
                active = null;
                subnav.hidden = featureBar.hidden = evolution.hidden = controls.hidden = true;
                stopEvolution?.(); stopEvolution = undefined;
                api.close();
                return;
            }
            if (!active && isOpen()) { navigate(available); return; }
            if (active && isOpen()) { const id = visiblePanel(active) ? active : available; navigateRefresh(id); }
            else if (active) { renderFeatureBar(active); placeControls(); }
        },
        failStartup(error) {
            configured = true;
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
        showEvolution(mount, withHeading = false) {
            stopEvolution?.();
            let target = evolution;
            if (withHeading) {
                const settings = doc.createElement('section'), heading = doc.createElement('h5');
                heading.className = 'tk-evolution-title';
                heading.textContent = '演化';
                target = doc.createElement('div');
                settings.append(heading, target); evolution.replaceChildren(settings);
            } else {
                evolution.replaceChildren();
            }
            stopEvolution = mount(target);
            evolution.hidden = target.childElementCount === 0;
            if (evolution.hidden) evolution.replaceChildren();
            syncControls();
        },
        getMount(id) {
            const route = canonicalRoute(id);
            return isWorldMountRoute(route) ? worldMount : memoryTabs.has(route) ? memoryMount : mounts.get(route);
        },
        isActive: id => isOpen() && active === canonicalRoute(id) && !body.hidden,
        async open(id = active || 'overview', refresh = false) {
            id = canonicalRoute(id);
            if (!visiblePanel(id)) id = routesFor(parentOf(id) || 'overview')[0]?.[0] || firstRoute();
            if (!id) return;
            const parent = parentOf(id);
            if (!parent) return;
            const wasClosed = !isOpen();
            if (active === id && !wasClosed && !refresh) return;
            const token = ++generation;
            await ensureOpen();
            if (token !== generation || !isOpen()) return;
            if (active && active !== id) scrollByRoute.set(active, api.getMount(active).scrollTop);
            if (parent !== 'settings' && returnTo) returnTo = null;
            if (focusRequest && focusRequest.route !== id) { focusRequest = null; stopWatchingFocus(); }
            active = id;
            lastRoute.set(parent, id);
            for (const [key, button] of buttons) {
                button.setAttribute('aria-selected', String(key === parent)); button.tabIndex = key === parent ? 0 : -1;
                button.classList.toggle('is-active', key === parent);
            }
            page.setAttribute('aria-labelledby', `tk-tab-${parent}`);
            for (const [key, mount] of mounts) mount.hidden = key !== id || isWorldMountRoute(key) || memoryTabs.has(key);
            worldMount.hidden = !isWorldMountRoute(id);
            memoryMount.hidden = !memoryTabs.has(id);
            worldMount.setAttribute('aria-label', Object.values(KITCHEN_ROUTES).flat().find(([key]) => key === id)?.[1] || '世界工具');
            // Retain focused controls when switching routes inside one section.
            if (subnav.dataset.section !== parent) buildSubnav(parent);
            for (const button of subnav.querySelectorAll('button[data-route]')) {
                button.setAttribute('aria-pressed', String(button.dataset.route === id));
                button.classList.toggle('is-active', button.dataset.route === id);
            }
            subnav.hidden = routesFor(parent).length < 2;
            stopEvolution?.(); stopEvolution = undefined; evolution.replaceChildren(); evolution.hidden = true;
            renderFeatureBar(id);
            onVisibility(true, id);
            if (wasClosed) buttons.get(parent).focus({ preventScroll: true });
            if (body.hidden) return;
            api.getMount(id).scrollTop = scrollByRoute.get(id) || 0;
            const mount = api.getMount(id); mount.querySelector('.tk-panel-message')?.remove();
            mount.setAttribute('aria-busy', 'true');
            const loading = !mount.childElementCount ? doc.createElement('p') : null;
            if (loading) { loading.className = 'tk-panel-message'; loading.setAttribute('role', 'status'); loading.textContent = '正在加载后厨…'; mount.append(loading); }
            if (configured && !actions[id]) { loading?.remove(); mount.removeAttribute('aria-busy'); placeControls(); return; }
            if (!configured) { return; }
            Promise.resolve().then(() => actions[id]?.()).catch(error => {
                if (token === generation) report(mount, error, id);
            }).finally(() => { loading?.remove(); mount.removeAttribute('aria-busy'); placeControls(); });
        },
        close() {
            generation += 1;
            focusRequest = null; stopWatchingFocus();
            if (pendingOpen) void pendingOpen.then(() => { setOpen(panel, false); syncVisibility(); });
            setOpen(panel, false); syncVisibility();
            (previousFocus?.isConnected ? previousFocus : trigger).focus({ preventScroll: true });
        },
        reset() { returnTo = focusRequest = null; stopWatchingFocus(); lastRoute.clear(); scrollByRoute.clear(); active = null; api.close(); generation += 1; },
    };
    close.addEventListener('click', api.close);
    trigger.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); isOpen() || pendingOpen ? api.close() : navigate(); });
    tabs.addEventListener('keydown', event => {
        const ids = [...buttons.keys()].filter(id => !buttons.get(id).hidden); const index = ids.indexOf(event.target.id?.replace('tk-tab-', ''));
        if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        buttons.get(ids[next]).focus(); navigateSection(ids[next]);
    });
    const closeOnEscape = event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        api.close();
    };
    panel.addEventListener('keydown', closeOnEscape);
    controls.addEventListener('keydown', closeOnEscape);
    workspace = api;
    return api;
}
