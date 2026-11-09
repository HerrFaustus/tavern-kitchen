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
            '#tk-workspace{position:fixed;inset:0;width:100%;height:100%;background:#202024}iframe{width:100%;height:100%;border:0}</style><div id="top-settings-holder"></div>' });
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
                frame.srcdoc = '<html class="tk-embedded"><head><link rel="stylesheet" href="/embedded.css"><style>html,body{height:100%;margin:0}body{display:grid;grid-template-rows:minmax(0,2fr) minmax(0,1fr);color:#ddd;background:#202024}main,footer{overflow:auto;min-height:0}footer{border-top:1px solid #555;box-sizing:border-box}</style></head><body><main>' +
                    '<p>地图记录</p>'.repeat(60) + '</main><footer data-kitchen-controls="map"><section data-setting-section="function"><label>随剧情更新<input type="checkbox" checked></label></section><section data-setting-section="prompts"><textarea id="local-prompt">本地提示词</textarea></section></footer></body></html>';
                mount.append(frame);
            } },
            panelSwitch: () => ({ enabled, label: '启用地图', change(value) { enabled = value; configure(); } }),
            configurePanel(id, bar) {
                const fields = globalThis.document.createElement('div');
                fields.className = 'tk-panel-controls';
                for (let i = 0; i < 20; i++) {
                    const input = globalThis.document.createElement('textarea'); input.value = '测试设置';
                    fields.append(input);
                }
                bar.hidden = false; workspace.getSettingSections().model.append(fields);
                if (id === 'suspense') {
                    const emptyFooter = globalThis.document.createElement('footer'); emptyFooter.hidden = true; bar.append(emptyFooter);
                }
                if (id === 'planner') {
                    const prompt = globalThis.document.createElement('textarea'); prompt.id = 'native-prompt';
                    workspace.getSettingSections().prompts.append(prompt);
                }
            },
        });
        configure();
        await workspace.open('map');
    });
    const frame = page.frameLocator('iframe');
    await frame.locator('#tk-module-native-controls').waitFor();
    const groups = frame.locator('#tk-module-native-controls > [data-settings-group]');
    assert.deepEqual(await groups.locator(':scope > :is(h5, summary)').allTextContents(), ['模块开关','模型设置','功能设置','提示词设置']);
    assert.deepEqual(await groups.evaluateAll(nodes => nodes.map(node => node.tagName)), ['SECTION','SECTION','SECTION','DETAILS']);
    assert.equal(await frame.locator('#tk-module-native-controls > h4').innerText(), '地图设置');
    assert.equal(await frame.locator('#tk-module-native-controls').getAttribute('aria-label'), '地图设置');
    assert.equal(await groups.last().evaluate(el => el.open), false);
    assert.equal(await frame.locator('[data-settings-group="function"] [data-setting-section="function"]').count(), 1);
    assert.equal(await frame.locator('[data-settings-group="prompts"] #local-prompt').count(), 1);
    for (const width of [319, 1280]) {
        await page.setViewportSize({ width, height: 780 });
        const ratio = await frame.locator('footer').evaluate(el => el.getBoundingClientRect().height / globalThis.innerHeight);
        assert.ok(Math.abs(ratio - 1 / 3) < .015);
        assert.ok(await frame.locator('footer').evaluate(el => el.getBoundingClientRect().top >= globalThis.innerHeight * .65));
        await frame.locator('[data-settings-group="prompts"] > summary').click();
        const expanded = await frame.locator('footer').evaluate(el => el.getBoundingClientRect().height / globalThis.innerHeight);
        assert.ok(Math.abs(expanded - .8) < .015, `embedded prompt settings should expand upward: ${expanded}`);
        await frame.locator('#local-prompt').fill('保留修改后的本地提示词');
        await frame.locator('[data-settings-group="prompts"] > summary').click();
        assert.ok(Math.abs(await frame.locator('footer').evaluate(el => el.getBoundingClientRect().height / globalThis.innerHeight) - 1 / 3) < .015);
        assert.equal(await frame.locator('[data-panel="map"]').count(), 1);
        assert.equal(await frame.locator('[data-settings-group="model"] details').count(), 0);
        assert.equal(await page.locator('.tk-workspace-controls').count(), 0);
    }
    await frame.getByRole('checkbox', { name: '启用地图' }).click({ noWaitAfter: true });
    const outside = page.getByRole('checkbox', { name: '启用地图' });
    await outside.waitFor();
    assert.ok(await outside.isVisible());
    assert.equal(await outside.isChecked(), false);
    await outside.click({ noWaitAfter: true });
    await frame.locator('#tk-module-native-controls').waitFor();
    assert.ok(await frame.getByRole('checkbox', { name: '启用地图' }).isChecked());
    assert.equal(await frame.locator('#local-prompt').inputValue(), '保留修改后的本地提示词');
    assert.equal(await frame.locator('[data-settings-group="prompts"]').evaluate(el => el.open), false);

    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        await page.evaluate(() => globalThis.workspace.open('suspense'));
        const native = page.locator('#tk-module-native-controls');
        await native.waitFor();
        assert.ok(await native.locator('[data-settings-group=master]').isVisible());
        assert.ok(await native.locator('[data-settings-group=model]').isVisible());
        assert.ok(await native.locator('[data-settings-group=function]').isHidden());
        assert.ok(await native.locator('[data-settings-group=prompts]').isHidden());
        assert.equal(await native.locator(':scope > h4').innerText(), '悬念设置');
        const box = await native.evaluate(el => ({top:el.getBoundingClientRect().top,body:el.previousElementSibling.getBoundingClientRect().bottom,height:el.getBoundingClientRect().height,page:el.parentElement.getBoundingClientRect().height,header:el.parentElement.firstElementChild.getBoundingClientRect().height}));
        assert.ok(box.top >= box.body - 1,'settings must follow content');
        assert.ok(Math.abs(box.height / (box.page-box.header) - 1/3) < .02);
        await page.evaluate(() => globalThis.workspace.open('settings'));
        await page.waitForFunction(() => globalThis.document.querySelector('.tk-panel-page').classList.contains('tk-page-full'));
        assert.ok(await native.isHidden());
    }
    await page.evaluate(() => globalThis.workspace.open('planner'));
    const native = page.locator('#tk-module-native-controls');
    await native.locator('#native-prompt').waitFor({state:'attached'});
    assert.equal(await native.locator(':scope > h4').innerText(), '编剧设置');
    for (const width of [319, 1280]) {
        await page.setViewportSize({width,height:780});
        const ratio = async () => native.evaluate(el => {
            const page = el.parentElement.getBoundingClientRect();
            return el.getBoundingClientRect().height / (page.height - el.parentElement.firstElementChild.getBoundingClientRect().height);
        });
        assert.ok(Math.abs(await ratio() - 1 / 3) < .02);
        await native.locator('[data-settings-group="prompts"] > summary').click();
        assert.ok(Math.abs(await ratio() - .8) < .02);
        await native.locator('#native-prompt').fill('编剧提示词');
        await native.locator('[data-settings-group="prompts"] > summary').click();
        assert.equal(await native.locator('#native-prompt').inputValue(), '编剧提示词');
    }
    for (const [route, label] of [['overview','主角'], ['people','人物'], ['situation','局势'], ['opening','世界生成'], ['clues','剧情线']]) {
        await page.evaluate(route => globalThis.workspace.open(route), route);
        const heading = native.locator(':scope > h4');
        await heading.filter({hasText:label + '设置'}).waitFor();
        assert.equal(await heading.innerText(), label + '设置');
        assert.equal(await native.getAttribute('aria-label'), label + '设置');
    }
    await page.evaluate(() => globalThis.workspace.open('data'));
    await page.waitForFunction(() => globalThis.document.querySelector('.tk-panel-page').classList.contains('tk-page-full'));
    assert.equal(await page.locator('#tk-module-native-controls [data-settings-group]').count(),0);
    assert.ok(await page.locator('#tk-module-native-controls').isHidden());
    await page.evaluate(() => globalThis.workspace.open('map'));
    await frame.locator('#tk-module-native-controls').waitFor();
    await frame.getByRole('checkbox', { name: '启用地图' }).focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => globalThis.document.querySelector('#tk-topbar button').getAttribute('aria-expanded') === 'false');
    assert.deepEqual(errors, []);
    console.log('Verified named settings, persistent groups, prompt expansion and disabling/re-enabling in native and embedded panels.');
} finally {
    await browser.close();
}
