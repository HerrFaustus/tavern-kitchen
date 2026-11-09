import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { definePanelPrompt, panelEnabled, usePanelSettings } from './panel-policy.js';
import { mountPanelControls } from './panel-controls.js';
import { MEMORY_TOOLS } from '../modules/story-summary/maintenance/tools.js';
import { initializeOpening } from '../modules/world-records/opening.js';
import { buildMapMaintenancePrompt } from '../modules/xiaobai-os/apps/map/maintenance/prompt.js';

test('panel controls show the bound model first and save and reset the actual request template',async () => {
    const {document} = parseHTML('<div id="controls"></div>');
    const bar = document.getElementById('controls'), state = {panelPrompts:{},panels:{map:true}};
    usePanelSettings(state);
    const mutations = [];
    const repo = {
        load:async () => ({presets:[{id:'world-model',name:'测试模型'}],bindings:{}}),
        mutate:async (...args) => mutations.push(args),
    };
    mountPanelControls('map',bar,state,async (key,value) => {state.panelPrompts[key]=value;},async()=>repo);
    await setImmediate();
    assert.match(bar.textContent, /人物、地图和局势共用此模型/);
    const select = bar.querySelector('.tk-panel-controls').querySelector('select');
    select.querySelector('option[value="world-model"]').selected = true;
    await select.onchange();
    assert.deepEqual(mutations,[['world',{type:'select',id:'world-model'}]]);
    const input = [...bar.querySelectorAll('textarea')].find(t=>t.parentElement.textContent.includes('地图更新'));
    const original = buildMapMaintenancePrompt('automatic');
    assert.equal(input.value,original);
    input.value='只更新本次提到的地点';
    const [save,reset] = input.parentElement.nextElementSibling.querySelectorAll('button');
    await save.onclick(); assert.equal(buildMapMaintenancePrompt('automatic'),input.value);
    await reset.onclick(); assert.equal(buildMapMaintenancePrompt('automatic'),original);
    const model = document.createElement('section'), prompts = document.createElement('details');
    const memoryBar = document.createElement('div');
    mountPanelControls('memory',memoryBar,state,async () => {},async()=>repo,{model,prompts});
    await setImmediate();
    assert.equal(model.querySelectorAll('select').length,4);
    assert.equal(model.querySelectorAll('details').length,0);
    assert.match(model.textContent,/召回模型/);
    state.panels.map=false; assert.equal(panelEnabled('map'),false);assert.equal(panelEnabled('opening'),true);
    state.enabled=false; assert.equal(panelEnabled('opening'),false);
    usePanelSettings({});
});

test('opening model receives saved instructions before the first request',async () => {
    usePanelSettings({panelPrompts:{openingPrompt:'读取世界书，保留知情边界。'}});
    let sent;
    await assert.rejects(initializeOpening({readInput:async()=>({player:'甲',inputs:[{label:'港口',key:'port',text:'潮水上涨'}]}),
        service:{ensure:async()=>({sources:{}})},guard:()=>true,write:async messages=>{sent=messages;throw Error('fixture stop');}}),/fixture stop/);
    assert.equal(sent[0].content,'读取世界书，保留知情边界。');assert.match(sent[1].content,/潮水上涨/);
    usePanelSettings({});
});

test('data substitution preserves dollar signs and host macros in the source data',() => {
    const read=definePanelPrompt('test','test-data','资料','{{text}}');
    assert.equal(read({text:'$& {{user}}'}),'$& {{user}}');
});

test('tool instructions change on the next serialized request while its validation schema stays intact',async () => {
    const {document} = parseHTML('<div id="controls"></div>');
    const state = {panelPrompts:{}}, bar = document.getElementById('controls');
    usePanelSettings(state);
    mountPanelControls('proofreading',bar,state,async (key,value) => {state.panelPrompts[key]=value;},
        async () => ({load:async () => ({presets:[],bindings:{}})}));
    await setImmediate();
    const tool = MEMORY_TOOLS.find(item => item.function.name === 'ReadMemory');
    const input = [...bar.querySelectorAll('textarea')].find(t => t.parentElement.textContent.startsWith('ReadMemory ·'));
    const [save,reset] = input.parentElement.nextElementSibling.querySelectorAll('button');
    const original = JSON.stringify(tool);
    input.value = '不是 JSON';
    await save.onclick();
    assert.match(bar.querySelector('.tk-prompt-fields [role="status"]').textContent,/有效的 JSON/);
    assert.equal(JSON.stringify(tool),original);
    const descriptions = {function:'先查已有总结'};
    input.value = JSON.stringify(descriptions);
    await save.onclick();
    assert.equal(JSON.parse(JSON.stringify(tool)).function.description,'先查已有总结');
    assert.deepEqual(tool.function.parameters.required,JSON.parse(original).function.parameters.required);
    await reset.onclick();
    assert.equal(JSON.stringify(tool),original);
    usePanelSettings({});
});
