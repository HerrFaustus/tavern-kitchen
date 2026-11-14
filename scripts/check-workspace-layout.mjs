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
        let enabled = true;
        const configure = () => workspace.configure({
            actions: { data() {}, suspense() {}, settings() {}, planner() {}, overview() {}, people() {}, situation() {}, opening() {}, clues() {}, map() {
                const mount = workspace.getMount('map');
                if (mount.querySelector('iframe')) return;
                const frame = globalThis.document.createElement('iframe');
                frame.onload = () => workspace.attachFrame(frame);
                frame.srcdoc = '<html class="tk-embedded"><head><link rel="stylesheet" href="/embedded.css"><style>html,body{height:100%;margin:0}body{display:grid;grid-template-rows:auto minmax(0,1fr);color:#ddd;background:#202024}main{grid-row:2}footer{grid-row:1}main,footer{overflow:auto;min-height:0}footer{border-top:1px solid #555;box-sizing:border-box}</style></head><body><main>' +
                    '<p>地图记录</p>'.repeat(60) + '<p>最后一条地点记录</p></main><footer data-kitchen-controls="map"><section data-setting-section="function"><label>随剧情更新<input type="checkbox" checked></label></section></footer></body></html>';
                mount.append(frame);
            } },
            panelSwitch: () => ({ enabled, label: '启用地图', change(value) { enabled = value; configure(); } }),
            configurePanel(id, bar) {
                bar.hidden = false;
                if (id === 'suspense') {
                    const emptyFooter = globalThis.document.createElement('footer'); emptyFooter.hidden = true; bar.append(emptyFooter);
                }
                if (id === 'planner') {
                    const toggle = globalThis.document.createElement('input'); toggle.type = 'checkbox'; toggle.id = 'native-planner-flag';
                    workspace.getSettingSections().function.append(toggle);
                }
            },
        });
        configure();
        await workspace.open('map');
    });
    const frame = page.frameLocator('iframe');
    const toggle = page.getByRole('button',{name:'地图设置'});
    const main = frame.locator('main');
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        await frame.locator('#tk-module-native-controls').waitFor({state:'attached'});
        assert.ok(await frame.locator('footer').isHidden());
        const height = await main.evaluate(el => el.clientHeight);
        await main.evaluate(el => { el.scrollTop = el.scrollHeight; });
        const bottom = await main.evaluate(el => el.scrollTop);
        assert.ok(bottom > 0 && await main.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2));
        await toggle.click();
        await frame.getByLabel('启用地图').waitFor();
        assert.ok(await main.evaluate(el => el.clientHeight) < height);
        assert.ok(await frame.getByLabel('随剧情更新').isVisible());
        await frame.getByLabel('启用地图').focus();
        await page.keyboard.press('Escape');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.ok(await toggle.evaluate(el => el === el.ownerDocument.activeElement));
        assert.equal(await main.evaluate(el => el.scrollTop), bottom);
    }
    for (const [route,label] of [['suspense','悬念'],['clues','剧情线'],['opening','世界生成'],['planner','编剧']]) {
        await page.evaluate(route => globalThis.workspace.open(route),route);
        const header = page.getByRole('button',{name:label + '设置'}); await header.click();
        assert.ok(await page.locator('#tk-module-native-controls [data-settings-group=master]').isVisible());
        assert.equal(await page.locator('[data-settings-group=model], [data-settings-group=prompts]').count(),0);
    }
    await page.getByRole('button',{name:'收起酒馆后厨'}).click();
    await page.getByRole('button',{name:'酒馆后厨',exact:true}).click();
    assert.ok(await page.getByRole('button',{name:'编剧设置'}).isVisible());
    assert.deepEqual(errors, []);
    console.log('Verified host disclosures, reading height, scroll restoration, keyboard focus and last route.');
} finally {
    await browser.close();
}
