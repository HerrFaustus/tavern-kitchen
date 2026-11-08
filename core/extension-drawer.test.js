import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import manifest from '../manifest.json' with { type: 'json' };
import { setImmediate } from 'node:timers/promises';
import { createKitchenWorkspace } from './kitchen-workspace.js';
import { createExtensionDrawer, createPanelSettings } from './extension-drawer.js';

test('extension entry uses the native inline drawer and opens the workspace', () => {
    const { document } = parseHTML('<html><body><div id="extensions_settings"></div></body></html>');
    let opened = 0;
    const container = createExtensionDrawer({ doc: document, onOpen: () => { opened++; } });
    document.querySelector('#extensions_settings').append(container);
    assert.equal(container.className, 'extension_container');
    assert.equal(container.querySelector('.inline-drawer-toggle.inline-drawer-header b').textContent, '酒馆后厨');
    assert.ok(container.querySelector('.inline-drawer-content'));
    const button = container.querySelector('.inline-drawer-content button.menu_button');
    assert.equal(button.textContent, '打开后厨');
    const content = container.querySelector('.inline-drawer-content');
    assert.equal(content.childElementCount, 4);
    assert.equal(content.children[1].textContent, '版本 ' + manifest.version);
    assert.equal(content.children[3].textContent, '后厨教程（待做）');
    assert.equal(content.children[3].disabled, true);
    assert.equal(content.querySelector('input, select, a'), null);
    button.click();
    assert.equal(opened, 1);
});

test('the drawer opens panel settings when all features are disabled and a panel can be restored', async () => {
    const { document, Event } = parseHTML('<html><body><div id="top-settings-holder"></div></body></html>');
    const workspace = createKitchenWorkspace({ documentTarget:document });
    let enabled = false;
    const panelSettings = createPanelSettings({
        doc:document, enabled:true, panels:[{id:'map',label:'地图',checked:false}],
        onPanelChange(id, checked) { enabled = checked; configure(); },
    });
    function configure() {
        workspace.configure({panelSettings, visiblePanel:id => id === 'map' && enabled, actions:{map(){}}});
    }
    configure();
    const drawer = createExtensionDrawer({doc:document, onOpen:() => workspace.open()});
    drawer.querySelector('button').click();
    await setImmediate();
    assert.equal(document.querySelector('#tk-workspace').classList.contains('openDrawer'), true);
    assert.equal(panelSettings.open, true);
    const checkbox = panelSettings.querySelector('[data-panel="map"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await setImmediate();
    assert.equal(workspace.isActive('map'), true);
    assert.equal(document.querySelector('.tk-workspace-body').hidden, false);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    assert.equal(document.querySelector('.tk-workspace-body').hidden, true);
    assert.equal(document.querySelector('#tk-topbar').hidden, false);
});
