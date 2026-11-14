import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { panelEnabled, usePanelSettings } from './panel-policy.js';
import { mountPanelControls } from './panel-controls.js';
import { MEMORY_TOOLS } from '../modules/story-summary/maintenance/tools.js';
import { initializeOpening } from '../modules/world-records/opening.js';
import { buildMapMaintenancePrompt } from '../modules/xiaobai-os/apps/map/maintenance/prompt.js';

test('panel controls render model selectors without prompt forms and ignore legacy overrides', async () => {
    const {document} = parseHTML('<div id="controls"></div>');
    const bar = document.getElementById('controls'), state = {panelPrompts:{openingPrompt:'旧覆盖'},panels:{map:true}};
    usePanelSettings(state);
    const mutations = [];
    const repo = {
        load:async () => ({presets:[{id:'world-model',name:'测试模型'}],bindings:{}}),
        mutate:async (...args) => mutations.push(args),
    };
    mountPanelControls('map',bar,async()=>repo);
    await setImmediate();
    assert.match(bar.textContent, /人物、地图和局势共用此模型/);
    assert.equal(bar.querySelectorAll('textarea, .tk-prompt-fields').length, 0);
    const select = bar.querySelector('.tk-panel-controls').querySelector('select');
    select.querySelector('option[value="world-model"]').selected = true;
    await select.onchange();
    assert.deepEqual(mutations,[['world',{type:'select',id:'world-model'}]]);
    const model = document.createElement('section'), unusedPrompts = document.createElement('details');
    const memoryBar = document.createElement('div');
    mountPanelControls('memory',memoryBar,async()=>repo,{model,prompts:unusedPrompts});
    await setImmediate();
    assert.equal(model.querySelectorAll('select').length,4);
    assert.equal(model.querySelectorAll('details, textarea').length,0);
    assert.equal(unusedPrompts.children.length,0);
    assert.match(model.textContent,/召回模型/);
    state.panels.map=false; assert.equal(panelEnabled('map'),false);assert.equal(panelEnabled('opening'),true);
    state.enabled=false; assert.equal(panelEnabled('opening'),false);
    usePanelSettings({});
});

test('opening and map maintenance always use built-in backend instructions and ignore legacy panelPrompts', async () => {
    usePanelSettings({panelPrompts:{openingPrompt:'旧的自定义开局提示词'}});
    let sent;
    await assert.rejects(initializeOpening({readInput:async()=>({player:'甲',inputs:[{label:'港口',key:'port',text:'潮水上涨'}]}),
        service:{ensure:async()=>({sources:{}})},guard:()=>true,write:async messages=>{sent=messages;throw Error('fixture stop');}}),/fixture stop/);
    assert.notEqual(sent[0].content,'旧的自定义开局提示词');
    assert.match(sent[1].content,/潮水上涨/);
    assert.ok(buildMapMaintenancePrompt('automatic').length > 20);
    const readTool = MEMORY_TOOLS.find(item => item.function.name === 'ReadMemory');
    assert.ok(readTool && Array.isArray(readTool.function.parameters.required));
    usePanelSettings({});
});
