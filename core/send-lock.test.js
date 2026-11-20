import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { installSendLock } from './send-lock.js';

function createFormDom() {
    const { document, Event } = parseHTML(`<!doctype html><html><body>
        <div id="form_sheld">
            <form id="send_form">
                <textarea id="send_textarea">继续前进</textarea>
                <button id="send_but" type="button" title="发送消息">发送</button>
            </form>
        </div>
    </body></html>`);
    return {
        document,
        Event,
        form: document.getElementById('send_form'),
        textarea: document.getElementById('send_textarea'),
        button: document.getElementById('send_but'),
    };
}

function keyEvent(EventCtor, props) {
    const ev = new EventCtor('keydown', { bubbles: true, cancelable: true });
    Object.assign(ev, props);
    return ev;
}

test('send lock blocks click, submit and Enter while locked and restores original button state on unlock', () => {
    const dom = createFormDom();
    const hostEvents = [];
    const blocked = [];

    let state = { locked: true, needsGate: false, reason: '总结正在进行中' };
    const lock = installSendLock({
        documentTarget: dom.document,
        getState: () => state,
        onBlocked: current => blocked.push(current.reason),
    });
    // Register host listeners on document after installSendLock (linkedom does not run
    // W3C capture-before-target, so registering on document verifies preventDefault +
    // stopImmediatePropagation cleanly in Node).
    dom.document.addEventListener('click', e => { if (!e.defaultPrevented) hostEvents.push('click'); });
    dom.document.addEventListener('submit', e => { if (!e.defaultPrevented) hostEvents.push('submit'); });
    dom.document.addEventListener('keydown', e => { if (!e.defaultPrevented && e.key === 'Enter') hostEvents.push('enter'); });

    assert.equal(dom.button.dataset.tkSendLocked, 'true');
    assert.equal(dom.button.getAttribute('aria-disabled'), 'true');
    assert.equal(dom.button.getAttribute('title'), '总结正在进行中');

    dom.button.dispatchEvent(new dom.Event('click', { bubbles: true, cancelable: true }));
    dom.form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }));
    dom.textarea.dispatchEvent(keyEvent(dom.Event, { key: 'Enter' }));
    assert.deepEqual(hostEvents, []);
    assert.equal(blocked.length, 3);

    // Shift+Enter, IME composing, and slash commands are never intercepted.
    dom.textarea.dispatchEvent(keyEvent(dom.Event, { key: 'Enter', shiftKey: true }));
    dom.textarea.dispatchEvent(keyEvent(dom.Event, { key: 'Enter', isComposing: true }));
    dom.textarea.value = '/help';
    dom.button.dispatchEvent(new dom.Event('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(hostEvents, ['enter', 'enter', 'click']);

    // Unlock restores the native title and allows normal clicks again.
    dom.textarea.value = '继续前进';
    state = { locked: false, needsGate: false, reason: '' };
    lock.sync();
    assert.equal(dom.button.dataset.tkSendLocked, undefined);
    assert.equal(dom.button.getAttribute('aria-disabled'), null);
    assert.equal(dom.button.getAttribute('title'), '发送消息');

    dom.button.dispatchEvent(new dom.Event('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(hostEvents, ['enter', 'enter', 'click', 'click']);
    lock.dispose();
});

test('send lock intercepts pre-send gate and replays exactly once after settlement succeeds', async () => {
    const dom = createFormDom();
    const hostClicks = [];

    let state = { locked: false, needsGate: true, reason: '' };
    let releaseGate;
    const gatePending = new Promise(resolve => { releaseGate = resolve; });
    const lock = installSendLock({
        documentTarget: dom.document,
        getState: () => state,
        onPreSend: async replay => {
            state = { locked: true, needsGate: false, reason: '正在总结上楼' };
            lock.sync();
            await gatePending;
            state = { locked: false, needsGate: false, reason: '' };
            lock.sync();
            replay();
        },
    });
    dom.document.addEventListener('click', e => {
        if (e.target === dom.button && !e.defaultPrevented) hostClicks.push(dom.textarea.value);
    });

    dom.button.dispatchEvent(new dom.Event('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(hostClicks, []);
    assert.equal(dom.button.dataset.tkSendLocked, 'true');

    // A duplicate click while the pre-send gate is running is also blocked.
    dom.button.dispatchEvent(new dom.Event('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(hostClicks, []);

    releaseGate();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(hostClicks, ['继续前进']);
    assert.equal(dom.button.dataset.tkSendLocked, undefined);
    lock.dispose();
});
