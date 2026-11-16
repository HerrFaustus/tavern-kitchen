import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapController } from '../apps/map/host/controller.js';
import type { MapClientState } from '../apps/map/types.js';
import { createEmptyMapDomain } from '../domains/map/state.js';
import { createDefaultXiaobaiOsSettings } from '../host/settings-normalization.js';
import { createMapKernelHarness } from './map-kernel-harness.js';

async function setupController() {
    const createHarness = createMapKernelHarness as (initialMap: unknown) => ReturnType<typeof createMapKernelHarness>;
    const harness = createHarness(createEmptyMapDomain());
    await harness.map.refreshCurrent();
    const defaults = createDefaultXiaobaiOsSettings();
    const busy = (mode: 'manual' | 'rebuild') => ({
        status: 'busy' as const,
        mode,
        reason: 'participant-busy' as const,
    });
    const controller = createMapController({
        map: harness.map,
        settings: {
            read: () => defaults,
            setMapAutoMaintenance: async () => defaults,
            setMapProjection: async () => defaults,
            subscribe: () => () => {},
        },
        maintenance: {
            startManual: () => busy('manual'),
            startRebuild: () => busy('rebuild'),
            cancelRequested: () => {},
            invalidateAutomatic: () => {},
            getStatus: () => ({ state: 'idle', mode: null, message: '', reason: '', lastRunAt: null }),
            subscribeStatus: () => () => {},
        },
        getChatIdentity: () => harness.state.capture.identityKey,
        subscribeData: () => () => {},
    });
    const chatIdentity = harness.state.capture.identityKey;
    controller.activate({
        activationToken: 'tok-map',
        isCurrent: () => true,
        post: () => true,
    });
    return { harness, controller, chatIdentity };
}

test('map/update-data persists manual location, feature, link and actor CRUD and rejects stale revisions or invalid domains', async () => {
    const { harness, controller, chatIdentity } = await setupController();
    const base = harness.map.readCurrent().map;
    assert.ok(base);
    assert.equal(base.revision, 0);

    const created = {
        ...base,
        atlas: {
            locations: [
                { key: 'harbor', name: '港区', scale: 'region', status: 'visited', brief: '海防要地', features: [{ name: '灯塔', state: '亮灯' }] },
                { key: 'dock', parent: 'harbor', name: '木码头', scale: 'outdoor', status: 'mentioned', features: [] },
            ],
            links: [
                { id: 'link-harbor-dock', from: 'harbor', to: 'dock', kind: 'road', bidirectional: true, label: '长堤' },
            ],
            actors: [
                { actorKey: 'player', displayName: '旅人', locationKey: 'dock' },
            ],
        },
    };

    const res1 = await controller.handleMessage({
        type: 'map/update-data',
        payload: { chatIdentity, expectedRevision: 0, map: created },
    }) as MapClientState;
    assert.equal(res1.status, 'ready');
    const savedMap1 = res1.map;
    assert.ok(savedMap1);
    assert.equal(savedMap1.revision, 1);
    assert.equal(savedMap1.atlas.locations.length, 2);
    assert.deepEqual(savedMap1.atlas.locations[0].features, [{ name: '灯塔', state: '亮灯' }]);
    assert.equal(savedMap1.atlas.links.length, 1);
    assert.equal(savedMap1.atlas.actors[0].locationKey, 'dock');

    // Stale expectedRevision must be rejected without clobbering revision 1
    await assert.rejects(
        () => Promise.resolve(controller.handleMessage({
            type: 'map/update-data',
            payload: { chatIdentity, expectedRevision: 0, map: base },
        })),
    );
    assert.equal(harness.map.readCurrent().map?.revision, 1);

    // Invalid map payload (link referencing missing location) must be rejected by parseMapDomain
    await assert.rejects(
        () => Promise.resolve(controller.handleMessage({
            type: 'map/update-data',
            payload: {
                chatIdentity,
                expectedRevision: 1,
                map: {
                    ...savedMap1,
                    atlas: {
                        ...savedMap1.atlas,
                        links: [{ id: 'bad-link', from: 'harbor', to: 'ghost', kind: 'road', bidirectional: true }],
                    },
                },
            },
        })),
    );
    assert.equal(harness.map.readCurrent().map?.revision, 1);

    // Removing a location along with its dependent links and moving actor persists cleanly at revision 2
    const pruned = {
        ...savedMap1,
        atlas: {
            locations: [{ key: 'harbor', name: '港区', scale: 'region', status: 'visited', features: [{ name: '灯塔', state: '熄灭' }] }],
            links: [],
            actors: [{ actorKey: 'player', displayName: '旅人', locationKey: 'harbor' }],
        },
    };
    const res2 = await controller.handleMessage({
        type: 'map/update-data',
        payload: { chatIdentity, expectedRevision: 1, map: pruned },
    }) as MapClientState;
    assert.ok(res2.map);
    assert.equal(res2.map.revision, 2);
    assert.equal(res2.map.atlas.locations.length, 1);
    assert.equal(res2.map.atlas.links.length, 0);
    assert.equal(res2.map.atlas.actors[0].locationKey, 'harbor');
});
