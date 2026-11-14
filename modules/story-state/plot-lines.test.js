import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { collectPlotLines, plotLinePrompt, summarizePlotLines } from './plot-lines.js';
import { createSuspenseBook } from './view.js';
import { plannerSnapshot, writerInput, publishNotes, reviewReason } from '../story-planner/notes.js';
import { extractGeneratedFloorPayload } from '../story-summary/inline/protocol.js';
import { usePanelSettings } from '../../core/panel-policy.js';

test('the clue board and writer use the same sourced thread across confirmation, closure, correction and rollback', t => {
    const { document } = parseHTML('<html><body></body></html>');
    globalThis.document = document;
    t.after(() => { delete globalThis.document; });
    const title = '两把银钥匙';
    const history = [];
    const store = { summaryHistory:history, json:{storyRecords:[]}, lastSummarizedMesId:3 };
    const world = { worldId:'world', branchId:'main', version:1, entities:[] };
    const memory = { enabled:true,store };
    const snap = () => plannerSnapshot(world,memory,[],'chat');
    const view = createSuspenseBook({getSnapshot:() => memory,clues:true});
    view.mount(document.body);
    function round(status,quote,reading) {
        const end = history.length;
        const parsed = extractGeneratedFloorPayload(JSON.stringify({summary:quote,plotLines:[{title,status,quote,reading}]}));
        assert.equal(parsed.status,'ready');
        history.push({kind:'batch',endMesId:end,roundSource:{start:end,end,digest:'source'+end},...parsed.payload});
        view.show(world);
        const input = JSON.parse(writerInput(snap(),null,'opening','')[1].content);
        assert.deepEqual(input.plotLines,collectPlotLines(history));
        assert.equal(input.plotLines.length,1);
        assert.equal(input.plotLines[0].status,status);
        assert.match(document.body.textContent,new RegExp(reading));
    }
    round('potential','两人各持一把银钥匙。','两把钥匙可能有关。');
    assert.ok(plotLinePrompt(history).includes(title));
    const previous = publishNotes(JSON.stringify({global:{text:'保持开放',dependencies:[]},
        chapter:{text:'两把钥匙已经出现',dependencies:[{lineTitle:title}]}}),null,snap(),'opening');
    round('active','二人结伴追查钥匙来历。','两人开始调查。');
    assert.equal(reviewReason(previous,snap()),'chapter-change');
    round('closed','两人查明钥匙来自同一把旧锁。','钥匙来历已经查明。');
    history.pop();
    history[1].roundRevisions=[{sourceId:'round:source1',end:1,baseVersion:0,previous:history[1].summary,text:'两人各自离开。'}];
    view.show(world);
    assert.equal(snap().plotLines[0].status,'potential');
    assert.doesNotMatch(document.body.textContent,/开始调查|已经查明/);
});

test('plot-line summarization aggregates beats, characters, focus, and triggers planner updates on active progression', t => {
    const { document } = parseHTML('<html><body></body></html>');
    globalThis.document = document;
    t.after(() => { delete globalThis.document; });
    const history = [
        {
            kind: 'batch',
            endMesId: 1,
            timeEnd: '雨夜',
            summary: '林疏在渡口发现被撕毁的账簿。',
            plotLines: [{
                title: '渡口私盐账簿',
                status: 'active',
                quote: '林疏在渡口发现被撕毁的账簿。',
                reading: '林疏拿到残页并怀疑码头账房涉案。',
                characters: ['林疏'],
                nextFocus: '核对残页印鉴',
            }],
        },
        {
            kind: 'batch',
            endMesId: 3,
            timeEnd: '次晨',
            summary: '林疏与沈砚对质，账房连夜烧毁剩余凭据。',
            plotLines: [{
                title: '渡口私盐账簿',
                status: 'active',
                quote: '账房连夜烧毁剩余凭据。',
                reading: '账房毁证自保，线索转向码头东仓。',
                summary: '林疏在渡口追查私盐残页后与沈砚对质，账房烧毁余册令焦点转向东仓。',
                characters: ['林疏', '沈砚'],
                nextFocus: '追查东仓货单',
            }],
        },
    ];
    const records = [{ id: 'sit-1', kind: 'situation', title: '渡口封锁', status: 'open', description: '渡口盘查加强', parties: ['林疏'] }];
    const lines = summarizePlotLines(history, records);
    const line = lines.find(item => item.title === '渡口私盐账簿');
    assert.equal(line.roundCount, 2);
    assert.equal(line.firstFloor, 1);
    assert.equal(line.floor, 3);
    assert.match(line.summary, /沈砚对质/);
    assert.deepEqual(line.characters, ['林疏', '沈砚']);
    assert.equal(line.nextFocus, '追查东仓货单');

    const store = { summaryHistory: history.slice(0, 1), json: { storyRecords: records } };
    const world = { worldId: 'w', branchId: 'main', version: 1, entities: [] };
    const snap1 = plannerSnapshot(world, { enabled: true, store }, [], 'chat');
    const saved = publishNotes(JSON.stringify({
        global: { text: '长线追踪', dependencies: [] },
        chapter: { text: '先盯住渡口', dependencies: [{ lineTitle: '渡口私盐账簿' }] },
    }), null, snap1, 'opening');
    store.summaryHistory = history;
    const snap2 = plannerSnapshot(world, { enabled: true, store }, [], 'chat');
    assert.equal(reviewReason(saved, snap2), 'chapter-change');
    const plannerPayload = JSON.parse(writerInput(snap2, saved, 'chapter-change')[1].content);
    assert.equal(plannerPayload.planningTargets.plotLines[0].summary, line.summary);
    assert.ok(plotLinePrompt(history, records).includes('焦') === false || plotLinePrompt(history, records).includes('渡口私盐账簿'));

    const view = createSuspenseBook({ getSnapshot: () => ({ enabled: true, store }), clues: true });
    view.mount(document.body);
    view.show(world);
    assert.match(document.body.textContent, /共 2 条剧情线/);
    assert.match(document.body.textContent, /推进轨迹（2 轮）/);
    assert.match(document.body.textContent, /追查东仓货单/);
});

test('old structured records seed the board; disabled clues supply no new extraction or writer material', () => {
    const record = {id:'r',kind:'plan',title:'送信',description:'明晨送信。',status:'open'};
    assert.equal(collectPlotLines([], [record])[0].recordId,'r');
    usePanelSettings({panels:{clues:false}});
    try {
        assert.equal(plotLinePrompt([]),'');
        const snap=plannerSnapshot({worldId:'w',branchId:'b',entities:[]},{enabled:true,store:{json:{storyRecords:[record]}}},[],'c');
        assert.deepEqual(snap.plotLines,[]);
    } finally { usePanelSettings({}); }
});
