import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapController } from '../apps/map/host/controller.js';
import { createWorldController } from '../apps/world/host/controller.js';
import { createDiceController } from '../apps/dice/host/controller.js';
import { createDefaultXiaobaiOsSettings } from '../host/settings-normalization.js';

test('unbound world and map render empty state without accessing a previous story or starting maintenance', async () => {
    const unexpected = () => { throw new Error('No story data or maintenance should be accessed'); };
    const settings = { read: createDefaultXiaobaiOsSettings };
    const maintenance = { getStatus: () => ({ state: 'idle' }), startRebuild: unexpected, startManual: unexpected };
    const context = { activationToken: 'empty', isCurrent: () => true, post: () => true };
    const map = createMapController({ map: { readCurrent: unexpected }, settings, maintenance, getChatIdentity: () => null });
    const mapState = map.activate(context);
    assert.equal(mapState.chatIdentity, '');
    assert.equal(mapState.map, null);
    assert.equal(mapState.status, 'ready');
    await assert.rejects(map.handleMessage({ type: 'map/rebuild', payload: { chatIdentity: '' } }));
    const world = createWorldController({ world: { readCurrent: unexpected }, settings, maintenance, getChatIdentity: () => '' });
    const worldState = world.activate(context);
    assert.equal(worldState.chatIdentity, '');
    assert.equal(worldState.world.news.length, 0);
    await assert.rejects(world.handleMessage({ type: 'world/refresh', payload: { chatIdentity: '' } }));
});

test('unbound dice opens global settings without reading a character sheet and rejects sheet writes', async () => {
    let refreshed = 0;
    let saved = 0;
    const sheets = { refresh: async () => { refreshed++; }, read: () => null, getFileState: () => 'ready', save: async () => { saved++; } };
    const controller = createDiceController({ read: createDefaultXiaobaiOsSettings }, () => '', async () => {}, () => {}, sheets);
    const state = await controller.activate({ activationToken: 'empty', isCurrent: () => true, post: () => true });
    assert.equal(state.chatIdentity, '');
    assert.equal(refreshed, 0);
    await assert.rejects(controller.handleMessage({ type: 'dice/set-coc7-sheet', payload: { chatIdentity: '', sheet: null } }), /选择一段对话/);
    assert.equal(saved, 0);
});
