import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { resolveStateInjectionDepth } from './authority.js';
import { createTestModuleUrl } from '../story-summary/tests/helpers/bundle-module.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('resolveStateInjectionDepth places D1 when covered and D2 when latest AI turn is unsummarized or swiping', () => {
    const chat = [
        { is_user: true, mes: '你好' },
        { is_user: false, mes: '铁匠看向柜台。' },
        { is_user: true, mes: '继续' },
        { is_user: false, mes: '他又递出一枚银币。' },
        { is_user: true, mes: '收下' },
    ];
    // Covered through index 3 (latest AI) -> D1
    assert.equal(resolveStateInjectionDepth(chat, { enabled: true, store: { lastSummarizedMesId: 3 }, invalidFrom: null }, 'normal'), 1);
    // Covered only through index 1 (< latest AI at index 3) -> D2
    assert.equal(resolveStateInjectionDepth(chat, { enabled: true, store: { lastSummarizedMesId: 1 }, invalidFrom: null }, 'normal'), 2);
    // Swipe always resolves to D2 so state stays before regenerated turn
    assert.equal(resolveStateInjectionDepth(chat, { enabled: true, store: { lastSummarizedMesId: 3 }, invalidFrom: null }, 'swipe'), 2);
});

test('installWorldAuthorityGeneration applies dynamic depth from prepareInjection while keeping string default D1', async () => {
    const prompts = {};
    const interceptors = [];
    const shims = {
        'script.js': `
            export const extension_prompts = globalThis.__dualAxisPrompts;
            export const extension_prompt_types = { IN_CHAT: 1 };
            export const extension_prompt_roles = { SYSTEM: 0 };
        `,
        'shared/common/generate-interceptor.js': `
            export const GENERATE_INTERCEPTOR_ORDER = { STORY_SUMMARY: 100 };
            export const registerGenerateInterceptor = (_id, fn) => globalThis.__dualAxisInterceptors.push(fn);
            export const unregisterGenerateInterceptor = () => {};
        `,
        'modules/story-summary/generate/recall-policy.js': 'export const usesStoryRecall = () => true;',
    };
    globalThis.__dualAxisPrompts = prompts;
    globalThis.__dualAxisInterceptors = interceptors;

    const out = await build({
        entryPoints: [path.join(root, 'modules/world-records/generation-host.js')],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        plugins: [{
            name: 'dual-axis-shims',
            setup(buildCtx) {
                buildCtx.onResolve({ filter: /.*/ }, args => {
                    const target = args.path.startsWith('.')
                        ? path.resolve(args.resolveDir, args.path)
                        : path.join(root, args.path);
                    const rel = path.relative(root, target).replace(/\\/g, '/');
                    if (shims[rel]) return { path: rel, namespace: 'shim' };
                    if (args.path.endsWith('/script.js')) return { path: 'script.js', namespace: 'shim' };
                    return null;
                });
                buildCtx.onLoad({ filter: /.*/, namespace: 'shim' }, args => ({ contents: shims[args.path], loader: 'js' }));
            },
        }],
    });

    // eslint-disable-next-line no-unsanitized/method -- Generated local test bundle with fixed host shims; no external source.
    const { installWorldAuthorityGeneration } = await import(await createTestModuleUrl(out.outputFiles[0].text));
    const dispose = installWorldAuthorityGeneration({
        getContext: () => ({ chatId: 'c1', chat: [{ is_user: false, mes: '近况' }] }),
        prepare: async (_q, type) => ({ value: '已确认状态', depth: type === 'swipe' ? 2 : 1 }),
    });

    await interceptors[0]([], 0, () => {}, 'normal', { signal: new AbortController().signal });
    assert.equal(prompts.tavernKitchenWorldAuthority.value, '已确认状态');
    assert.equal(prompts.tavernKitchenWorldAuthority.depth, 1);

    await interceptors[0]([], 0, () => {}, 'swipe', { signal: new AbortController().signal });
    assert.equal(prompts.tavernKitchenWorldAuthority.depth, 2);

    dispose();
});
