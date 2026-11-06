import { reviewedRounds } from './summary-layers.js';
import { isRangeSourceCurrent } from './turn-source.js';

const fields = ['characters', 'locations', 'times', 'keywords'];
const strings = (values, limit = 24) => [...new Set(values.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].slice(0, limit);

export function prepareMemoryTags(decoded) {
    const supplied = decoded.memoryTags;
    if (supplied !== undefined && (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)
        || fields.some(field => supplied[field] !== undefined && (!Array.isArray(supplied[field])
            || supplied[field].length > 24 || supplied[field].some(value => typeof value !== 'string' || value.length > 120))))) {
        throw new Error('记忆标签须为人物、地点、时间、关键词的短文本数组，每类最多 24 项');
    }

    const fallback = {
        characters: [], locations: [], times: [],
        keywords: Array.isArray(decoded.keywords) ? decoded.keywords.map(value => typeof value === 'string' ? value : value?.text) : [],
    };
    return Object.fromEntries([['version', 1], ...fields.map(field => [field, strings([...(supplied?.[field] || []), ...fallback[field]]).map(value => value.slice(0, 120))])]);
}

export function validateMemoryTags(value) {
    if (!value || value.version !== 1 || fields.some(field => !Array.isArray(value[field]) || value[field].length > 24
        || value[field].some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 120))) throw new Error('记忆标签版本或内容无效');
    return value;
}

export function memoryTagsByFloor(store, chat) {
    const result = new Map();
    for (const batch of reviewedRounds(store?.summaryHistory)) {
        const source = batch.sourceReceipt?.source || batch.roundSource;
        if (batch.memoryTags?.version !== 1 || !isRangeSourceCurrent(source, chat)) continue;
        const tags = strings(fields.flatMap(field => Array.isArray(batch.memoryTags[field]) ? batch.memoryTags[field] : []), 96);
        for (let floor = source.start; floor <= source.end; floor++) result.set(floor, tags);
    }
    return result;
}
