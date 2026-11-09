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
    const rootPanel=frame.locator('#world-proposals');
    await rootPanel.waitFor({state:'visible'});
    assert.equal(await rootPanel.locator('.tk-proposal-row').count(),1);
    assert.doesNotMatch(await rootPanel.innerText(),/隐藏的幕后首脑|真实身份/);
    await rootPanel.locator('.tk-proposal-queue > summary').click();
    await rootPanel.locator('.tk-proposal-row > summary').click();
    assert.match(await rootPanel.innerText(),/第 2 楼|主角支付五金币/);
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        const size=await rootPanel.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth}));
        assert.ok(size.scrollWidth<=size.width,`proposal panel overflows at ${width}px`);
    }
    await rootPanel.getByRole('button',{name:'确认写入'}).click();
    await rootPanel.getByRole('status').filter({hasText:'已保存'}).waitFor();
    const result=await page.evaluate(()=>globalThis.fixture.read());
    assert.equal(result.entities.find(item=>item.id==='hero').fields.coins.value,5);
    assert.equal(result.entities.find(item=>item.id==='smith').fields.coins.value,5);
    assert.equal(result.entities.find(item=>item.id==='sword').fields.owner.value.entityId,'hero');
    assert.equal(result.updates[0].reviews.length,3);
    assert.equal(new Set(result.updates[0].reviews.map(item=>item.eventId)).size,1);
    assert.equal(result.receipts.at(-1).origins.length,3);
    if (!await rootPanel.locator('.tk-proposal-queue').evaluate(node=>node.open)) await rootPanel.locator('.tk-proposal-queue > summary').click();
    await rootPanel.getByText('显示未直接证实或幕后变化（可能涉及剧透）').click();
    await rootPanel.locator('.tk-proposal-row > summary').click();
    assert.match(await rootPanel.innerText(),/隐藏的幕后首脑/);
    await rootPanel.getByRole('button',{name:'拒绝'}).click();
    await rootPanel.getByLabel('处理说明（可选）').fill('这条推测不成立');
    await rootPanel.getByRole('button',{name:'拒绝变化'}).click();
    await rootPanel.getByRole('status').filter({hasText:'已保存'}).waitFor();
    const rejected=await page.evaluate(()=>globalThis.fixture.read());
    assert.equal(rejected.updates[0].reviews.at(-1).action,'rejected');
    assert.equal(rejected.updates[0].reviews.at(-1).reason,'这条推测不成立');
    assert.equal(rejected.entities.find(item=>item.id==='smith').fields['真实身份'],undefined);
    assert.deepEqual(await page.evaluate(()=>globalThis.fixture.errors),[]);

    // Moving unchanged content must not be mistaken for a changed source.
    const originalBranch=rejected.branchId;
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
    // Editing the synthetic source makes the already-written trade stale.
    // Exercise the actual data route, fork before the effect, then switch back.
    await page.evaluate(()=>{globalThis.fixture.chat.shift();globalThis.fixture.chat[1].mes='主角没有购买铁剑。';});
    await recovery.getByRole('button',{name:'重新读取'}).click();
    await recovery.getByRole('status').filter({hasText:'正文来源有变'}).waitFor();
    assert.match(await recovery.innerText(),/正文来源有变/);
    await recovery.getByRole('button',{name:'恢复到此版本'}).click();
    assert.match(await recovery.innerText(),/聊天和总结不变/);
    await recovery.getByRole('button',{name:'确认恢复'}).click();
    await recovery.getByRole('status').filter({hasText:'已切换到第'}).waitFor();
    const restored=await page.evaluate(async()=>{await globalThis.fixture.archive.prepare();return globalThis.fixture.read();});
    assert.notEqual(restored.branchId,originalBranch);
    assert.equal(restored.entities.find(item=>item.id==='hero').fields.coins.value,10);
    assert.equal(restored.entities.find(item=>item.id==='smith').fields.coins.value,0);
    assert.equal((await page.evaluate(()=>globalThis.fixture.service.branches())).length,2);
    await recovery.getByRole('button',{name:'重新读取'}).click();
    await recovery.getByLabel('保留的世界分支').selectOption(originalBranch);
    await recovery.getByRole('button',{name:'切换分支'}).click();
    await recovery.getByRole('button',{name:'确认切换'}).click();
    await page.waitForFunction(async original=>{try{return (await globalThis.fixture.read()).branchId===original;}catch{return false;}},originalBranch);
    const original=await page.evaluate(()=>globalThis.fixture.read());
    assert.equal(original.entities.find(item=>item.id==='hero').fields.coins.value,5);
    const blocked=await page.evaluate(async()=>{try {await globalThis.fixture.archive.prepare();return false;}catch{return true;}});
    assert.equal(blocked,true,'switching back does not erase the old source conflict');

    const second=await openFixture(), next=second.page.frameLocator('iframe').locator('#world-proposals');
    await next.waitFor({state:'visible'});
    await next.locator('.tk-proposal-queue > summary').click();
    await next.locator('.tk-proposal-row > summary').click();
    await next.getByRole('button',{name:'修改'}).click();
    const values=next.getByLabel('新值');
    await values.nth(0).fill('4');
    await values.nth(1).fill('4');
    await next.getByLabel('处理说明（可选）').fill('核对后修改数额');
    await next.getByRole('button',{name:'确认并保存'}).click();
    await next.getByRole('status').filter({hasText:'已保存'}).waitFor();
    const edited=await second.page.evaluate(()=>globalThis.fixture.read());
    assert.equal(edited.entities.find(item=>item.id==='hero').fields.coins.value,4);
    assert.equal(edited.entities.find(item=>item.id==='smith').fields.coins.value,4);
    assert.equal(edited.updates[0].update.proposals[0].value,5);
    assert.equal(edited.updates[0].reviews[0].proposal.value,4);
    assert.deepEqual(await second.page.evaluate(()=>globalThis.fixture.errors),[]);
    const card=await second.page.evaluate(async()=>{const {testCardRoundTrip}=await import('/card.js');return testCardRoundTrip();});
    assert.deepEqual(card,{exportedNotes:1,containsSetting:false,branchChanged:true,chapter:'灯塔等待来客',recovered:'旧导入章节札记',
        calls:0,rejected:true,activeUnchanged:true,notesAfterRecovery:1,sourcePreserved:true,revisionPreserved:true});
    assert.deepEqual(errors,[]);
    console.log('Verified isolated workspace, grouped proposal review, world history restoration and switching, source conflicts, and actual IndexedDB card/notes round trip.');
} finally { await browser.close(); }
