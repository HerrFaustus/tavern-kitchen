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
                        globalThis.frameReady = true;
                        reply({type:'LOAD_PANEL_CONFIG',config:{}});
                        reply({type:'KITCHEN_MEMORY_VIEW',view:'memory'});
                    } else if (event.data.type === 'SAVE_PANEL_CONFIG') {
                        globalThis.savedSettings=event.data;
                        reply({type:'PANEL_CONFIG_SAVE_RESULT',requestId:event.data.requestId,success:true});
                    } else if (event.data.type === 'REQUEST_GENERATE') {
                        globalThis.summaryRequest = event.data;
                        reply({type:'GENERATION_STATE',isGenerating:false});
                    }
                };
                frame.src='/scripts/extensions/third-party/tavern-kitchen/modules/story-summary/story-summary.html';
                workspace.getMount('memory').append(frame);
            }, recall() {
                workspace.getMount('recall').querySelector('iframe').contentWindow.postMessage({source:'TavernKitchen',type:'KITCHEN_MEMORY_VIEW',view:'recall'},globalThis.location.origin);
            }, proofreading() {
                workspace.getMount('proofreading').querySelector('iframe').contentWindow.postMessage({source:'TavernKitchen',type:'KITCHEN_MEMORY_VIEW',view:'proofreading'},globalThis.location.origin);
            }, 'settings-memory'() {
                workspace.getMount('settings-memory').querySelector('iframe').contentWindow.postMessage({source:'TavernKitchen',type:'KITCHEN_MEMORY_VIEW',view:'settings-memory'},globalThis.location.origin);
            }},
        });
        await workspace.open('memory');
    });
    const frame=page.frameLocator('iframe');
    await page.waitForFunction(() => globalThis.frameReady === true);
    assert.equal(await page.getByRole('button',{name:/总结设置|校对设置/}).count(), 0);
    assert.equal(await frame.locator('.archive #btn-generate').count(), 1);
    assert.equal(await frame.locator('#summary-options, #summary-controls, #tab-summary, #tab-agent, #trigger-interval, #trigger-role, #use-vector-boundary, #filter-rules-content').count(), 0);
    await page.evaluate(() => globalThis.document.querySelector('iframe').contentWindow.postMessage({
        source:'TavernKitchen', type:'CHAT_SUMMARY_STATE', state:{hasChat:true, chatEnabled:true, effectiveEnabled:true,
            recovery:{fromFloor:24,token:'fixture',scope:'branch-a'}},
    },globalThis.location.origin));
    const recover = frame.getByRole('button',{name:'从断点重记',exact:true});
    await recover.click();
    assert.match(await frame.locator('#confirm-message').innerText(), /保留前 24 楼.*第 25 楼/);
    await frame.locator('#confirm-cancel').click();
    assert.equal(await page.evaluate(() => globalThis.summaryRequest), undefined);
    await recover.click();
    await frame.locator('#confirm-ok').click();
    await page.waitForFunction(() => globalThis.summaryRequest?.recovery.token === 'fixture');
    await page.evaluate(() => globalThis.workspace.open('recall'));
    await frame.locator('#recall-page').waitFor({state:'visible'});
    await page.evaluate(() => globalThis.document.querySelector('iframe').contentWindow.postMessage({
        source:'TavernKitchen', type:'RECALL_HISTORY',
        entries:[{id:'r1',chatId:'default',targetFloor:9,type:'normal',status:'success',mode:'vector',queryPreview:'旧码头仓库线索',focusCharacters:['林默'],candidateCount:4,includedCount:1,trimmedCount:0,chunks:[{floor:2,speaker:'林默',score:0.88,included:true,text:'木箱夹层藏着半张船票。'}]}],
    }, globalThis.location.origin));
    assert.match(await frame.locator('#recall-detail').innerText(), /木箱夹层藏着半张船票/);
    await page.evaluate(() => globalThis.workspace.open('proofreading'));
    await frame.locator('#proofreading-page').waitFor({state:'visible'});
    await frame.locator('#proofreading-page .memory-record-view').waitFor({state:'visible'});
    assert.equal(await frame.locator('#proofreading-page input[type="checkbox"], #proofreading-page .memory-controls').count(), 0);
    await page.evaluate(() => globalThis.workspace.open('settings-memory'));
    await frame.locator('#settings-modal.active').waitFor();
    assert.ok(await frame.locator('#settings-retention-section').isVisible());
    assert.ok(await frame.locator('#proofreading-settings-host #proofreading-interval').isVisible());
    assert.ok(await frame.locator('#settings-recall-section').isVisible());
    await frame.locator('#keep-visible-count').fill('3');
    await frame.locator('#settings-save').click();
    await page.waitForFunction(() => globalThis.savedSettings?.config?.ui?.keepVisibleCount === 3);
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        assert.ok(await frame.locator('body').evaluate(body => body.scrollWidth <= body.clientWidth));
    }
    await page.evaluate(() => globalThis.workspace.open('memory'));
    await frame.locator('.archive').waitFor({state:'visible'});
    assert.ok(await frame.locator('#settings-modal').isHidden());
    assert.deepEqual(errors,[]);
    console.log('Verified streamlined memory settings, recall page, proofreading view and recovery controls inside unified workspace.');
} finally { await browser.close(); }
