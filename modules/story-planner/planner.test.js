import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { createNoteStore } from './storage.js';
import { createPlanner } from './runtime.js';
import { plannerSnapshot, publishNotes, staleTargetsForNote, writerInput } from './notes.js';
import { createPlannerSettings } from './settings-view.js';

test('one writer publishes once, full chapter only; change, rollback and chat isolation', async () => {
    globalThis.indexedDB = new IDBFactory();
    const store = createNoteStore();
    const world = {worldId:'w',branchId:'b',version:1, entities:[{id:'bridge',fields:{status:{value:'封闭'}}}]};
    const chat = [{mes:'进镇',is_user:true}];
    let scope = 'chat', boundary = 'opening', calls = 0;
    const snapshot = () => ({ ...plannerSnapshot(world,{enabled:true},chat,scope), boundary });
    const runtime = createPlanner({snapshot,store, preference:()=>'日常',status:()=>{},write:async messages=>{
        calls++;
        const {reason} = JSON.parse(messages[1].content);
        return JSON.stringify({global:{text:'后台方向',dependencies:[]},
            chapter:{text:'完整章节稿'+calls,dependencies:[{entityId:'bridge',field:'status'}]},reason});
    }});
    const run = () => runtime.prepare();
    assert.equal((await runtime.inspect()).state,'empty');
    assert.equal(await run(),'完整章节稿1');
    let shown = await runtime.inspect();
    assert.equal(shown.state,'ready');
    assert.equal(shown.note.chapter.text,'完整章节稿1');
    assert.equal(shown.note.global.text,'后台方向');
    assert.equal(calls,1,'reading the panel must not call the writer');
    chat[0].mes = '原文已改写';
    assert.equal((await runtime.inspect()).state,'empty','a note from a different source must not be shown');
    chat[0].mes = '进镇';
    assert.equal((await runtime.inspect()).state,'ready');
    chat.push({mes:'去河边'});
    assert.equal(await run(),'完整章节稿1');
    world.entities[0].fields.status.value='通行'; world.version++;
    assert.equal((await runtime.inspect()).state,'stale');
    assert.equal(await run(),'完整章节稿2');
    boundary='closed-1';
    assert.equal((await runtime.inspect()).state,'stale');
    assert.equal(await run(),'完整章节稿3');
    const rows = await store.list(snapshot().owner);
    assert.equal(rows.length,3);
    assert.equal(rows[2].global.text,'后台方向');
    chat.pop(); boundary='opening'; world.entities[0].fields.status.value='封闭';
    assert.equal(await run(),'完整章节稿1');
    scope='other';
    assert.equal((await runtime.inspect()).state,'empty');
    assert.equal(await run(),'完整章节稿4');
    assert.deepEqual(chat,[{mes:'进镇',is_user:true}]);
});

test('a note read finishing after the world changes cannot display the earlier snapshot', async () => {
    const world = {worldId:'w',branchId:'b',version:1,entities:[]};
    const chat = [{mes:'原文',is_user:true}];
    const snap = () => plannerSnapshot(world,{enabled:true,store:{summaryHistory:[]}},chat,'chat');
    const note = publishNotes(JSON.stringify({global:{text:'全局',dependencies:[]},chapter:{text:'章节',dependencies:[]}}),null,snap(),'opening');
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const runtime = createPlanner({snapshot:snap,status:()=>{},write:()=>assert.fail('inspection must not call the writer'),
        store:{list:async()=>{started(); return new Promise(resolve=>{release=resolve;});}}});
    const reading = runtime.inspect();
    await waiting;
    world.version++;
    release([note]);
    assert.deepEqual(await reading,{state:'changed'});
});

test('an in-flight writer cannot publish after its world snapshot changes in place', async () => {
    const world = {worldId:'w',branchId:'b',version:1,entities:[]};
    const chat = [{mes:'原文',is_user:true}];
    const snap = () => plannerSnapshot(world,{enabled:true,store:{summaryHistory:[]}},chat,'chat');
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const runtime = createPlanner({snapshot:snap,status:()=>{},store:{list:async()=>[],put:()=>assert.fail('stale note must not be saved')},
        write:async()=>{started();return new Promise(resolve=>{release=resolve;});}});
    const running = runtime.prepare();
    await waiting;
    world.version++;
    release(JSON.stringify({global:{text:'全局',dependencies:[]},chapter:{text:'章节',dependencies:[]}}));
    assert.equal(await running,'');
});

