import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { IDBFactory } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';
import { createTestModuleUrl } from '../story-summary/tests/helpers/bundle-module.js';

test('foreground adapter publishes only a whole chapter and clears its request-local slot', async t => {
    const fixture = globalThis.__plannerHost = {prompts:{}, calls:0, events:{}};
    globalThis.indexedDB = new IDBFactory();
    t.after(()=>{delete globalThis.__plannerHost;});
    const mocks = {
        'extensions.js': 'export const extension_settings={}; export const getContext=()=>({chat:[],name1:"旅人",getTokenCountAsync:async()=>100});',
        'utils.js': 'export const debounce=fn=>fn;',
        'script.js': 'export const extension_prompts=globalThis.__plannerHost.prompts, extension_prompt_types={IN_CHAT:1}, extension_prompt_roles={SYSTEM:0}, chat_metadata={}, getRequestHeaders=()=>({});',
        'event-manager.js': 'export const event_types=new Proxy({},{get:(_,k)=>k}); export const createModuleEvents=()=>({on:(k,fn)=>globalThis.__plannerHost.events[k]=fn,cleanup(){}});',
        'generate-interceptor.js': 'export const GENERATE_INTERCEPTOR_ORDER={STORY_PLANNER:300}; export function registerGenerateInterceptor(id,fn){globalThis.__plannerHost.run=fn;} export function unregisterGenerateInterceptor(){}',
        'host.js': 'export const resolveTextApi=async()=>({provider:"other",baseUrl:"http://127.0.0.1:8080/v1",model:"fixture-model",apiKey:""}); export const generateFeatureText=async(_f,opts)=>{globalThis.__plannerHost.calls++; globalThis.__plannerHost.lastMessages=opts?.messages; return {text:JSON.stringify({global:{text:"后台全局",dependencies:[]},chapter:{text:"药车停在桥头。",dependencies:[]}})};};',
        'repository.js': 'export function getTextApiRepository(){} export function getProfileSnapshot(){return null;}',
        'raw-recall.js': 'export async function recallRawMemory(_cfg,opts){globalThis.__plannerHost.recalls?.push(opts); return globalThis.__plannerHost.recallResult || {chunks:[],focusCharacters:[]};}',
    };
    const result = await build({entryPoints:['modules/story-planner/host.js'],platform:'node',format:'esm',bundle:true,write:false,
        banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},
        plugins:[{name:'fixture',setup(api){
            api.onResolve({filter:/(?:^|\/)(?:extensions|utils|script|event-manager|generate-interceptor)\.js$|text-api\/(?:host|repository)\.js$|retrieval\/raw-recall\.js$/},args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));
            api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
        }}]});
    // eslint-disable-next-line no-unsanitized/method -- Only the local fixture bundle is imported.
    const {installPlanner} = await import(await createTestModuleUrl(result.outputFiles[0].text));
    const chat=[{mes:'去河边',is_user:true}];
    const state={owner:'one',boundary:'opening',world:{entities:[],version:1},chat,records:[],layers:{parents:[],leaves:[]}};
    const settings = {};
    const planner=installPlanner({snapshot:()=>state,getContext:()=>({getTokenCountAsync:async()=>100}),settings,saveSettings:()=>{}});
    const run=(type,size=8192)=>fixture.run(chat,size,()=>assert.fail(),type,{});
    const { document } = parseHTML('<html><body><div id="planner"></div></body></html>');
    const root = document.getElementById('planner');
    await planner.open(root);
    assert.equal(root.querySelector('input[type="checkbox"]'), null);
    assert.equal(settings.onChapter, true);
    for (const type of ['normal','continue','regenerate','swipe']) await run(type);
    assert.equal(fixture.calls,0);
    assert.deepEqual(fixture.prompts,{});
    await root.querySelector('[data-prepare-note]').onclick();
    assert.equal(fixture.calls,1);
    await run('normal');
    assert.equal(fixture.prompts['kitchen-chapter-note'].value,'【本章札记】\n药车停在桥头。');
    fixture.events.GENERATION_ENDED();
    assert.deepEqual(fixture.prompts,{});
    await run('normal',100);
    assert.deepEqual(fixture.prompts,{});
    await run('quiet');
    assert.equal(fixture.calls,1);
    await run('continue');
    assert.equal(fixture.calls, 1);
    await planner.open(root);
    assert.equal(root.querySelector('.tk-planner-chapter').textContent,'药车停在桥头。');
    assert.equal(root.querySelector('.tk-planner-global').open,false);
    assert.equal(root.querySelector('.tk-planner-global .tk-planner-note-text').textContent,'后台全局');
    assert.match(root.querySelector('.tk-planner-global summary').textContent,/剧透/);
    assert.equal(fixture.calls,1,'opening the panel must not call the model');
    fixture.events.CHAT_CHANGED();
    assert.deepEqual(fixture.prompts,{});
    assert.equal(root.querySelector('.tk-planner-chapter').textContent,'');
    state.owner='another-chat';
    await planner.open(root);
    assert.match(root.textContent,/暂无札记/);
    state.owner='one';
    await planner.open(root);
    assert.equal(root.querySelector('.tk-planner-chapter').textContent,'药车停在桥头。');
    state.boundary='next-chapter';
    await planner.open(root);
    assert.match(root.querySelector('.tk-planner-note-status').textContent,/待更新/);
    await run('normal');
    assert.deepEqual(fixture.prompts,{});
    assert.equal(fixture.calls,1);
    assert.equal(settings.onChapter,true);
    await planner.onChapter();
    await run('normal');
    assert.equal(fixture.calls,2);
    assert.match(fixture.prompts['kitchen-chapter-note'].value,/药车/);
    assert.deepEqual(chat,[{mes:'去河边',is_user:true}]);
    planner.dispose();
});

