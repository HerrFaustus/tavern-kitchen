import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import manifest from '../manifest.json' with { type: 'json' };
import { setImmediate } from 'node:timers/promises';
import { createKitchenWorkspace } from './kitchen-workspace.js';
import { createExtensionDrawer } from './extension-drawer.js';

test('extension entry uses the native inline drawer and opens the workspace', () => {
    const { document } = parseHTML('<html><body><div id="extensions_settings"></div></body></html>');
    let opened = 0;
    let tutorialOpened = 0;
    const container = createExtensionDrawer({
        doc: document,
        onOpen: () => { opened++; },
        onTutorial: () => { tutorialOpened++; },
    });
    document.querySelector('#extensions_settings').append(container);
    assert.equal(container.className, 'extension_container');
    assert.equal(container.querySelector('.inline-drawer-toggle.inline-drawer-header b').textContent, '酒馆后厨');
    assert.ok(container.querySelector('.inline-drawer-content'));
    const button = container.querySelector('.inline-drawer-content button.menu_button');
    assert.equal(button.textContent, '打开后厨');
    const content = container.querySelector('.inline-drawer-content');
    assert.equal(content.childElementCount, 4);
    assert.equal(content.children[1].textContent, '版本 ' + manifest.version);
    assert.equal(content.children[3].textContent, '后厨教程');
    assert.equal(content.children[3].disabled, false);
    assert.equal(content.querySelector('input, select, a'), null);
    button.click();
    assert.equal(opened, 1);
    content.children[3].click();
    assert.equal(tutorialOpened, 1);
});

test('all panels open directly without panel switches and show the native titlebar', async () => {
    const { document } = parseHTML('<html><body><div id="top-settings-holder"></div></body></html>');
    const workspace = createKitchenWorkspace({ documentTarget: document });
    let opens = 0;
    workspace.configure({
        visiblePanel: () => true,
        actions: { map: () => { opens++; }, people: () => { opens++; } },
    });
    await workspace.open('map');
    const page = document.querySelector('[role="tabpanel"]');
    const body = page.querySelector('.tk-workspace-body');
    assert.ok(document.querySelector('#tk-workspace.fillRight'));
    assert.equal(document.querySelector('.tk-workspace-titlebar h3').textContent, '酒馆后厨');
    assert.equal(document.querySelector('.tk-panel-settings'), null);
    assert.equal(page.querySelector('[data-panel]'), null);
    assert.equal(body.hidden, false);
    assert.equal(workspace.isActive('map'), true);
    await setImmediate();
    assert.equal(opens, 1);
    await workspace.open('people');
    await setImmediate();
    assert.equal(opens, 2);
    assert.equal(workspace.isActive('people'), true);
    assert.equal(body.hidden, false);
});
