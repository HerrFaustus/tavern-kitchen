import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { clearAgentNotice, installAgentStatus, setAgentIdleStatus, showAgentNotice } from './agent-status.js';

function mount(t) {
    const { document } = parseHTML('<html><body><div id="form_sheld"><form id="send_form"></form></div></body></html>');
    // linkedom re-fires childList observers on same-value `hidden` writes; the strip
    // contents under test do not depend on live mutation mounting.
    class NoopObserver { observe() {} disconnect() {} }
    Object.defineProperty(document, 'defaultView', { value: { MutationObserver: NoopObserver } });
    const stop = installAgentStatus(document);
    t.after(() => { clearAgentNotice(); setAgentIdleStatus(); stop(); });
    return { document, status: () => document.querySelector('#tk-floor-status'), host: () => document.getElementById('tk-agent-status') };
}

test('the agent strip stays permanently visible in standby mode on mount and after clearAgentNotice', async t => {
    const ui = mount(t);
    assert.equal(ui.host().hidden, false);
    assert.ok(ui.status());
    assert.equal(ui.status().classList.contains('is-idle'), true);

    let clicks = 0;
    setAgentIdleStatus({
        message: '后厨待命 · 已总结 2 楼，待总结 1 楼',
        actions: [{ label: '手动总结', callback: () => { clicks += 1; } }],
    });
    assert.match(ui.status().textContent, /已总结 2 楼，待总结 1 楼/);
    const manualBtn = [...ui.status().querySelectorAll('button')].find(button => button.textContent === '手动总结');
    assert.ok(manualBtn);
    manualBtn.click();
    await setImmediate();
    assert.equal(clicks, 1);

    showAgentNotice({ level: 'info', message: '正在总结…', pinned: true });
    assert.equal(ui.status().classList.contains('is-idle'), false);
    clearAgentNotice();
    assert.equal(ui.host().hidden, false);
    assert.equal(ui.status().classList.contains('is-idle'), true);
    assert.match(ui.status().textContent, /已总结 2 楼，待总结 1 楼/);
});

test('a pinned hard-block error survives background info notices and idle updates until resolved', async t => {
    const ui = mount(t);
    showAgentNotice({ level: 'error', message: '世界档案尚未就绪，本轮未发送。', pinned: true });
    assert.match(ui.status().textContent, /世界档案尚未就绪/);

    setAgentIdleStatus({ message: '后厨待命 · 应该不会覆盖错误' });
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

test('dismissing an error returns the strip to the permanent standby bar and allows routine feedback', async t => {
    const ui = mount(t);
    showAgentNotice({ level: 'error', message: '总结失败，请重试。', pinned: true });
    const dismiss = [...ui.status().querySelectorAll('button')].find(button => button.textContent === '收起');
    dismiss.click();
    await setImmediate();
    assert.equal(ui.host().hidden, false);
    assert.equal(ui.status().classList.contains('is-idle'), true);
    assert.doesNotMatch(ui.status().textContent, /总结失败/);

    showAgentNotice({ level: 'info', message: '向量任务完成', timeoutMs: 5 });
    assert.match(ui.status().textContent, /向量任务完成/);
    assert.equal(ui.host().hidden, false);
});
