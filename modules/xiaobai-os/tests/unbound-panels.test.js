import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapController } from '../apps/map/host/controller.js';
import { createWorldController } from '../apps/world/host/controller.js';
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

