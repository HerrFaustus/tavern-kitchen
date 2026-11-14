import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const workspace = (await build({absWorkingDir:root,entryPoints:['core/kitchen-workspace.js'],bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
const css = await fs.readFile(path.join(root, 'style.css'), 'utf8');
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN});
try {
    const page = await browser.newPage({viewport:{width:319,height:780}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://kitchen.test') { await route.abort(); return; }
        if (url.pathname === '/workspace.js') { await route.fulfill({contentType:'text/javascript',body:workspace}); return; }
        if (url.pathname === '/') {
            await route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#202024;color:#ddd}'+css+'#tk-workspace{position:fixed;inset:0;width:100%;height:100%}iframe{width:100%;height:100%;border:0}</style><div id="top-settings-holder"></div>'}); return;
        }
        const prefix='/scripts/extensions/third-party/tavern-kitchen/';
        if (!url.pathname.startsWith(prefix)) { await route.abort(); return; }
        const file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.length)));
        if (!file.startsWith(root+path.sep)) { await route.abort(); return; }
        await route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)] || 'application/octet-stream'});
    });
    await page.goto('http://kitchen.test/');
    await page.evaluate(async () => {
        const {createKitchenWorkspace} = await import('/workspace.js');
        const workspace = createKitchenWorkspace({});
        globalThis.workspace = workspace;
        workspace.configure({
            actions:{memory() {
                const existing = workspace.getMount('memory').querySelector('iframe');
                if (existing) { existing.contentWindow.postMessage({source:'TavernKitchen',type:'KITCHEN_MEMORY_VIEW',view:'memory'},globalThis.location.origin); return; }
                const frame = globalThis.document.createElement('iframe');
                frame.onload = () => workspace.attachFrame(frame);
                globalThis.onmessage = event => {
                    if (event.origin !== globalThis.location.origin || event.source !== frame.contentWindow || event.data?.source !== 'TavernKitchen-StoryFrame') return;
                    const reply = data => frame.contentWindow.postMessage({source:'TavernKitchen',...data},globalThis.location.origin);
                    if (event.data.type === 'FRAME_READY') {
                        reply({type:'LOAD_PANEL_CONFIG',config:{}});
                        reply({type:'KITCHEN_MEMORY_VIEW',view:'memory'});
                    } else if (event.data.type === 'SAVE_PANEL_CONFIG') {
                        globalThis.savedSettings=event.data;
                        reply({type:'PANEL_CONFIG_SAVE_RESULT',requestId:event.data.requestId,success:true});
                    }
                };
                frame.src='/scripts/extensions/third-party/tavern-kitchen/modules/story-summary/story-summary.html';
                workspace.getMount('memory').append(frame);
            }, proofreading() {
                workspace.getMount('proofreading').querySelector('iframe').contentWindow.postMessage({source:'TavernKitchen',type:'KITCHEN_MEMORY_VIEW',view:'proofreading'},globalThis.location.origin);
            }},
            panelSwitch:()=>({enabled:true,label:'启用总结',change(){}}),
        });
        await workspace.open('memory');
    });
    const frame=page.frameLocator('iframe');
    const controls=frame.locator('#tk-module-native-controls');
    await controls.waitFor();
    assert.equal(await controls.locator(':scope > h4').innerText(), '总结设置');
    const functional=controls.locator('[data-settings-group="function"]');
    await functional.locator('#summary-options #settings-modal.active').waitFor();
    assert.ok(await functional.locator('#trigger-enabled').isVisible());
    assert.equal(await functional.locator('#summary-options > summary').count(),0);
    assert.equal(await functional.locator('#tab-summary > summary').count(),0);
    assert.ok(await functional.locator('#tab-vector > h3').isVisible());
    const advanced=functional.locator('#tab-summary .summary-group').filter({hasText:'高级设置'});
    assert.equal(await advanced.locator('#use-vector-boundary').count(),1);
    assert.equal(await advanced.locator('#trigger-role').count(),1);
    assert.ok(await advanced.locator('#trigger-role').isVisible());
    assert.ok(await functional.locator('#filter-rules-content').isVisible());
    assert.equal(await functional.locator('details:visible').count(),0);
    await functional.locator('#trigger-interval').fill('3');
    await functional.locator('#settings-save').click();
    await page.waitForFunction(() => globalThis.savedSettings?.config?.trigger?.interval === 3);
    assert.equal(await controls.locator('[data-settings-group="prompts"], #tab-summary-prompts, #tab-prompts').count(), 0);
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        const height = () => frame.locator('#summary-controls').evaluate(el => el.getBoundingClientRect().height / globalThis.innerHeight);
        assert.ok(Math.abs(await height() - 1 / 4) < .02, `expected 1/4 summary controls height, got ${await height()}`);
    }
    if (process.env.TK_SETTINGS_SHOTS) {
        await fs.mkdir(process.env.TK_SETTINGS_SHOTS, {recursive:true});
        for (const width of [319,1280]) {
            await page.setViewportSize({width,height:780});
            await functional.locator('#trigger-interval').scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(process.env.TK_SETTINGS_SHOTS, `summary-${width}.png`)});
        }
    }
    await page.evaluate(() => globalThis.workspace.open('proofreading'));
    await frame.locator('#tab-agent.active').waitFor();
    await frame.locator('#tk-module-native-controls [data-settings-group="function"] #memory-maintenance-enabled').waitFor();
    assert.equal(await controls.locator(':scope > h4').innerText(), '校对设置');
    assert.equal(await controls.locator('[data-settings-group="prompts"]').count(), 0);
    const proofRatio = await frame.locator('.memory-controls').evaluate(el => el.getBoundingClientRect().height / globalThis.innerHeight);
    assert.ok(Math.abs(proofRatio - 1 / 4) < .02, `expected 1/4 proofreading controls ratio, got ${proofRatio}`);
    await page.evaluate(() => globalThis.workspace.open('memory'));
    await frame.locator('#summary-options #settings-modal.active').waitFor();
    assert.deepEqual(errors,[]);
    console.log('Verified compact summary and proofreading settings without prompt forms inside the unified workspace.');
} finally { await browser.close(); }
