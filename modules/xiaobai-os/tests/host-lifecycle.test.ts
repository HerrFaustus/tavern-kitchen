import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { createXiaobaiOsLifecycle, type XiaobaiOsLifecycleOptions } from '../host/lifecycle.js';
import type { XiaobaiOsFrameBridgeOptions } from '../host/frame-bridge.js';
import type { CapturedChatBinding } from '../kernel/contracts.js';

function harness(t: TestContext, options: XiaobaiOsLifecycleOptions = {}) {
    const { document, window } = parseHTML('<html><head></head><body><button id="send_but"></button></body></html>');
    // linkedom has no modal-dialog implementation; only lifecycle transitions are under test.
    const createElement = document.createElement.bind(document);
    t.mock.method(document, 'createElement', ((name: string) => {
        const element = createElement(name);
        if (name === 'dialog') {
            Object.assign(element, { showModal() {}, close() {} });
        }
        return element;
    }) as typeof document.createElement);
    let frameOptions: XiaobaiOsFrameBridgeOptions | undefined;
    const bridge = { post: () => true, isReady: () => true, dispose() {} };
    const lifecycle = createXiaobaiOsLifecycle({
        documentTarget: document as unknown as Document,
        windowTarget: window as unknown as Window,
        stylesheetHref: '/host.css', frameSrc: '/os.html',
        captureChatBinding: () => ({
            identityKey: 'chat-a', binding: { kind: 'character', ownerLocator: 'avatar.png', chatId: 'chat-a' }, reference: null,
        }),
        bridgeFactory: value => { frameOptions = value; return bridge; },
        ...options,
    });
    t.after(async () => { await lifecycle.cleanup(); });
    return { lifecycle, document, window, bridge, frameOptions: () => frameOptions };
}

test('panels and global API requests work without a chat; selecting a chat expires the old activation', async t => {
    let binding: CapturedChatBinding | null = null;
    let requests = 0;
    const h = harness(t, {
        captureChatBinding: () => binding,
        isChatBindingCurrent: () => { throw new Error('A global page must not require a chat binding'); },
        getAppDescriptors: () => [{ id: 'agent-api', name: '模型接口', description: '', accent: '' }],
        createActivationToken: () => 'api-session',
        appRuntime: { activate: async () => ({ status: 'ready' }), handleMessage: async () => { requests++; return { saved: true }; } },
    });
    const post = t.mock.method(h.bridge, 'post', () => true);
    h.lifecycle.init();
    assert.equal(h.lifecycle.open('agent-api'), true);
    await h.frameOptions()?.onMessage?.({ type: 'app/activate', requestId: 'open', payload: { appId: 'agent-api' } }, h.bridge);
    assert.equal((post.mock.calls.at(-1)?.arguments as unknown[])[0], 'app/activation-result');
    assert.equal(((post.mock.calls.at(-1)?.arguments as unknown[])[1] as { ok: boolean }).ok, true);
    const request = { type: 'agent-api/save', requestId: 'save', appId: 'agent-api', activationToken: 'api-session' };
    await h.frameOptions()?.onMessage?.(request, h.bridge);
    assert.equal(requests, 1);
    binding = { identityKey: 'chat-a', binding: { kind: 'character', ownerLocator: 'a.png', chatId: 'chat-a' }, reference: null };
    await h.frameOptions()?.onMessage?.(request, h.bridge);
    assert.equal(requests, 1, 'an old page cannot write after selecting a chat');
    assert.equal(((post.mock.calls.at(-1)?.arguments as unknown[])[1] as { error: string }).error, 'app_inactive');
});

test('embedded workspace opens inside its mount without adding a chat launcher or another modal', async t => {
    let mount: HTMLElement;
    const h = harness(t, { embeddedMount: () => mount, getAppDescriptors: () => [
        { id: 'map', name: '地图', description: '', accent: '#aaa' },
        { id: 'world', name: '世界', description: '', accent: '#aaa' },
    ] });
    mount = h.document.createElement('div') as unknown as HTMLElement;
    h.document.body.append(mount);
    h.lifecycle.init();
    assert.equal(h.document.getElementById('tavernKitchen-os-button'), null);
    assert.equal(h.lifecycle.open('map'), true);
    const frame = mount.querySelector('iframe');
    assert.ok(frame);
    assert.equal(frame.getAttribute('src'), '/os.html?embedded=1');
    const post = t.mock.method(h.bridge, 'post', () => true);
    assert.equal(h.lifecycle.open('world'), true);
    assert.equal(mount.querySelector('iframe'), frame);
    assert.deepEqual(post.mock.calls[0].arguments, ['os/navigate', { appId: 'world' }]);
    await h.lifecycle.closeWindow();
    assert.equal(mount.childElementCount, 0);
});

test('a failing background start and failing error owner are observed without adding a dialog', async t => {
    const log = t.mock.method(console, 'error', () => undefined);
    const error = new Error('background start failed');
    const reportingError = new Error('owner failed');
    const h = harness(t, {
        appRuntime: { startBackground: async () => { throw error; } },
        onError: () => { throw reportingError; },
    });
    assert.equal(h.lifecycle.init(), true);
    await setImmediate();
    assert.deepEqual(log.mock.calls[0].arguments[1], { error, reportingError });
    assert.equal(h.document.querySelectorAll('dialog').length, 0);
    await h.lifecycle.cleanup();
    assert.equal(h.lifecycle.isInitialized(), false);
});

test('window close and global cleanup report failures while completing the remaining release steps', async t => {
    const failures: unknown[] = [];
    const closedError = new Error('window close failed');
    const cancelError = new Error('cancel failed');
    const stopError = new Error('stop failed');
    const calls: string[] = [];
    const h = harness(t, {
        onError: error => { failures.push(error); },
        appRuntime: {
            handleWindowClosed: async () => { calls.push('closed'); throw closedError; },
            cancelAll: async () => { calls.push('cancel'); throw cancelError; },
            stopBackground: async () => { calls.push('stop'); throw stopError; },
        },
    });
    h.lifecycle.init();
    assert.equal(h.lifecycle.open(), true);
    assert.ok(h.frameOptions());
    await h.lifecycle.closeWindow();
    assert.equal(h.lifecycle.isOpen(), false);
    assert.deepEqual(failures, [closedError]);
    await h.lifecycle.cleanup();
    assert.ok(calls.includes('cancel'));
    assert.ok(calls.includes('stop'));
    assert.ok(failures.includes(cancelError));
    assert.ok(failures.includes(stopError));
    assert.equal(h.document.querySelectorAll('dialog').length, 0);
    assert.equal(h.document.getElementById('tavernKitchen-os-button'), null);
});

test('a failed window-open task is logged once and cannot publish a successful init snapshot', async t => {
    const error = new Error('window open failed');
    const failures: unknown[] = [];
    const h = harness(t, {
        onError: failure => { failures.push(failure); },
        appRuntime: { handleWindowOpened: async () => { throw error; } },
    });
    const post = t.mock.method(h.bridge, 'post', () => true);
    h.lifecycle.init();
    h.lifecycle.open();
    await h.frameOptions()?.onReady?.(h.bridge);
    await setImmediate();
    assert.deepEqual(failures, [error]);
    assert.equal(post.mock.callCount(), 1);
    // A failure response is still posted to the requester, never an init snapshot.
    assert.equal((post.mock.calls[0].arguments as unknown[])[0], 'os/error');
});
