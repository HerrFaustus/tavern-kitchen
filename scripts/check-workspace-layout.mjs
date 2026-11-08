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
        await route.fulfill({ contentType: 'text/html', body:
            '<style>body{margin:0;background:#202024;color:#ddd;font:15px sans-serif}' + css +
            '#tk-workspace{position:fixed;inset:0;width:100%;height:100%;background:#202024}iframe{width:100%;height:100%;border:0}</style><div id="top-settings-holder"></div>' });
    });
    await page.goto('http://kitchen.test');
    await page.evaluate(async () => {
        const { createKitchenWorkspace } = await import('/workspace.js');
        const workspace = createKitchenWorkspace({});
        let enabled = true;
        const configure = () => workspace.configure({
            actions: { map() {
                const mount = workspace.getMount('map');
                if (mount.querySelector('iframe')) return;
                const frame = globalThis.document.createElement('iframe');
                frame.onload = () => workspace.attachFrame(frame);
                frame.srcdoc = '<style>html,body{height:100%;margin:0}body{display:grid;grid-template-rows:minmax(0,2fr) minmax(0,1fr);color:#ddd;background:#202024}main,footer{overflow:auto;min-height:0}footer{border-top:1px solid #555;box-sizing:border-box}</style><main>' +
                    '<p>地图记录</p>'.repeat(60) + '</main><footer data-kitchen-controls="map"><section data-setting-section="function"><label>随剧情更新<input type="checkbox" checked></label></section><section data-setting-section="prompts"><textarea id="local-prompt">本地提示词</textarea></section></footer>';
                mount.append(frame);
            } },
            panelSwitch: () => ({ enabled, label: '启用地图', change(value) { enabled = value; configure(); } }),
            configurePanel(id, bar) {
                const details = globalThis.document.createElement('details');
                details.className = 'tk-panel-controls'; details.open = true;
                const heading = globalThis.document.createElement('summary');
                heading.textContent = '模型设置'; details.append(heading);
                for (let i = 0; i < 20; i++) {
                    const input = globalThis.document.createElement('textarea'); input.value = '测试设置';
                    details.append(input);
                }
                bar.hidden = false; workspace.getSettingSections().model.append(details);
            },
        });
        configure();
        await workspace.open('map');
    });
    const frame = page.frameLocator('iframe');
    await frame.locator('#tk-module-native-controls').waitFor();
    const groups = frame.locator('#tk-module-native-controls > details');
    assert.deepEqual(await groups.locator(':scope > summary').allTextContents(), ['总开关','模型设置','功能设置','提示词设置']);
    assert.deepEqual(await groups.evaluateAll(nodes => nodes.map(node => node.open)), [true,true,true,false]);
    assert.equal(await frame.locator('[data-settings-group="function"] [data-setting-section="function"]').count(), 1);
    assert.equal(await frame.locator('[data-settings-group="prompts"] #local-prompt').count(), 1);
    await frame.locator('[data-settings-group="prompts"] > summary').click();
    await frame.locator('#local-prompt').fill('保留修改后的本地提示词');

    for (const width of [319, 1280]) {
        await page.setViewportSize({ width, height: 780 });
        const ratio = await frame.locator('footer').evaluate(el => el.getBoundingClientRect().height / globalThis.innerHeight);
        assert.ok(Math.abs(ratio - 1 / 3) < .015);
        assert.equal(await frame.locator('[data-panel="map"]').count(), 1);
        assert.ok(await frame.locator('.tk-panel-controls').evaluate(el => el.open));
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

    await frame.getByRole('checkbox', { name: '启用地图' }).focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => globalThis.document.querySelector('#tk-topbar button').getAttribute('aria-expanded') === 'false');
    assert.deepEqual(errors, []);
    console.log('Verified one shared lower third, expanded settings and disabling/re-enabling across the live iframe.');
} finally {
    await browser.close();
}
