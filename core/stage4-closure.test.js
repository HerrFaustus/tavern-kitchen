import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import http from 'node:http';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { parseHTML } from 'linkedom';

import {
    createLocalFileMirror,
    isFileUploadUnsupportedStatus,
} from '../shared/common/local-file-mirror.js';
import { StorageFile } from './storage-file.js';
import {
    createSillyTavernFileStorage,
    createSillyTavernUserJsonFilePort,
} from '../modules/xiaobai-os/storage/sillytavern-file-storage.js';
import {
    createMetadataConfirmation,
    MetadataConfirmationError,
} from '../modules/story-summary/data/metadata-confirmation.js';
import { EXT_ID } from './constants.js';
import {
    clearEndpointTokenParamCache,
    detectFallbackTokenLimitParam,
    getCachedTokenLimitParam,
    isRetryableTransientError,
    redactApiKeySecrets,
    runWithRetry,
} from '../modules/agent-core/runtime/retry-policy.js';
import { OpenAICompatibleAdapter } from '../modules/agent-core/adapters/openai-compatible.js';
import { generateText, testTextConnection } from '../modules/text-api/runtime.js';
import { createExtensionDrawer } from './extension-drawer.js';
import { openKitchenTutorial, TUTORIAL_SECTIONS } from './kitchen-tutorial.js';
import {
    inspectVectorUpgradeCompatibility,
    pruneOrphanFloorWork,
    runUpgradeSelfCheck,
    validateWorldCoinsFields,
} from './upgrade-selfcheck.js';

async function withHttpServer(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}

test('Stage 4 (14A): StorageFile falls back to IndexedDB mirror on 404/405/501 and syncs back on 200', async t => {
    assert.equal(isFileUploadUnsupportedStatus(404), true);
    assert.equal(isFileUploadUnsupportedStatus(405), true);
    assert.equal(isFileUploadUnsupportedStatus(501), true);
    assert.equal(isFileUploadUnsupportedStatus(500), false);

    const mirror = createLocalFileMirror({ indexedDB: new IDBFactory(), dbName: 'TK_Test_StorageFile' });
    t.after(() => mirror.close());

    let hostSupportsUpload = false;
    const serverFiles = new Map();
    const mockFetch = async (url, options = {}) => {
        if (url === '/api/files/upload') {
            if (!hostSupportsUpload) {
                return new Response('Method Not Allowed', { status: 405 });
            }
            const parsed = JSON.parse(options.body);
            serverFiles.set(parsed.name, Buffer.from(parsed.data, 'base64').toString('utf8'));
            return Response.json({ ok: true });
        }
        if (url.startsWith('/user/files/')) {
            const name = url.slice('/user/files/'.length);
            if (!hostSupportsUpload || !serverFiles.has(name)) {
                return new Response('Not Found', { status: 404 });
            }
            return new Response(serverFiles.get(name), { status: 200 });
        }
        return new Response('Unexpected', { status: 500 });
    };

    const storage = new StorageFile('tk_mirror_test.json', {
        fetch: mockFetch,
        localMirror: mirror,
        maxRetries: 1,
    });
    await storage.load();
    await storage.setAndSave('alpha', { count: 42 });
    assert.equal(storage.usingLocalMirror(), true);

    const reloaded = new StorageFile('tk_mirror_test.json', {
        fetch: mockFetch,
        localMirror: mirror,
        maxRetries: 1,
    });
    const data = await reloaded.load();
    assert.deepEqual(data.alpha, { count: 42 });
    assert.equal(reloaded.usingLocalMirror(), true);

    hostSupportsUpload = true;
    await reloaded.setAndSave('beta', { count: 99 });
    assert.equal(reloaded.usingLocalMirror(), false);
    assert.equal(await mirror.get('tk_mirror_test.json'), null);
    assert.equal(JSON.parse(serverFiles.get('tk_mirror_test.json')).beta.count, 99);
});

