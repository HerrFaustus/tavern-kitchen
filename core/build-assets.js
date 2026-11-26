/** Resolve generated resources without owning application state. */
const moduleUrl = new URL(import.meta.url);
const base = moduleUrl.pathname.match(/^(.*\/scripts\/extensions\/third-party\/[^/]+\/)/)?.[1];
if (!base) throw new Error('Plugin asset base is unavailable');
let manifestPromise;
const LOAD_FAILURE_MESSAGE = '加载失败，请刷新重试';

export function reportBuildFailure(error) {
    let feedback = document.querySelector('#xb-frame-boot .xb-frame-boot-text');
    if (!feedback) {
        feedback = document.querySelector('[data-build-failure]');
        if (!feedback) {
            feedback = document.createElement('p');
            feedback.dataset.buildFailure = '';
            feedback.setAttribute('role', 'alert');
            document.body.prepend(feedback);
        }
    }
    feedback.textContent = LOAD_FAILURE_MESSAGE;
    console.error(error);
}

export function pluginAsset(path) {
    return new URL(path, new URL(base, moduleUrl)).href;
}

export function readBuildManifest() {
    manifestPromise ||= fetch(pluginAsset('dist/manifest.json'), { cache: 'no-cache' })
        .then(async response => {
            if (!response.ok) throw new Error(`Build manifest: ${response.status}`);
            const manifest = await response.json();
            const currentChunk = moduleUrl.pathname.slice(base.length + 'dist/'.length);
            if (moduleUrl.pathname.startsWith(`${base}dist/`) && !manifest.resources[currentChunk]) {
                throw new Error('Plugin build changed; reload the page');
            }
            return manifest;
        }).catch(error => { manifestPromise = null; throw error; });
    return manifestPromise;
}

export async function buildEntry(id) {
    const manifest = await readBuildManifest();
    const entry = manifest.entries[id];
    if (!entry) throw new Error(`Unknown build entry: ${id}`);
    return { ...entry, file: pluginAsset(`dist/${entry.file}`), css: entry.css.map(file => pluginAsset(`dist/${file}`)) };
}

export async function buildEntryUrl(id) {
    return (await buildEntry(id)).file;
}

/**
 * @param {string} href
 * @param {Document | ShadowRoot | HTMLElement} [target]
 * @param {string} [id]
 */
function loadStylesheetLink(href, target = document.head, id = '') {
    return new Promise((resolve, reject) => {
        let link = (id && target.getElementById?.(id))
            || [...target.querySelectorAll('link[rel="stylesheet"]')].find(node => node.href === href);
        if (link?.sheet) { resolve(); return; }
        const created = !link;
        if (created) {
            link = document.createElement('link');
            if (id) link.id = id;
            link.rel = 'stylesheet';
            link.href = href;
            link.addEventListener('error', () => link.remove(), { once: true });
        }
        link.addEventListener('load', () => resolve(), { once: true });
        link.addEventListener('error', () => reject(new Error(`Stylesheet: ${href}`)), { once: true });
        if (created) target.appendChild(link);
    });
}

/**
 * @param {string} id
 * @param {Document | ShadowRoot | HTMLElement} [target]
 */
export async function loadBuildStyles(id, target = document.head) {
    const entry = await buildEntry(id);
    await Promise.all(entry.css.map(href => loadStylesheetLink(href, target)));
    return entry;
}

/**
 * @param {Document | ShadowRoot | HTMLElement} [target]
 */
export async function loadEmbeddedStyles(target = document.head) {
    await loadStylesheetLink(pluginAsset('core/kitchen-embedded.css'), target, 'tk-embedded-styles');
}

/**
 * @param {string} id
 * @param {Document | ShadowRoot | HTMLElement} [styleTarget]
 * @param {{ includeEmbedded?: boolean }} [options]
 */
export async function loadBuildEntry(id, styleTarget = document.head, { includeEmbedded = false } = {}) {
    const entry = await loadBuildStyles(id, styleTarget);
    // WHY: Always load core/kitchen-embedded.css AFTER entry CSS inside a ShadowRoot so host-following
    // overrides cleanly win cascade order regardless of bundled asset filenames.
    if (includeEmbedded) await loadEmbeddedStyles(styleTarget);
    // eslint-disable-next-line no-unsanitized/method -- Only paths from this plugin's generated entry manifest are imported.
    return import(/* @vite-ignore */ entry.file);
}
