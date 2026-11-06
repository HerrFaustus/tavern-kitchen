import type { WorldSettings } from './types.js';

export function normalizeWorldSettings(value: unknown): WorldSettings {
    const input = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    return {
        ...(typeof input.peopleEvolution === 'boolean' && { peopleEvolution: input.peopleEvolution }),
        ...(typeof input.sceneryEvolution === 'boolean' && { sceneryEvolution: input.sceneryEvolution }),
        ...((input.encounterFrequency === 'off' || input.encounterFrequency === 'occasional' || input.encounterFrequency === 'lively') && { encounterFrequency: input.encounterFrequency }),
        subscribed: typeof input.subscribed === 'boolean' ? input.subscribed : false,
        injectToStory: typeof input.injectToStory === 'boolean' ? input.injectToStory : true,
    };
}
