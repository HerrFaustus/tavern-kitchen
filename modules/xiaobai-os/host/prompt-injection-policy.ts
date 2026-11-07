import { MAP_PROMPTS } from '../apps/map/prompt-registration.js';
import { WORLD_PROMPTS } from '../apps/world/prompt-registration.js';

export const PROMPT_INJECTION_POLICY = [
    MAP_PROMPTS, WORLD_PROMPTS,
] as const;