test('Stage 4 (14A): SillyTavern JSON & Sidecar storage preserve CAS conflict safety on IndexedDB fallback', async t => {
    const mirror = createLocalFileMirror({ indexedDB: new IDBFactory(), dbName: 'TK_Test_Sidecar' });
    t.after(() => mirror.close());

    const unsupportedFetch = async () => new Response('Not Implemented', { status: 501 });
    const jsonPort = createSillyTavernUserJsonFilePort({ fetch: unsupportedFetch, localMirror: mirror });
    await jsonPort.replace('custom_state.json', { ok: true, items: ['a', 'b'] });
    assert.deepEqual(await jsonPort.read('custom_state.json'), { ok: true, items: ['a', 'b'] });

    const sidecarPort = createSillyTavernFileStorage({ fetch: unsupportedFetch, localMirror: mirror });
    const envelope1 = {
        formatVersion: 1,
        osId: 'os_test_1',
        binding: { kind: 'character', ownerLocator: 'alice.png', chatId: 'chat-1' },
        revision: 1,
        commitId: 'commit_1',
        partitions: { world: { tick: 1 } },
    };
    const write1 = await sidecarPort.replace({ expected: null, candidate: envelope1 });
    assert.equal(write1.status, 'confirmed');
    assert.equal((await sidecarPort.read('os_test_1'))?.revision, 1);

    const conflictAttempt = await sidecarPort.replace({
        expected: null,
        candidate: { ...envelope1, revision: 2, commitId: 'commit_2' },
    });
    assert.equal(conflictAttempt.status, 'conflict');

    const write2 = await sidecarPort.replace({
        expected: envelope1,
        candidate: { ...envelope1, revision: 2, commitId: 'commit_2' },
    });
    assert.equal(write2.status, 'confirmed');
    assert.equal(await sidecarPort.delete('os_test_1'), 'deleted');
    assert.equal(await sidecarPort.delete('os_test_1'), 'missing');
});

test('Stage 4 (14A): Metadata confirmation degrades cleanly after settled saveMetadata on missing endpoint or large chat, never hiding real save failures', async () => {
    const context = {
        chatId: 'chat-confirm-test',
        characterId: 0,
        characters: [{ name: 'Alice', chat: 'Alice - 1', avatar: 'alice.png' }],
    };
    const expected = { storySummary: { summaryHistory: [{ id: 's1' }] } };
    const previous = { storySummary: { summaryHistory: [] } };

    const missingEndpointConfirm = createMetadataConfirmation(context, () => ({}), async () => new Response('Not Found', { status: 404 }));
    const settledOk = await missingEndpointConfirm(expected, previous, null, {
        allowSettledDegrade: () => true,
        savePending: () => false,
    });
    assert.deepEqual(settledOk, expected);

    await assert.rejects(
        missingEndpointConfirm(expected, previous, null, {
            timeoutMs: 80,
            allowSettledDegrade: () => false,
            savePending: () => false,
        }),
        MetadataConfirmationError,
    );

    const largeChatHangingConfirm = createMetadataConfirmation(
        context,
        () => ({}),
        () => Promise.reject(Object.assign(new Error('network timeout'), { code: 'ETIMEDOUT' })),
    );
    const largeOk = await largeChatHangingConfirm(expected, previous, null, {
        allowSettledDegrade: () => true,
        isLargeChat: true,
        savePending: () => false,
    });
    assert.deepEqual(largeOk, expected);

    const largeNotSavedConfirm = createMetadataConfirmation(
        context,
        () => ({}),
        async () => Response.json([{ chat_metadata: { extensions: { [EXT_ID]: previous } } }]),
    );
    await assert.rejects(
        largeNotSavedConfirm(expected, previous, null, {
            allowSettledDegrade: () => true,
            isLargeChat: true,
            savePending: () => false,
        }),
        err => err instanceof MetadataConfirmationError && err.code === 'metadata_not_saved',
    );
});

