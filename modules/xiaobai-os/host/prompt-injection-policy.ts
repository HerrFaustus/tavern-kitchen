import { DICE_CHECK_PROMPTS, DICE_ENCOUNTER_PROMPTS } from '../apps/dice/prompt-registration.js';
import { MAP_PROMPTS } from '../apps/map/prompt-registration.js';
import { WORLD_PROMPTS } from '../apps/world/prompt-registration.js';

export const PROMPT_INJECTION_POLICY = [
    DICE_CHECK_PROMPTS, DICE_ENCOUNTER_PROMPTS, MAP_PROMPTS, WORLD_PROMPTS,
] as const;
