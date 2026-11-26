import { observeBackgroundTask } from '../shared/common/async-errors.js';

let workspace;
let nativeControls;
const surfaceRegistry = new Set();
let hostThemeObserver = null;
let hostThemeLastSignature = '';
let hostThemeRafId = null;
let hostThemeScheduled = false;
let currentHostScheme = 'dark';

function parseRgb(color) {
    const match = String(color || '').match(/rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? 1 : Number(match[4])];
}

function detectHostScheme(theme) {
    const declared = String(theme.colorScheme || '').trim().toLowerCase();
    if (declared === 'light' || declared === 'only light') return 'light';
    if (declared === 'dark' || declared === 'only dark') return 'dark';
    const bg = parseRgb(theme.getPropertyValue('--SmartThemeBlurTintColor')) || parseRgb(theme.backgroundColor);
    if (bg && bg[3] > 0.15) {
        const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
        return lum > 0.56 ? 'light' : 'dark';
    }
    const fg = parseRgb(theme.getPropertyValue('--SmartThemeBodyColor')) || parseRgb(theme.color);
    if (fg) {
        const lum = (0.2126 * fg[0] + 0.7152 * fg[1] + 0.0722 * fg[2]) / 255;
        return lum < 0.45 ? 'light' : 'dark';
    }
    return 'dark';
}

function resolveSolidSurface(theme, scheme) {
    const raw = parseRgb(theme.getPropertyValue('--SmartThemeBlurTintColor')) || parseRgb(theme.backgroundColor);
    if (raw) return `rgb(${Math.round(raw[0])}, ${Math.round(raw[1])}, ${Math.round(raw[2])})`;
    return scheme === 'light' ? '#f6f8fa' : '#1c1c21';
}

