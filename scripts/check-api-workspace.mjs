import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = await build({ stdin: { resolveDir: root, contents: `
    export {createKitchenWorkspace, bindKitchenSurface} from './core/kitchen-workspace.js';
    export {requireAgent} from './core/panel-controls.js';
    export {createTextApiRepository} from './modules/text-api/repository.js';
    export {createPreset} from './modules/text-api/model.js';
    export {mountTextApiSettings} from './modules/text-api/settings-ui.js';
    export {mountWorldSettings} from './modules/xiaobai-os/apps/world/evolution-view.js';
` }, bundle:true, format:'esm', platform:'browser', write:false, loader:{'.css':'empty'}, external:['../../../../../script.js','../../../../utils.js'] });
const [workspaceCss, embeddedCss, apiCss] = await Promise.all(['style.css','core/kitchen-embedded.css','modules/text-api/settings-ui.css'].map(file => fs.readFile(file,'utf8')));
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN});
try {
    for (const width of [319, 600]) {
        const page = await browser.newPage({ viewport:{width,height:780} });
        const errors = [];
        page.on('pageerror',error => errors.push(error.message));
        await page.route('**/*',async route => {
            const url = new URL(route.request().url());
            if (url.origin !== 'http://kitchen.test') return route.abort();
            if (url.pathname === '/script.js') return route.fulfill({contentType:'text/javascript',body:'export const getRequestHeaders = () => ({});'});
            if (url.pathname === '/utils.js') return route.fulfill({contentType:'text/javascript',body:'export const debounce = fn => fn;'});
            if (url.pathname.endsWith('/fixture.js')) return route.fulfill({contentType:'text/javascript',body:fixture.outputFiles[0].text});
            if (url.pathname.endsWith('kitchen-embedded.css')) return route.fulfill({contentType:'text/css',body:embeddedCss});
            if (url.pathname === '/api.css') return route.fulfill({contentType:'text/css',body:apiCss});
            const prefix = '/scripts/extensions/third-party/tavern-kitchen/';
            if (url.pathname.startsWith(prefix)) {
                const file = path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.length)));
                if (!file.startsWith(root + path.sep)) return route.abort();
                const types = {'.js':'text/javascript','.css':'text/css','.json':'application/json'};
                if (!types[path.extname(file)]) return route.abort();
                return route.fulfill({contentType:types[path.extname(file)],body:await fs.readFile(file)});
            }
            return route.fulfill({contentType:'text/html',body:'<style>body{margin:0;font:16px system-ui;color:var(--SmartThemeBodyColor);background:var(--SmartThemeBlurTintColor);--SmartThemeBodyColor:#ddd;--SmartThemeEmColor:#bbb;--SmartThemeQuoteColor:#bca880;--SmartThemeBorderColor:#787878;--SmartThemeBlurTintColor:#272728;--SmartThemeChatTintColor:#272728}.text_pole{font:inherit;border:1px solid var(--SmartThemeBorderColor);padding:3px 5px}.menu_button,.inline-drawer-header{font:inherit;color:inherit;background:transparent;border:1px solid var(--SmartThemeBorderColor);border-radius:4px}.text_pole:is(select){appearance:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%);background-size:5px 5px;background-position:right 6px center;background-repeat:no-repeat;padding-right:20px}'+workspaceCss+'#tk-workspace{position:fixed;inset:0;height:100%;width:100%}</style><div id="top-settings-holder"></div><select style="position:fixed;left:-100vw" class="text_pole" id="host-select" aria-label="宿主连接"><option>本地连接</option></select>'});
        });
        await page.goto('http://kitchen.test');
        const mountFixture = () => page.evaluate(async () => {
            const api = await import('/fixture.js');
            const { loadBuildEntry } = await import('/scripts/extensions/third-party/tavern-kitchen/core/build-assets.js');
            const key = 'textApiPresets';
            const storage = {
                async getStrict(name,fallback) { return JSON.parse(globalThis.localStorage.getItem(name) || 'null') ?? fallback; },
                async updateAndSave(update) {
                    const draft = {[key]:await this.getStrict(key,null)};
                    update(draft);
                    if (globalThis.failSave) { globalThis.failSave = false; throw new Error('样例存储写入失败'); }
                    globalThis.localStorage.setItem(key,JSON.stringify(draft[key]));
                },
                clearCache() {},
            };
            if (!globalThis.localStorage.getItem(key)) {
                const preset = id => api.createPreset(id, id === 'p' ? '本地连接' : '旧世界连接', {provider:'openai-compatible', baseUrl:'http://fixture.invalid', model:'fixture', apiKey:'fixture'});
                globalThis.localStorage.setItem(key,JSON.stringify({version:1,profilesVersion:1,presets:[preset('p'),preset('old')],bindings:{summary:'p',memory:'old',opening:'p',planner:'p'}}));
            }
            const repository = api.createTextApiRepository({common:storage,planner:storage});
            const workspace = api.createKitchenWorkspace({});
            const world = {subscribed:true, encounterFrequency:'occasional'};
            const prefs = {read:()=>({enabled:true,apps:{world}}),subscribe:()=>()=>{},async setEncounterFrequency(v){world.encounterFrequency=v;}};
            globalThis.uiFixture = {workspace,world,calls:0,simRuns:0};
            const doc = globalThis.document;
            let storyUi = null;
            workspace.configure({actions:{
                async situation() {
                    const mount = workspace.getMount('situation');
                    if (!storyUi) {
                        const host = doc.createElement('div');
                        host.className = 'tk-embedded-host';
                        const shadow = host.attachShadow({ mode: 'open' });
                        const surface = doc.createElement('div');
                        surface.className = 'tk-surface tk-embedded tk-follow-host';
                        shadow.append(surface);
                        mount.append(host);
                        api.bindKitchenSurface(host, surface);
                        const mod = await loadBuildEntry('apps/story-summary', shadow, { includeEmbedded: true });
                        storyUi = mod.mountStorySummaryUI({
                            root: shadow,
                            surface,
                            postToHost(msg) {
                                if (msg.type === 'FRAME_READY') {
                                    storyUi.receiveHostMessage({ source:'TavernKitchen', type:'LOAD_PANEL_CONFIG', config:{} });
                                    storyUi.receiveHostMessage({ source:'TavernKitchen', type:'KITCHEN_MEMORY_VIEW', view:'world' });
                                }
                            },
                        });
                    } else {
                        storyUi.receiveHostMessage({ source:'TavernKitchen', type:'KITCHEN_MEMORY_VIEW', view:'world' });
                    }
                    const bar = workspace.getControls();
                    const triggerBtn = doc.createElement('button'); triggerBtn.id = 'sim-trigger'; triggerBtn.type = 'button'; triggerBtn.className = 'menu_button'; triggerBtn.textContent = '执行推演';
                    const alertBox = doc.createElement('div'); alertBox.setAttribute('role', 'alert'); alertBox.hidden = true;
                    const alertMsg = doc.createElement('span');
                    const goSettings = doc.createElement('button'); goSettings.type = 'button'; goSettings.className = 'menu_button'; goSettings.textContent = '前往设置';
                    goSettings.onclick = () => workspace.visitBinding('simulation', '#sim-trigger');
                    alertBox.append(alertMsg, goSettings);
                    triggerBtn.onclick = async () => {
                        try {
                            await api.requireAgent('simulation', async () => repository);
                            globalThis.uiFixture.simRuns++;
                            alertBox.hidden = true;
                        } catch (error) {
                            alertMsg.textContent = error.message;
                            alertBox.hidden = false;
                        }
                    };
                    bar.append(triggerBtn, alertBox);
                }, 'settings-world'() {
                    api.mountWorldSettings(workspace.getMount('settings-world'), prefs);
                },
                settings() {
                    const mount = workspace.getMount('settings');
                    if (mount.querySelector('#api-surface-host')) return;
                    const host = doc.createElement('div');
                    host.id = 'api-surface-host';
                    host.className = 'tk-embedded-host';
                    const shadow = host.attachShadow({ mode: 'open' });
                    const apiStyle = doc.createElement('link');
                    apiStyle.rel = 'stylesheet'; apiStyle.href = '/api.css';
                    const embeddedStyle = doc.createElement('link');
                    embeddedStyle.id = 'tk-embedded-styles'; embeddedStyle.rel = 'stylesheet';
                    embeddedStyle.href = '/core/kitchen-embedded.css';
                    const surface = doc.createElement('div');
                    surface.className = 'tk-surface tk-embedded tk-follow-host';
                    const surfaceBody = doc.createElement('div');
                    surfaceBody.className = 'tk-surface-body';
                    surfaceBody.style.cssText = 'overflow:auto;padding:.35em;box-sizing:border-box;';
                    const rootEl = doc.createElement('main');
                    rootEl.id = 'api';
                    surfaceBody.append(rootEl);
                    surface.append(surfaceBody);
                    shadow.append(apiStyle, embeddedStyle, surface);
                    mount.append(host);
                    api.bindKitchenSurface(host, surface);
                    const instance = api.mountTextApiSettings(rootEl,{feature:'library',namespace:'',library:true,
                        async transport(action,payload) {
                            if (action === 'load') return repository.load();
                            if (action === 'mutate') return repository.mutate(payload.feature,payload.mutation);
                            if (action.endsWith('call-stats')) return {features:{},recent:[]};
                            if (action === 'dialog') {
                                globalThis.uiFixture.dialogs = globalThis.uiFixture.dialogs || [];
                                globalThis.uiFixture.dialogs.push(payload);
                                return globalThis.nextDialogResult ?? null;
                            }
                            globalThis.uiFixture.calls++; throw Error('意外模型调用');
                        },
                    });
                    instance.refresh();
                },
            }});
            await workspace.open('situation');
        });
        await mountFixture();
        assert.equal(await page.locator('#tk-workspace iframe').count(), 0);
        const trigger = page.locator('#sim-trigger');
        const apiSurface = page.locator('#api-surface-host');
        const binding = apiSurface.getByLabel('推演 Agent');
        const waitForReturnFocus = () => page.waitForFunction(() => globalThis.document.activeElement?.id === 'sim-trigger', undefined, { timeout: 5000 });
        await trigger.click();
        await page.getByRole('alert').filter({hasText:'请先在设置中配置推演agent'}).waitFor();
        await page.getByRole('button',{name:'前往设置'}).click();
        await binding.waitFor();
        await page.waitForFunction(() => globalThis.document.querySelector('#api-surface-host')?.shadowRoot?.activeElement?.dataset.agentBinding === 'simulation');
        assert.equal(await apiSurface.getByLabel('编剧 Agent').inputValue(),'p');
        assert.match(await apiSurface.getByLabel('总结 Agent').locator('..').innerText(),/旧世界连接/);
        assert.ok(await apiSurface.getByLabel('选择连接').isHidden());
        await page.getByRole('button',{name:'返回局势'}).click();
        await waitForReturnFocus();
        await trigger.click();
        await page.getByRole('button',{name:'前往设置'}).click();
        await page.evaluate(() => { globalThis.failSave = true; });
        await binding.selectOption('p');
        await apiSurface.getByRole('status').filter({hasText:'样例存储写入失败'}).waitFor();
        assert.equal(await binding.inputValue(),'');
        await binding.selectOption('p');
        await apiSurface.getByRole('status').filter({hasText:'已保存推演 Agent'}).waitFor();
        await page.getByRole('button',{name:'返回局势'}).click();
        await waitForReturnFocus();
        await trigger.click();
        await page.waitForFunction(() => globalThis.uiFixture.simRuns === 1);
        await page.getByRole('tab',{name:'设置',exact:true}).click();
        await page.getByRole('button',{name:'世界与推演'}).click();
        await page.locator('#tk-world-encounter-frequency').selectOption('lively');
        assert.equal(await page.evaluate(() => globalThis.uiFixture.world.encounterFrequency), 'lively');
        assert.equal(await page.locator('#tk-world-inject-to-story').count(), 0);
        await page.getByRole('button',{name:'API',exact:true}).click();
        assert.equal(await binding.inputValue(),'p');
        await apiSurface.getByLabel('总结 Agent').selectOption('p');
        await apiSurface.getByRole('status').filter({hasText:'已保存总结 Agent'}).waitFor();
        for (const [size,dark] of [[16,true],[20,false]]) {
            await page.evaluate(({size,dark}) => {
                globalThis.document.body.style.fontSize = size + 'px';
                globalThis.document.body.style.setProperty('--SmartThemeBodyColor',dark?'#ddd':'#252525');
                globalThis.document.body.style.setProperty('--SmartThemeBlurTintColor',dark?'#272728':'#f6f3ef');
                globalThis.document.body.style.setProperty('--SmartThemeChatTintColor',dark?'#272728':'#f6f3ef');
                globalThis.document.body.style.setProperty('--SmartThemeEmColor',dark?'#bbb':'#555');
            },{size,dark});
            const reference = await page.locator('#host-select').evaluate(el => ({height:el.offsetHeight,arrow:globalThis.getComputedStyle(el).backgroundImage}));
            await page.waitForFunction(expected => {
                const node = globalThis.document.querySelector('#api-surface-host')?.shadowRoot?.querySelector('[data-agent-binding=simulation]');
                return node && Math.abs(node.offsetHeight - expected) <= 1;
            },reference.height);
            assert.equal(await binding.evaluate(el => globalThis.getComputedStyle(el).backgroundImage),reference.arrow);
            assert.ok(await apiSurface.locator('.tk-surface-body').evaluate(el => el.scrollWidth <= el.clientWidth));
            if (process.env.TK_UI_SHOTS) {
                await fs.mkdir(process.env.TK_UI_SHOTS,{recursive:true});
                await page.screenshot({path:path.join(process.env.TK_UI_SHOTS,'API-'+width+'-'+(dark?'深色16':'浅色20')+'.png')});
            }
        }
        await apiSurface.getByText('编辑连接',{exact:true}).click();
        await apiSurface.getByText('更多',{exact:true}).click();
        const rename = apiSurface.getByRole('button',{name:'重命名'});
        await rename.click();
        assert.equal(await apiSurface.getByLabel('选择连接').locator('option:checked').textContent(),'本地连接');
        // Unsaved draft confirmation when switching connections (B5)
        const modelInput = apiSurface.getByLabel('模型', { exact: true });
        await modelInput.fill('unsaved-model-draft');
        await page.evaluate(() => { globalThis.nextDialogResult = false; });
        await apiSurface.getByLabel('选择连接').selectOption('old');
        assert.equal(await apiSurface.getByLabel('选择连接').inputValue(), 'p', 'cancelling dirty switch must keep current connection');
        assert.equal(await modelInput.inputValue(), 'unsaved-model-draft', 'cancelling dirty switch must keep unsaved draft');
        assert.ok(await page.evaluate(() => globalThis.uiFixture.dialogs?.some(d => d.kind === 'confirm' && /未保存/.test(d.message))));
        await page.evaluate(() => { globalThis.nextDialogResult = true; });
        await apiSurface.getByLabel('选择连接').selectOption('old');
        assert.equal(await apiSurface.getByLabel('选择连接').inputValue(), 'old');
        await apiSurface.getByLabel('选择连接').selectOption('p');
        // One-click bind all to host API (B5)
        await apiSurface.getByRole('button', { name: /一键全绑/ }).click();
        await apiSurface.getByRole('status').filter({ hasText: /同酒馆主 API/ }).first().waitFor();
        for (const agentLabel of ['总结 Agent', '推演 Agent', '编剧 Agent']) {
            assert.equal(await apiSurface.getByLabel(agentLabel).inputValue(), '@host');
        }
        // Re-bind back to 'p' so reload persistence assertion below stays intact
        await apiSurface.getByLabel('总结 Agent').selectOption('p');
        await apiSurface.getByRole('status').filter({ hasText: '已保存总结 Agent' }).waitFor();
        await apiSurface.getByLabel('推演 Agent').selectOption('p');
        await apiSurface.getByRole('status').filter({ hasText: '已保存推演 Agent' }).waitFor();
        await apiSurface.getByLabel('编剧 Agent').selectOption('p');
        await apiSurface.getByRole('status').filter({ hasText: '已保存编剧 Agent' }).waitFor();
        assert.equal(await page.evaluate(() => globalThis.uiFixture.calls),0);
        await page.reload(); await mountFixture();
        await page.getByRole('tab',{name:'设置',exact:true}).click();
        await binding.waitFor(); assert.equal(await binding.inputValue(),'p');
        assert.equal(await page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('textApiPresets')).bindings.world),'p');
        assert.deepEqual(errors,[]);
        await page.close();
    }
    console.log('Verified all three bindings, legacy conflict, rollback, cancel, explicit re-enable, keyboard focus, host metrics and persistence.');
} finally { await browser.close(); }
