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
            await route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#202024;color:#ddd}'+css+'#tk-workspace{position:fixed;inset:0;width:100%;height:100%}</style><div id="top-settings-holder"></div>'}); return;
        }
        const prefix='/scripts/extensions/third-party/tavern-kitchen/';
        if (!url.pathname.startsWith(prefix)) { await route.abort(); return; }
        const file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.length)));
        if (!file.startsWith(root+path.sep)) { await route.abort(); return; }
        await route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)] || 'application/octet-stream'});
    });
    await page.goto('http://kitchen.test/');
    await page.evaluate(async () => {
        const { createKitchenWorkspace, bindKitchenSurface } = await import('/workspace.js');
        const { loadBuildEntry } = await import('/scripts/extensions/third-party/tavern-kitchen/core/build-assets.js');
        const workspace = createKitchenWorkspace({});
        globalThis.workspace = workspace;
        let ui = null;
        async function ensureSurface(initialView) {
            if (ui) {
                ui.receiveHostMessage({ source:'TavernKitchen', type:'KITCHEN_MEMORY_VIEW', view: initialView });
                return;
            }
            const mount = workspace.getMount('memory');
            const host = globalThis.document.createElement('div');
            host.className = 'tk-embedded-host';
            const shadow = host.attachShadow({ mode: 'open' });
            const surface = globalThis.document.createElement('div');
            surface.className = 'tk-surface tk-embedded tk-follow-host';
            shadow.append(surface);
            mount.append(host);
            bindKitchenSurface(host, surface);
            const mod = await loadBuildEntry('apps/story-summary', shadow, { includeEmbedded: true });
            ui = mod.mountStorySummaryUI({
                root: shadow,
                surface,
                postToHost(msg) {
                    const reply = data => ui.receiveHostMessage({ source:'TavernKitchen', ...data });
                    if (msg.type === 'FRAME_READY') {
                        globalThis.frameReady = true;
                        reply({ type:'LOAD_PANEL_CONFIG', config:{} });
                        reply({ type:'KITCHEN_MEMORY_VIEW', view: initialView });
                    } else if (msg.type === 'SAVE_PANEL_CONFIG') {
                        globalThis.savedSettings = msg;
                        reply({ type:'PANEL_CONFIG_SAVE_RESULT', requestId: msg.requestId, success:true });
                    } else if (msg.type === 'REQUEST_GENERATE') {
                        globalThis.summaryRequest = msg;
                        reply({ type:'GENERATION_STATE', isGenerating:false });
                    } else if (msg.type === 'CLOSE_PANEL') {
                        globalThis.closePanelPosted = (globalThis.closePanelPosted || 0) + 1;
                        workspace.close();
                    }
                },
            });
            globalThis.storyUi = ui;
        }
        workspace.configure({
            actions:{
                memory: () => ensureSurface('memory'),
                recall: () => ensureSurface('recall'),
                'settings-memory': () => ensureSurface('settings-memory'),
            },
        });
        await workspace.open('memory');
    });
    const surface = page.locator('#tk-memory-mount .tk-embedded-host');
    await page.waitForFunction(() => globalThis.frameReady === true);
    assert.equal(await page.locator('#tk-workspace iframe').count(), 0);
    assert.equal(await page.getByRole('button',{name:/总结设置/}).count(), 0);
    assert.equal(await surface.locator('.archive #btn-generate').count(), 1);
    assert.equal(await surface.locator('#summary-options, #summary-controls, #tab-summary, #tab-agent, #trigger-interval, #trigger-role, #use-vector-boundary, #filter-rules-content').count(), 0);
    await page.evaluate(() => globalThis.storyUi.receiveHostMessage({
        source:'TavernKitchen', type:'CHAT_SUMMARY_STATE', state:{hasChat:true, chatEnabled:true, effectiveEnabled:true,
            recovery:{fromFloor:24,token:'fixture',scope:'branch-a'}},
    }));
    const recover = surface.getByRole('button',{name:'从断点重记',exact:true});
    await recover.click();
    assert.match(await surface.locator('#confirm-message').innerText(), /保留前 24 楼.*第 25 楼/);
    await surface.locator('#confirm-cancel').click();
    assert.equal(await page.evaluate(() => globalThis.summaryRequest), undefined);
    await recover.click();
    await surface.locator('#confirm-ok').click();
    await page.waitForFunction(() => globalThis.summaryRequest?.recovery.token === 'fixture');
    await page.evaluate(() => globalThis.workspace.open('recall'));
    await surface.locator('#recall-page').waitFor({state:'visible'});
    await page.evaluate(() => globalThis.storyUi.receiveHostMessage({
        source:'TavernKitchen', type:'RECALL_HISTORY',
        entries:[{id:'r1',chatId:'default',targetFloor:9,type:'normal',status:'success',mode:'vector',queryPreview:'旧码头仓库线索',focusCharacters:['林默'],candidateCount:4,includedCount:1,trimmedCount:0,chunks:[{floor:2,speaker:'林默',score:0.88,included:true,text:'木箱夹层藏着半张船票。'}]}],
    }));
    assert.match(await surface.locator('#recall-detail').innerText(), /木箱夹层藏着半张船票/);
    const recallBounds = await surface.locator('#recall-page').evaluate(pageEl => {
        const select = pageEl.querySelector('#recall-round-select');
        const pRect = pageEl.getBoundingClientRect();
        const sRect = select.getBoundingClientRect();
        return {
            selectRight: sRect.right,
            pageRight: pRect.right,
            scrollWidth: pageEl.scrollWidth,
            clientWidth: pageEl.clientWidth,
        };
    });
    assert.ok(recallBounds.selectRight <= recallBounds.pageRight + 1, `recall select overflows right edge: ${JSON.stringify(recallBounds)}`);
    assert.ok(recallBounds.scrollWidth <= recallBounds.clientWidth + 1, `recall page overflows horizontally: ${JSON.stringify(recallBounds)}`);
    assert.equal(await surface.locator('#proofreading-page').count(), 0);
    await page.evaluate(() => globalThis.workspace.open('settings-memory'));
    await surface.locator('#settings-modal.active').waitFor();
    assert.ok(await surface.locator('#settings-retention-section').isVisible());
    assert.equal(await surface.locator('#proofreading-settings-host, #proofreading-interval').count(), 0);
    assert.ok(await surface.locator('#settings-recall-section').isVisible());
    assert.equal(await surface.locator('#keep-visible-count').inputValue(), '0');
    await surface.locator('#keep-visible-count').fill('3');
    await surface.locator('#settings-save').click();
    await page.waitForFunction(() => globalThis.savedSettings?.config?.ui?.keepVisibleCount === 3);
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        assert.ok(await surface.locator('.tk-surface-body').evaluate(body => body.scrollWidth <= body.clientWidth));
        const settingsFoot = await surface.locator('#settings-modal').evaluate(modal => {
            const layout = modal.querySelector('.workspace-layout').getBoundingClientRect();
            const foot = modal.querySelector('.modal-foot').getBoundingClientRect();
            return { layoutBottom: layout.bottom, footTop: foot.top };
        });
        assert.ok(settingsFoot.footTop >= settingsFoot.layoutBottom - 1, `settings footer overlaps scrollable body: ${JSON.stringify(settingsFoot)}`);
    }
    await page.evaluate(() => globalThis.workspace.open('memory'));
    await surface.locator('.archive').waitFor({state:'visible'});
    assert.ok(await surface.locator('#settings-modal').isHidden());
    // Pressing Escape inside the in-page story-summary surface closes the side workspace (B6)
    await surface.locator('#btn-generate').focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => globalThis.closePanelPosted === 1);
    assert.ok(await page.locator('#tk-workspace.closedDrawer').count() === 1);
    assert.deepEqual(errors,[]);
    console.log('Verified streamlined memory settings (keepVisibleCount default 0), recall page and recovery controls inside unified workspace.');
} finally { await browser.close(); }
