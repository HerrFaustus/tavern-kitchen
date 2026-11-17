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
    function settle({ update = true } = {}) {
        const initial = read();
        if (!initial.owner || !tasks().length) return Promise.resolve();
        if (active?.owner === initial.owner) {
            // A full job already covers a simulation-only request; a simulation job
            // must yield to the pre-send request so the latest reply is summarized.
            if (active.update || !update) return active.promise;
            return active.promise.then(() => settle({ update:true }));
        }
        invalidate();
        const controller = new AbortController(), { signal } = controller;
        const job = { owner: initial.owner, controller, update };
        active = job;
        const current = () => active === job && read().owner === job.owner && !signal.aborted;
        const interrupted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
        const work = async () => {
            const groups = update ? ['simulation', 'update', 'chapter'] : ['simulation'];
            const limitFor = (snapshot, group) => (group === 'simulation'
                ? (snapshot.simulationEnd ?? snapshot.end)
                : (snapshot.updateEnd ?? snapshot.end));
            const maxEnd = () => {
                const snapshot = read();
                return update ? Math.max(snapshot.simulationEnd ?? snapshot.end ?? -1, snapshot.updateEnd ?? snapshot.end ?? -1)
                    : (snapshot.simulationEnd ?? snapshot.end ?? -1);
            };
            for (let floor = 0; current() && floor <= maxEnd(); floor++) {
                const { chat } = read();
                if (!isNarrativeReply(chat[floor])) continue;
                const start = chat[floor - 1]?.is_user ? floor - 1 : floor;
                const source = captureRangeSource(chat, start, floor);
                const steps = tasks();
                for (const group of groups) {
                    if (floor > limitFor(read(), group)) continue;
                    const pending = steps.filter(step => step.group === group && !complete(source, step));
                    if (!pending.length) continue;
                    const check = () => {
                        signal.throwIfAborted();
                        const live = read();
                        if (!current() || floor > limitFor(live, group) || !isRangeSourceCurrent(source, live.chat)) {
                            throw new Error('聊天或选定回复已改变');
                        }
                        if (pending.some(step => !tasks().some(item => item.key === step.key))) throw new Error('功能已关闭');
                        return true;
                    };
                    try {
                        check();
                        status({ floor, message: '正在处理' + pending.map(step => step.label).join('、') });
                        await execute({ source, steps: pending, group, signal, check });
                        check();
                        if (pending.some(step => !complete(source, step))) throw new Error('保存尚未确认，请读回后重试');
                    } catch (error) {
                        if (current()) { blocked = { floor, message: error.message, error, group }; status(blocked); }
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
                // WHY: pre-send settlement is fail closed. A blocked summary or world
                // write must abort this generation and leave the draft for the Agent
                // strip's retry action instead of holding the send indefinitely.
                await settle();
                if (waiting === ticket && read().owner !== ticket.owner) abort(true);
            } catch {
                if (waiting === ticket) abort(true);
            } finally { if (waiting === ticket) waiting = null; }
        },
    };
}
