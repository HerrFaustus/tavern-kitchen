import { captureRangeSource, isNarrativeReply, isRangeSourceCurrent } from '../modules/story-summary/data/turn-source.js';

// The pending foreground call stays in the host interceptor. Finishing a replay
// never calls Generate, so cancelling, switching chats or a duplicate click cannot send it twice.
export function createTurnQueue({ read, tasks, complete, execute, status = () => {} }) {
    let active, waiting, blocked, resume;
    const wake = () => { resume?.(); resume = null; };
    function invalidate() {
        active?.controller.abort();
        active = null;
        blocked = null;
        status(null);
        wake();
    }
    function settle() {
        const initial = read();
        if (!initial.owner || !tasks().length) return Promise.resolve();
        if (active?.owner === initial.owner) return active.promise;
        invalidate();
        const controller = new AbortController(), { signal } = controller;
        const job = { owner: initial.owner, controller };
        active = job;
        const current = () => active === job && read().owner === job.owner && !signal.aborted;
        const interrupted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
        const work = async () => {
            for (let floor = 0; current() && floor <= read().end; floor++) {
                const { chat } = read();
                if (!isNarrativeReply(chat[floor])) continue;
                const start = chat[floor - 1]?.is_user ? floor - 1 : floor;
                const source = captureRangeSource(chat, start, floor);
                const guard = () => {
                    signal.throwIfAborted();
                    if (!current() || floor > read().end || !isRangeSourceCurrent(source, read().chat)) throw new Error('聊天或选定回复已改变');
                };
                const steps = tasks();
                for (const group of ['update', 'simulation', 'review', 'chapter']) {
                    const pending = steps.filter(step => step.group === group && !complete(source, step));
                    if (!pending.length) continue;
                    const check = () => {
                        guard();
                        if (pending.some(step => !tasks().some(live => live.key === step.key))) throw new Error('功能已关闭');
                        return true;
                    };
                    try {
                        check();
                        status({ floor, message: '正在处理' + pending.map(step => step.label).join('、') });
                        await execute({ source, steps: pending, group, signal, check });
                        check();
                        if (pending.some(step => !complete(source, step))) throw new Error('保存尚未确认，请读回后重试');
                    } catch (error) {
                        if (current()) { blocked = { floor, message: error.message, error }; status(blocked); }
                        throw error;
                    }
                }
            }
            if (current()) status(null);
        };
        job.promise = Promise.race([Promise.resolve().then(work), interrupted]).finally(() => { if (active === job) active = null; });
        wake();
        return job.promise;
    }
    return {
        settle, invalidate,
        cancelGeneration() { if (waiting) { waiting.abort(true); waiting = null; wake(); } },
        async beforeGeneration(abort) {
            if (!tasks().length) return;
            if (waiting) { abort(true); return; }
            const ticket = { owner: read().owner, abort };
            waiting = ticket;
            try {
                while (waiting === ticket && read().owner === ticket.owner && tasks().length) {
                    if (blocked) { await new Promise(resolve => { resume = resolve; }); continue; }
                    try { await settle(); break; }
                    catch { if (!blocked && !active && !tasks().length) break; }
                }
                if (waiting === ticket && read().owner !== ticket.owner) abort(true);
            } catch { if (waiting === ticket) abort(true); }
            finally { if (waiting === ticket) waiting = null; }
        },
    };
}
