import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || path.resolve(import.meta.dirname, '..'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_BIN });
try {
    const page = await browser.newPage({ viewport: { width: 319, height: 780 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://kitchen.test') { await route.abort(); return; }
        if (url.pathname === '/') {
            await route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;background:#202024;color:#ddd}</style><iframe title="summary" style="width:100%;height:760px;border:0"></iframe>' });
            return;
        }
        const prefix = '/scripts/extensions/third-party/tavern-kitchen/';
        if (!url.pathname.startsWith(prefix)) { await route.abort(); return; }
        const file = path.resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
        if (!file.startsWith(root + path.sep)) { await route.abort(); return; }
        await route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream' });
    });
    await page.goto('http://kitchen.test');
    await page.evaluate(() => {
        const frame = globalThis.document.querySelector('iframe');
        globalThis.onmessage = event => {
            if (event.origin !== globalThis.location.origin || event.source !== frame.contentWindow || event.data?.source !== 'TavernKitchen-StoryFrame') return;
            const reply = data => frame.contentWindow.postMessage({ source: 'TavernKitchen', ...data }, globalThis.location.origin);
            if (event.data.type === 'WORLD_FIELD_SOURCE') {
                reply({type:'WORLD_FIELD_SOURCE_RESULT',payload:{...event.data,floor:3,name:'阿棠',text:'守卫阿棠接过县衙钥匙，答应明早交还。'}});
            } else if (event.data.type === 'WORLD_EVOLUTION_REQUEST') {
                reply({ type: 'WORLD_EVOLUTION_STATE', settings: globalThis.evolution || { enabled: true, subscribed: false, sceneryEvolution: false, encounterFrequency: 'occasional' } });
            } else if (event.data.type === 'WORLD_EVOLUTION_CHANGE') {
                globalThis.evolution = { enabled: true, subscribed: false, sceneryEvolution: false, encounterFrequency: 'occasional', ...globalThis.evolution, [event.data.key]: event.data.value };
                reply({ type: 'WORLD_EVOLUTION_STATE', settings: globalThis.evolution });
            } else if (event.data.type === 'FRAME_READY') {
                globalThis.frameReady = true;
                reply({ type: 'LOAD_PANEL_CONFIG', config: {} });
                reply({ type: 'KITCHEN_MEMORY_VIEW', view: 'memory' });
            } else if (event.data.type === 'KITCHEN_CARD_INFO') {
                reply({ type: 'KITCHEN_CARD_INFO_RESULT', counts: { rounds: 7, people: 2, notes: 1 } });
            } else if (event.data.type === 'KITCHEN_CARD_IMPORT') {
                globalThis.importedCard = JSON.parse(event.data.text); reply({ type:'KITCHEN_CARD_RESULT', success:true, message:'后厨卡已导入' });
            } else if (event.data.type === 'KITCHEN_CARD_EXPORT') {
                globalThis.exportedCard = true; reply({ type: 'KITCHEN_CARD_RESULT', success: true, message: '后厨卡已导出' });
            } else if (event.data.type === 'SAVE_PANEL_CONFIG') {
                globalThis.savedPrompt = event.data.promptChange;
                reply({ type: 'PANEL_CONFIG_SAVE_RESULT', requestId: event.data.requestId, success: true });
            }
        };
        frame.src = '/scripts/extensions/third-party/tavern-kitchen/modules/story-summary/story-summary.html';
    });
    const frame = page.frameLocator('iframe');
    await page.waitForFunction(() => globalThis.frameReady === true);
    assert.equal(await frame.locator('.archive #btn-generate').count(), 1);
    assert.equal(await frame.locator('#summary-options, #summary-controls, #tab-summary-prompts, #tab-prompts, #summary-style, #prompt-round, #prompt-stage, #prompt-chapter, #tab-agent, [data-settings-group="prompts"], [data-setting-section="prompts"]').count(), 0);
    assert.ok(await frame.locator('.archive').evaluate(el => !el.inert && el.checkVisibility()));
    assert.ok(await frame.locator('#settings-modal').isHidden());
    const view = name => page.evaluate(view => globalThis.document.querySelector('iframe').contentWindow.postMessage({ source:'TavernKitchen', type:'KITCHEN_MEMORY_VIEW', view },globalThis.location.origin), name);
    await view('data');
    await frame.locator('#data-overview').waitFor();
    await frame.locator('#kitchen-card-counts').filter({ hasText: '7 轮总结' }).waitFor();
    assert.ok(await frame.locator('.archive').isHidden());
    assert.ok(await frame.locator('#settings-modal').isHidden());
    assert.equal(await frame.locator('#legacy-data-tools, #tab-transfer, #tab-cache, #tab-clear, #tab-backups, #workspace-clear, #workspace-rollback').count(), 0);
    await frame.getByRole('button', { name: '导出后厨卡', exact: true }).click();
    await page.waitForFunction(() => globalThis.exportedCard === true);
    await frame.locator('#kitchen-card-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({type:'TavernKitchenCard',version:1,data:{}}))});
    await frame.locator('#confirm-ok').click();
    await page.waitForFunction(() => globalThis.importedCard?.type === 'TavernKitchenCard');
    await frame.locator('#kitchen-card-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await frame.locator('#kitchen-card-status').filter({hasText:'不支持的后厨卡格式'}).waitFor();
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        const full = await frame.locator('#data-page').evaluate(el => ({height:el.getBoundingClientRect().height,total:globalThis.innerHeight,overflow:globalThis.getComputedStyle(el).overflowY,width:el.clientWidth,scrollWidth:el.scrollWidth}));
        assert.ok(Math.abs(full.height/full.total - 1) < .02);
        assert.equal(full.overflow,'auto');
        assert.ok(full.scrollWidth <= full.width);
        assert.equal(await frame.locator('#data-page [data-setting-section], #data-page [data-kitchen-controls], #data-page [data-settings-group]').count(),0);
        assert.equal(await frame.locator('#data-controls').evaluate(el => globalThis.getComputedStyle(el).overflowY),'visible');
    }
    await view('recall');
    await frame.locator('#recall-page').waitFor({ state: 'visible' });
    await frame.locator('#recall-empty').filter({ hasText: '暂无本聊天每轮召回记录' }).waitFor();
    await page.evaluate(() => globalThis.document.querySelector('iframe').contentWindow.postMessage({
        source: 'TavernKitchen', type: 'RECALL_HISTORY',
        entries: [{ id: 'r1', chatId: 'default', targetFloor: 4, type: 'normal', status: 'success', mode: 'vector', queryPreview: '旧港潮汐与灯塔密函', focusCharacters: ['林默', '灯塔'], candidateCount: 6, includedCount: 1, trimmedCount: 1, diagnosticsText: 'recall ok line 1', chunks: [
            { floor: 1, speaker: '林默', score: 0.91, included: true, text: '潮水退去后，灯塔铁门露出铜锁。' },
            { floor: 0, speaker: '港口守卫', score: 0.42, included: false, filterReason: 'budget', text: '雾气弥漫在码头的木桩间。' },
        ] }],
    }, globalThis.location.origin));
    await frame.locator('#recall-detail').waitFor({ state: 'visible' });
    assert.match(await frame.locator('#recall-detail').innerText(), /旧港潮汐与灯塔密函/);
    assert.match(await frame.locator('#recall-detail').innerText(), /灯塔铁门露出铜锁/);
    await frame.locator('#recall-diagnostics-wrap > summary').click();
    assert.match(await frame.locator('#recall-diagnostics-log').innerText(), /recall ok line 1/);
    assert.equal(await frame.locator('#proofreading-page').count(), 0);
    await view('settings-memory');
    await frame.locator('#settings-modal.active').waitFor();
    assert.ok(await frame.locator('#settings-retention-section').isVisible());
    assert.equal(await frame.locator('#proofreading-settings-host, #proofreading-interval').count(), 0);
    assert.ok(await frame.locator('#settings-recall-section').isVisible());
    assert.equal(await frame.locator('#trigger-interval, #trigger-role, #use-vector-boundary, #filter-rules-content, #tab-summary, #tab-agent').count(), 0);
    await frame.locator('#settings-save').click();
    await frame.locator('#settings-modal.active').waitFor();
    await view('memory');
    await frame.locator('.archive').waitFor({ state: 'visible' });
    await view('people');
    await frame.locator('#archive-people').waitFor();
    assert.equal(await frame.locator('#archive-person-select').count(), 0);
    assert.equal(await frame.getByText('选择一段对话后查看人物档案。', { exact: true }).count(), 1);
    assert.equal(await frame.locator('#profile-content').innerText(), '');
    await page.evaluate(() => globalThis.document.querySelector('iframe').contentWindow.postMessage({
        source: 'TavernKitchen', type: 'SUMMARY_FULL_DATA',
        payload: globalThis.originalScene = {
            chatId: 'people-ui-fixture', rounds: [], facts: [],
            storyRecords: [
                { id: 'port', kind: 'situation', title: '港口封锁', description: '守卫检查出港船只。', status: 'open', _history: [{text:'守卫开始加强检查',_addedAt:1}] },
                { id: 'rain', kind: 'situation', flavor: 'scenery', title: '雨季将至', description: '海风湿润，迁徙鸟群停在岸边。', status: 'open' },
            ],
            entities: [{ id: 'person-lin', kind: 'person', name: '林舟', aliases: ['银鸦'],
                fields: { '称号': { value: '渡鸦使者', nature: 'established_fact' } } }],
            characterAliases: [{ from: '阿舟', to: '银鸦', evidence: '身份已揭示' }],
            characters: { main: ['林舟', '银鸦', '阿舟', '沈青'], relationships: [
                { from: '银鸦', to: '沈青', label: '共同守护银钥匙的伙伴' },
            ] },
        },
    }, globalThis.location.origin));
    for (const width of [319, 1280]) {
        await page.setViewportSize({ width, height: 780 });
        await view('people');
        await frame.locator('#archive-people').waitFor();
        assert.ok(await frame.locator('.archive-hero').isHidden());
        assert.equal(await frame.locator('.archive-search, #keywords-cloud, .archive-keywords').count(), 0);
        assert.equal(await frame.locator('.archive-graph, #archive-profile-open, #rel-fs-modal').count(), 0);
        assert.ok(await frame.locator('#archive-person-name').isHidden());
        assert.equal(await frame.locator('#archive-roster button').count(), 2);
        assert.equal(await frame.locator('.archive-aliases, #aliases-list, #alias-add').count(), 0);
        await frame.locator('#archive-roster').getByRole('button', { name: /林舟/ }).click();
        assert.match(await frame.locator('#profile-content').innerText(), /共同守护银钥匙的伙伴/);
        assert.match(await frame.locator('#profile-content').innerText(), /别名：银鸦、阿舟/);
        assert.match(await frame.locator('#profile-content').innerText(), /称号：渡鸦使者/);
        await frame.locator('#archive-people-back').click();
        await frame.locator('#archive-roster').getByRole('button', { name: /沈青/ }).click();
        assert.equal(await frame.locator('#archive-person-name').innerText(), '沈青');
        assert.match(await frame.locator('#profile-content').innerText(), /共同守护银钥匙的伙伴/);
        assert.ok(await frame.locator('#archive-profile').isVisible());
        await frame.locator('#archive-people-back').click();
        await view('memory');
        await frame.locator('#archive-story').waitFor();
        assert.ok(await frame.locator('.archive-hero').isVisible());
        assert.equal(await frame.locator('.archive-search').count(), 0);
    }
    await view('people');
    const deliver = payload => page.evaluate(payload => globalThis.document.querySelector('iframe').contentWindow.postMessage({
        source:'TavernKitchen',type:'SUMMARY_FULL_DATA',payload
    }, globalThis.location.origin),payload);
    const state = {chatId:'people-ui-fixture',branchId:'主线',characters:{main:[],relationships:[]},storyRecords:[],rounds:[],facts:[],characterAliases:[],entities:[]};
    await deliver(state);
    await frame.getByText('这段对话尚无人物记录。').waitFor();
    const guard = {kind:'person',id:'tang-west',name:'阿棠',fields:{身份:{nature:'established_fact',value:'西门守卫'}}};
    const key = {kind:'item',id:'key',name:'县衙钥匙',fields:{保管人:{nature:'established_fact',value:{entityId:guard.id},source:{module:'world_update',key:'fixture/0'}}}};
    state.entities = [guard,key];
    await deliver(state);
    await frame.locator('#archive-person-name').filter({hasText:'阿棠'}).waitFor();
    assert.ok(await frame.locator('#archive-roster').isHidden());
    assert.match(await frame.locator('#profile-content').innerText(),/所有人：未知，保管人：阿棠/);
    await frame.getByRole('button',{name:'查看交接原楼'}).click();
    await frame.locator('#archive-detail-body').filter({hasText:'第 4 楼'}).waitFor();
    await frame.getByRole('button',{name:'返回档案'}).click();
    const twin = {kind:'person',id:'tang-east',name:'阿棠',fields:{身份:{nature:'established_fact',value:'东门传令官'}}};
    state.entities.push(twin);
    await deliver(state);
    await frame.getByRole('button',{name:/东门传令官/}).click();
    assert.equal(await frame.locator('#world-people-editor, button:has-text("编辑人物"), button:has-text("编辑名称")').count(), 0);
    await page.setViewportSize({width:600,height:780});
    assert.equal(await frame.locator('#archive-person-name').innerText(),'阿棠');
    await frame.locator('#archive-people-back').click();
    assert.ok(await frame.getByRole('button',{name:/东门传令官/}).evaluate(el => el.ownerDocument.activeElement === el));
    await frame.getByRole('button',{name:/西门守卫/}).click();
    await deliver({...state,branchId:'支线'});
    await frame.getByRole('button',{name:/东门传令官/}).waitFor();
    const longName = '城北抄录官' + 'Ashford'.repeat(12);
    const roster = Array.from({length:36}, (_, i) => ({kind:'person', id:'scribe-' + i, name:'书吏' + i, fields:{}}));
    roster.push({kind:'person',id:'guest',name:longName,fields:{}});
    const ending = '守卫将封好的名册交到城门。';
    const round = {_addedAt:3, _sourceStart:2, title:'西门换班', summary:'守卫沿城墙清点灯火。'.repeat(480) + ending, participants:[]};
    await deliver({...state, entities:roster, rounds:[round]});
    const reading = frame.locator('.archive');
    const guest = frame.getByRole('button',{name:new RegExp('城北抄录官')});
    for (const width of [319,600]) {
        await page.setViewportSize({width,height:780});
        await guest.scrollIntoViewIfNeeded();
        const previous = await reading.evaluate(el => el.scrollTop);
        assert.ok(previous > 0);
        assert.ok(await reading.evaluate(el => el.scrollWidth <= el.clientWidth));
        await guest.click();
        assert.equal(await frame.locator('#archive-person-name').innerText(),longName);
        await frame.locator('#archive-people-back').click();
        assert.equal(await reading.evaluate(el => el.scrollTop),previous);
        assert.ok(await guest.evaluate(el => el === el.ownerDocument.activeElement));
        await view('memory');
        await frame.locator('#timeline-list').getByText(round.summary,{exact:true}).waitFor();
        const accessibleEnd = await reading.evaluate(el => {
            el.scrollTop = el.scrollHeight;
            const text = el.querySelector('.archive-event-main p');
            return !!text && text.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1 && el.scrollTop > 0 && el.scrollWidth <= el.clientWidth;
        });
        assert.ok(accessibleEnd);
        await view('people');
    }
    await page.evaluate(() => globalThis.document.querySelector('iframe').contentWindow.postMessage({source:'TavernKitchen',type:'SUMMARY_FULL_DATA',payload:globalThis.originalScene},globalThis.location.origin));
    await view('world');
    const affairs = frame.locator('[data-situation-group="affairs"]');
    const scenery = frame.locator('[data-situation-group="scenery"]');
    await affairs.waitFor();
    assert.match(await affairs.innerText(), /港口封锁/);
    assert.match(await scenery.innerText(), /雨季将至/);
    assert.equal(await frame.locator('.tk-story-situations article').count(), 2);
    assert.doesNotMatch(await frame.locator('.tk-story-situations').innerText(), /类型：事态|类型：风物/);
    assert.equal(await frame.locator('.tk-story-situations h5').filter({hasText:'局势历史'}).count(),1);
    assert.match(await frame.locator('[data-record-id=port]').innerText(),/守卫开始加强检查/);
    assert.match(await frame.locator('[data-record-id=port]').innerText(),/来源：第 2 楼/);
    assert.equal(await frame.locator('.tk-story-situations details').count(), 0);
    assert.equal(await frame.locator('.tk-story-situations > button, .sec-btn').count(), 0);
    assert.equal(await frame.locator('.tk-story-situations input, .tk-story-situations select, #situation-controls').count(), 0);
    await fs.mkdir(path.resolve('output'), { recursive: true });
    for (const width of [319, 1280]) {
        await page.setViewportSize({ width, height: 780 });
        assert.ok(await affairs.isVisible());
        assert.ok(await scenery.isVisible());
        assert.ok(await frame.locator('body').evaluate(body => body.scrollWidth <= body.clientWidth));
        await page.screenshot({ path: path.resolve('output', 'situations-' + width + '.png') });
    }
    await view('memory');
    await frame.locator('#archive-story').waitFor();
    assert.deepEqual(errors, []);
    console.log('Verified summary settings, read-only character profiles with relationship entries and dual-axis views.');
} finally { await browser.close(); }

