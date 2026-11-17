import test from 'node:test';
import assert from 'node:assert/strict';
import { panelEnabled, usePanelSettings } from './panel-policy.js';
import { requireAgent, panelAgent } from './panel-controls.js';
import { initializeOpening } from '../modules/world-records/opening.js';
import { buildMapMaintenancePrompt } from '../modules/xiaobai-os/apps/map/maintenance/prompt.js';

test('enabling a module checks only its own Agent without writing or starting a model', async () => {
    const settings = { presets:[{id:'p',kind:'text',provider:'openai-compatible',model:'local',baseUrl:'http://localhost'}], bindings:{world:'p'} };
    const repository = async () => ({load:async () => settings});
    await requireAgent('simulation', repository);
    await requireAgent(panelAgent('map'), repository);
    await assert.rejects(requireAgent(panelAgent('places'), repository), {message:'请先在设置中配置总结agent'});
    await assert.rejects(requireAgent(panelAgent('planner'), repository), {message:'请先在设置中配置编剧agent'});
    usePanelSettings({panels:{map:false}}); assert.equal(panelEnabled('map'),true); usePanelSettings({});
});

test('opening and map maintenance always use built-in backend instructions and ignore legacy panelPrompts', async () => {
    usePanelSettings({panelPrompts:{openingPrompt:'旧的自定义开局提示词'}});
    let sent;
    await assert.rejects(initializeOpening({readInput:async()=>({player:'甲',inputs:[{label:'港口',key:'port',text:'潮水上涨'}]}),
        service:{ensure:async()=>({sources:{}})},guard:()=>true,write:async messages=>{sent=messages;throw Error('fixture stop');}}),/fixture stop/);
    assert.notEqual(sent[0].content,'旧的自定义开局提示词');
    assert.match(sent[1].content,/潮水上涨/);
    assert.ok(buildMapMaintenancePrompt('automatic').length > 20);
    usePanelSettings({});
});
