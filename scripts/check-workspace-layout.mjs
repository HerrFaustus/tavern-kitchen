import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const bundle = await build({
    absWorkingDir: root, entryPoints: ['core/kitchen-workspace.js'],
    bundle: true, write: false, format: 'esm', platform: 'browser',
});
const drawerBundle = await build({
    absWorkingDir: root, entryPoints: ['core/extension-drawer.js'],
    bundle: true, write: false, format: 'esm', platform: 'browser',
});
const css = await fs.readFile(path.join(root, 'style.css'), 'utf8');
const embeddedCss = await fs.readFile(path.join(root, 'core/kitchen-embedded.css'), 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_BIN });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        if (new URL(route.request().url()).pathname === '/workspace.js') {
            await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
            return;
        }
        if (new URL(route.request().url()).pathname === '/drawer.js') {
            await route.fulfill({ contentType: 'text/javascript', body: drawerBundle.outputFiles[0].text });
            return;
        }
        if (new URL(route.request().url()).pathname === '/embedded.css') {
            await route.fulfill({ contentType: 'text/css', body: embeddedCss });
            return;
        }
        await route.fulfill({ contentType: 'text/html', body:
            '<style>body{margin:0;background:#202024;color:#ddd;font:15px sans-serif}' + css +
            '#tk-workspace{position:fixed;inset:0;width:100%;height:100%;background:#202024}iframe{width:100%;height:100%;border:0}.drawer-icon{display:inline-block;width:1em;height:1em}</style><div id="top-settings-holder"></div><div id="extensions_settings"></div>' });
    });
    await page.goto('http://kitchen.test');
    await page.evaluate(async () => {
        const { createKitchenWorkspace } = await import('/workspace.js');
        const workspace = createKitchenWorkspace({});
        globalThis.workspace = workspace;
        const configure = () => workspace.configure({
            actions: { data() {}, suspense() {}, settings() {}, planner() {}, overview() {}, people() {}, situation() {}, opening() {}, map() {
                const mount = workspace.getMount('map');
                if (mount.querySelector('.tk-embedded-host')) return;
                const host = globalThis.document.createElement('div');
                host.className = 'tk-embedded-host';
                const shadow = host.attachShadow({ mode: 'open' });
                const style = globalThis.document.createElement('style');
                style.textContent = ':host{display:block;height:100%;width:100%}.tk-surface{display:grid;grid-template-rows:minmax(0,1fr);height:100%;color:#ddd;background:#202024}main{overflow:auto;min-height:0}';
                const surface = globalThis.document.createElement('div');
                surface.className = 'tk-surface tk-embedded';
                const mainEl = globalThis.document.createElement('main');
                for (let i = 0; i < 60; i++) {
                    const p = globalThis.document.createElement('p');
                    p.textContent = '地图记录';
                    mainEl.append(p);
                }
                const last = globalThis.document.createElement('p');
                last.textContent = '最后一条地点记录';
                mainEl.append(last);
                surface.append(mainEl);
                shadow.append(style, surface);
                mount.append(host);
                workspace.attachSurface(shadow);
            } },
            configurePanel(id, bar) {
                if (id === 'map') {
                    const label = globalThis.document.createElement('label');
                    const input = globalThis.document.createElement('input'); input.type = 'checkbox'; input.checked = true;
                    label.append(input, '随剧情更新');
                    bar.append(label);
                }
                if (id === 'suspense') {
                    const emptyFooter = globalThis.document.createElement('footer'); emptyFooter.hidden = true; bar.append(emptyFooter);
                }
                if (id === 'planner') {
                    const toggle = globalThis.document.createElement('input'); toggle.type = 'checkbox'; toggle.id = 'native-planner-flag';
                    bar.append(toggle);
                }
            },
        });
        configure();
        await workspace.open('map');
    });
    const main = page.locator('#tk-world-mount main');
    await page.locator('.tk-workspace-titlebar .tk-workspace-app-title').filter({hasText:'酒馆后厨'}).waitFor();
    assert.equal(await page.locator('#tk-workspace iframe').count(), 0, 'workspace must mount surfaces directly without iframes');
    assert.ok(await page.locator('#tk-tab-world').evaluate(el => el.classList.contains('menu_button') && el.classList.contains('is-active')));
    assert.ok(await page.locator('.tk-subnav button').filter({hasText:'地图'}).evaluate(el => el.classList.contains('menu_button') && el.classList.contains('is-active')));
    assert.equal(await page.locator('#tk-tab-api').count(), 0);
    await page.locator('#tk-tab-settings').waitFor();
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        await page.locator('#tk-module-native-controls').waitFor({state:'visible'});
        if (width === 319) {
            const tabRows = await page.locator('#tk-workspace .tk-tabs button').evaluateAll(buttons => {
                const tops = buttons.map(btn => Math.round(btn.getBoundingClientRect().top));
                const nav = buttons[0]?.parentElement;
                return { count: buttons.length, uniqueTops: new Set(tops).size, fits: nav ? nav.scrollWidth <= nav.clientWidth + 1 : false };
            });
            assert.equal(tabRows.count, 6);
            assert.equal(tabRows.uniqueTops, 1, 'all 6 topbar tabs must stay on a single line at 319px');
            assert.equal(tabRows.fits, true, 'topbar tabs must not overflow horizontally at 319px');
        }
        assert.ok(await page.getByLabel('随剧情更新').isVisible());
        await main.waitFor({state:'visible'});
        const height = await main.evaluate(el => el.clientHeight);
        assert.ok(height > 0);
        await main.evaluate(el => { el.scrollTop = el.scrollHeight; });
        const bottom = await main.evaluate(el => el.scrollTop);
        assert.ok(bottom > 0 && await main.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2));
    }
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    assert.ok(await page.locator('#tk-tab-settings').evaluate(el => el.classList.contains('is-active')));
    for (const subLabel of ['API', '剧情与召回', '世界与推演']) {
        assert.ok(await page.locator('.tk-subnav button').filter({hasText:subLabel}).isVisible());
    }
    await page.getByRole('tab', { name: '剧情', exact: true }).click();
    for (const subLabel of ['总结', '召回', '悬念']) {
        assert.ok(await page.locator('.tk-subnav button').filter({hasText:subLabel}).isVisible());
    }
    for (const [route] of [['suspense'],['opening'],['planner']]) {
        await page.evaluate(route => globalThis.workspace.open(route),route);
        assert.equal(await page.getByRole('button',{name:/设置$/}).count(), 0);
        assert.equal(await page.locator('[data-settings-group=model], [data-settings-group=prompts]').count(),0);
    }
    assert.equal(await page.locator('#tk-module-native-controls #native-planner-flag').count(), 1);
    await page.locator('#tk-tab-planner').focus();
    await page.keyboard.press('Escape');
    await page.locator('#tk-workspace.closedDrawer[inert]').waitFor({state:'attached'});
    await page.getByRole('button',{name:'酒馆后厨',exact:true}).click();
    assert.ok(await page.locator('#tk-tab-planner').evaluate(el => el.classList.contains('is-active')));
    await page.getByRole('button',{name:'收起酒馆后厨'}).click();
    await page.getByRole('button',{name:'酒馆后厨',exact:true}).click();
    assert.ok(await page.locator('#tk-tab-planner').evaluate(el => el.classList.contains('is-active')));
    await page.getByRole('button',{name:'收起酒馆后厨'}).click();
    await page.setViewportSize({width:360,height:780});
    await page.evaluate(async () => {
        const { createExtensionDrawer } = await import('/drawer.js');
        const holder = globalThis.document.querySelector('#extensions_settings');
        holder.append(createExtensionDrawer({ doc: globalThis.document, onOpen: () => globalThis.workspace.open('world') }));
    });
    const tutorialBtn = page.getByRole('button', { name: '后厨教程', exact: true });
    assert.ok(await tutorialBtn.isVisible());
    await tutorialBtn.click();
    const dialog = page.locator('#tk-tutorial-dialog');
    await dialog.waitFor({ state: 'visible' });
    const tutorialLayout = await dialog.evaluate(el => ({
        fits: el.scrollWidth <= el.clientWidth,
        docFits: globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth,
        links: el.querySelectorAll('a[href]').length,
        hasPlaceholder: (el.textContent || '').includes('待做'),
        footerButtons: [...el.querySelectorAll('.tk-tutorial-footer .menu_button')].map(btn => {
            const rect = btn.getBoundingClientRect();
            return { text: btn.textContent.trim(), width: rect.width, height: rect.height };
        }),
    }));
    assert.ok(tutorialLayout.fits && tutorialLayout.docFits, 'tutorial dialog must fit cleanly at 360px');
    assert.equal(tutorialLayout.links, 0);
    assert.equal(tutorialLayout.hasPlaceholder, false);
    for (const btn of tutorialLayout.footerButtons) {
        assert.ok(btn.height > 0 && btn.height <= 46 && btn.width >= btn.height, `tutorial footer button wrapped vertically: ${JSON.stringify(btn)}`);
    }
    await dialog.getByRole('button', { name: '下一节' }).click();
    assert.match(await dialog.locator('.tk-tutorial-step').innerText(), /^2 \//);
    await dialog.getByRole('button', { name: '我知道了' }).click();
    assert.equal(await dialog.evaluate(el => el.open), false);

    // Verify centered host modal (B4) opens cleanly and dismisses on Escape
    await page.evaluate(() => globalThis.workspace.openModal({ title: '第 4 楼原文', subtitle: '阿棠 · 第 4 楼', text: '守卫阿棠接过县衙钥匙。' }));
    const hostModal = page.locator('#tk-host-modal');
    await hostModal.waitFor({ state: 'visible' });
    assert.match(await hostModal.innerText(), /守卫阿棠接过县衙钥匙/);
    await page.keyboard.press('Escape');
    assert.equal(await hostModal.count(), 0);
    assert.deepEqual(errors, []);
    console.log('Verified host disclosures, reading height, scroll restoration, keyboard focus, last route, 360px fit and offline tutorial.');
} finally {
    await browser.close();
}
