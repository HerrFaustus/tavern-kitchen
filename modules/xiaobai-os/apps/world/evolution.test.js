import { parseHTML } from 'linkedom';
import { mountEvolutionView, registerEvolutionReader } from './evolution-view.js';
import { createSettingsRepository } from '../../host/settings-repository.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorldMaintenanceParticipant } from './host/maintenance-participant.js';

test('automatic sessions restrict reads and writes to nearby or freshly awakened subjects and recheck on save', async () => {
    const near = {key:'person/a',kind:'person',title:'信使',near:true};
    const far = {key:'situation/port',kind:'situation',title:'封港',near:false,wakeFloor:3};
    let subjects = [near,far];
    const current = {identityKey:'chat',chatIdentity:'chat',world:{overview:'密报',news:[
        {id:'port',title:'封港',body:'候潮',situationId:'port'}]}};
    const service = {readCurrent:() => current,refreshCurrent:async () => current,
        replaceContent(owner, old, next, guard) { if (!guard()) throw new Error('名单已变化'); }};
    const p = createWorldMaintenanceParticipant(service,() => ({peopleEvolution:true,subscribed:true}),() => subjects);
    const session = floor => p.createSession({chatIdentity:'chat',messages:[{role:'assistant',index:floor,text:'山路通行'}]},'automatic');
    const s = await session(4);
    assert.deepEqual(s.executeTool('WorldRead',{}),{overview:'',news:[]});
    assert.throws(() => s.executeTool('WorldEdit',{remove:['port']}),/授权/);
    assert.equal(s.executeTool('WorldEdit',{upsert:[{id:'person-a',subjectId:near.key,title:'信使',body:'准备出城'}],
        progress:[{scope:'news:person-a',from:'',quote:'山路通行',reason:'出城有路可走'}]}).ok,true);
    subjects = [far];
    assert.equal(s.canCommit(),false);
    await assert.rejects(s.commit(() => true),/名单已变化/);
    assert.equal(await session(4),null);
    assert.equal((await session(3)).executeTool('WorldRead',{}).news[0].id,'port');
});

test('automatic evolution separates character and situation writes and rechecks switches before commit', async () => {
    const current = { identityKey: 'chat', chatIdentity: 'chat', world: { version: 3, overview: '', news: [] } };
    const flags = { subscribed: false, peopleEvolution: false, injectToStory: true };
    const service = { readCurrent: () => current, refreshCurrent: async () => current,
        async replaceContent(identity, expected, next, guard) { assert.ok(guard()); current.world = { ...current.world, ...next }; } };
    const participant = createWorldMaintenanceParticipant(service, () => ({ ...flags }));
    assert.equal(participant.isEnabled('automatic'), false);
    const edit = (session, id) => session.executeTool('WorldEdit', { progress:[{scope:'news:' + id,from:'',quote:'山路通行',reason:'山路已经开放。'}],upsert:[{id, title:'动向', body:'信使改走山路。'}]});
    for (const people of [true, false]) {
        Object.assign(flags, {peopleEvolution: people, subscribed: !people});
        assert.equal(participant.isEnabled('automatic'), true);
        const session = await participant.createSession({ chatIdentity:'chat', messages:[{role:'assistant',index:3,text:'山路通行'}] }, 'automatic');
        assert.throws(() => edit(session, people ? 'situation-port' : 'person-courier'), /关闭/);
        assert.equal(edit(session, people ? 'person-courier' : 'situation-port').ok, true);
        flags[people ? 'peopleEvolution' : 'subscribed'] = false;
        assert.equal(session.canCommit(), false);
        flags[people ? 'peopleEvolution' : 'subscribed'] = true;
        await session.commit(() => true);
    }
    assert.equal(current.world.news.length, 2);
});

test('section controls save independently and only display their own background entries', async t => {
    const {document} = parseHTML('<html><body><section></section></body></html>');
    const previous = globalThis.document;
    globalThis.document = document; t.after(() => { globalThis.document = previous; });
    const state = {enabled:true, apps:{world:{subscribed:true}}};
    const preferences = {read:() => state, subscribe:() => () => {}, setWorldPreference(key, value) { state.apps.world[key] = value; }};
    const current = {chatIdentity:'chat', world:{overview:'港口封航', news:[{id:'person-a',title:'信使绕路',body:'走山路'}, {id:'port',title:'旧局势',body:'候潮'}]}};
    const disconnect = registerEvolutionReader({readCurrent:() => current, refreshCurrent:async () => current, subscribe:() => () => {}});
    t.after(disconnect);
    const parent = document.querySelector('section');
    const stop = mountEvolutionView(parent, 'people', preferences);
    assert.match(parent.textContent, /信使绕路/); assert.doesNotMatch(parent.textContent, /港口封航|旧局势/);
    const input = parent.querySelector('input');
    assert.equal(input.checked, false);
    input.checked = true; await input.onchange();
    assert.equal(state.apps.world.peopleEvolution, true);
    stop();
    const close = mountEvolutionView(parent, 'situation', preferences);
    assert.match(parent.textContent, /港口封航/); assert.doesNotMatch(parent.textContent, /信使绕路/);
    const second = parent.querySelector('input'); second.checked = false; await second.onchange();
    assert.equal(state.apps.world.subscribed, false); assert.equal(state.apps.world.peopleEvolution, true);
    close();
});

