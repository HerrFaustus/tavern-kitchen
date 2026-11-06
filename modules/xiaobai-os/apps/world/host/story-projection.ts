import { escapePromptData } from '../../../capabilities/maintenance/prompt-safety.js';
import type { WorldContent } from '../../../domains/world/types.js';

export const MAX_WORLD_STORY_MESSAGE_CHARS = 8_000;

export function buildWorldStoryPrompt(world: WorldContent | null): string {
    if (!world || (!world.overview && !world.news.length)) { return ''; }
    const sections = [
        ...(world.overview ? [escapePromptData(world.overview)] : []),
        ...world.news.map(item => `• ${escapePromptData(item.title)}\n${escapePromptData(item.body)}`),
    ];
    const render = (included: string[]) => [
        '<world_background>',
        ...included,
        '</world_background>',
    ].join('\n');
    const full = render(sections);
    if ([...full].length <= MAX_WORLD_STORY_MESSAGE_CHARS) { return full; }
    const included: string[] = [];
    for (const section of sections) {
        if ([...render([...included, section])].length <= MAX_WORLD_STORY_MESSAGE_CHARS) {
            included.push(section);
        }
    }
    return included.length ? render(included) : '';
}
