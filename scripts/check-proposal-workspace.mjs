import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const developmentRoot = path.resolve(import.meta.dirname, '..');
const root = path.resolve(process.argv[2] || developmentRoot);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = (await build({absWorkingDir:root,entryPoints:['scripts/fixtures/proposal-workspace.js'],
    bundle:true,write:false,format:'esm',platform:'browser',nodePaths:[path.join(developmentRoot,'node_modules')]})).outputFiles[0].text;
const cardFixture = (await build({absWorkingDir:root,entryPoints:['scripts/fixtures/card-roundtrip.js'],
    bundle:true,write:false,format:'esm',platform:'browser',nodePaths:[path.join(developmentRoot,'node_modules')]})).outputFiles[0].text;
const css = await fs.readFile(path.join(root,'style.css'),'utf8');
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN});
try {
    const errors = [];
    async function openFixture() {
        const context=await browser.newContext({viewport:{width:319,height:780}}), page=await context.newPage();
        page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if (url.origin !== 'http://kitchen.test') { await route.abort(); return; }
        if (url.pathname === '/fixture.js') { await route.fulfill({contentType:'text/javascript',body:fixture}); return; }
        if (url.pathname === '/card.js') { await route.fulfill({contentType:'text/javascript',body:cardFixture}); return; }
        if (url.pathname === '/') {
            await route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#202024;color:#ddd}'+css+
                '#tk-workspace{position:fixed;inset:0;width:100%;height:100%}iframe{width:100%;height:100%;border:0}</style><div id="top-settings-holder"></div>'}); return;
        }
        const prefix='/scripts/extensions/third-party/tavern-kitchen/';
        if (!url.pathname.startsWith(prefix)) { await route.abort(); return; }
        const file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.length)));
        if (!file.startsWith(root+path.sep)) { await route.abort(); return; }
        await route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)] || 'application/octet-stream'});
        });
        await page.goto('http://kitchen.test/');
        await page.evaluate(async()=>{const {mountFixture}=await import('/fixture.js');await mountFixture();});
        return {context,page};
    }
    const {page} = await openFixture();
    const frame=page.frameLocator('iframe');
    assert.equal(await frame.locator('#world-proposals').count(), 0);
    await page.evaluate(() => globalThis.fixture.service.syncTurns(globalThis.fixture.chat));

    // Moving unchanged content must not be mistaken for a changed source.
    const beforeRecovery = await page.evaluate(() => globalThis.fixture.read());
    const originalBranch = beforeRecovery.branchId;
    await page.evaluate(async()=>{globalThis.fixture.chat.unshift({mes:'更早的开场。',send_date:'opening'});await globalThis.fixture.workspace.open('data');});
    const recovery=frame.locator('#world-recovery');
    await recovery.waitFor({state:'visible'});
    await recovery.locator('details > summary').click();
    assert.doesNotMatch(await recovery.innerText(),/正文来源有变/);
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        const size=await frame.locator('#data-page').evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth}));
        assert.ok(size.scrollWidth<=size.width,`data page overflows at ${width}px`);
    }
    await page.evaluate(()=>{globalThis.fixture.chat.shift();globalThis.fixture.chat[1].mes='主角没有购买铁剑。';});
    await recovery.getByRole('button',{name:'重新读取'}).click();
    await recovery.getByRole('status').filter({hasText:'正文来源有变'}).waitFor();
    assert.match(await recovery.innerText(),/正文来源有变/);
    await recovery.getByRole('button',{name:'恢复到此版本'}).click();
    assert.match(await recovery.innerText(),/在当前世界恢复/);
    await recovery.getByRole('button',{name:'确认恢复'}).click();
    await recovery.getByRole('status').filter({hasText:'已原位恢复到第'}).waitFor();
    const restored=await page.evaluate(async()=>{await globalThis.fixture.archive.prepare();return globalThis.fixture.read();});
    assert.equal(restored.branchId,originalBranch);
    assert.equal(restored.entities.find(item=>item.id==='hero').fields.coins.value,10);
    assert.equal(restored.entities.find(item=>item.id==='smith').fields.coins.value,0);
    assert.equal((await page.evaluate(()=>globalThis.fixture.service.branches())).length,1);
    await recovery.getByRole('button',{name:'重新读取'}).click();
    assert.equal(await recovery.getByLabel('保留的世界分支').count(),0);
    assert.match(await recovery.innerText(),/已撤销的回执/);
    const card=await page.evaluate(async()=>{const {testCardRoundTrip}=await import('/card.js');return testCardRoundTrip();});
    assert.deepEqual(card,{exportedNotes:1,containsSetting:false,branchChanged:true,chapter:'灯塔等待来客',recovered:'旧导入章节札记',
        calls:0,rejected:true,activeUnchanged:true,notesAfterRecovery:1,sourcePreserved:true,revisionPreserved:true});
    assert.deepEqual(errors,[]);
    console.log('Verified isolated workspace without manual proposal review, in-place world restoration, source conflicts, and actual IndexedDB card/notes round trip.');
} finally { await browser.close(); }
