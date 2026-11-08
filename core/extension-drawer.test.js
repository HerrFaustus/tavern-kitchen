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

test('each panel can be enabled in place, even when all panels are off', async () => {
    const { document, Event } = parseHTML('<html><body><div id="top-settings-holder"></div></body></html>');
    const workspace = createKitchenWorkspace({documentTarget:document});
    const enabled = new Set();
    let opens = 0;
    function configure() {
        workspace.configure({
            visiblePanel:() => true,
            actions:{map:() => { opens++; }},
            panelSwitch:(id, label) => ({
                enabled:enabled.has(id), label:'启用' + label,
                change:checked => { if (checked) enabled.add(id); else enabled.delete(id); configure(); },
            }),
        });
    }
    configure();
    await workspace.open('map');
    const page = document.querySelector('[role="tabpanel"]');
    const toggle = () => page.querySelector('[data-panel="map"]');
    const body = page.querySelector('.tk-workspace-body');
    assert.ok(document.querySelector('#tk-workspace.fillRight'));
    assert.equal(document.querySelector('.tk-panel-settings'), null);
    assert.ok(body.nextElementSibling.classList.contains('tk-workspace-controls'));
    assert.ok(body.nextElementSibling.contains(toggle()), 'module controls remain below its content when disabled');
    assert.equal(body.contains(toggle()), false);
    assert.equal(toggle().getAttribute('aria-label'), '启用地图');
    assert.equal(body.hidden, true);
    assert.equal(workspace.isActive('map'), false);
    assert.equal(opens, 0);
    for (const checked of [true,false,true]) {
        toggle().checked = checked;
        toggle().dispatchEvent(new Event('change'));
        await setImmediate();
        assert.equal(body.hidden, !checked);
        assert.equal(workspace.isActive('map'), checked);
        assert.equal(toggle().checked, checked);
    }
    assert.equal(opens, 2);
    await workspace.open('people');
    assert.equal(page.querySelector('[data-panel="people"]').checked, false);
    assert.equal(body.hidden, true);
});
