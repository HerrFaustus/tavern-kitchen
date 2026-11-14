import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';

// Run the same settings renderer against the host CSS in three isolated viewports.
const root = path.resolve(import.meta.dirname, '..');
const host = process.env.SILLYTAVERN_PUBLIC || path.resolve(root, '../references/sources/SillyTavern__SillyTavern/public');
const browser = process.env.CHROMIUM_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const css = [path.join(host, 'style.css'), path.join(host, 'css/mobile-styles.css'), path.join(root, 'style.css')]
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');
const widths = [1440, 820, 390];

async function inspect(doc, width, createPlannerSettings) {
    const reference = doc.querySelector('#right-nav-panel');
    const panel = doc.querySelector('#tk-workspace');
    const controls = doc.createElement('div');
    panel.append(controls);
    let retries = 0;
    const view = createPlannerSettings(controls, {
        retry: () => { retries++; },
    });
    const retry = controls.querySelector('button');
    view.status('等待正文生成', false);
    const initiallyHidden = retry.hidden;
    view.note({state:'empty'});
    const empty = controls.querySelector('.tk-planner-note-status').textContent;
    const chapterText = '药车停在桥头。\n' + '雨水顺着斗篷流下。'.repeat(40) + 'X'.repeat(160);
    const globalText = '后台仍未揭晓的线索。';
    view.note({state:'ready',note:{id:'fiction',revision:2,chapter:{text:chapterText},global:{text:globalText}}});
    const chapter = controls.querySelector('.tk-planner-chapter');
    const global = controls.querySelector('.tk-planner-global');
    const globalClosed = !global.open && !global.querySelector('.tk-planner-note-text').checkVisibility();
    global.querySelector('summary').click();
    const globalOpened = global.open && global.querySelector('.tk-planner-note-text').checkVisibility();
    const chapterMatches = chapter.textContent === chapterText;
    const fitsPlain = controls.scrollWidth <= controls.clientWidth;
    view.note({
        state: 'ready',
        note: {
            id: 'fiction-entities',
            revision: 3,
            chapter: {
                text: '实体模式正文',
                entities: {
                    characters: [{ target: '林默', commentary: '握紧账本', prediction: '今晚会去码头核对船单', suggestion: '保持克制观察' }],
                    plotLines: [{ target: '药车失踪案', commentary: '线索指向旧桥', prediction: '车夫可能已越过关卡', suggestion: '埋下雨水脚印伏笔' }],
                    situations: [],
                },
            },
            global: {
                text: globalText,
                entities: {
                    characters: [],
                    plotLines: [{ target: '走私暗线', commentary: '后台真凶未露面', prediction: '三日后收网', suggestion: '暂不揭示账房身份' }],
                    situations: [],
                },
            },
        },
    });
    const statCount = controls.querySelectorAll('.tk-planner-stat').length;
    const entityCardCount = controls.querySelectorAll('.tk-planner-chapter .tk-planner-entity').length;
    const globalResetClosed = !global.open;
    view.status('札记未能发布', true);
    retry.click();
    const box = element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return [x, y, width, height].map(Math.round);
    };
    return { width, native: box(reference), kitchen: box(panel), fields: controls.querySelectorAll('textarea, select').length, retries,
        empty, chapterMatches, globalClosed, globalOpened, globalResetClosed, statCount, entityCardCount,
        retryVisible: initiallyHidden && !retry.hidden, fits: fitsPlain && controls.scrollWidth <= controls.clientWidth };
}

const bundle = await build({
    absWorkingDir: root,
    entryPoints: ['modules/story-planner/settings-view.js'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__plannerSettingsView',
    platform: 'browser',
});
const output = path.join(root, 'output');
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(output, 'planner-ui-'));
const frame = '<!doctype html><meta charset="utf-8"><style>' + css +
    '</style><style>:root{--sheldWidth:800px;--topBarBlockSize:40px;--animation-duration-2x:0s}</style>' +
    '<nav class="drawer-content fillRight openDrawer" id="right-nav-panel"></nav><section class="drawer-content fillRight openDrawer" id="tk-workspace"></section>';
const html = '<!doctype html><meta charset="utf-8">' +
    widths.map(width => '<iframe src="/frame" width="'+width+'" height="720"></iframe>').join('') +
    '<script>' + bundle.outputFiles[0].text + '\nconst { createPlannerSettings } = __plannerSettingsView;\n' + inspect.toString() +
    '\nwindow.onload=async()=>{try{const rows=await Promise.all(Array.from(document.querySelectorAll("iframe"),f=>inspect(f.contentDocument,+f.width,createPlannerSettings)));await fetch("/result",{method:"POST",body:JSON.stringify(rows)})}catch(e){await fetch("/result",{method:"POST",body:JSON.stringify(String(e))})}}</script>';
const { promise, resolve, reject } = Promise.withResolvers();
const server = http.createServer((req, res) => {
    if (req.url === '/result' && req.method === 'POST') {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', part => { body += part; });
        req.on('error', reject);
        req.on('end', () => {
            res.end();
            try { resolve(JSON.parse(body)); }
            catch (error) { reject(error); }
        });
        return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src 'none'");
    res.end(req.url === '/frame' ? frame : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const edge = spawn(browser, ['--headless', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--user-data-dir=' + path.join(temp, 'profile'), 'http://127.0.0.1:' + server.address().port],
    { stdio: 'ignore', windowsHide: true });
edge.on('error', reject);
const timeout = setTimeout(() => reject(new Error('Timed out waiting for headless browser')), 30000);
try {
    const results = await promise;
    assert.equal(results.length, widths.length, JSON.stringify(results));
    for (const row of results) {
        console.log(row);
        assert.equal(row.kitchen[0] + row.kitchen[2], row.width);
        assert.equal(row.kitchen[2], row.native[2]);
        if (row.width > 1000) assert.ok(row.kitchen[0] >= (row.width + 800) / 2);
        assert.equal(row.fields, 0);
        assert.match(row.empty,/暂无札记/);
        assert.ok(row.chapterMatches && row.globalClosed && row.globalOpened && row.globalResetClosed);
        assert.equal(row.statCount, 2);
        assert.equal(row.entityCardCount, 2);
        assert.ok(row.retryVisible && row.retries === 1 && row.fits);
    }
} finally {
    clearTimeout(timeout);
    edge.kill();
    server.closeAllConnections();
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
}
