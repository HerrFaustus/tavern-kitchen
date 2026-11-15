import type { WorldSettings } from './types.js';

export function normalizeWorldSettings(value: unknown): WorldSettings {
    const input = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    return {
        peopleEvolution: true,
        sceneryEvolution: true,
        encounterFrequency: (input.encounterFrequency === 'off' || input.encounterFrequency === 'occasional' || input.encounterFrequency === 'lively')
            ? input.encounterFrequency
            : 'occasional',
        subscribed: true,
        injectToStory: typeof input.injectToStory === 'boolean' ? input.injectToStory : true,
    };
}
