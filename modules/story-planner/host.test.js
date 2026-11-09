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
        'script.js': 'export const extension_prompts=globalThis.__plannerHost.prompts, extension_prompt_types={IN_CHAT:1}, extension_prompt_roles={SYSTEM:0};',
        'event-manager.js': 'export const event_types=new Proxy({},{get:(_,k)=>k}); export const createModuleEvents=()=>({on:(k,fn)=>globalThis.__plannerHost.events[k]=fn,cleanup(){}});',
        'generate-interceptor.js': 'export const GENERATE_INTERCEPTOR_ORDER={STORY_PLANNER:300}; export function registerGenerateInterceptor(id,fn){globalThis.__plannerHost.run=fn;} export function unregisterGenerateInterceptor(){}',
        'host.js': 'export const resolveTextApi=async()=>({provider:"other",apiKey:"fixture"}); export const generateFeatureText=async()=>{globalThis.__plannerHost.calls++; return {text:JSON.stringify({global:{text:"后台全局",dependencies:[]},chapter:{text:"药车停在桥头。",dependencies:[]}})};};',
        'repository.js': 'export function getTextApiRepository(){}',
    };
    const result = await build({entryPoints:['modules/story-planner/host.js'],platform:'node',format:'esm',bundle:true,write:false,
        banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},
        plugins:[{name:'fixture',setup(api){
            api.onResolve({filter:/script\.js$|event-manager\.js$|generate-interceptor\.js$|text-api\/(?:host|repository)\.js$/},args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));
            api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path]}));
        }}]});
    // eslint-disable-next-line no-unsanitized/method -- Only the local fixture bundle is imported.
    const {installPlanner} = await import(await createTestModuleUrl(result.outputFiles[0].text));
    const chat=[{mes:'去河边',is_user:true}];
    const state={owner:'one',boundary:'opening',world:{entities:[],version:1},chat,records:[],layers:{parents:[],leaves:[]}};
    const planner=installPlanner({snapshot:()=>state,getContext:()=>({getTokenCountAsync:async()=>100}),settings:{}});
    const run=(type,size=8192)=>fixture.run(chat,size,()=>assert.fail(),type,{});
    await run('normal');
    assert.equal(fixture.prompts['kitchen-chapter-note'].value,'【本章札记】\n药车停在桥头。');
    fixture.events.GENERATION_ENDED();
    assert.deepEqual(fixture.prompts,{});
    await run('normal',100);
    assert.deepEqual(fixture.prompts,{});
    await run('quiet');
    assert.equal(fixture.calls,1);
    await run('continue');
    assert.equal(fixture.calls,1);
    const { document } = parseHTML('<html><body><div id="planner"></div><div id="settings"></div></body></html>');
    const root = document.getElementById('planner'), controls = document.getElementById('settings');
    await planner.open(root,controls);
    assert.equal(root.querySelector('.tk-planner-chapter').textContent,'药车停在桥头。');
    assert.equal(root.querySelector('.tk-planner-global').open,false);
    assert.equal(root.querySelector('.tk-planner-global .tk-planner-note-text').textContent,'后台全局');
    assert.match(root.querySelector('.tk-planner-global summary').textContent,/剧透/);
    assert.equal(fixture.calls,1,'opening the panel must not call the model');
    fixture.events.CHAT_CHANGED();
    assert.deepEqual(fixture.prompts,{});
    assert.equal(root.querySelector('.tk-planner-chapter').textContent,'');
    state.owner='another-chat';
    await planner.open(root,controls);
    assert.match(root.textContent,/暂无札记/);
    state.owner='one';
    await planner.open(root,controls);
    assert.equal(root.querySelector('.tk-planner-chapter').textContent,'药车停在桥头。');
    state.boundary='next-chapter';
    await planner.open(root,controls);
    assert.match(root.querySelector('.tk-planner-note-status').textContent,/需要更新/);
    assert.equal(fixture.calls,1);
    assert.deepEqual(chat,[{mes:'去河边',is_user:true}]);
    planner.dispose();
});
