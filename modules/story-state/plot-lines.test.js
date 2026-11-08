import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { collectPlotLines, plotLinePrompt } from './plot-lines.js';
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
