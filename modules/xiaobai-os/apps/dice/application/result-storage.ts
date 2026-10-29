import type { PartitionStore } from '../../../kernel/contracts.js';
import type { DiceData } from '../partition.js';
import type { DiceResults } from './results.js';
import { DiceOperationError } from './operation-error.js';

/** Explicit record cleanup only. A committed roll has no replacement or purchase path. */
export function createDiceResultStorage(store: PartitionStore<DiceData>, results: DiceResults) {
    return {
        async clearResults(checkIds: ReadonlySet<string>) {
            const controller = new AbortController();
            try {
                const result = await store.transact(transaction => {
                    const data = transaction.currentOrInitial();
                    transaction.replace({ ...data, resultOverrides: Object.fromEntries(
                        Object.entries(data.resultOverrides).filter(([id]) => !checkIds.has(id))) });
                }, { signal: controller.signal, abandonOnAbort: true });
                if (result.status !== 'confirmed' && result.status !== 'unchanged') { throw new DiceOperationError('dice_result_save_failed'); }
                results.forget(checkIds);
            } finally { controller.abort(); }
        },
    };
}