test('evolution switches persist independently across reloads', async () => {
    const root = {};
    const adapter = { getExtensionSettings: () => root, saveSettings: async () => true };
    const repo = createSettingsRepository(adapter);
    await repo.prepare();
    await repo.setWorldPreference('subscribed', true);
    await repo.setWorldPreference('peopleEvolution', true);
    await repo.setWorldPreference('peopleEvolution', false);
    await repo.setWorldPreference('sceneryEvolution', true);
    await repo.setEncounterFrequency('lively');
    const reloaded = await createSettingsRepository(adapter).prepare();
    assert.equal(reloaded.apps.world.sceneryEvolution, true);
    assert.equal(reloaded.apps.world.encounterFrequency, 'lively');
    assert.equal(reloaded.apps.world.peopleEvolution, false);
    assert.equal(reloaded.apps.world.subscribed, true);
});

test('inline situation switches accept only the active frame and restore saved state after failure', async t => {
    const { document } = parseHTML('<html><body><section></section></body></html>');
    const previous = { document: globalThis.document, window: globalThis.window };
    const listeners = new Set(), messages = [];
    globalThis.document = document;
    globalThis.window = {
        location: { origin: 'http://kitchen.test' },
        addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
        removeEventListener(type, listener) { if (type === 'message') listeners.delete(listener); },
    };
    let stop;
    t.after(() => { stop?.(); Object.assign(globalThis, previous); });
    const state = { enabled: true, apps: { world: { subscribed: false, sceneryEvolution: false } } };
    let fail = false;
    const frame = { contentWindow: { postMessage(message) { messages.push(structuredClone(message)); } } };
    const preferences = {
        read: () => state, subscribe: () => () => {},
        async setWorldPreference(key, value) {
            if (fail) throw new Error('保存失败');
            state.apps.world[key] = value;
        },
    };
    stop = mountEvolutionView(document.querySelector('section'), 'situation', preferences, frame);
    const receive = [...listeners][0];
    const event = value => ({
        origin: window.location.origin, source: frame.contentWindow,
        data: { source: 'TavernKitchen-StoryFrame', type: 'WORLD_EVOLUTION_CHANGE', key: 'subscribed', value },
    });
    receive({ ...event(true), source: {} });
    assert.equal(state.apps.world.subscribed, false);
    receive(event(true));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(messages.at(-1).settings.subscribed, true);
    assert.equal(messages.at(-1).settings.pending, false);
    fail = true;
    receive(event(false));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(messages.at(-1).settings.subscribed, true);
    assert.match(messages.at(-1).settings.error, /保存失败/);
    stop();
    assert.equal(listeners.size, 0);
});
import { registerSituationCatalog } from '../../../story-state/situation-links.js';
import { createWorldMaintenanceSession } from './maintenance/session.js';

test('background links use exact situation IDs and expire if the target disappears before commit', async t => {
    let catalog = [{id:'port', title:'东港封锁'}];
    const unregister = registerSituationCatalog(key => key === 'chat' ? catalog : []); t.after(unregister);
    const world = { readCurrent: () => ({identityKey:'chat', chatIdentity:'chat', world:{overview:'',news:[]}}),
        replaceContent(owner, old, next, guard) { if (!guard()) throw new Error('stale link'); } };
    const session = createWorldMaintenanceSession(world,'automatic',() => ({subscribed:true}), [{role:'assistant',index:3,text:'仓库满了'}]);
    const article = {id:'situation-cargo', title:'积货', body:'货物堆积。'};
    assert.ok(session.dataMessages.some(m => m.content.includes('东港封锁')));
    assert.throws(() => session.executeTool('WorldEdit',{upsert:[{...article,situationId:'unknown'}]}),/局势目录/);
    assert.equal(session.executeTool('WorldEdit',{upsert:[{...article,situationId:'port'}], progress:[{scope:'news:situation-cargo',from:'',quote:'仓库满了',reason:'到港货物无法入库'}]}).ok,true);
    catalog = [];
    await assert.rejects(session.commit(() => true),/stale link/);
});
test('automatic progression requires matching previous state and evidence from accepted narration', async () => {
    const quote = '信使已收到通行证';
    const previous = {id:'person-a',title:'信使',body:'等候通行证'};
    const world = {readCurrent:() => ({identityKey:'chat',chatIdentity:'chat',world:{overview:'',news:[previous]}})};
    const session = createWorldMaintenanceSession(world,'automatic',() => ({peopleEvolution:true}), [
        {role:'user',text:'我希望信使已经到达',index:3},{role:'assistant',text:quote,index:4}]);
    const change = {upsert:[{...previous,body:'准备出城'}]};
    const proof = {scope:'news:person-a',from:previous.body,quote,reason:'现已具备出城条件'};
    for (const invalid of [[],[{...proof,from:'已经出发'}],[{...proof,quote:'我希望信使已经到达'}]]) {
        assert.throws(() => session.executeTool('WorldEdit',{...change,progress:invalid}));
        assert.equal(session.canCommit(),false);
    }
    const updated = session.executeTool('WorldEdit',{...change,progress:[proof]});
    assert.equal(updated.data.news[0].progress.floor,4);
    assert.equal(updated.data.news[0].progress.from,previous.body);
    assert.equal(session.canCommit(),true);
    assert.throws(() => session.executeTool('WorldEdit',{remove:['person-a']}));
    assert.equal(session.canCommit(),false);
});
