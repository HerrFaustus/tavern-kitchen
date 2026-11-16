import { prefix, prepareWriterRequest, publishNotes, reviewReason, selectVersion, staleTargetsForNote } from './notes.js';

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
    let current, failed, pending;
    const cancel = () => { current?.abort(); current = null; pending = null; };
    return {
        cancel,
        retry() { failed = null; },
        async inspect() {
            const snap = snapshot();
            if (!snap) return { state:'unavailable' };
            const { fresh } = captureSnapshot(snapshot, snap);
            try {
                if (store.recoverLegacy && snap.legacyOwner) await store.recoverLegacy(snap.legacyOwner, snap.owner, fresh);
                const rows = await store.list(snap.owner);
                const note = selectVersion(rows,snap);
                if (!fresh()) return { state:'changed' };
                if (!note) {
                    const prior = rows.filter(row=>row.owner===snap.owner).sort((a,b)=>b.revision-a.revision)[0];
                    return prior ? {state:'stale',note:prior,reason:'札记依据的原文已改写'} : {state:'empty'};
                }
                const reason = reviewReason(note, snap);
                return reason
                    ? { state: 'stale', note, staleTargets: staleTargetsForNote(note, snap, reason) }
                    : { state: 'ready', note };
            } catch (error) {
                if (!fresh()) return { state:'changed' };
                throw error;
            }
        },
        prepare(signal, end, { force = false, throwOnError = false } = {}) {
            const read = () => snapshot(end);
            const snap = read();
            if (!snap || signal?.aborted) return Promise.resolve('');
            if (force) failed = null;
            const key = JSON.stringify([snap.owner,snap.world.version,snap.boundary,snap.lineState,prefix(snap.chat,snap.chat.length-1)]);
            if (!force && !throwOnError && pending?.key === key) return pending.promise;
            cancel();
            const job = {key}; pending = job;
            job.promise = run(signal, read, { throwOnError }).finally(() => { if(pending === job) pending = null; });
            return job.promise;
        },
    };
    async function run(signal, read, { throwOnError = false } = {}) {
            const controller = new AbortController();
            current = controller;
            const stop = () => controller.abort();
            signal?.addEventListener('abort',stop,{once:true});
            try {
                const snap = read();
                if (!snap || signal?.aborted) return '';
                const { fresh } = captureSnapshot(read, snap, controller.signal);
                if (store.recoverLegacy && snap.legacyOwner) await store.recoverLegacy(snap.legacyOwner, snap.owner, fresh);
                const previous = selectVersion(await store.list(snap.owner),snap);
                if (!fresh()) return '';
                const reason = reviewReason(previous,snap);
                if (!reason) { status('当前章节札记已就绪'); return previous.chapter.text; }
                const stale = staleTargetsForNote(previous, snap, reason);
                const source = prefix(snap.chat, snap.chat.length - 1);
                const ticket = JSON.stringify([snap.owner, snap.world.version, snap.boundary, snap.lineState, source, previous?.id, reason, snap.plotLines, stale]);
                if (failed === ticket) return '';
                status('后台作家正在整理札记');
                try {
                    let request = prepareWriterRequest(snap, previous, reason, stale);
                    let raw, published;
                    try {
                        raw = await write(request.messages, controller.signal);
                        if (!fresh()) return '';
                        published = publishNotes(raw, previous, snap, reason, {
                            mode: request.mode,
                            staleTargets: request.staleTargets,
                        });
                    } catch (firstError) {
                        if (request.mode !== 'partial' || !fresh() || controller.signal.aborted
                            || firstError?.name === 'AbortError' || firstError?.secretLeak) {
                            throw firstError;
                        }
                        // WHY: Fall back once to a full chapter rewrite when partial diffs miss targets, overflow
                        // scoped dependencies, or produce malformed JSON so chapter notes do not get stuck.
                        request = prepareWriterRequest(snap, previous, reason, stale, { forceFull: true });
                        raw = await write(request.messages, controller.signal);
                        if (!fresh()) return '';
                        published = publishNotes(raw, previous, snap, reason, {
                            mode: 'full',
                            staleTargets: null,
                        });
                    }
                    const saved = await store.put(published, fresh);
                    if (!fresh()) return '';
                    failed = null;
                    status('当前章节札记已就绪');
                    return saved.chapter.text;
                } catch (error) {
                    if (fresh()) {
                        failed = ticket;
                        status('札记未能发布，可检查模型设置并重试', true);
                        if (throwOnError && error?.name !== 'AbortError') throw error;
                    }
                    return '';
                }
            } finally {
                signal?.removeEventListener('abort',stop);
                if (current === controller) current = null;
            }
    }
}
