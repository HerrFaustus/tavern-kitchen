/* eslint-env browser */
/* global fixture */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'acorn';
import { official, referenceFor, readOfficialFile } from './host/official.mjs';
import { startFixture } from './fixtures/install-host.mjs';

const root = path.resolve(import.meta.dirname,'..');
const archive = process.argv[2] && path.resolve(process.argv[2]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'tavern-kitchen-install-'));
const extension = archive ? path.join(temp,'tavern-kitchen') : root;
const old = JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/chat-0.2.32.json'),'utf8'));
const modelCalls = [];
let failConnection = false, failFloor = null;
const base = '/scripts/extensions/third-party/tavern-kitchen/';
const host = referenceFor(official.indexVersion);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser, archiveHash;
try {
    if (archive) {
        archiveHash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
        assert.equal(archiveHash,fs.readFileSync(archive+'.sha256','utf8').split(/\s+/)[0]);
        execFileSync('unzip',['-q',archive,'-d',temp]);
    }
    const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
    const built=JSON.parse(fs.readFileSync(path.join(extension,'dist/manifest.json')));
    if (archive) {
        const info=JSON.parse(fs.readFileSync(path.join(path.dirname(archive),'release-info.json')));
        assert.equal(info.sha256,archiveHash);assert.equal(info.archive,path.basename(archive));
        assert.equal(info.version,manifest.version);assert.equal(info.build_id,built.buildId);
        assert.equal(info.bytes,fs.statSync(archive).size);
        assert.equal(info.files,execFileSync('unzip',['-Z','-1',archive],{encoding:'utf8'}).trim().split('\n').length);
    }
    assert.equal(manifest.js,'dist/host/plugin.js');
    assert.ok(fs.existsSync(path.join(extension,manifest.js)));
    for (const file of ['docs/LICENSE.md','docs/NOTICE','docs/COPYRIGHT','dist/THIRD-PARTY-LICENSES.md']) assert.ok(fs.statSync(path.join(extension,file)).size>0);
    const imports=new Map();
    const dist=path.join(extension,'dist');
    for (const entry of fs.readdirSync(dist,{recursive:true}).filter(item=>item.endsWith('.js'))) {
        const source=fs.readFileSync(path.join(dist,entry),'utf8');
        for (const node of parse(source,{sourceType:'module',ecmaVersion:'latest'}).body.filter(n=>n.type==='ImportDeclaration')) {
            const target=path.posix.resolve(base+'dist',path.dirname(entry),node.source.value);
            if (target.startsWith(base)) continue;
            const names=imports.get(target) || new Set();
            for (const spec of node.specifiers) if (spec.imported?.name) names.add(spec.imported.name);
            imports.set(target,names);
        }
    }
    for(const field of ['doNavbarIconClick','saveSettings','getRequestHeaders','chat','characters','chat_metadata','eventSource','event_types']) imports.get('/script.js').add(field);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN});
    const bare=await browser.newPage();
    await bare.addInitScript(startFixture);
    await bare.route('http://kitchen.test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="chat"></div><div id="send_form"></div>'}));
    await bare.goto('http://kitchen.test/');
    const uninstalled=await bare.evaluate(async()=>{
        for (const type of ['normal','continue','swipe','group']) await fixture.generate(type);
        return {generated:fixture.generated,writes:fixture.writes,metadata:fixture.chat_metadata,prompts:Object.keys(fixture.extension_prompts)};
    });
    await bare.close();
    const page=await browser.newPage();
    page.setDefaultTimeout(7000);
    const failures=[];
    page.on('pageerror',err=>failures.push(err.message));
    page.on('console',msg=>{ if (msg.type()==='error' && msg.text().includes('[TavernKitchen]')) failures.push(msg.text()); });
    await page.addInitScript(startFixture);
    await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if (url.origin!=='http://kitchen.test') return route.abort();
        const name=decodeURIComponent(url.pathname);
        if(name === '/v1/chat/completions') {
            const body = route.request().postDataJSON();
            const floor = body.messages?.[1]?.content?.startsWith('{') ? JSON.parse(body.messages[1].content).increment?.end : undefined;
            modelCalls.push({model:body.model, messages:body.messages, floor});
            if (floor === failFloor) return route.fulfill({status:503,json:{error:{message:'fixture floor 20'}}});
            if(failConnection) return route.fulfill({status:503,json:{error:{message:'fixture busy'}}});
            const input = Number.isInteger(floor) && JSON.parse(body.messages[1].content);
            const last = input?.increment?.messages?.at(-1);
            const change = last?.text.includes('店主收下五金币，交出铜铃') ?
                [{type:'trade',task:'overview',group:'买铃',direction:'buy',counterparty:'shop',item:'bell',price:4,
                    floor:last.floor,quote:'店主收下五金币，交出铜铃',paymentQuote:'收下五金币'}] : [];
            const content = body.model === 'stub-planner'
                ? JSON.stringify({global:{text:'清河沿革',dependencies:[]},chapter:{text:'查证东桥。',dependencies:[]}})
                : JSON.stringify({summary:last?.text || '旅人入镇，东桥有守卫。',changes:change});
            if(body.stream) return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:4,total_tokens:11}})+'\n\ndata: [DONE]\n\n'});
            return route.fulfill({json:{model:body.model,choices:[{message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:4,total_tokens:11}}});
        }
        if (name==='/') return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="'+base+manifest.css+'"><style>.drawer-toggle{min-width:32px;min-height:28px}#tk-workspace.openDrawer{position:fixed;inset:30px 0 0;width:100%;height:calc(100% - 30px);z-index:10;background:white}.closedDrawer{display:none}</style><div id="top-settings-holder"></div><div id="extensions_settings"></div><div id="chat"></div><div id="send_form"></div><script src="/fixture-jquery.js"></script><script type="module" src="'+base+manifest.js+'"></script>'});
        if(name==='/fixture-jquery.js') return route.fulfill({contentType:'text/javascript',body:readOfficialFile(host,'public/lib/jquery-3.5.1.min.js')});
        if(imports.has(name)) return route.fulfill({contentType:'text/javascript',body:[...imports.get(name)].map(key=>'export const '+key+'=window.fixture['+JSON.stringify(key)+'] ?? (()=>{});').join('\n')});
        if(name.startsWith(base)){
            const file=path.resolve(extension,name.slice(base.length));
            assert.ok(file.startsWith(extension+path.sep));
            if(!fs.existsSync(file)) return route.fulfill({status:404,body:''});
            return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'})[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
        }
        return route.fulfill({status:404,body:''});
    });
    try {
        await page.goto('http://kitchen.test/');
        await page.waitForFunction(()=>!!window.tavernKitchenGenerateInterceptor && !!document.querySelector('#tavern-kitchen-extension'),{},{timeout:10000});
        await page.getByRole('button',{name:'酒馆后厨',exact:true}).first().click({timeout:5000});
        await page.waitForFunction(()=>document.querySelector('#tk-workspace')?.classList.contains('openDrawer'));
        await page.waitForTimeout(250);
        const observed = await page.evaluate(async()=>{
            for (const type of ['normal','continue','swipe','group']) await fixture.generate(type);
            await fixture.eventSource.emit(fixture.event_types.CHAT_CHANGED);
            return { generated:fixture.generated, writes:fixture.writes, metadata:fixture.chat_metadata, prompts:Object.keys(fixture.extension_prompts),
                enabled: Object.entries(fixture.extension_settings.TavernKitchen.panels || {}).filter(([,on])=>on).map(([k])=>k),
                floorControls:document.querySelectorAll('#tk-floor-status,.tavernKitchen-story-summary-btn').length,
                worlds:(await fixture.storedRows('TavernKitchen_WorldArchive','branches')).length,notes:(await fixture.storedRows('TavernKitchen.StoryPlanner','notes')).length };
        });
        assert.deepEqual(observed,{generated:4,writes:0,metadata:{},prompts:[],enabled:[],floorControls:0,worlds:0,notes:0});
        for (const [key,value] of Object.entries(uninstalled)) assert.deepEqual(observed[key],value);
        assert.deepEqual(failures,[]);
        await page.getByRole('button',{name:'酒馆后厨',exact:true}).first().click();
        await page.getByRole('button',{name:'主角设置'}).click();
        await page.locator('[data-panel=overview]').click();
        const missing=page.getByRole('alert').filter({hasText:'请先在API界面中配置更新agent'});
        await missing.waitFor();
        assert.equal(await page.locator('[data-panel=overview]').isChecked(),false);
        await missing.getByRole('button',{name:'前往 API'}).click();
        const api = page.frameLocator('iframe').last();
        const editor = api.getByText('编辑连接',{exact:true});
        await editor.click();
        const picker = api.getByLabel('选择连接',{exact:true});
        await picker.selectOption({label:'自定义连接'});
        for(const [agent,label] of [['update','更新'],['simulation','推演'],['planner','编剧']]) {
            if(agent !== 'update'){
                page.once('dialog',dialog=>dialog.accept(label+'测试连接'));
                await api.getByRole('button',{name:'新建',exact:true}).click();
                await picker.locator('option:checked').filter({hasText:label+'测试连接'}).waitFor({state:'attached'});
            }
            await api.getByLabel('接口地址',{exact:true}).fill('http://kitchen.test/v1');
            await api.getByLabel('API Key',{exact:true}).fill('fictional-test-key');
            await api.getByLabel('模型',{exact:true}).fill('stub-'+agent);
            await api.locator('[data-save]').click();
            await api.getByRole('status').filter({hasText:'已保存'}).first().waitFor();
            await api.getByLabel(label+' Agent',{exact:true}).selectOption(await picker.inputValue());
            await api.getByRole('status').filter({hasText:'已保存'+label+' Agent'}).waitFor();
        }
        assert.equal(modelCalls.length,0);
        assert.equal(await page.evaluate(()=>fixture.writes),0);
        assert.equal(await page.evaluate(async()=>(await fixture.storedRows('TavernKitchen_WorldArchive','branches')).length),0);
        for(const [index,role] of ['update','simulation','planner'].entries()){
            await picker.selectOption({label:['自定义连接','推演测试连接','编剧测试连接'][index]});
            failConnection=role==='simulation';
            await api.getByRole('button',{name:'测试生成'}).click();
            await api.getByRole('status').filter({hasText:failConnection?/503|fixture busy/:/成功/}).first().waitFor();
        }
        failConnection=false;
        assert.deepEqual(modelCalls.map(call=>call.model),['stub-update','stub-simulation','stub-planner']);
        await page.getByRole('button',{name:'返回主角'}).click();
        await page.locator('[data-panel=overview]').check();
        await page.waitForFunction(()=>fixture.chat_metadata.extensions?.TavernKitchen?.storySummary?.floorWork?.[1]?.done.includes('overview'),undefined,{timeout:10000});
        assert.equal(modelCalls.length,4);
        assert.ok(modelCalls.at(-1).messages[0].content.includes('主角物品栏') || modelCalls.at(-1).messages[0].content.includes('主角的钱物'));
        assert.ok(!modelCalls.at(-1).messages[0].content.includes('逐楼摘要'));
        const afterFirst=modelCalls.length;
        await page.evaluate(async()=>{
            fixture.chat.push({name:'旅人',is_user:true,mes:'给我看看。',send_date:'stream-user'});
            await fixture.eventSource.emit(fixture.event_types.MESSAGE_SENT,2);
            await fixture.eventSource.emit(fixture.event_types.GENERATION_STARTED,'normal',{},false);
            document.body.dataset.generating='true';
            fixture.chat.push({name:'店主',mes:'半句',send_date:'stream-role'});
            await fixture.eventSource.emit(fixture.event_types.STREAM_TOKEN_RECEIVED,'半句');
            await fixture.eventSource.emit(fixture.event_types.MESSAGE_RECEIVED,3);
        });
        await page.waitForTimeout(100);
        assert.equal(modelCalls.length,afterFirst);
        await page.evaluate(async()=>{
            Object.assign(fixture.chat[3],{mes:'只陈列货品。',swipes:['未选的候选。','只陈列货品。'],swipe_id:1,swipe_info:[{send_date:'unused'},{send_date:'stream-role'}]});
            delete document.body.dataset.generating;
            await fixture.eventSource.emit(fixture.event_types.GENERATION_ENDED);
        });
        await page.waitForFunction(()=>fixture.chat_metadata.extensions.TavernKitchen.storySummary.floorWork?.[3]?.done.includes('overview'));
        assert.equal(modelCalls.length,afterFirst+1);
        assert.deepEqual(JSON.parse(modelCalls.at(-1).messages[1].content).increment.messages.map(m=>m.text),['给我看看。','只陈列货品。']);
        await page.locator('[data-panel=overview]').uncheck();
        const connectionTests=modelCalls.slice(0,3).map(call=>call.model);
        await page.evaluate(() => {
            const chat=Array.from({length:100},(_,i)=>({mes:'虚构清河问答 '+i,is_user:i%2===0,name:i%2===0?'旅人':'店主',send_date:'test-'+i}));
            localStorage.setItem('chat',JSON.stringify(chat));localStorage.setItem('metadata','{}');localStorage.setItem('fixtureChatId','百楼旧事');
        });
        async function openInventory(){
            await page.getByRole('button',{name:'酒馆后厨',exact:true}).first().click();
            await page.getByRole('button',{name:'主角设置'}).click();
        }
        await page.reload(); await openInventory();
        const start=modelCalls.length;
        failFloor=39; await page.locator('[data-panel=overview]').check();
        await page.getByRole('button',{name:'重试本楼'}).waitFor({timeout:90000});
        assert.deepEqual(modelCalls.slice(start).map(r=>r.floor),Array.from({length:20},(_,i)=>2*i+1));
        assert.match(await page.locator('#tk-floor-status').innerText(),/第 40 楼/);
        await page.evaluate(()=>{ window.interrupted=fixture.generate('group'); });
        await page.waitForTimeout(50);
        assert.equal(await page.evaluate(()=>fixture.generated),0);
        await page.reload();
        await page.getByRole('button',{name:'重试本楼'}).waitFor({timeout:30000});
        await page.evaluate(()=>{window.waitForGeneration=fixture.generate('continue');});
        assert.equal(await page.evaluate(()=>fixture.generate('normal')),false);
        assert.equal(await page.evaluate(()=>fixture.generated),0);
        failFloor=null;
        await page.getByRole('button',{name:'重试本楼'}).click();
        await page.waitForFunction(()=>fixture.generated===1,undefined,{timeout:120000});
        assert.equal(await page.evaluate(()=>window.waitForGeneration),true);
        assert.equal(await page.evaluate(()=>Object.values(fixture.chat_metadata.extensions.TavernKitchen.storySummary.floorWork).filter(row=>row.done.includes('overview')).length),50);
        const backlog=modelCalls.slice(start).map(r=>r.floor);
        assert.equal(backlog.length,52);
        assert.equal(backlog.filter(f=>f===39).length,3);
        assert.deepEqual(backlog.slice(22),Array.from({length:30},(_,i)=>41+2*i));
        await openInventory(); await page.locator('[data-panel=overview]').uncheck();
        await page.evaluate(()=>localStorage.removeItem('fixtureChatId'));

        await page.evaluate(data=>fixture.installOld(data),old);
        await page.reload();
        await page.getByRole('button',{name:'酒馆后厨',exact:true}).first().click();
        await page.locator('#tk-tab-data').click();
        const data=page.frameLocator('iframe').last();
        async function exportCard(){
            const pending=page.waitForEvent('download',{timeout:10000});
            await data.getByRole('button',{name:'导出后厨卡'}).click();
            const download=await pending;
            return JSON.parse(fs.readFileSync(await download.path(),'utf8'));
        }
        const upgraded=await exportCard();
        assert.equal(upgraded.data.world.branchId,old.selected);
        assert.deepEqual(upgraded.data.world.entities,old.card.data.world.entities);
        assert.equal(upgraded.data.notes[0].chapter.text,'东桥封锁旧稿');
        assert.equal(upgraded.data.memory.storySummary.json.arcs,undefined);
        for(const input of [old.card,upgraded]){
            await data.locator('#kitchen-card-file').setInputFiles({name:'虚构后厨卡.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});
            await data.getByRole('button',{name:'导入',exact:true}).click();
            await data.getByText(/后厨卡已导入/).first().waitFor();
            const restored=await exportCard();
            assert.equal(restored.data.world.branchId,old.selected);
            assert.equal(restored.data.world.worldId,old.card.data.world.worldId);
            assert.deepEqual(restored.data.world.receipts,old.card.data.world.receipts);
            assert.equal(restored.data.notes.length,1);
        }
        const inactive=old.branches.find(row=>row.branchId!==old.selected);
        const preserved=await page.evaluate(async id=>({
            world:(await fixture.storedRows('TavernKitchen_WorldArchive','branches')).find(row=>row.branchId===id),
            notes:await fixture.storedRows('TavernKitchen.StoryPlanner','notes'),
        }),inactive.branchId);
        assert.deepEqual(preserved.world,inactive);
        const inactiveNote=old.notes.find(note=>note.owner!==old.card.data.notes[0].owner);
        assert.deepEqual(preserved.notes.find(n=>n.id===inactiveNote.id),inactiveNote);
        await page.locator('#tk-tab-overview').click();
        if (!await page.locator('[data-panel=overview]').isVisible()) await page.getByRole('button',{name:'主角设置'}).click();
        await page.locator('[data-panel=overview]').check();
        await page.waitForFunction(()=>fixture.chat_metadata.extensions.TavernKitchen.storySummary.floorWork?.[1]?.done.includes('overview'));
        await page.evaluate(async()=>{
            fixture.chat.push({name:'旅人',mes:'我递出五金币。',is_user:true,send_date:'buyer'},
                {name:'店主',mes:'店主收下五金币，交出铜铃。',swipe_id:0,swipes:['店主收下五金币，交出铜铃。','十枚才卖。'],swipe_info:[{send_date:'cash'},{send_date:'offer'}],send_date:'cash'});
            await fixture.eventSource.emit(fixture.event_types.MESSAGE_RECEIVED,3);
        });
        const confirmPrice=page.getByRole('button',{name:'按原文价确认（5 金币）'});
        await confirmPrice.waitFor();
        assert.match(await page.locator('#tk-floor-status').innerText(),/模型价 4 金币/);
        const beforePrice=await page.evaluate(async()=> (await fixture.storedRows('TavernKitchen_WorldArchive','branches'))
            .filter(b=>b.branchId===fixture.chat_metadata.extensions.TavernKitchen.storySummary.dataBranch || b.activeWorldBranch==='old-4')
            .map(b=>b.entities.find(e=>e.id==='hero')?.fields.coins?.value));
        assert.ok(beforePrice.length && beforePrice.every(value=>value===10));
        const toggle=page.getByRole('button',{name:'酒馆后厨',exact:true}).first();
        if(await page.locator('#tk-workspace.openDrawer').count()) await toggle.click();
        await confirmPrice.click();
        await page.waitForFunction(()=>fixture.chat_metadata.extensions.TavernKitchen.storySummary.floorWork?.[3]?.done.includes('overview'));
        await toggle.click();
        await page.locator('#tk-tab-data').click();
        const paid=await exportCard();
        const value=(card,id,field)=>card.data.world.entities.find(row=>row.id===id).fields[field]?.value;
        assert.equal(value(paid,'hero','coins'),5);assert.equal(value(paid,'shop','coins'),37);assert.equal(value(paid,'bell','owner').entityId,'hero');
        const receipt=paid.data.world.receipts.find(r=>r.origin?.effectId.startsWith('turn:'));
        assert.ok(receipt);
        assert.equal(receipt.trades[0].price,5);assert.equal(receipt.trades[0].quantity,1);
        await page.evaluate(async()=>{
            Object.assign(fixture.chat[3],{swipe_id:1,mes:'十枚才卖。',send_date:'offer'});
            await fixture.eventSource.emit(fixture.event_types.MESSAGE_SWIPED,3);
        });
        const recovery=data.locator('#world-recovery');
        if (!await recovery.getByRole('button',{name:'重新读取'}).isVisible()) await recovery.locator('details > summary').first().click();
        await recovery.getByRole('button',{name:'重新读取'}).click();
        await recovery.getByText(/已写入变化的正文来源有变/).waitFor();
        await recovery.getByRole('button',{name:'恢复到此版本'}).click();
        await recovery.getByText(/在当前世界恢复第/).waitFor();
        assert.match(await recovery.innerText(),/旅人.*coins|金币/);
        await recovery.getByRole('button',{name:'确认恢复'}).click();
        await recovery.getByText(/已原位恢复到第/).waitFor();
        await page.waitForFunction(()=>fixture.chat_metadata.extensions.TavernKitchen.storySummary.floorWork?.[3]?.source.messages.at(-1).text==='十枚才卖。');
        const quote=await exportCard();
        assert.equal(value(quote,'hero','coins'),10);assert.equal(value(quote,'shop','coins'),37);assert.equal(value(quote,'bell','owner').entityId,'shop');
        assert.equal(quote.data.world.worldId,paid.data.world.worldId);assert.equal(quote.data.world.branchId,paid.data.world.branchId);
        assert.ok(quote.data.world.withdrawn.some(v=>v.receipts.some(r=>r.commandId===receipt.commandId)));
        assert.equal(failures.filter(message=>message.includes('fixture busy')).length,1);
        assert.deepEqual(failures.filter(message=>!message.includes('fixture busy') && !message.includes('fixture floor 20')),[]);
        console.log(JSON.stringify({version:manifest.version,buildId:built.buildId,installedFrom:archive || 'working tree',sha256:archiveHash,browser:browser.version(),opened:true,uninstalled,allOff:observed,
            streaming:{partialRequests:0,acceptedRequests:1},priceReview:{proposed:4,paid:5,quantity:1},
            connections:connectionTests,backlog:{roleFloors:50,requests:backlog.length,blockedAt:40,hostGenerations:1},legacyCommit:old.commit,upgradedBranch:old.selected,cardImports:2,bell:{afterPurchase:5,afterRecovery:10,peerBalance:37,withdrawn:true}}));
    } catch (error) { throw new Error(error.message+' '+JSON.stringify(failures),{cause:error}); }
} finally { await browser?.close(); fs.rmSync(temp,{recursive:true,force:true}); }
