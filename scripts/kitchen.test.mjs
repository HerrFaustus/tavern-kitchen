import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pluginRoot, hostPathForImport, servedHostImport } from './host/paths.mjs';
import { PROMPT_INJECTION_POLICY } from '../modules/xiaobai-os/host/prompt-injection-policy.ts';
import { createDefaultXiaobaiOsSettings, normalizeXiaobaiOsSettings } from '../modules/xiaobai-os/host/settings-normalization.ts';

test('deployment paths survive a shallow source checkout and a renamed install directory', () => {
    assert.equal(hostPathForImport(path.join(pluginRoot, 'plugin-entry.js'), '../../../extensions.js'), 'public/scripts/extensions.js');
    assert.equal(hostPathForImport(path.join(pluginRoot, 'modules/xiaobai-os/host/production-composition.ts'), '../../../../../../../script.js'), 'public/script.js');
    assert.equal(hostPathForImport(path.join(pluginRoot, 'plugin-entry.js'), './core/constants.js'), null);
    const deployedChunk = 'https://local.test/scripts/extensions/third-party/custom-kitchen/dist/host/plugin.js';
    assert.equal(new URL(servedHostImport('host/plugin.js', 'public/script.js'), deployedChunk).pathname, '/script.js');
    assert.throws(() => hostPathForImport(path.join(pluginRoot, 'plugin-entry.js'), '../../../../../../private.json'));
});

test('new installs leave autonomous model calls disabled and the shipped app set contains no removed products', () => {
    const defaults = createDefaultXiaobaiOsSettings();
    assert.equal(defaults.apps.map.autoMaintenance, false);
    assert.equal(defaults.apps.world.subscribed, false);
    const host = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'modules/xiaobai-os/host/app-catalog.json')));
    const shell = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'modules/xiaobai-os/shell/app-catalog.json')));
    assert.deepEqual(new Set(host), new Set(['map', 'world', 'agent-api']));
    assert.deepEqual(shell, host);
});

test('legacy action check settings cannot enable a check prompt', () => {
    const loaded = normalizeXiaobaiOsSettings({ apps: { dice: { actionChecksEnabled: true } } });
    assert.equal(Object.hasOwn(loaded.apps,'dice'), false);
    assert.ok(PROMPT_INJECTION_POLICY.every(group => !group.id.startsWith('dice')));
});
