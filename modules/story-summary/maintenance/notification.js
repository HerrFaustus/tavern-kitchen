let listener = null;

export function registerMemoryMaintenance(listenerFunction) {
    listener = listenerFunction;
    return () => { if (listener === listenerFunction) listener = null; };
}

export function notifySummaryCommitted(batch) {
    listener?.(batch);
}

let chapterObserver;
export function watchChapterSaves(observer) {
    chapterObserver = observer;
    return () => { if (chapterObserver === observer) chapterObserver = null; };
}
export function observeSavedChapter() { chapterObserver?.changed(); }
export function chapterNotesEnabled() { return !!chapterObserver?.enabled(); }
