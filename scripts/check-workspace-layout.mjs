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
        if (new URL(route.request().url()).pathname === '/embedded.css') {
            await route.fulfill({ contentType: 'text/css', body: embeddedCss });
            return;
        }
        await route.fulfill({ contentType: 'text/html', body:
            '<style>body{margin:0;background:#202024;color:#ddd;font:15px sans-serif}' + css +
            '#tk-workspace{position:fixed;inset:0;width:100%;height:100%;background:#202024}iframe{width:100%;height:100%;border:0}.drawer-icon{display:inline-block;width:1em;height:1em}</style><div id="top-settings-holder"></div>' });
    });
    await page.goto('http://kitchen.test');
    await page.evaluate(async () => {
        const { createKitchenWorkspace } = await import('/workspace.js');
        const workspace = createKitchenWorkspace({});
        globalThis.workspace = workspace;
        const configure = () => workspace.configure({
            actions: { data() {}, suspense() {}, settings() {}, planner() {}, overview() {}, people() {}, situation() {}, opening() {}, clues() {}, map() {
                const mount = workspace.getMount('map');
                if (mount.querySelector('iframe')) return;
                const frame = globalThis.document.createElement('iframe');
                frame.onload = () => workspace.attachFrame(frame);
                frame.srcdoc = '<html class="tk-embedded"><head><link rel="stylesheet" href="/embedded.css"><style>html,body{height:100%;margin:0}body{display:grid;grid-template-rows:minmax(0,1fr);color:#ddd;background:#202024}main{overflow:auto;min-height:0}</style></head><body><main>' +
                    '<p>地图记录</p>'.repeat(60) + '<p>最后一条地点记录</p></main></body></html>';
                mount.append(frame);
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
    const frame = page.frameLocator('iframe');
    const main = frame.locator('main');
    await page.locator('.tk-workspace-titlebar .tk-workspace-app-title').filter({hasText:'酒馆后厨'}).waitFor();
    assert.ok(await page.locator('#tk-tab-world').evaluate(el => el.classList.contains('menu_button') && el.classList.contains('is-active')));
    assert.ok(await page.locator('.tk-subnav button').filter({hasText:'地图'}).evaluate(el => el.classList.contains('menu_button') && el.classList.contains('is-active')));
    assert.equal(await page.locator('#tk-tab-api').count(), 0);
    await page.locator('#tk-tab-settings').waitFor();
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        await page.locator('#tk-module-native-controls').waitFor({state:'visible'});
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
    for (const subLabel of ['总结', '召回', '悬念', '剧情线', '校对']) {
        assert.ok(await page.locator('.tk-subnav button').filter({hasText:subLabel}).isVisible());
    }
    for (const [route] of [['suspense'],['clues'],['opening'],['planner']]) {
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
    assert.deepEqual(errors, []);
    console.log('Verified host disclosures, reading height, scroll restoration, keyboard focus and last route.');
} finally {
    await browser.close();
}