test('invalid private text, stale completion and failed draft never reach a reply', async () => {
    const snap=plannerSnapshot({worldId:'w',branchId:'b',entities:[{id:'p',fields:{'管理员私有/身份':{value:'苍鹰密探'}}}]},{enabled:true},[],'who');
    const note={text:'苍鹰密探',dependencies:[]};
    assert.throws(()=>publishNotes(JSON.stringify({global:note,chapter:note}),null,snap,'opening'),/私有/);
    let resolve, started, calls=0;
    const running = new Promise(r=>{started=r;});
    const runtime=createPlanner({snapshot:()=>snap,status:()=>{},preference:()=>'',store:{list:async()=>[],put:()=>assert.fail()},
        write:async()=>{calls++; if(calls===1){started(); return new Promise(r=>{resolve=r;});} throw new Error('offline');}});
    const pending=runtime.prepare();
    await running; runtime.cancel(); resolve('stale');
    assert.equal(await pending,'');
    assert.equal(await runtime.prepare(),'');
    assert.equal(await runtime.prepare(),'');
    assert.equal(calls,2);
    runtime.retry(); await runtime.prepare(); assert.equal(calls,3);
});

test('planner organizes input around characters, plotLines and situations and renders structured commentary/prediction/suggestion notes', async () => {
    const world = {
        worldId: 'w',
        branchId: 'b',
        version: 2,
        entities: [
            { id: 'c1', kind: 'person', name: '林疏', fields: { 身份: { value: '巡夜使' }, '管理员私有/暗桩': { value: '黑鸦替身' } } },
        ],
    };
    const store = {
        summaryHistory: [{
            kind: 'batch',
            endMesId: 2,
            summary: '林疏夜探东仓并记下暗号。',
            plotLines: [{ title: '东仓暗号', status: 'active', reading: '林疏已发现东仓暗门。', summary: '林疏追查暗号至东仓暗门。', quote: '林疏夜探东仓并记下暗号。', characters: ['林疏'] }],
        }],
        json: {
            storyRecords: [
                { id: 'p1', kind: 'person', name: '林疏', presence: 'present', note: '在仓外警戒' },
                { id: 's1', kind: 'situation', title: '城门戒严', status: 'open', description: '子时后只进不出', parties: ['巡夜司'] },
            ],
        },
    };
    const snap = plannerSnapshot(world, { enabled: true, store }, [{ mes: '夜风起', is_user: true }], 'chat');
    const promptPayload = JSON.parse(writerInput(snap, null, 'opening')[1].content);
    assert.equal(promptPayload.planningTargets.characters[0].name, '林疏');
    assert.equal(promptPayload.planningTargets.plotLines[0].title, '东仓暗号');
    assert.equal(promptPayload.planningTargets.situations[0].title, '城门戒严');

    const bad = publishBad => assert.throws(() => publishNotes(publishBad, null, snap, 'opening'), /私有/);
    bad(JSON.stringify({
        global: { entities: { characters: [{ target: '林疏', commentary: '黑鸦替身牵动全局', prediction: '身份待爆', suggestion: '暂留伏笔' }] }, dependencies: [] },
        chapter: { entities: { characters: [{ target: '林疏', commentary: '黑鸦替身准备行动', prediction: '试探守卫', suggestion: '展示警觉' }] }, dependencies: [] },
    }));

    const validNote = publishNotes(JSON.stringify({
        global: {
            entities: {
                characters: [{ target: '林疏', commentary: '背负双重身份压力', prediction: '中后期将面对信任撕裂', suggestion: '通过微动作维持矛盾感' }],
            },
            dependencies: [],
        },
        chapter: {
            entities: {
                characters: [{ target: '林疏', commentary: '正处东仓外缘，精力消耗过半', prediction: '可能借巡夜身份试探守门人', suggestion: '突出其观察换防间隙时的迟疑' }],
                plotLines: [{ target: '东仓暗号', commentary: '刚确认暗门位置，尚缺开启口令', prediction: '若强闯会惊动城防', suggestion: '保持线索开放，让玩家决定潜入或佯装巡检' }],
                situations: [{ target: '城门戒严', commentary: '限制了撤离路径', prediction: '换防时会出现短暂松动', suggestion: '用远处巡逻脚步声提醒时限压力' }],
            },
            dependencies: [{ lineTitle: '东仓暗号' }],
        },
    }), null, snap, 'opening');

    assert.match(validNote.chapter.text, /【人物】/);
    assert.match(validNote.chapter.text, /点评：/);
    assert.match(validNote.chapter.text, /走向预测：/);
    assert.match(validNote.chapter.text, /建议：/);
    assert.match(validNote.chapter.text, /【剧情线】/);
    assert.match(validNote.chapter.text, /【局势】/);

    const copiedTexts = [];
    const { document } = parseHTML('<html><body><div id="root"></div><div id="ctrl"></div></body></html>');
    const view = createPlannerSettings(document.getElementById('root'), {
        retry: () => {},
        controlsRoot: document.getElementById('ctrl'),
        clipboard: { writeText: async text => { copiedTexts.push(text); } },
    });
    view.note({ state: 'ready', note: { ...validNote, revision: 1 } });
    assert.equal(document.querySelectorAll('.tk-planner-entity').length, 4);
    assert.match(document.querySelector('.tk-planner-overview').textContent, /人物 1.*剧情线 1.*局势 1/);
    assert.equal(document.querySelector('.tk-planner-global').open, false);

    // Filter by group and search keyword, then test stale badge and copy button.
    document.querySelector('.tk-planner-filter[data-entity-filter="plotLines"]').click();
    assert.equal(document.querySelectorAll('.tk-planner-chapter .tk-planner-entity:not([hidden])').length, 1);
    document.querySelector('.tk-planner-filter[data-entity-filter="all"]').click();
    const search = document.querySelector('.tk-planner-search');
    search.value = '城门';
    search.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(document.querySelectorAll('.tk-planner-chapter .tk-planner-entity:not([hidden])').length, 1);

    document.querySelector('.tk-planner-copy').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(copiedTexts[0], validNote.chapter.text);
    assert.equal(document.querySelector('.tk-planner-copy-status').textContent, '已复制');

    view.note({
        state: 'stale',
        staleTargets: { all: false, characters: ['林疏'], plotLines: [], situations: [], details: [{ group: 'characters', target: '林疏', field: 'presence' }] },
        note: { ...validNote, revision: 1 },
    });
    assert.equal(document.querySelectorAll('.tk-planner-entity.is-stale .tk-planner-tag.is-stale').length, 2);
    assert.match(document.querySelector('.tk-planner-note-status').textContent, /林疏/);
});