test('Stage 4 (15A): Retry policy handles bounded transient backoff, skips 401/abort/probe, auto-swaps token params & redacts secrets', async t => {
    clearEndpointTokenParamCache();
    t.after(() => clearEndpointTokenParamCache());

    assert.equal(isRetryableTransientError({ status: 429 }), true);
    assert.equal(isRetryableTransientError({ status: 503 }), true);
    assert.equal(isRetryableTransientError({ status: 401 }), false);
    assert.equal(isRetryableTransientError({ status: 403 }), false);

    let flakyAttempts = 0;
    const retriedValue = await runWithRetry(
        async () => {
            flakyAttempts += 1;
            if (flakyAttempts < 3) {
                throw Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '0' } });
            }
            return 'ok';
        },
        { baseDelayMs: 5, maxDelayMs: 10, maxRetries: 2 },
    );
    assert.equal(retriedValue, 'ok');
    assert.equal(flakyAttempts, 3);

    let authAttempts = 0;
    await assert.rejects(
        runWithRetry(
            async () => {
                authAttempts += 1;
                throw Object.assign(new Error('invalid api key'), { status: 401 });
            },
            { baseDelayMs: 5, maxRetries: 2 },
        ),
    );
    assert.equal(authAttempts, 1);

    const secret = 'sk-super/secret+token=99';
    const cleaned = redactApiKeySecrets(
        `fail key=${secret} enc=${encodeURIComponent(secret)} Authorization: Bearer live-token-abc https://x.test?key=qsecret`,
        secret,
    );
    assert.equal(cleaned.includes(secret), false);
    assert.equal(cleaned.includes(encodeURIComponent(secret)), false);
    assert.equal(cleaned.includes('live-token-abc'), false);
    assert.equal(cleaned.includes('qsecret'), false);

    assert.equal(
        detectFallbackTokenLimitParam({
            status: 400,
            message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        }),
        'max_completion_tokens',
    );
    assert.equal(
        detectFallbackTokenLimitParam({
            status: 400,
            body: JSON.stringify({ error: { message: 'Unknown parameter: max_completion_tokens', param: 'max_completion_tokens' } }),
        }),
        'max_tokens',
    );

    const seenBodies = [];
    const baseUrl = await withHttpServer(t, (req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            seenBodies.push(parsed);
            if (parsed.max_tokens !== undefined) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: {
                        message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
                        type: 'invalid_request_error',
                        param: 'max_tokens',
                    },
                }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: 'chatcmpl-test',
                model: parsed.model,
                choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'pong' } }],
                usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
            }));
        });
    });

    const adapter = new OpenAICompatibleAdapter({
        baseUrl: `${baseUrl}/v1`,
        model: 'custom-gateway-model',
        apiKey: '',
    });
    const first = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 64 });
    assert.equal(first.text, 'pong');
    assert.equal(seenBodies.length, 2);
    assert.equal(seenBodies[0].max_tokens, 64);
    assert.equal(seenBodies[1].max_completion_tokens, 64);
    assert.equal(seenBodies[1].max_tokens, undefined);
    assert.equal(getCachedTokenLimitParam(`${baseUrl}/v1`, 'custom-gateway-model'), 'max_completion_tokens');

    const second = await adapter.chat({ messages: [{ role: 'user', content: 'hi again' }], maxTokens: 32 });
    assert.equal(second.text, 'pong');
    assert.equal(seenBodies.length, 3);
    assert.equal(seenBodies[2].max_completion_tokens, 32);

    let probeCalls = 0;
    const probeUrl = await withHttpServer(t, (_req, res) => {
        probeCalls += 1;
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'busy' } }));
    });
    const preset = {
        id: 'p-probe',
        name: 'Probe',
        kind: 'text',
        provider: 'openai-compatible',
        baseUrl: `${probeUrl}/v1`,
        prefixMode: 'auto',
        customPrefix: '',
        apiKey: '',
        model: 'fixture-model',
        stream: false,
    };
    await assert.rejects(testTextConnection(preset));
    assert.equal(probeCalls, 1);

    let recoveredAttempts = 0;
    const retryUrl = await withHttpServer(t, (_req, res) => {
        recoveredAttempts += 1;
        if (recoveredAttempts === 1) {
            res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
            res.end(JSON.stringify({ error: { message: 'transient 503' } }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            id: 'chatcmpl-retry',
            model: 'fixture-model',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'recovered' } }],
        }));
    });
    const recovered = await generateText({ ...preset, baseUrl: `${retryUrl}/v1` }, {
        messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(recovered.text, 'recovered');
    assert.equal(recoveredAttempts, 2);
});

