import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url), {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=process.cwd();
const workspace=(await build({absWorkingDir:root,entryPoints:['core/kitchen-workspace.js'],bundle:true,write:false,format:'esm',platform:'browser'})).outputFiles[0].text;
const api=(await build({absWorkingDir:root,entryPoints:['modules/text-api/settings-ui.js'],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.css':'empty'}})).outputFiles[0].text;
const css=await fs.readFile('style.css','utf8'); const apiCss=await fs.readFile('modules/text-api/settings-ui.css','utf8');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN});
try {
const page=await browser.newPage({viewport:{width:420,height:800}});
page.on('pageerror',e=>process.stderr.write('browser: '+e.message+'\n'));
await page.route('**/*',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/workspace.js')return route.fulfill({contentType:'text/javascript',body:workspace});if(p==='/api.js')return route.fulfill({contentType:'text/javascript',body:api}); return route.fulfill({contentType:'text/html',body:'<style>body{margin:0}'+css+'#tk-workspace{position:fixed;inset:0;width:100%;height:100%;}iframe{width:100%;height:100%;border:0}</style><div id="top-settings-holder"></div>'});});
await page.goto('http://kitchen.test/');
await page.evaluate(async ({apiCss})=>{const {createKitchenWorkspace}=await import('/workspace.js');const w=createKitchenWorkspace({});w.configure({actions:{settings(){const f=globalThis.document.createElement('iframe');f.onload=()=>w.attachFrame(f);f.srcdoc='<style>html,body{height:100%;margin:0}'+apiCss+'</style><div id="api"></div><script type="module">import {mountTextApiSettings} from "/api.js"; const e=mountTextApiSettings(document.getElementById("api"),{library:true, feature:"library",namespace:"",transport:async()=>({presets:[{id:"p",name:"测试",kind:"text",provider:"openai-compatible",baseUrl:"https://example.invalid/v1",apiKey:"",model:"fixture",sampling:{}}],bindings:{summary:"p"}})});e.refresh();</script>';w.getMount('settings').append(f);}},panelSwitch:()=>({enabled:true,label:'启用API',change(){}})});await w.open('settings');}, {apiCss});
const frame=page.frameLocator('iframe');
await frame.getByLabel('选择连接').waitFor({timeout:10000});
await frame.getByLabel('选择连接').selectOption('p');
await frame.getByLabel('模型', {exact:true}).waitFor();
assert.equal(await frame.locator('#tk-module-native-controls, [data-settings-group]').count(),0);
assert.equal(await frame.locator('.text-api-configuration > summary').count(),0);
assert.ok(await page.locator('#tk-module-native-controls').isHidden());
assert.ok(await page.locator('.tk-panel-page').evaluate(el=>el.classList.contains('tk-page-full')));
assert.ok(await frame.locator('[data-save]').isVisible());
assert.ok(await frame.getByRole('button',{name:'测试生成',exact:true}).isVisible());
console.log('Verified API stays unified inside the live workspace without settings groups.');
} finally {await browser.close();}
