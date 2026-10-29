import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { startKitchenBootstrap } from './kitchen-bootstrap.js';

test('entry is mounted before a delayed runtime and survives late native buttons and toolbar replacement', async () => {
    const { document } = parseHTML('<html><body><div id="top-settings-holder"><div id="persona-management-button"></div></div></body></html>');
    let resolveRuntime;
    let started = false;
    const pending = new Promise(resolve => { resolveRuntime = resolve; });
    const { workspace, ready } = startKitchenBootstrap({ documentTarget: document, loadRuntime: () => pending });
    const entry = document.getElementById('tk-topbar');
    assert.ok(entry, 'the icon exists before runtime download or settings I/O');
    await workspace.open();
    assert.equal(workspace.isActive('world'), true);
    assert.match(workspace.getMount('world').textContent, /正在加载/);
    assert.equal(started, false);
    const characters = document.createElement('div'); characters.id = 'rightNavHolder';
    entry.parentElement.append(characters);
    await setImmediate();
    assert.equal(entry.nextElementSibling, characters);
    const replacement = document.createElement('div'); replacement.id = 'top-settings-holder';
    entry.parentElement.replaceWith(replacement);
    await setImmediate();
    assert.equal(document.getElementById('tk-topbar'), entry);
    assert.equal(entry.parentElement, replacement);
    resolveRuntime({ startKitchen(kitchen) {
        started = true;
        kitchen.configure({ settingsElement: document.createElement('div'), actions: { world() {
            const result = document.createElement('p'); result.textContent = '总览已加载';
            kitchen.getMount('world').append(result);
        } } });
    } });
    await ready; await setImmediate();
    assert.equal(started, true);
    assert.equal(document.querySelectorAll('#tk-topbar').length, 1);
    assert.match(workspace.getMount('world').textContent, /总览已加载/);
    workspace.failStartup(new Error('fixture unavailable'));
    assert.match(workspace.getMount('settings').textContent, /重新加载/);
    assert.equal(document.querySelectorAll('#tk-topbar').length, 1, 'loading failures never remove the native entry');
});
