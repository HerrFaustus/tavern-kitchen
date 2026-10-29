import type { PartitionStore, XiaobaiOsFileControls } from '../../../kernel/contracts.js';
import { parseCoc7Sheet, type Coc7Sheet } from '../domain/coc7-sheet.js';
import type { DiceData } from '../partition.js';
import { COC7_SHEET_COPY as copy } from './sheet-copy.js';

/** The sheet update is one candidate; confirmation never executes the reset again. */
export function createDiceSheetService(store: PartitionStore<DiceData>, files: XiaobaiOsFileControls) {
    return {
        read: () => store.peekCurrent()?.value?.sheet ?? null,
        refresh: () => store.read(),
        subscribe(listener: () => void) {
            const unsubscribeStore = store.subscribe(listener);
            const unsubscribeFile = files.subscribeFileState(listener);
            return () => { unsubscribeStore(); unsubscribeFile(); };
        },
        getFileState: files.getFileState,
        async confirm() {
            const result = await files.retryPending();
            if (result.error?.code === 'commit_guard_rejected') { throw new Error(copy.operationExpired); }
            if (!['confirmed', 'none'].includes(result.status)) { throw new Error(copy.saveUnconfirmed); }
        },
        async save(sheet: Coc7Sheet | null, guard: () => boolean) {
            const validated = sheet === null ? null : parseCoc7Sheet(sheet);
            const result = await store.transact(transaction => {
                const current = transaction.currentOrInitial();
                current.sheet = validated;
                transaction.replace(current);
            }, { commitGuard: guard });
            if (result.status === 'unconfirmed' || result.status === 'conflict') { throw new Error(copy.saveUnconfirmed); }
            if (result.status === 'failed') { throw new Error(result.error.message); }
        },
    };
}
export type DiceSheetService = ReturnType<typeof createDiceSheetService>;
