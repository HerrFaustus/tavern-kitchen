import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
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
    assert.equal(button.textContent, '打开酒馆后厨');
    button.click();
    assert.equal(opened, 1);
});
