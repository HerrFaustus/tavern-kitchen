import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pluginRoot, hostPathForImport, servedHostImport } from './host/paths.mjs';
import { createDiceResultStorage } from '../modules/xiaobai-os/apps/dice/application/result-storage.ts';
import { createDefaultXiaobaiOsSettings } from '../modules/xiaobai-os/host/settings-normalization.ts';

test('deployment paths survive a shallow source checkout and a renamed install directory', () => {
    assert.equal(hostPathForImport(path.join(pluginRoot, 'plugin-entry.js'), '../../../extensions.js'), 'public/scripts/extensions.js');
    assert.equal(hostPathForImport(path.join(pluginRoot, 'modules/xiaobai-os/host/production-composition.ts'), '../../../../../../../script.js'), 'public/script.js');
    assert.equal(hostPathForImport(path.join(pluginRoot, 'plugin-entry.js'), './core/constants.js'), null);
    const deployedChunk = 'https://local.test/scripts/extensions/third-party/custom-kitchen/dist/host/plugin.js';
    assert.equal(new URL(servedHostImport('host/plugin.js', 'public/script.js'), deployedChunk).pathname, '/script.js');
    assert.throws(() => hostPathForImport(path.join(pluginRoot, 'plugin-entry.js'), '../../../../../../private.json'));
});

test('a failed dice cleanup keeps the published result; confirmed cleanup forgets only selected IDs', async () => {
    const snapshots = [];
    const forgotten = [];
    let status = 'unconfirmed';
    const store = { transact: async (update, options) => {
        update({ currentOrInitial: () => ({ sheet: { name: 'player' }, resultOverrides: { one: 1, two: 2 } }), replace: data => snapshots.push(data) });
        snapshots.push(options.signal);
        return { status };
    } };
    const service = createDiceResultStorage(store, { forget: ids => forgotten.push([...ids]) });
    await assert.rejects(service.clearResults(new Set(['one'])));
    assert.deepEqual(forgotten, []);
    assert.equal(snapshots[1].aborted, true);
    status = 'confirmed';
    await service.clearResults(new Set(['one']));
    assert.deepEqual(snapshots[2], { sheet: { name: 'player' }, resultOverrides: { two: 2 } });
    assert.deepEqual(forgotten, [['one']]);
});

test('new installs leave autonomous model calls disabled and the shipped app set contains no removed products', () => {
    const defaults = createDefaultXiaobaiOsSettings();
    assert.equal(defaults.apps.map.autoMaintenance, false);
    assert.equal(defaults.apps.world.subscribed, false);
    assert.equal(defaults.apps.dice.actionChecksEnabled, false);
    assert.equal(defaults.apps.dice.encountersEnabled, false);
    const host = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'modules/xiaobai-os/host/app-catalog.json')));
    const shell = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'modules/xiaobai-os/shell/app-catalog.json')));
    assert.deepEqual(new Set(host), new Set(['dice', 'map', 'world', 'agent-api']));
    assert.deepEqual(shell, host);
});
