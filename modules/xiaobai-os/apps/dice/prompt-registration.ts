import type { PromptInjectionGroup } from '../../capabilities/prompt-injection/index.js';

export const DICE_CHECK_PROMPTS = {
    id: 'dice_check',
    slots: { rules: { depth: 1, role: 'user' }, result: { depth: 0, role: 'user' } },
} as const satisfies PromptInjectionGroup;