test('Stage 4 (15A Vacuum 4): Offline interactive tutorial drawer opens from extension drawer, switches tabs & stays offline', () => {
    const { document } = parseHTML('<html><body><div id="extensions_settings"></div></body></html>');
    const drawer = createExtensionDrawer({ doc: document });
    document.querySelector('#extensions_settings').append(drawer);

    const tutorialBtn = drawer.querySelectorAll('.inline-drawer-content button.menu_button')[1];
    assert.equal(tutorialBtn.textContent, '后厨教程');
    assert.equal(tutorialBtn.disabled, false);

    tutorialBtn.click();
    const dialog = document.getElementById('tk-tutorial-dialog');
    assert.ok(dialog);
    assert.equal(dialog.hasAttribute('open'), true);
    assert.equal(dialog.querySelector('.tk-tutorial-step').textContent, `1 / ${TUTORIAL_SECTIONS.length}`);
    assert.equal(dialog.querySelectorAll('[href^="http"], [src^="http"]').length, 0);

    const nextBtn = Array.from(dialog.querySelectorAll('button')).find(btn => btn.textContent === '下一节');
    nextBtn.click();
    assert.equal(dialog.querySelector('.tk-tutorial-step').textContent, `2 / ${TUTORIAL_SECTIONS.length}`);
    assert.equal(dialog.querySelector('.tk-tutorial-section-title').textContent, TUTORIAL_SECTIONS[1].title);

    const secondOpen = openKitchenTutorial({ doc: document, initialSectionId: 'diagnostics' });
    assert.equal(secondOpen, dialog);
    assert.equal(document.querySelectorAll('#tk-tutorial-dialog').length, 1);
    assert.equal(dialog.querySelector('.tk-tutorial-step').textContent, `4 / ${TUTORIAL_SECTIONS.length}`);
});

test('Stage 4 (15A Vacuum 5): Upgrade self-check prunes orphan floorWork idempotently and flags coins/vector issues non-destructively', async () => {
    const chat = [
        { is_user: true, mes: 'Hi' },
        { is_user: false, mes: 'Welcome' },
        { is_user: false, mes: 'Second reply' },
    ];
    const storySummary = {
        floorWork: {
            0: { done: ['overview'], source: { start: 0, end: 0, digest: 'u' } },
            1: { done: ['overview', 'memory'], source: { start: 1, end: 1, digest: 'ok' } },
            2: { done: [] },
            99: { done: ['overview'], source: { start: 99, end: 99, digest: 'stale' } },
            badKey: { done: ['memory'] },
        },
    };
    const worldState = {
        entities: [
            { id: 'hero', name: '主角', fields: { coins: { value: -15 } } },
            { id: 'npc1', name: '老板', fields: { coins: { value: 250 } } },
            { id: 'npc2', name: '旅人', fields: { coins: '50铜币' } },
        ],
    };

    const coinValidation = validateWorldCoinsFields(worldState);
    assert.equal(coinValidation.ok, false);
    assert.equal(coinValidation.invalidCoins.length, 2);
    assert.equal(worldState.entities[0].fields.coins.value, -15);

    const vectorCheck = inspectVectorUpgradeCompatibility({ dimsMismatch: true, fingerprintMismatch: true });
    assert.equal(vectorCheck.ok, false);
    assert.equal(vectorCheck.needsRebuild, true);

    let persistedCount = 0;
    const firstPass = await runUpgradeSelfCheck({
        storySummary,
        chat,
        worldState,
        vectorStatus: { dimsMismatch: true, fingerprintMismatch: true },
        onPruneFloorWork: () => { persistedCount += 1; },
    });
    assert.equal(persistedCount, 1);
    assert.deepEqual(firstPass.prunedFloors.sort(), ['0', '2', '99', 'badKey'].sort());
    assert.deepEqual(Object.keys(storySummary.floorWork), ['1']);
    assert.equal(firstPass.ok, false);
    assert.equal(firstPass.notices.length, 3);

    const secondPass = await runUpgradeSelfCheck({
        storySummary,
        chat,
        worldState,
        vectorStatus: { dimsMismatch: true, fingerprintMismatch: true },
        onPruneFloorWork: () => { persistedCount += 1; },
    });
    assert.equal(persistedCount, 1);
    assert.deepEqual(secondPass.prunedFloors, []);

    const orphanCleanup = pruneOrphanFloorWork({ floorWork: { 5: { done: ['overview'] } } }, []);
    assert.equal(orphanCleanup.changed, true);
    assert.deepEqual(orphanCleanup.prunedFloors, ['5']);
});
