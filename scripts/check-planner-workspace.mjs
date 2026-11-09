import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const shims = {
    'script.js': 'export const extension_prompts=globalThis.__plannerFixture.prompts,extension_prompt_types={IN_CHAT:1},extension_prompt_roles={SYSTEM:0};',
    'event-manager.js': 'export const event_types=new Proxy({},{get:(_,key)=>key}); export const createModuleEvents=()=>({on:(key,fn)=>{globalThis.__plannerFixture.events[key]=fn;},cleanup(){}});',
    'generate-interceptor.js': 'export const GENERATE_INTERCEPTOR_ORDER={STORY_PLANNER:300}; export const registerGenerateInterceptor=(_id,fn)=>{globalThis.__plannerFixture.interceptor=fn;}; export const unregisterGenerateInterceptor=()=>{};',
    'text-api-host.js': 'export const resolveTextApi=async()=>({provider:"other",apiKey:"fixture"}); export const generateFeatureText=async()=>{const f=globalThis.__plannerFixture;f.calls++;if(f.failNextRequest){f.failNextRequest=false;throw Error("fixture failure");}return {text:JSON.stringify({global:{text:"幕后线索尚未揭晓。",dependencies:[]},chapter:{text:"旅人站在码头。\\n海风吹动斗篷。\\n"+"船工低声商议潮水与航程。".repeat(240),dependencies:[]}})};};',
};
const bundle = await build({absWorkingDir:root,entryPoints:['scripts/fixtures/planner-workspace.js'],bundle:true,write:false,format:'esm',platform:'browser',
    plugins:[{name:'planner-fixture-boundaries',setup(api){
        api.onResolve({filter:/.*/},args=>{
            const name=path.basename(args.path);
            const resolved=path.resolve(args.resolveDir,args.path);
            const key=resolved === path.join(root,'modules/text-api/host.js') ? 'text-api-host.js' : name;
            return Object.hasOwn(shims,key) ? {path:key,namespace:'fixture'} : null;
        });
        api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:shims[args.path]}));
    }}]});
const css = await fs.readFile(path.join(root,'style.css'),'utf8');
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN});
try {
    const page=await browser.newPage({viewport:{width:319,height:780}}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(() => { globalThis.__plannerFixture={prompts:{},events:{},calls:0,errors:[]}; });
    await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if (url.origin !== 'http://kitchen.test') { await route.abort(); return; }
        if (url.pathname === '/fixture.js') { await route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text}); return; }
        await route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#202024;color:#ddd}'+css+
            '#tk-workspace{position:fixed;inset:0;width:100%;height:100%}</style><div id="top-settings-holder"></div>'});
    });
    const mount = () => page.evaluate(async()=>{const fixture=await import('/fixture.js');await fixture.mountPlannerFixture();});
    await page.goto('http://kitchen.test/');
    await mount();
    const panel=page.locator('#tk-panel-planner'), state=panel.locator('.tk-planner-note-status'), chapter=panel.locator('.tk-planner-chapter');
    await state.filter({hasText:'暂无札记'}).waitFor();
    assert.ok(await page.locator('#tk-module-native-controls [data-settings-group="function"]').isHidden());
    assert.equal(await page.evaluate(()=>globalThis.__plannerFixture.calls),0);
    const injected=await page.evaluate(()=>globalThis.__plannerFixture.generate());
    await chapter.filter({hasText:'旅人站在码头'}).waitFor();
    assert.equal(injected,'【本章札记】\n'+await chapter.innerText());
    const global=panel.locator('.tk-planner-global');
    assert.equal(await global.evaluate(el=>el.open),false);
    assert.ok(await global.locator('.tk-planner-note-text').isHidden());
    await global.locator('summary').click();
    assert.equal(await global.locator('.tk-planner-note-text').innerText(),'幕后线索尚未揭晓。');
    await page.evaluate(()=>globalThis.__plannerFixture.editSource());
    await state.filter({hasText:'暂无札记'}).waitFor();
    assert.ok(await chapter.isHidden());
    await page.evaluate(()=>globalThis.__plannerFixture.restoreSource());
    await chapter.filter({hasText:'旅人站在码头'}).waitFor();
    assert.equal(await global.evaluate(el=>el.open),false);
    await page.evaluate(()=>globalThis.__plannerFixture.fork());
    await state.filter({hasText:'暂无札记'}).waitFor();
    assert.ok(await chapter.isHidden());
    await page.evaluate(async()=>{globalThis.__plannerFixture.failNext();await globalThis.__plannerFixture.generate();});
    const functionSettings=page.locator('#tk-module-native-controls [data-settings-group="function"]');
    await functionSettings.getByRole('button',{name:'下次正文重试'}).waitFor();
    await functionSettings.getByRole('button',{name:'下次正文重试'}).click();
    assert.ok(await functionSettings.isHidden());
    await page.evaluate(()=>globalThis.__plannerFixture.restore());
    await chapter.filter({hasText:'旅人站在码头'}).waitFor();
    assert.equal(await global.evaluate(el=>el.open),false);
    assert.equal(await page.evaluate(()=>globalThis.__plannerFixture.calls),2);
    await page.reload();
    await mount();
    await chapter.filter({hasText:'旅人站在码头'}).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.__plannerFixture.calls),0,'reopening saved notes must not invoke the writer');
    if (process.env.TK_PLANNER_SHOTS) await fs.mkdir(process.env.TK_PLANNER_SHOTS,{recursive:true});
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        const sizes=await panel.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,height:el.clientHeight}));
        assert.ok(sizes.scrollWidth<=sizes.width,`planner note overflows at ${width}px`);
        assert.ok(sizes.height>0 && sizes.scrollHeight>sizes.height,`long notes must scroll at ${width}px`);
        assert.ok(await panel.evaluate(el=>{el.scrollTop=el.scrollHeight; return el.scrollTop>0;}));
        await panel.evaluate(el=>{el.scrollTop=0;});
        if (process.env.TK_PLANNER_SHOTS) await page.screenshot({path:path.join(process.env.TK_PLANNER_SHOTS,`planner-${width}.png`)});
    }
    assert.deepEqual(await page.evaluate(()=>globalThis.__plannerFixture.errors),[]);
    assert.deepEqual(errors,[]);
    console.log('Verified saved chapter, spoiler-gated global note, live branch changes and reload using browser IndexedDB.');
} finally { await browser.close(); }