test('installPlanner forwards buildPlannerProseQuery overrides and recalled chunks from settled floors', async t => {
    const fixture = globalThis.__plannerHost = {
        prompts: {},
        calls: 0,
        events: {},
        recalls: [],
        recallResult: { chunks: [{ floor: 0, speaker: '林疏', text: '旧年桥头密约。' }], focusCharacters: ['林疏'] },
    };
    globalThis.indexedDB = new IDBFactory();
    t.after(() => { delete globalThis.__plannerHost; });
    const result = await build({
        entryPoints: ['modules/story-planner/host.js'],
        platform: 'node',
        format: 'esm',
        bundle: true,
        write: false,
        banner: { js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);" },
        plugins: [{
            name: 'fixture-recall',
            setup(api) {
                const mocks = {
                    'extensions.js': 'export const extension_settings={}; export const getContext=()=>({chat:[],name1:"旅人",getTokenCountAsync:async()=>100});',
                    'utils.js': 'export const debounce=fn=>fn;',
                    'script.js': 'export const extension_prompts=globalThis.__plannerHost.prompts, extension_prompt_types={IN_CHAT:1}, extension_prompt_roles={SYSTEM:0}, chat_metadata={}, getRequestHeaders=()=>({});',
                    'event-manager.js': 'export const event_types=new Proxy({},{get:(_,k)=>k}); export const createModuleEvents=()=>({on:(k,fn)=>globalThis.__plannerHost.events[k]=fn,cleanup(){}});',
                    'generate-interceptor.js': 'export const GENERATE_INTERCEPTOR_ORDER={STORY_PLANNER:300}; export function registerGenerateInterceptor(id,fn){globalThis.__plannerHost.run=fn;} export function unregisterGenerateInterceptor(){}',
                    'host.js': 'export const resolveTextApi=async()=>({provider:"other",baseUrl:"http://127.0.0.1:8080/v1",model:"fixture-model",apiKey:""}); export const generateFeatureText=async(_f,opts)=>{globalThis.__plannerHost.calls++; globalThis.__plannerHost.lastMessages=opts?.messages; return {text:JSON.stringify({global:{text:"后台全局",dependencies:[]},chapter:{text:"药车停在桥头。",dependencies:[]}})};};',
                    'repository.js': 'export function getTextApiRepository(){} export function getProfileSnapshot(){return null;}',
                    'raw-recall.js': 'export async function recallRawMemory(_cfg,opts){globalThis.__plannerHost.recalls.push(opts); return globalThis.__plannerHost.recallResult;}',
                };
                api.onResolve({ filter: /(?:^|\/)(?:extensions|utils|script|event-manager|generate-interceptor)\.js$|text-api\/(?:host|repository)\.js$|retrieval\/raw-recall\.js$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }));
                api.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
            },
        }],
    });
    // eslint-disable-next-line no-unsanitized/method -- Only the local fixture bundle is imported.
    const { installPlanner } = await import(await createTestModuleUrl(result.outputFiles[0].text));
    const chat = [
        { mes: '林疏提到桥头。', is_user: true },
        { mes: '守卫点头示意。', is_user: false },
    ];
    const state = {
        owner: 'owner-recall-host',
        boundary: 'opening',
        lastSummarizedMesId: 1,
        world: { entities: [{ id: 'lin', kind: 'person', name: '林疏', aliases: ['阿疏'], fields: { 状态: { value: '潜伏' } } }], version: 1 },
        chat,
        records: [
            { id: 'p-lin', kind: 'person', name: '林疏', presence: 'present', note: '在东桥附近盯梢' },
            { id: 's1', kind: 'situation', title: '城东搜查', status: 'open', description: '沿桥排查', parties: ['林疏'] },
        ],
        layers: { parents: [], leaves: [] },
    };
    const planner = installPlanner({
        snapshot: () => state,
        getContext: () => ({ getTokenCountAsync: async () => 100 }),
        settings: {},
    });
    await planner.onChapter();
    assert.equal(fixture.recalls.length, 1);
    assert.equal(fixture.recalls[0].hiddenThrough, 1);
    assert.match(fixture.recalls[0].queryOverride, /城东搜查/);
    assert.ok(fixture.recalls[0].focusCharactersOverride.includes('林疏'));
    const sent = JSON.parse(fixture.lastMessages[1].content);
    assert.equal(sent.recalledProse[0].text, '旧年桥头密约。');
    planner.dispose();
});
