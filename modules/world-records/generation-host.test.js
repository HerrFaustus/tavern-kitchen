import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createTestModuleUrl } from '../story-summary/tests/helpers/bundle-module.js';

test('native generation reads authority before memory, clears quiet/changed-chat prompts and stops on failed reads', async t => {
    const prompts = {}; globalThis.__worldPromptTest = { prompts };
    t.after(() => { delete globalThis.__worldPromptTest; delete globalThis.tavernKitchenGenerateInterceptor; });
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const built = await build({ stdin: { resolveDir: root, contents: `
export * from './modules/world-records/generation-host.js';
export {registerGenerateInterceptor,unregisterGenerateInterceptor} from './shared/common/generate-interceptor.js';` },
    bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'host', setup(api) {
        api.onResolve({ filter: /(?:script|debug-core)\.js$/ }, args => ({ path: args.path.endsWith('script.js') ? 'script' : 'debug', namespace: 'host' }));
        api.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: args.path === 'script'
            ? 'export const extension_prompts=globalThis.__worldPromptTest.prompts;export const extension_prompt_types={IN_CHAT:1};export const extension_prompt_roles={SYSTEM:0};'
            : 'export const xbLog={warn(){}};' }));
    } }] });
    // eslint-disable-next-line no-unsanitized/method -- Generated local test bundle with fixed host shims; no external source.
    const mod = await import(await createTestModuleUrl(built.outputFiles[0].text));
    let reads = 0, failed = false; const errors = [], order = [];
    mod.registerGenerateInterceptor('probe-before', () => order.push('before'), 100);
    const dispose = mod.installWorldAuthorityGeneration({ getContext: () => ({ chat: [{ mes: '铁匠' }] }),
        prepare: async query => { reads++; order.push('world'); assert.equal(query, '铁匠'); if (failed) throw Error('storage unavailable'); return '已确认：金币70'; },
        onError: error => errors.push(error.message) });
    mod.registerGenerateInterceptor('probe-memory', () => order.push('memory'), 200);
    t.after(() => { dispose(); mod.unregisterGenerateInterceptor('probe-before'); mod.unregisterGenerateInterceptor('probe-memory'); });
    const aborted = [];
    await globalThis.tavernKitchenGenerateInterceptor([], 0, value => aborted.push(value), 'normal');
    assert.deepEqual(order, ['before', 'world', 'memory']);
    assert.equal(prompts.tavernKitchenWorldAuthority.value, '已确认：金币70');
    assert.equal(prompts.tavernKitchenWorldAuthority.depth, 1);
    await globalThis.tavernKitchenGenerateInterceptor([], 0, value => aborted.push(value), 'quiet');
    assert.equal(reads, 1); assert.equal(prompts.tavernKitchenWorldAuthority, undefined);
    await globalThis.tavernKitchenGenerateInterceptor([], 0, value => aborted.push(value), 'normal');
    dispose.clear(); assert.equal(prompts.tavernKitchenWorldAuthority, undefined);
    order.length = 0; failed = true;
    await globalThis.tavernKitchenGenerateInterceptor([], 0, value => aborted.push(value), 'normal');
    assert.deepEqual(order, ['before', 'world']); assert.deepEqual(aborted, [true]);
    assert.equal(prompts.tavernKitchenWorldAuthority, undefined); assert.deepEqual(errors, ['storage unavailable']);
});
