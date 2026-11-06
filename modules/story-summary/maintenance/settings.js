export const DEFAULT_MEMORY_MAINTENANCE_ENABLED = true;

export function normalizeProofreading(config = {}) {
    const interval = Number(config.proofreadingInterval);
    return {
        proofreadingInterval: Number.isInteger(interval) ? Math.max(1, Math.min(100, interval)) : 5,
        proofreadingPrompt: String(config.proofreadingPrompt ?? '').trim().slice(0, 4000),
    };
}
