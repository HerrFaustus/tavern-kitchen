import { prefix, publishNotes, reviewReason, selectVersion, writerInput } from './notes.js';

export function createPlanner({snapshot, store, write, status}) {
    let current, failed;
    const cancel = () => { current?.abort(); current = null; };
    return {
        cancel,
        retry() { failed = null; },
        async prepare(signal) {
            cancel();
            const controller = new AbortController();
            current = controller;
            const stop = () => controller.abort();
            signal?.addEventListener('abort',stop,{once:true});
            try {
                const snap = snapshot();
                if (!snap || signal?.aborted) return '';
                const end = snap.chat.length - 1, source = prefix(snap.chat,end);
                const fresh = () => {
                    if (controller.signal.aborted) return false;
                    const next = snapshot();
                    return next?.owner === snap.owner && next.boundary === snap.boundary && next.world.version === snap.world.version && JSON.stringify(next.plotLines) === JSON.stringify(snap.plotLines)
                        && next.chat.length === end + 1 && prefix(next.chat,end) === source;
                };
                const previous = selectVersion(await store.list(snap.owner),snap);
                if (!fresh()) return '';
                const reason = reviewReason(previous,snap);
                if (!reason) { status('当前章节札记已就绪'); return previous.chapter.text; }
                const ticket = JSON.stringify([snap.owner,snap.boundary,previous?.id,reason,snap.plotLines]);
                if (failed === ticket) return '';
                status('后台作家正在整理札记');
                try {
                    const raw = await write(writerInput(snap,previous,reason),controller.signal);
                    if (!fresh()) return '';
                    const saved = await store.put(publishNotes(raw,previous,snap,reason));
                    if (!fresh()) return '';
                    failed = null;
                    status('当前章节札记已就绪');
                    return saved.chapter.text;
                } catch (error) {
                    if (fresh()) { failed = ticket; status('札记未能发布，可检查模型设置并重试', true); }
                    return '';
                }
            } finally {
                signal?.removeEventListener('abort',stop);
                if (current === controller) current = null;
            }
        },
    };
}
