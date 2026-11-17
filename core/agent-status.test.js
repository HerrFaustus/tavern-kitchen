import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { clearAgentNotice, installAgentStatus, showAgentNotice } from './agent-status.js';

function mount(t) {
    const { document } = parseHTML('<html><body><div id="form_sheld"><form id="send_form"></form></div></body></html>');
    // linkedom re-fires childList observers on same-value `hidden` writes; the strip
    // contents under test do not depend on live mutation mounting.
    class NoopObserver { observe() {} disconnect() {} }
    Object.defineProperty(document, 'defaultView', { value: { MutationObserver: NoopObserver } });
    const stop = installAgentStatus(document);
    t.after(() => { clearAgentNotice(); stop(); });
    return { document, status: () => document.querySelector('#tk-floor-status'), host: () => document.getElementById('tk-agent-status') };
}

test('a pinned hard-block error survives background info notices and only a retry resolves it', async t => {
    const ui = mount(t);
    showAgentNotice({ level: 'error', message: '世界档案尚未就绪，本轮未发送。', pinned: true });
    assert.match(ui.status().textContent, /世界档案尚未就绪/);

    const ignored = showAgentNotice({ level: 'info', message: '后台轻提示', timeoutMs: 5 });
    assert.equal(ignored, null);
    await setImmediate();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(ui.status().textContent, /世界档案尚未就绪/);
    assert.equal(ui.host().hidden, false);

    clearAgentNotice();
    showAgentNotice({ level: 'info', message: '队列空闲', timeoutMs: 5 });
    assert.match(ui.status().textContent, /队列空闲/);
});

test('a user-dismissed hard-block error can be replaced by later routine feedback', async t => {
    const ui = mount(t);
    showAgentNotice({ level: 'error', message: '总结失败，请重试。', pinned: true });
    const dismiss = [...ui.status().querySelectorAll('button')].find(button => button.textContent === '收起');
    dismiss.click();
    await setImmediate();
    assert.equal(ui.host().hidden, true);

    showAgentNotice({ level: 'info', message: '向量任务完成', timeoutMs: 5 });
    assert.match(ui.status().textContent, /向量任务完成/);
    assert.equal(ui.host().hidden, false);
});
