import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createPreset } from '../modules/text-api/model.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const bundle = await build({
    absWorkingDir: root, entryPoints: ['modules/text-api/settings-ui.js'],
    bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' },
});
const css = await fs.readFile(path.join(root, 'modules/text-api/settings-ui.css'), 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_BIN });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://kitchen.test') { await route.abort(); return; }
        if (url.pathname === '/settings.js') {
            await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
            return;
        }
        await route.fulfill({ contentType: 'text/html', body:
            '<style>body{background:#202024;color:#ddd;font:15px sans-serif;margin:0;height:100dvh;overflow:hidden}#api{height:100%;overflow:auto}' + css + '</style><main id="api"></main>' });
    });
    await page.goto('http://kitchen.test');
    const presets = [
        createPreset('text', '正文接口', { provider: 'openai-compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'fixture-only', model: 'fixture-model' }),
        createPreset('embedding', '向量接口', { kind: 'embedding', provider: 'openai-compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'fixture-only', model: 'fixture-vector' }),
    ];
    await page.evaluate(async presets => {
        const { mountTextApiSettings } = await import('/settings.js');
        const config = { presets, bindings: { summary: 'text', embedding: 'embedding' } };
        const editor = mountTextApiSettings(globalThis.document.querySelector('#api'), {
            feature: 'library', namespace: '', library: true,
            async transport(action, payload) {
                if (action === 'mutate') {
                    globalThis.saved = payload.mutation;
                    const index = config.presets.findIndex(p => p.id === payload.mutation.id);
                    config.presets[index] = structuredClone(payload.mutation.preset);
                }
                return structuredClone(config);
            },
        });
        editor.refresh();
    }, presets);
    const selector = page.getByLabel('选择连接');
    const settings = page.locator('.text-api-configuration');
    await selector.waitFor();
    assert.ok((await selector.boundingBox()).height <= 50);
    assert.equal(await selector.evaluate(el => !!el.closest('.tk-module-settings')), false);
    assert.ok(await settings.evaluate(el => el.open));
    assert.equal(await page.locator('.text-api-presets button, .text-api-presets input').count(), 0);
    await page.getByLabel('模型', { exact: true }).fill('updated-model');
    await page.locator('[data-save]').click();
    await page.waitForFunction(() => globalThis.saved?.preset.model === 'updated-model');
    await selector.selectOption('embedding');
    assert.equal(await page.getByLabel('接口用途').inputValue(), 'embedding');
    assert.equal(await page.getByLabel('模型', { exact: true }).inputValue(), 'fixture-vector');
    await fs.mkdir(path.join(root, 'output'), { recursive: true });
    for (const width of [319, 1280]) {
        await page.setViewportSize({ width, height: 780 });
        assert.ok(await page.locator('#api').evaluate(el => el.scrollWidth <= el.clientWidth));
        assert.equal(await settings.evaluate(el => globalThis.getComputedStyle(el).overflowY), 'visible');
        assert.equal(await page.locator('.text-api > fieldset').evaluate(el => globalThis.getComputedStyle(el).display), 'block');
        assert.ok(await selector.evaluate(el => el.getBoundingClientRect().height <= 50));
        await page.screenshot({ path: path.join(root, 'output', 'api-layout-' + width + '.png') });
    }
    assert.deepEqual(errors, []);
    console.log('Verified one continuous API page, preset switching and saving at both widths.');
} finally {
    await browser.close();
}