/** Read real host controls so custom Tavern themes also reach isolated frames. */
function collectNativeControlMetrics(scheme = 'dark') {
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
    const fallbackChevron = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 10 7'%3E%3Cpolygon points='0,0 10,0 5,7' fill='%23${scheme === 'light' ? '57606a' : 'a3aab4'}'/%3E%3C/svg%3E")`;
    const entries = [];
    for (const control of nativeControls.children) {
        const style = getComputedStyle(control);
        const name = control.dataset.control;
        const bgImage = style.getPropertyValue('background-image').trim();
        const needsSelectChevron = name === 'select' && (!bgImage || bgImage === 'none');
        for (const property of properties) {
            let value = style.getPropertyValue(property);
            // WHY: Some hosts (e.g. TauriTavern or minimal custom CSS) strip select.text_pole's background-image while keeping
            // appearance:none or custom borders, which hides Chromium's native dropdown chevron. Provide a crisp inline SVG
            // chevron fallback only when the host supplies no background-image of its own.
            if (needsSelectChevron) {
                if (property === 'appearance') value = 'none';
                else if (property === 'background-image') value = fallbackChevron;
                else if (property === 'background-position') value = 'right 8px center';
                else if (property === 'background-size') value = '9px 6px';
                else if (property === 'background-repeat') value = 'no-repeat';
                else if (property === 'padding' && parseFloat(style.paddingRight) < 20) {
                    value = `${style.paddingTop} 24px ${style.paddingBottom} ${style.paddingLeft}`;
                }
            }
            entries.push([`--tk-${name}-${property}`, value]);
        }
    }
    return entries;
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
/**
 * @param {string} id
 * @param {Record<string, unknown> | null} [detail]
 */
export const openKitchenTab = (id, detail = null) => workspace?.open(id, detail != null, detail);
/**
 * @param {Record<string, unknown>} [options]
 */
export const openKitchenModal = (options = {}) => workspace?.openModal(options);
export const closeKitchenWorkspace = () => workspace?.close();

function syncHostThemeToDocument(doc = document) {
    hostThemeScheduled = false;
    hostThemeRafId = null;
    if (typeof getComputedStyle !== 'function' || !doc?.body || !doc?.documentElement) return;
    try {
        const theme = getComputedStyle(doc.body);
        const scheme = detectHostScheme(theme);
        const solidBg = resolveSolidSurface(theme, scheme);
        const pairs = [
            ['--tk-font', theme.fontFamily],
            ['--tk-font-size', theme.fontSize],
            ['--tk-text-shadow', theme.textShadow],
            ['--tk-color-scheme', scheme],
            ['--tk-surface-solid', solidBg],
            ['--tk-motion-duration', theme.getPropertyValue('--animation-duration-2x').trim() || '200ms'],
            ...collectNativeControlMetrics(scheme),
        ];
        const signature = `${scheme}|${pairs.map(([, v]) => v).join('\u001f')}`;
        currentHostScheme = scheme;
        if (signature !== hostThemeLastSignature) {
            hostThemeLastSignature = signature;
            doc.documentElement.dataset.tkScheme = scheme;
            for (const [prop, val] of pairs) doc.documentElement.style.setProperty(prop, val);
            for (const surface of surfaceRegistry) {
                if (!surface.isConnected) { surfaceRegistry.delete(surface); continue; }
                surface.dataset.tkScheme = scheme;
            }
            if (typeof doc.defaultView?.CustomEvent === 'function') {
                doc.dispatchEvent(new doc.defaultView.CustomEvent('kitchen-theme-change', { detail: { scheme } }));
            }
        } else {
            for (const surface of surfaceRegistry) {
                if (!surface.isConnected) { surfaceRegistry.delete(surface); continue; }
                if (surface.dataset.tkScheme !== scheme) surface.dataset.tkScheme = scheme;
            }
        }
    } catch (error) {
        console.debug('[TavernKitchen] syncHostThemeToDocument skipped', error);
    }
}

function ensureHostThemeSync(doc = document) {
    syncHostThemeToDocument(doc);
    if (hostThemeObserver || typeof doc?.defaultView?.MutationObserver !== 'function') return;
    const schedule = () => {
        if (hostThemeScheduled) return;
        hostThemeScheduled = true;
        if (typeof requestAnimationFrame === 'function') {
            hostThemeRafId = requestAnimationFrame(() => syncHostThemeToDocument(doc));
        } else {
            queueMicrotask(() => syncHostThemeToDocument(doc));
        }
    };
    hostThemeObserver = new doc.defaultView.MutationObserver(schedule);
    for (const target of [doc.documentElement, doc.body]) {
        if (target) hostThemeObserver.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    }
}

/**
 * Bind an in-page Open Shadow DOM surface to the shared host theme & focus manager.
 * CSS custom properties (--SmartTheme*, --tk-*) cascade automatically through the shadow boundary;
 * only data-tk-scheme is mirrored onto the shadow root container for light-scheme selector rules.
 */
export function bindKitchenSurface(hostElement, surfaceElement) {
    const doc = hostElement?.ownerDocument || document;
    if (surfaceElement) {
        surfaceElement.classList.add('tk-surface', 'tk-embedded', 'tk-follow-host');
        surfaceElement.dataset.kitchenTheme = 'host';
        surfaceElement.removeAttribute('data-theme');
        surfaceRegistry.add(surfaceElement);
    }
    ensureHostThemeSync(doc);
    if (surfaceElement) surfaceElement.dataset.tkScheme = currentHostScheme;
    const stopFocus = hostElement?.shadowRoot ? workspace?.attachSurface(hostElement.shadowRoot) : null;
    return () => {
        if (surfaceElement) surfaceRegistry.delete(surfaceElement);
        stopFocus?.();
    };
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
    const surfaces = new Set();
    let returnTo = null, focusRequest = null, stopFocusWatch;
    const stopWatchingFocus = () => { stopFocusWatch?.(); stopFocusWatch = undefined; };
    const syncControls = () => {
        const hasEvolution = !evolution.hidden && evolution.childElementCount > 0;
        const hasActions = featureBar.childElementCount > 0;
        featureBar.hidden = !hasActions;
        controls.hidden = !(hasEvolution || hasActions) || body.hidden;
        page.classList.toggle('tk-page-full', controls.hidden && !body.hidden);
    };
    const isSurfaceVisible = surface => {
        const host = surface?.host || surface;
        return Boolean(host?.isConnected && host.style?.visibility !== 'hidden' && (!host.checkVisibility || host.checkVisibility()));
    };
    const isNodeFocusable = item => item.isConnected && !item.disabled && !item.closest?.('fieldset[disabled]') && (!item.checkVisibility || item.checkVisibility());
    const restoreRequestedFocus = () => {
        if (!focusRequest || focusRequest.route !== active || !isOpen()) return false;
        if (!focusRequest.selector) { focusRequest = null; stopWatchingFocus(); return false; }
        const mount = api.getMount(active);
        const activeSurfaces = [...surfaces].filter(surface => {
            const host = surface?.host || surface;
            return mount?.contains(host) && isSurfaceVisible(surface);
        });
        for (const surface of [controls, mount, ...activeSurfaces]) {
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
            for (const surface of surfaces) {
                const host = surface?.host || surface;
                if (!mount?.contains(host)) continue;
                watch(host, { attributes: true, attributeFilter: ['style', 'hidden'] });
                watch(surface, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'style'] });
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
    let observedHolder = null;
    let observedParent = null;
    let entryObserver = null;
    const attachEntryObserver = holder => {
        const target = holder || doc.body;
        const parent = holder?.parentElement || null;
        if (!target || (observedHolder === target && observedParent === parent)) return;
        entryObserver?.disconnect();
        observedHolder = target;
        observedParent = parent;
        // WHY: Observe only #top-settings-holder and its direct parent with childList:true (no subtree) once attached,
        // so late toolbar buttons and holder replacement are still caught while streaming chat tokens never fire callbacks.
        entryObserver = new doc.defaultView.MutationObserver(() => {
            const currentHolder = doc.getElementById('top-settings-holder');
            if (!currentHolder) {
                attachEntryObserver(null);
                return;
            }
            if (observedHolder !== currentHolder || observedParent !== currentHolder.parentElement) attachEntryObserver(currentHolder);
            if (!entry.isConnected || entry.parentElement !== currentHolder || entry.nextElementSibling) inject();
        });
        entryObserver.observe(target, holder ? { childList: true } : { childList: true, subtree: true });
        if (holder && parent && parent !== holder) entryObserver.observe(parent, { childList: true });
    };
    const inject = () => {
        const holder = doc.getElementById('top-settings-holder');
        if (!holder) { attachEntryObserver(null); return false; }
        if (entry.parentElement !== holder) holder.append(entry);
        else if (entry !== holder.lastElementChild) {
            if (holder.moveBefore) holder.moveBefore(entry, null);
            else holder.append(entry);
        }
        attachEntryObserver(holder);
        return true;
    };
    inject();
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
    const routeDetails = new Map();
    let hostModal = null;
    let hostModalFocus = null;
    const syncHostScheme = () => ensureHostThemeSync(doc);
    syncHostScheme();
    const closeModal = () => {
        if (!hostModal) return;
        const dialog = hostModal;
        hostModal = null;
        if (typeof dialog.close === 'function' && dialog.open) dialog.close();
        dialog.remove();
        if (hostModalFocus?.isConnected) hostModalFocus.focus({ preventScroll: true });
        hostModalFocus = null;
    };
    const openModal = ({ title = '', subtitle = '', text = '', content = null, wide = false, onClose = null } = {}) => {
        closeModal();
        syncHostScheme();
        hostModalFocus = doc.activeElement;
        const dialog = doc.createElement('dialog');
        dialog.id = 'tk-host-modal';
        dialog.className = wide ? 'tk-host-modal is-wide' : 'tk-host-modal';
        dialog.setAttribute('aria-labelledby', 'tk-host-modal-title');
        const head = doc.createElement('header');
        head.className = 'tk-host-modal-head';
        const titleWrap = doc.createElement('div');
        titleWrap.className = 'tk-host-modal-titles';
        const h3 = doc.createElement('h3');
        h3.id = 'tk-host-modal-title';
        h3.textContent = title || '详情';
        titleWrap.append(h3);
        if (subtitle) {
            const sub = doc.createElement('small');
            sub.className = 'tk-host-modal-subtitle';
            sub.textContent = subtitle;
            titleWrap.append(sub);
        }
        const closeBtn = doc.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'menu_button tk-host-modal-close';
        closeBtn.setAttribute('aria-label', '关闭弹窗');
        closeBtn.textContent = '✕';
        head.append(titleWrap, closeBtn);
        const bodyEl = doc.createElement('div');
        bodyEl.className = 'tk-host-modal-body';
        if (content) bodyEl.append(content);
        else {
            const prose = doc.createElement('div');
            prose.className = 'tk-host-modal-prose';
            prose.textContent = text;
            bodyEl.append(prose);
        }
        dialog.append(head, bodyEl);
        const dismiss = () => {
            closeModal();
            onClose?.();
        };
        closeBtn.addEventListener('click', dismiss);
        dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
        dialog.addEventListener('click', event => {
            if (event.target !== dialog) return;
            const bounds = dialog.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
        });
        doc.body.append(dialog);
        hostModal = dialog;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        closeBtn.focus({ preventScroll: true });
        return {
            dialog,
            body: bodyEl,
            setTitle(nextTitle, nextSubtitle = '') {
                h3.textContent = nextTitle || '详情';
                const existing = titleWrap.querySelector('.tk-host-modal-subtitle');
                if (nextSubtitle) {
                    if (existing) existing.textContent = nextSubtitle;
                    else {
                        const sub = doc.createElement('small');
                        sub.className = 'tk-host-modal-subtitle';
                        sub.textContent = nextSubtitle;
                        titleWrap.append(sub);
                    }
                } else existing?.remove();
            },
            setText(nextText) {
                const prose = doc.createElement('div');
                prose.className = 'tk-host-modal-prose';
                prose.textContent = nextText;
                bodyEl.replaceChildren(prose);
            },
            close: dismiss,
        };
    };
    const isWorldMountRoute = route => worldTabs.has(route) && !(route === 'settings' && mounts.get('settings').childElementCount > 0 && !worldMount.childElementCount);
    const api = {
        visitBinding,
        openModal,
        closeModal,
        consumeRouteDetail(id) {
            const route = canonicalRoute(id);
            const value = routeDetails.get(route) ?? null;
            routeDetails.delete(route);
            return value;
        },
        getControls() { return featureBar; },
        getSettingSections() { return { function: controls }; },
        attachSurface(surface) {
            if (!surface) return () => {};
            surfaces.add(surface);
            if (focusRequest && isOpen()) ensureFocusWatch();
            return () => { surfaces.delete(surface); };
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
        async open(id = active || 'overview', refresh = false, detail = null) {
            id = canonicalRoute(id);
            if (!visiblePanel(id)) id = routesFor(parentOf(id) || 'overview')[0]?.[0] || firstRoute();
            if (!id) return;
            if (detail != null) {
                routeDetails.set(id, detail);
                refresh = true;
            }
            const parent = parentOf(id);
            if (!parent) return;
            syncHostScheme();
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
            closeModal();
            generation += 1;
            focusRequest = null; stopWatchingFocus();
            if (pendingOpen) void pendingOpen.then(() => { setOpen(panel, false); syncVisibility(); });
            setOpen(panel, false); syncVisibility();
            (previousFocus?.isConnected ? previousFocus : trigger).focus({ preventScroll: true });
        },
        reset() {
            closeModal(); routeDetails.clear(); returnTo = focusRequest = null; stopWatchingFocus(); lastRoute.clear(); scrollByRoute.clear(); active = null; api.close(); generation += 1;
            if (hostThemeRafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(hostThemeRafId);
            hostThemeRafId = null; hostThemeScheduled = false;
        },
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
