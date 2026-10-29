import { DICE_PARTITION } from '../apps/dice/partition.js';

/** First user document only. No wallet, rewards, social or learning partitions. */
export async function initialUserPartitions(sheet: unknown): Promise<Record<string, unknown>> {
    return { [DICE_PARTITION.key]: { ...DICE_PARTITION.createInitial(), sheet } };
}
