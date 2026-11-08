import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { collectOpening, openingMessages } from './opening-input.js';
import { initializeOpening, OPENING } from './opening.js';
import { openingOperations } from './opening-projection.js';
import { readWorldMap } from './map-commands.js';
import { buildAuthorityContext } from './authority.js';

test('collects bound books once, independent of keyword activation, and selects the live greeting',async () => {
    const bookReads = [];
    const ctx = {characterId:0,characters:[{avatar:'a',name:'守门人',data:{description:'灰色制服',extensions:{world:'卡书'}}}],
        name1:'旅人',powerUserSettings:{persona_description_lorebook:'人设书'},chat:[{mes:'第二个开场',swipes:['弃用开场','第二个开场']},
            {is_user:true,mes:'我要进城'}]};
    const read = await collectOpening(ctx,{globals:['全局','重复'],chatBook:'聊天',extraBooks:()=>['附加','重复'],loadBook:async name => {
        bookReads.push(name); return {entries:{off:{disable:true,content:'禁用条目'},untriggered:{key:['未命中'],content:name}}};
    }});
    assert.equal(new Set(bookReads).size,6); assert.equal(bookReads.length,6);
    const material = read.inputs.map(row=>row.text);
    for (const value of ['灰色制服','第二个开场','我要进城',...bookReads]) assert.ok(material.includes(value));
    for (const value of ['弃用开场','禁用条目']) assert.ok(!material.includes(value));
    assert.ok(openingMessages(ctx.chat).fresh);
    ctx.chat.push({mes:'守门人打开了门'}); assert.equal(openingMessages(ctx.chat).fresh,false);
});

function fixture() {
    const service = createWorldService({storage:createWorldStorage({indexedDB:new IDBFactory()}),getIdentity:()=> 'chat'});
    let writes = 0;
    const input = {player:'旅人',inputs:[
        {key:'port',label:'港城书 · 港口',text:'港城的码头正在挂灯。守门人私下传信。若失火则封港。远山有白银。'},
        {key:'opening',label:'开场',text:'旅人刚到码头。'}]};
    const output = source => {
        const row = (kind,name,value,more={}) => ({part:source.part,quote:source.text,kind,name,value,...more});
        return source.label === '开场' ? [row('position','旅人',source.text.includes('广场') ? '广场' : '码头')]
            : [row('place','港城','沿海城市',{scale:'city'}),row('place','码头','靠岸处',{parent:'港城'}),
                row('feature','石阶','潮湿的石阶',{parent:'码头'}),row('scenery','灯节','正在挂灯',{scope:'港城'}),row('situation','港务','筹备灯节',{scope:'港城'}),
                row('secret','守门人','私下传信'),row('condition','封港','若失火则封港'),row('place','远山','有白银')];
    };
    const write = async messages => { writes++;return JSON.stringify(JSON.parse(messages[1].content).sources.flatMap(output)); };
    const run = options => initializeOpening({readInput:async()=>structuredClone(input),service,write,guard:()=>true,
        project:openingOperations,oldChat:false,...options});
    return {service,input,run,write,count:()=>writes};
}
test('first generation has local opening facts, world-only secrets, an atlas and no duplicated commits',async () => {
    const f = fixture(); await f.run();
    let state = await f.service.read();
    const text = buildAuthorityContext(state,'四下看看',4000,'旅人');
    assert.match(text,/码头/); assert.match(text,/正在挂灯/); assert.doesNotMatch(text,/私下传信|若失火|白银/);
    const map = readWorldMap(state); assert.equal(map.atlas.locations.find(p=>p.name === '码头').parent,map.atlas.locations.find(p=>p.name === '港城').key);
    assert.equal(map.atlas.locations.find(p=>p.name === '码头').features[0].name,'石阶');
    assert.equal(map.atlas.actors.find(p=>p.actorKey === 'player').locationKey,map.atlas.locations.find(p=>p.name === '码头').key);
    assert.ok(state.sources[OPENING].rows.some(r=>r.kind === 'secret' && r.key === 'port'));
    const version = state.version;
    await f.run();assert.equal((await f.service.read()).version,version);assert.equal(f.count(),1);
    f.input.inputs[1].text = '旅人刚到广场。';await f.run();state = await f.service.read();
    assert.equal(f.count(),2); assert.match(buildAuthorityContext(state,'',4000,'旅人'),/广场/);
    assert.equal(state.modules.story.records.length,2);
    assert.equal(state.modules.story.records[0].version,version);
});
test('completed batches resume after failure and stale evidence never becomes a live world',async () => {
    const f = fixture();
    f.input.inputs[0].text += '灯'.repeat(9950);
    f.input.inputs[1].text += '潮'.repeat(200);
    let calls = 0;
    await assert.rejects(f.run({write:async messages => { if (++calls === 2) throw new Error('offline');return f.write(messages); }}),/offline/);
    assert.equal((await f.service.read()).entities.length,0);
    await f.run();assert.equal(f.count(),2);
    f.input.inputs[1].text += '改动';
    const prev = (await f.service.read()).sources[OPENING].fingerprint;
    await assert.rejects(f.run({write:async messages=>{f.input.inputs[1].text+='又改';return f.write(messages);}}),/已改动/);
    assert.equal((await f.service.read()).sources[OPENING].fingerprint,prev);
});
test('old chat initialization does not reset live positions or create active opening situations',async()=>{
    const f=fixture();await f.run({oldChat:true});
    const state=await f.service.read();
    assert.equal(state.modules.map.atlas.actors.length,0);assert.equal(state.modules.story,undefined);
    assert.ok(state.sources[OPENING].rows.some(row=>row.kind==='position'));
});

