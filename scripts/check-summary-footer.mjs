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
            await route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;background:#202024;color:#ddd}#host{width:100%;height:780px}</style><div id="host" class="tk-embedded-host"></div>' });
            return;
        }
        const prefix = '/scripts/extensions/third-party/tavern-kitchen/';
        if (!url.pathname.startsWith(prefix)) { await route.abort(); return; }
        const file = path.resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
        if (!file.startsWith(root + path.sep)) { await route.abort(); return; }
        await route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream' });
    });
    await page.goto('http://kitchen.test');
    await page.evaluate(async () => {
        const { loadBuildEntry } = await import('/scripts/extensions/third-party/tavern-kitchen/core/build-assets.js');
        const host = globalThis.document.getElementById('host');
        const shadow = host.attachShadow({ mode: 'open' });
        const surface = globalThis.document.createElement('div');
        surface.className = 'tk-surface tk-embedded tk-follow-host';
        surface.dataset.kitchenTheme = 'host';
        shadow.append(surface);
        const mod = await loadBuildEntry('apps/story-summary', shadow, { includeEmbedded: true });
        let ui;
        ui = mod.mountStorySummaryUI({
            root: shadow,
            surface,
            postToHost(msg) {
                const reply = data => ui.receiveHostMessage({ source: 'TavernKitchen', ...data });
                if (msg.type === 'WORLD_FIELD_SOURCE') {
                    reply({ type:'WORLD_FIELD_SOURCE_RESULT', payload:{ ...msg, floor:3, name:'阿棠', text:'守卫阿棠接过县衙钥匙，答应明早交还。' } });
                } else if (msg.type === 'WORLD_EVOLUTION_REQUEST') {
                    reply({ type: 'WORLD_EVOLUTION_STATE', settings: globalThis.evolution || { enabled: true, subscribed: false, sceneryEvolution: false, encounterFrequency: 'occasional' } });
                } else if (msg.type === 'WORLD_EVOLUTION_CHANGE') {
                    globalThis.evolution = { enabled: true, subscribed: false, sceneryEvolution: false, encounterFrequency: 'occasional', ...globalThis.evolution, [msg.key]: msg.value };
                    reply({ type: 'WORLD_EVOLUTION_STATE', settings: globalThis.evolution });
                } else if (msg.type === 'FRAME_READY') {
                    globalThis.frameReady = true;
                    reply({ type: 'LOAD_PANEL_CONFIG', config: {} });
                    reply({ type: 'KITCHEN_MEMORY_VIEW', view: 'memory' });
                } else if (msg.type === 'KITCHEN_CARD_INFO') {
                    reply({ type: 'KITCHEN_CARD_INFO_RESULT', counts: { rounds: 7, people: 2, notes: 1 } });
                } else if (msg.type === 'KITCHEN_CARD_IMPORT') {
                    globalThis.importedCard = JSON.parse(msg.text); reply({ type:'KITCHEN_CARD_RESULT', success:true, message:'后厨卡已导入' });
                } else if (msg.type === 'KITCHEN_CARD_EXPORT') {
                    globalThis.exportedCard = true; reply({ type: 'KITCHEN_CARD_RESULT', success: true, message: '后厨卡已导出' });
                } else if (msg.type === 'SAVE_PANEL_CONFIG') {
                    globalThis.savedPrompt = msg.promptChange;
                    reply({ type: 'PANEL_CONFIG_SAVE_RESULT', requestId: msg.requestId, success: true });
                }
            },
        });
        globalThis.storyUi = ui;
    });
    const surface = page.locator('#host');
    await page.waitForFunction(() => globalThis.frameReady === true);
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await surface.locator('.archive #btn-generate').count(), 1);
    assert.equal(await surface.locator('#summary-options, #summary-controls, #tab-summary-prompts, #tab-prompts, #summary-style, #prompt-round, #prompt-stage, #prompt-chapter, #tab-agent, [data-settings-group="prompts"], [data-setting-section="prompts"]').count(), 0);
    assert.ok(await surface.locator('.archive').evaluate(el => !el.inert && el.checkVisibility()));
    assert.ok(await surface.locator('#settings-modal').isHidden());
    const view = name => page.evaluate(view => globalThis.storyUi.receiveHostMessage({ source:'TavernKitchen', type:'KITCHEN_MEMORY_VIEW', view }), name);
    await view('data');
    await surface.locator('#data-overview').waitFor();
    await surface.locator('#kitchen-card-counts').filter({ hasText: '7 轮总结' }).waitFor();
    assert.ok(await surface.locator('.archive').isHidden());
    assert.ok(await surface.locator('#settings-modal').isHidden());
    assert.equal(await surface.locator('#legacy-data-tools, #tab-transfer, #tab-cache, #tab-clear, #tab-backups, #workspace-clear, #workspace-rollback').count(), 0);
    await surface.getByRole('button', { name: '导出后厨卡', exact: true }).click();
    await page.waitForFunction(() => globalThis.exportedCard === true);
    await surface.locator('#kitchen-card-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({type:'TavernKitchenCard',version:1,data:{}}))});
    await surface.locator('#confirm-ok').click();
    await page.waitForFunction(() => globalThis.importedCard?.type === 'TavernKitchenCard');
    await surface.locator('#kitchen-card-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await surface.locator('#kitchen-card-status').filter({hasText:'不支持的后厨卡格式'}).waitFor();
    for (const width of [319,1280]) {
        await page.setViewportSize({width,height:780});
        const full = await surface.locator('#data-page').evaluate(el => ({height:el.getBoundingClientRect().height,total:globalThis.innerHeight,overflow:globalThis.getComputedStyle(el).overflowY,width:el.clientWidth,scrollWidth:el.scrollWidth}));
        assert.ok(Math.abs(full.height/full.total - 1) < .02);
        assert.equal(full.overflow,'auto');
        assert.ok(full.scrollWidth <= full.width);
        assert.equal(await surface.locator('#data-page [data-setting-section], #data-page [data-kitchen-controls], #data-page [data-settings-group]').count(),0);
        assert.equal(await surface.locator('#data-controls').evaluate(el => globalThis.getComputedStyle(el).overflowY),'visible');
    }
    await view('recall');
    await surface.locator('#recall-page').waitFor({ state: 'visible' });
    await surface.locator('#recall-empty').filter({ hasText: '暂无本聊天每轮召回记录' }).waitFor();
    await page.evaluate(() => globalThis.storyUi.receiveHostMessage({
        source: 'TavernKitchen', type: 'RECALL_HISTORY',
        entries: [{ id: 'r1', chatId: 'default', targetFloor: 4, type: 'normal', status: 'success', mode: 'vector', queryPreview: '旧港潮汐与灯塔密函', focusCharacters: ['林默', '灯塔'], candidateCount: 6, includedCount: 1, trimmedCount: 1, diagnosticsText: 'recall ok line 1', chunks: [
            { floor: 1, speaker: '林默', score: 0.91, included: true, text: '潮水退去后，灯塔铁门露出铜锁。' },
            { floor: 0, speaker: '港口守卫', score: 0.42, included: false, filterReason: 'budget', text: '雾气弥漫在码头的木桩间。' },
        ] }],
    }));
    await surface.locator('#recall-detail').waitFor({ state: 'visible' });
    assert.match(await surface.locator('#recall-detail').innerText(), /旧港潮汐与灯塔密函/);
    assert.match(await surface.locator('#recall-detail').innerText(), /灯塔铁门露出铜锁/);
    await surface.locator('#recall-diagnostics-wrap > summary').click();
    assert.match(await surface.locator('#recall-diagnostics-log').innerText(), /recall ok line 1/);
    assert.equal(await surface.locator('#proofreading-page').count(), 0);
    await view('settings-memory');
    await surface.locator('#settings-modal.active').waitFor();
    assert.ok(await surface.locator('#settings-retention-section').isVisible());
    assert.equal(await surface.locator('#proofreading-settings-host, #proofreading-interval').count(), 0);
    assert.ok(await surface.locator('#settings-recall-section').isVisible());
    assert.equal(await surface.locator('#trigger-interval, #trigger-role, #use-vector-boundary, #filter-rules-content, #tab-summary, #tab-agent').count(), 0);
    await surface.locator('#settings-save').click();
    await surface.locator('#settings-modal.active').waitFor();
    await view('memory');
    await surface.locator('.archive').waitFor({ state: 'visible' });
    await view('people');
    await surface.locator('#archive-people').waitFor();
    assert.equal(await surface.locator('#archive-person-select').count(), 0);
    assert.equal(await surface.getByText('选择一段对话后查看人物档案。', { exact: true }).count(), 1);
    assert.equal(await surface.locator('#profile-content').innerText(), '');
    await page.evaluate(() => globalThis.storyUi.receiveHostMessage({
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
    }));
    for (const width of [319, 1280]) {
        await page.setViewportSize({ width, height: 780 });
        await view('people');
        await surface.locator('#archive-people').waitFor();
        assert.ok(await surface.locator('.archive-hero').isHidden());
        assert.equal(await surface.locator('.archive-search, #keywords-cloud, .archive-keywords').count(), 0);
        assert.equal(await surface.locator('.archive-graph, #archive-profile-open, #rel-fs-modal').count(), 0);
        assert.ok(await surface.locator('#archive-person-name').isHidden());
        assert.equal(await surface.locator('#archive-roster button').count(), 2);
        assert.equal(await surface.locator('.archive-aliases, #aliases-list, #alias-add').count(), 0);
        await surface.locator('#archive-roster').getByRole('button', { name: /林舟/ }).click();
        assert.match(await surface.locator('#profile-content').innerText(), /共同守护银钥匙的伙伴/);
        assert.match(await surface.locator('#profile-content').innerText(), /别名：银鸦、阿舟/);
        assert.match(await surface.locator('#profile-content').innerText(), /称号：渡鸦使者/);
        // Clicking a relationship target link jumps directly to that person's profile (C2)
        await surface.locator('#profile-content [data-jump-person="沈青"]').click();
        assert.equal(await surface.locator('#archive-person-name').innerText(), '沈青');
        assert.match(await surface.locator('#profile-content').innerText(), /共同守护银钥匙的伙伴/);
        assert.ok(await surface.locator('#archive-profile').isVisible());
        await surface.locator('#archive-people-back').click();
        // Roster search filters visible people cleanly (C1)
        await surface.locator('#archive-people-search').fill('渡鸦');
        assert.equal(await surface.locator('#archive-roster button').count(), 1);
        assert.match(await surface.locator('#archive-roster').innerText(), /林舟/);
        await surface.locator('#archive-people-search').fill('');
        assert.equal(await surface.locator('#archive-roster button').count(), 2);
        await view('memory');
        await surface.locator('#archive-story').waitFor();
        assert.ok(await surface.locator('.archive-hero').isVisible());
        assert.equal(await surface.locator('.archive-search').count(), 0);
    }
    await view('people');
    const deliver = payload => page.evaluate(payload => globalThis.storyUi.receiveHostMessage({
        source:'TavernKitchen',type:'SUMMARY_FULL_DATA',payload
    }),payload);
    const state = {chatId:'people-ui-fixture',branchId:'主线',characters:{main:[],relationships:[]},storyRecords:[],rounds:[],facts:[],characterAliases:[],entities:[]};
    await deliver(state);
    await surface.getByText('这段对话尚无人物记录。').waitFor();
    const guard = {kind:'person',id:'tang-west',name:'阿棠',fields:{身份:{nature:'established_fact',value:'西门守卫'}}};
    const key = {kind:'item',id:'key',name:'县衙钥匙',fields:{保管人:{nature:'established_fact',value:{entityId:guard.id},source:{module:'world_update',key:'fixture/0'}}}};
    state.entities = [guard,key];
    await deliver(state);
    await surface.locator('#archive-person-name').filter({hasText:'阿棠'}).waitFor();
    assert.ok(await surface.locator('#archive-roster').isHidden());
    assert.match(await surface.locator('#profile-content').innerText(),/所有人：未知，保管人：阿棠/);
    await surface.getByRole('button',{name:'查看交接原楼'}).click();
    await surface.locator('#archive-detail-body').filter({hasText:'第 4 楼'}).waitFor();
    await surface.getByRole('button',{name:'返回档案'}).click();
    const twin = {kind:'person',id:'tang-east',name:'阿棠',fields:{身份:{nature:'established_fact',value:'东门传令官'}}};
    state.entities.push(twin);
    await deliver(state);
    await surface.getByRole('button',{name:/东门传令官/}).click();
    assert.equal(await surface.locator('#world-people-editor, button:has-text("编辑人物"), button:has-text("编辑名称")').count(), 0);
    await page.setViewportSize({width:600,height:780});
    assert.equal(await surface.locator('#archive-person-name').innerText(),'阿棠');
    await surface.locator('#archive-people-back').click();
    assert.ok(await surface.getByRole('button',{name:/东门传令官/}).evaluate(el => el.getRootNode().activeElement === el));
    await surface.getByRole('button',{name:/西门守卫/}).click();
    await deliver({...state,branchId:'支线'});
    await surface.getByRole('button',{name:/东门传令官/}).waitFor();
    const longName = '城北抄录官' + 'Ashford'.repeat(12);
    const roster = Array.from({length:36}, (_, i) => ({kind:'person', id:'scribe-' + i, name:'书吏' + i, fields:{}}));
    roster.push({kind:'person',id:'guest',name:longName,fields:{}});
    const ending = '守卫将封好的名册交到城门。';
    const round = {_addedAt:3, _sourceStart:2, title:'西门换班', summary:'守卫沿城墙清点灯火。'.repeat(480) + ending, participants:[]};
    await deliver({...state, entities:roster, rounds:[round]});
    const reading = surface.locator('.archive');
    const guest = surface.getByRole('button',{name:new RegExp('城北抄录官')});
    for (const width of [319,600]) {
        await page.setViewportSize({width,height:780});
        await guest.scrollIntoViewIfNeeded();
        const previous = await reading.evaluate(el => el.scrollTop);
        assert.ok(previous > 0);
        assert.ok(await reading.evaluate(el => el.scrollWidth <= el.clientWidth));
        await guest.click();
        assert.equal(await surface.locator('#archive-person-name').innerText(),longName);
        await surface.locator('#archive-people-back').click();
        assert.equal(await reading.evaluate(el => el.scrollTop),previous);
        assert.ok(await guest.evaluate(el => el === el.getRootNode().activeElement));
        await view('memory');
        await surface.locator('#timeline-list').getByText(round.summary,{exact:true}).waitFor();
        await surface.locator('#archive-story-search').fill('不存在的关键词XYZ');
        assert.match(await surface.locator('#timeline-list').innerText(), /没有找到匹配的内容/);
        await surface.locator('#archive-story-search').fill('西门换班');
        assert.match(await surface.locator('#timeline-list').innerText(), /西门换班/);
        await surface.locator('#archive-story-search').fill('');
        const accessibleEnd = await reading.evaluate(el => {
            el.scrollTop = el.scrollHeight;
            const text = el.querySelector('.archive-event-main p');
            return !!text && text.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1 && el.scrollTop > 0 && el.scrollWidth <= el.clientWidth;
        });
        assert.ok(accessibleEnd);
        await view('people');
    }
    await page.evaluate(() => globalThis.storyUi.receiveHostMessage({source:'TavernKitchen',type:'SUMMARY_FULL_DATA',payload:globalThis.originalScene}));
    await view('world');
    const affairs = surface.locator('[data-situation-group="affairs"]');
    const scenery = surface.locator('[data-situation-group="scenery"]');
    await affairs.waitFor();
    assert.match(await affairs.innerText(), /港口封锁/);
    assert.match(await scenery.innerText(), /雨季将至/);
    assert.equal(await surface.locator('.tk-story-situations article').count(), 2);
    assert.doesNotMatch(await surface.locator('.tk-story-situations').innerText(), /类型：事态|类型：风物/);
    assert.equal(await surface.locator('.tk-story-situations h5').filter({hasText:'局势历史'}).count(),1);
    assert.match(await surface.locator('[data-record-id=port]').innerText(),/守卫开始加强检查/);
    assert.match(await surface.locator('[data-record-id=port]').innerText(),/来源：第 2 楼/);
    assert.equal(await surface.locator('.tk-story-situations details').count(), 0);
    assert.equal(await surface.locator('.tk-story-situations > button, .sec-btn').count(), 0);
    assert.equal(await surface.locator('.tk-story-situations input, .tk-story-situations select, #situation-controls').count(), 0);
    // World situation search filters visible articles without living inside .tk-story-situations (C1)
    await surface.locator('#archive-world-search').fill('雨季');
    assert.equal(await surface.locator('.tk-story-situations article').count(), 1);
    assert.match(await surface.locator('.tk-story-situations').innerText(), /雨季将至/);
    await surface.locator('#archive-world-search').fill('');
    assert.equal(await surface.locator('.tk-story-situations article').count(), 2);
    await fs.mkdir(path.resolve('output'), { recursive: true });
    for (const width of [319, 1280]) {
        await page.setViewportSize({ width, height: 780 });
        assert.ok(await affairs.isVisible());
        assert.ok(await scenery.isVisible());
        assert.ok(await surface.locator('.tk-surface-body').evaluate(body => body.scrollWidth <= body.clientWidth));
        await page.screenshot({ path: path.resolve('output', 'situations-' + width + '.png') });
    }
    await view('memory');
    await surface.locator('#archive-story').waitFor();
    assert.deepEqual(errors, []);
    console.log('Verified summary settings, read-only character profiles with relationship entries and dual-axis views.');
} finally { await browser.close(); }
