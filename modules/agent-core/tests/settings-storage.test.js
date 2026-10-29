import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exercise the default dynamic import, not an injected storage double: this is
// the path used by the memory assistant and must share the API page's file.
test('default shared agent settings read and save the retained Agent API storage', async t => {
    const result = await build({
        entryPoints: [fileURLToPath(new URL('../settings-repository.js', import.meta.url))],
        bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
        plugins: [{ name: 'host-storage-contract', setup(builder) {
            builder.onResolve({ filter: /\/(script|utils)\.js$/ }, () => ({ path: 'host', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const getRequestHeaders = () => ({}); export const debounce = fn => fn;' }));
        } }],
    });
    // eslint-disable-next-line no-unsanitized/method -- Executes repository code bundled with a local host-contract fixture.
    const repository = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    const files = new Map();
    const reads = [];
    t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
        if (url === '/api/files/upload') {
            const { name, data } = JSON.parse(options.body);
            files.set(name, JSON.parse(Buffer.from(data, 'base64').toString()));
            return new Response('{}');
        }
        reads.push(url);
        return new Response('', { status: 404 });
    });
    const config = await repository.loadSharedAgentSettings();
    assert.ok(config.presets);
    assert.deepEqual(reads, ['/user/files/TavernKitchen_AgentApi.json']);
    const saved = await repository.saveSharedAgentSettings({ ...config, currentPresetName: '本地预设' });
    assert.equal(saved.ok, true);
    assert.equal(files.size, 1);
    assert.equal(files.get('TavernKitchen_AgentApi.json').settings.currentPresetName, saved.config.currentPresetName);
});