test('granular single-entity, record field and plot-line dependencies surface stale targets in inspect()', async () => {
    globalThis.indexedDB = new IDBFactory();
    const noteStore = createNoteStore();
    const store = {
        json: {
            storyRecords: [
                { id: 'p1', kind: 'person', name: '林疏', presence: 'present', note: '东仓门外' },
                { id: 's1', kind: 'situation', title: '城门戒严', status: 'open', description: '子时闭门', parties: ['巡夜司'] },
            ],
        },
        summaryHistory: [
            { endMesId: 1, summary: '林疏发现密信', plotLines: [{ title: '东仓暗号', status: 'active', reading: '发现暗门', quote: '发现密信' }] },
        ],
    };
    const world = {
        worldId: 'w2',
        branchId: 'b2',
        version: 1,
        entities: [{ id: 'c1', name: '林疏', fields: { disposition: { value: '警惕' } } }],
    };
    const chat = [{ mes: '入夜', is_user: true }];
    const snapshot = () => ({ ...plannerSnapshot(world, { enabled: true, store }, chat, 's-granular'), boundary: 'opening' });
    const runtime = createPlanner({
        snapshot,
        store: noteStore,
        preference: () => '',
        status: () => {},
        write: async () => JSON.stringify({
            global: {
                entities: { characters: [{ target: '林疏', commentary: '握有密信', prediction: '将查账本', suggestion: '维持悬念' }] },
                dependencies: [{ entityId: 'c1', field: 'disposition' }],
            },
            chapter: {
                entities: {
                    characters: [{ target: '林疏', commentary: '在门外蹲守', prediction: '试探守卫', suggestion: '描摹风声' }],
                    plotLines: [{ target: '东仓暗号', commentary: '暗门刚露端倪', prediction: '待查口令', suggestion: '暂留扣子' }],
                    situations: [{ target: '城门戒严', commentary: '夜禁未解', prediction: '换防前紧张', suggestion: '强调时限' }],
                },
                dependencies: [
                    { entityId: 'c1', field: 'presence' },
                    { recordId: 's1', field: 'status' },
                    { lineTitle: '东仓暗号' },
                ],
            },
        }),
    });
    await runtime.prepare();
    let inspected = await runtime.inspect();
    assert.equal(inspected.state, 'ready');

    // Changing only character presence marks only 林疏 as stale.
    store.json.storyRecords[0].presence = 'absent';
    inspected = await runtime.inspect();
    assert.equal(inspected.state, 'stale');
    assert.deepEqual(inspected.staleTargets.characters, ['林疏']);
    assert.deepEqual(inspected.staleTargets.situations, []);

    // Reverting presence and changing plotLine version digest marks 东仓暗号 as stale.
    store.json.storyRecords[0].presence = 'present';
    store.summaryHistory[0].plotLines[0].status = 'advanced';
    const nextSnap = snapshot();
    const staleByLine = staleTargetsForNote(inspected.note, nextSnap, 'world');
    assert.deepEqual(staleByLine.plotLines, ['东仓暗号']);
    assert.deepEqual(staleByLine.characters, []);
});
