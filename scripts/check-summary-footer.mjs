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
            if (event.data.type === 'WORLD_EVOLUTION_REQUEST') {
                reply({ type: 'WORLD_EVOLUTION_STATE', settings: globalThis.evolution || { enabled: true, subscribed: false, sceneryEvolution: false, encounterFrequency: 'occasional' } });
            } else if (event.data.type === 'WORLD_EVOLUTION_CHANGE') {
                globalThis.evolution = { enabled: true, subscribed: false, sceneryEvolution: false, encounterFrequency: 'occasional', ...globalThis.evolution, [event.data.key]: event.data.value };
                reply({ type: 'WORLD_EVOLUTION_STATE', settings: globalThis.evolution });
            } else if (event.data.type === 'FRAME_READY') {
                reply({ type: 'LOAD_PANEL_CONFIG', config: {} });
                reply({ type: 'KITCHEN_MEMORY_VIEW', view: 'memory' });
            } else if (event.data.type === 'SAVE_PANEL_CONFIG') {
                globalThis.savedPrompt = event.data.promptChange;
                reply({ type: 'PANEL_CONFIG_SAVE_RESULT', requestId: event.data.requestId, success: true });
            }
        };
        frame.src = '/scripts/extensions/third-party/tavern-kitchen/modules/story-summary/story-summary.html';
    });
    const frame = page.frameLocator('iframe'), options = frame.locator('#summary-options');
    assert.ok(await frame.locator('#btn-generate').evaluate(el => !!el.closest('#summary-controls')));
    assert.equal(await frame.locator('.archive #btn-generate').count(), 0);
    assert.ok(await options.evaluate(el => el.open));
    await frame.locator('#tab-summary-prompts > summary').click();
    await frame.locator('#tab-summary-prompts details > summary').first().click();
    await frame.locator('#prompt-round').fill('只提交本轮测试');
    await frame.locator('[data-save-layer="round"]').click();
    await page.waitForFunction(() => globalThis.savedPrompt?.value === '只提交本轮测试');
    assert.ok(await frame.locator('.archive').evaluate(el => !el.inert && el.checkVisibility()));
    assert.ok(await frame.locator('#settings-modal').evaluate(el => el.closest('#summary-options') && globalThis.getComputedStyle(el).position === 'static'));
    await frame.locator('#tab-transfer > summary').click();
    assert.ok(await frame.locator('#btn-copy-summary').isVisible());
    const view = name => page.evaluate(view => globalThis.document.querySelector('iframe').contentWindow.postMessage({ source:'TavernKitchen', type:'KITCHEN_MEMORY_VIEW', view },globalThis.location.origin), name);
    await view('proofreading');
    await frame.locator('#memory-maintenance-enabled').waitFor({state:'attached'});
    await frame.locator('#tab-agent.active').waitFor();
    const proofRatio = await frame.locator('.memory-controls').evaluate(el => el.getBoundingClientRect().height / globalThis.innerHeight);
    const proofSizes = await frame.locator('.memory-controls').evaluate(el => {
        const rows = [];
        for (let node = el; node; node = node.parentElement) {
            const style = globalThis.getComputedStyle(node);
            rows.push([node.id || node.className || node.tagName, node.getBoundingClientRect().height, style.height, style.minHeight, style.display]);
        }
        return rows;
    });
    assert.ok(Math.abs(proofRatio - 1 / 3) < .02, JSON.stringify(proofSizes));
    assert.ok(await frame.locator('.memory-settings').evaluate(el => el.open));
    assert.ok(await options.isHidden());
    assert.equal(await frame.locator('#settings-close, .memory-api, [data-workspace-page], #summary-text-api').count(), 0);
    await frame.locator('#settings-save').click();
    await frame.locator('#tab-agent.active').waitFor();
    assert.ok(await options.isHidden());
    await view('memory');
    await options.waitFor();
    assert.ok(await frame.locator('#tab-summary > summary').isVisible());
    await view('people');
    await frame.locator('#archive-people').waitFor();
    assert.equal(await frame.locator('#archive-person-select').count(), 0);
    assert.equal(await frame.getByText('暂无人物记录', { exact: true }).count(), 1);
    assert.equal(await frame.locator('#profile-content').innerText(), '');
    await page.evaluate(() => globalThis.document.querySelector('iframe').contentWindow.postMessage({
        source: 'TavernKitchen', type: 'SUMMARY_FULL_DATA',
        payload: {
            chatId: 'people-ui-fixture', rounds: [], facts: [],
            storyRecords: [
                { id: 'port', kind: 'situation', title: '港口封锁', description: '守卫检查出港船只。', status: 'open' },
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
        assert.equal(await frame.locator('#archive-people h2').count(), 0);
        assert.equal(await frame.locator('#archive-roster button').count(), 2);
        assert.equal(await frame.locator('.archive-aliases, #aliases-list, #alias-add').count(), 0);
        await frame.locator('#archive-roster').getByRole('button', { name: '林舟', exact: true }).click();
        assert.match(await frame.locator('#profile-content').innerText(), /共同守护银钥匙的伙伴/);
        assert.match(await frame.locator('#profile-content').innerText(), /别名：银鸦、阿舟/);
        assert.match(await frame.locator('#profile-content').innerText(), /称号：渡鸦使者/);
        await frame.locator('#archive-roster').getByRole('button', { name: '沈青', exact: true }).click();
        assert.equal(await frame.locator('.prof-name').innerText(), '沈青');
        assert.match(await frame.locator('#profile-content').innerText(), /共同守护银钥匙的伙伴/);
        assert.ok(await frame.locator('#archive-profile').isVisible());
        await view('memory');
        await frame.locator('#archive-story').waitFor();
        assert.ok(await frame.locator('.archive-hero').isVisible());
        assert.equal(await frame.locator('.archive-search').count(), 0);
    }
    await view('world');
    const affairs = frame.locator('[data-situation-group="affairs"]');
    const scenery = frame.locator('[data-situation-group="scenery"]');
    await affairs.waitFor();
    assert.match(await affairs.innerText(), /港口封锁/);
    assert.match(await scenery.innerText(), /雨季将至/);
    assert.equal(await frame.locator('.tk-story-situations article').count(), 2);
    assert.equal(await frame.locator('.tk-story-situations details').count(), 0);
    assert.equal(await frame.locator('.tk-story-situations > button, .sec-btn').count(), 0);
    assert.equal(await frame.locator('.tk-story-situations input, .tk-story-situations select').count(), 0);
    assert.ok(await frame.locator('#situation-controls > [data-setting-section="function"]').isVisible());
    const affairToggle = frame.getByRole('checkbox', { name: '事态随剧情演化' });
    const sceneryToggle = frame.getByRole('checkbox', { name: '风物随剧情演化' });
    await affairToggle.check();
    await page.waitForFunction(() => globalThis.evolution?.subscribed === true);
    await sceneryToggle.check();
    await page.waitForFunction(() => globalThis.evolution?.sceneryEvolution === true);
    assert.ok(await affairToggle.isChecked());
    await frame.getByLabel('街头偶遇频率').selectOption('lively');
    await page.waitForFunction(() => globalThis.evolution?.encounterFrequency === 'lively');
    await fs.mkdir(path.resolve('output'), { recursive: true });
    for (const width of [319, 1280]) {
        await page.setViewportSize({ width, height: 780 });
        assert.ok(await affairs.isVisible());
        const split = await frame.locator('#situation-controls').evaluate(el => ({ controls: el.getBoundingClientRect().height, total: globalThis.innerHeight }));
        assert.ok(Math.abs(split.controls / split.total - 1 / 3) < .015);
        assert.ok(await scenery.isVisible());
        assert.ok(await frame.locator('body').evaluate(body => body.scrollWidth <= body.clientWidth));
        await page.screenshot({ path: path.resolve('output', 'situations-' + width + '.png') });
    }
    await view('memory');
    await frame.locator('#archive-story').waitFor();
    assert.deepEqual(errors, []);
    console.log('Verified summary settings, proofreading navigation and direct character profiles with relationship entries.');
} finally { await browser.close(); }

