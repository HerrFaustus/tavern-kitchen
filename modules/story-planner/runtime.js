import { prefix, publishNotes, reviewReason, selectVersion, staleTargetsForNote, writerInput } from './notes.js';

function captureSnapshot(snapshot, snap, signal) {
    const end = snap.chat.length - 1, source = prefix(snap.chat,end);
    const { owner, boundary } = snap, version = snap.world.version, lines = JSON.stringify(snap.plotLines);
    return {
        fresh() {
            if (signal?.aborted) return false;
            const next = snapshot();
            return next?.owner === owner && next.boundary === boundary && next.world.version === version && JSON.stringify(next.plotLines) === lines
                && next.chat.length === end + 1 && prefix(next.chat,end) === source;
        },
    };
}

export function createPlanner({snapshot, store, write, status}) {
    let current, failed;
    const cancel = () => { current?.abort(); current = null; };
    return {
        cancel,
        retry() { failed = null; },
        async inspect() {
            const snap = snapshot();
            if (!snap) return { state:'unavailable' };
            const { fresh } = captureSnapshot(snapshot, snap);
            try {
                if (store.recoverLegacy && snap.legacyOwner) await store.recoverLegacy(snap.legacyOwner, snap.owner, fresh);
                const note = selectVersion(await store.list(snap.owner),snap);
                if (!fresh()) return { state:'changed' };
                if (!note) return { state:'empty' };
                const reason = reviewReason(note, snap);
                return reason
                    ? { state: 'stale', note, staleTargets: staleTargetsForNote(note, snap, reason) }
                    : { state: 'ready', note };
            } catch (error) {
                if (!fresh()) return { state:'changed' };
                throw error;
            }
        },
        async prepare(signal) {
            cancel();
            const controller = new AbortController();
            current = controller;
            const stop = () => controller.abort();
            signal?.addEventListener('abort',stop,{once:true});
            try {
                const snap = snapshot();
                if (!snap || signal?.aborted) return '';
                const { fresh } = captureSnapshot(snapshot, snap, controller.signal);
                if (store.recoverLegacy && snap.legacyOwner) await store.recoverLegacy(snap.legacyOwner, snap.owner, fresh);
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
