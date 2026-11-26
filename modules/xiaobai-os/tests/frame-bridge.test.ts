import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createDirectXiaobaiOsBridge, type XiaobaiOsDirectBridgeOptions } from '../host/direct-bridge.js';

function harness(t: TestContext, callbacks: Partial<XiaobaiOsDirectBridgeOptions> = {}) {
    const bridge = createDirectXiaobaiOsBridge(callbacks);
    t.after(() => bridge.dispose());
    const client = bridge.clientBridge!;
    return {
        bridge,
        client,
        send(type: string, payload: unknown = {}) {
            client.post(type, payload);
        },
    };
}

test('direct bridge callbacks log sync throws and async rejections instead of leaving rejected tasks', async t => {
    const log = t.mock.method(console, 'error', () => undefined);
    const readyError = new Error('ready failed');
    const messageError = new Error('message failed');
    const h = harness(t, {
        onReady: () => { throw readyError; },
        onMessage: async () => { throw messageError; },
    });
    h.send('os/frame-ready');
    await setImmediate();
    h.send('app/request');
    await setImmediate();
    assert.deepEqual(log.mock.calls.map(call => call.arguments[1]), [readyError, messageError]);
});

test('premature and disposed direct bridge messages never invoke callbacks or report failures', async t => {
    const log = t.mock.method(console, 'error', () => undefined);
    const calls: string[] = [];
    const h = harness(t, {
        onReady: () => { calls.push('ready'); },
        onMessage: message => { calls.push(message.type); },
    });
    h.send('app/request');
    await setImmediate();
    assert.equal(h.bridge.isReady(), false);
    h.send('os/frame-ready');
    await setImmediate();
    assert.equal(h.bridge.isReady(), true);
    h.send('app/accepted');
    await setImmediate();
    h.bridge.dispose();
    h.send('app/late');
    await setImmediate();
    assert.deepEqual(calls, ['ready', 'app/accepted']);
    assert.equal(log.mock.callCount(), 0);
});
