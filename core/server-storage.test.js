import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { StorageFile } from './storage-file.js';

// Exercise the actual factory configuration without importing the browser host.
const code = transformSync(fs.readFileSync(new URL('./server-storage.js', import.meta.url), 'utf8'), { format: 'cjs' }).code;
function settingsStorage() {
    const module = { exports: {} };
    vm.runInNewContext(code, { module, require(name) {
        if (name === './storage-file.js') return { StorageFile };
        if (name.endsWith('/script.js')) return { getRequestHeaders: () => ({}) };
        if (name.endsWith('/utils.js')) return { debounce: fn => fn };
        throw new Error(`Unexpected storage dependency: ${name}`);
    } });
    return module.exports.CommonSettingStorage;
}

function pendingRead(t) {
    let finish;
    const response = new Promise(resolve => { finish = resolve; });
    t.mock.method(globalThis, 'fetch', async () => response);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const storage = settingsStorage();
    return { storage, finish: () => finish({ ok: true, status: 200, text: async () => '{"script":"original"}' }) };
}

test('production settings storage allows a successful read before five seconds', async t => {
    const { storage, finish } = pendingRead(t);
    const reading = storage.getStrict('script');
    await Promise.resolve();
    t.mock.timers.tick(4999);
    finish();
    assert.equal(await reading, 'original');
});

test('production settings storage times out at five seconds without publishing late data', async t => {
    const { storage, finish } = pendingRead(t);
    const reading = storage.getStrict('script');
    const rejected = assert.rejects(reading, { code: 'STORAGE_READ_TIMEOUT' });
    await Promise.resolve();
    t.mock.timers.tick(5000);
    await rejected;
    finish();
    await Promise.resolve();
    assert.equal(storage.getCacheSize(), 0);
});
