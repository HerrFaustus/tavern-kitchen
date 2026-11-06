import { WORLD_LIMITS, WORLD_VERSION, WORLD_WRITE_LIMITS } from './types.js';

const text = (maxLength: number, description: string, allowEmpty = false) => ({
    type: 'string', maxLength, ...(!allowEmpty ? { minLength: 1, pattern: '\\S' } : {}), description,
});
export const worldNewsSchema = (bodyLimit: number = WORLD_LIMITS.body) => ({
    type: 'object', additionalProperties: false, required: ['id', 'title', 'body'], properties: {
        id: text(WORLD_LIMITS.id, 'Stable article ID. Reuse it to continue an article.'),
        subjectId: text(240, 'Exact subject key from the current simulation list. Reuse it when updating.'),
        situationId: text(200, 'Optional exact ID from the current situation catalog. Omit when unrelated.'),
        title: text(WORLD_LIMITS.title, 'Article title.'),
        ...(bodyLimit === WORLD_LIMITS.body && { progress: {
            type: 'object', additionalProperties: false, required: ['from', 'quote', 'reason', 'floor'],
            properties: { from: text(800, 'Previous state.', true), quote: text(400, 'Source quote.'),
                reason: text(300, 'Reason for progression.'), floor: { type: 'integer', minimum: 0 } },
        } }),
        body: text(bodyLimit, 'Plain-text news brief; its opening is also the list preview.'),
    },
});
const overview = text(WORLD_LIMITS.overview, 'Wider-world atmosphere. Omit in an edit to keep it; an empty string clears it.', true);
export const WORLD_CONTENT_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['overview', 'news'], properties: {
        overview,
        news: { type: 'array', maxItems: WORLD_LIMITS.news, items: worldNewsSchema() },
    },
};
export const WORLD_SCHEMA = {
    ...WORLD_CONTENT_SCHEMA, required: ['version', ...WORLD_CONTENT_SCHEMA.required],
    properties: { version: { type: 'integer', enum: [WORLD_VERSION] }, ...WORLD_CONTENT_SCHEMA.properties },
};
export const WORLD_EDIT_SCHEMA = {
    type: 'object', additionalProperties: false, properties: {
        overview,
        progress: { type: 'array', maxItems: 17, description: 'Required for each automatic change, including retirement.', items: {
            type: 'object', additionalProperties: false, required: ['scope','from','reason','quote'], properties: {
                scope: text(80, 'news:<article id> or overview'), from: text(800, 'Exact previous body/overview, empty for a new entry.', true),
                reason: text(300, 'What changed this turn and why it enables this step.'),
                quote: text(400, 'Exact quotation from the accepted assistant narration.'), },
        } },
        upsert: { type: 'array', maxItems: WORLD_WRITE_LIMITS.news,
            description: 'Complete new or replacement articles. Each ID appears once in this batch, in upsert or remove.',
            items: worldNewsSchema(WORLD_WRITE_LIMITS.body) },
        remove: { type: 'array', maxItems: WORLD_WRITE_LIMITS.news,
            description: 'IDs to retire. Omit to keep articles not replaced by upsert. A missing ID is already removed.',
            items: text(WORLD_WRITE_LIMITS.id, 'Article ID to retire.') },
    },
};
