import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { createKitchenWorkspace, getKitchenMount } from './kitchen-workspace.js';

test('one native workspace owns tabs, keeps the shared frame attached and recovers failed panels', async () => {
    const { document } = parseHTML('<html><head></head><body><div id="top-settings-holder"><div id="persona-management-button"></div></div></body></html>');
    const settingsElement = document.createElement('div');
    const calls = [];
    const workspace = createKitchenWorkspace({ documentTarget: document, settingsElement, actions: {
        memory: () => { calls.push('memory'); },
        planner: () => { throw new Error('请先启用规划'); },
        map: () => { calls.push('map'); },
        world: () => { calls.push('world'); },
    } });
    assert.equal(document.querySelectorAll('#tk-topbar').length, 1);
    assert.equal(document.querySelector('#persona-management-button').previousElementSibling.id, 'tk-topbar');
    workspace.open('memory');
    await setImmediate();
    assert.deepEqual(calls, ['memory']);
    assert.equal(document.querySelectorAll('[role="tab"]').length, 8);
    assert.equal(document.querySelector('[aria-selected="true"]').textContent, '记忆');
    workspace.open('memory');
    await setImmediate();
    assert.deepEqual(calls, ['memory']);
    workspace.open('map');
    const mount = getKitchenMount('map');
    const parent = mount.parentElement;
    const frame = document.createElement('iframe'); mount.append(frame);
    workspace.open('world');
    await setImmediate();
    assert.equal(getKitchenMount('world'), mount);
    assert.equal(mount.parentElement, parent, 'tab switches must not detach a live iframe');
    assert.equal(mount.firstElementChild, frame);
    assert.equal(mount.getAttribute('aria-labelledby'), 'tk-tab-world');
    workspace.open('planner');
    await setImmediate();
    assert.match(getKitchenMount('planner').textContent, /请先启用规划/);
    getKitchenMount('planner').querySelectorAll('button')[1].click();
    assert.equal(workspace.isActive('settings'), true);
    assert.equal(document.querySelectorAll('dialog').length, 0);
    workspace.close();
    assert.equal(document.querySelector('#tk-workspace').hidden, true);
    assert.equal(document.querySelector('#tk-topbar button').getAttribute('aria-expanded'), 'false');
    workspace.open('world');
    assert.equal(mount.firstElementChild, frame);
});
