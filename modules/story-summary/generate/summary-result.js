// Model output boundary. No store mutation; temporary references live only here.
import { sanitizeCharacterAliasUpdates } from '../data/character-aliases.js';
import { isRelationFact, RELATION_TRENDS } from '../data/fact-predicates.js';
import { parseStoryUpdates } from '../../story-state/records.js';

const FACT_PREDICATE_ALIASES = new Map([
    ['当前位置', '位置'], ['当前所在地', '位置'], ['所在位置', '位置'],
    ['所在地', '位置'], ['当前状态', '状态'],
]);
function invalid(path, reason) {
    const error = new Error(`${path}：${reason}`);
    error.code = 'invalid_summary_field';
    error.path = path;
    throw error;
}

function object(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '须为对象');
    return value;
}

function text(value, path, allowEmpty = false) {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim())) invalid(path, '须为有效文本');
    return value.trim();
}

function array(value, path) {
    if (!Array.isArray(value)) invalid(path, '须为数组');
    return value;
}

function optionalArray(value, path) {
    return value === undefined ? [] : array(value, path);
}

function names(value, path) {
    return array(value, path).map((name, i) => text(name, `${path}[${i}]`));
}

function prepareFact(update, path) {
    object(update, path);
    const s = text(update.s, `${path}.s`);
    const predicate = text(update.p, `${path}.p`);
    const p = FACT_PREDICATE_ALIASES.get(predicate) || predicate;
    if (update.retracted !== undefined && typeof update.retracted !== 'boolean') {
        invalid(`${path}.retracted`, '须为布尔值');
    }
    if (update.retracted === true) return { s, p, retracted: true };
    const o = text(update.o, `${path}.o`);
    if (typeof update.isState !== 'boolean') invalid(`${path}.isState`, '须为布尔值');
    const fact = { s, p, o, isState: update.isState };
    if (isRelationFact(fact) && update.trend != null) {
        const trend = text(update.trend, `${path}.trend`, true);
        if (trend) {
            if (!RELATION_TRENDS.includes(trend)) invalid(`${path}.trend`, '须为规定的关系趋势');
            fact.trend = trend;
        }
    }
    return fact;
}

/** Validate and project one generated batch before any merge or persistence. */
export function prepareSummaryResult(parsed) {
    object(parsed, 'summary');
    const factUpdates = optionalArray(parsed.factUpdates, 'factUpdates').map((update, i) => prepareFact(update, `factUpdates[${i}]`));
    const newCharacters = names(optionalArray(parsed.newCharacters, 'newCharacters'), 'newCharacters');
    const aliasUpdates = optionalArray(parsed.characterAliasUpdates, 'characterAliasUpdates').map((update, i) => {
        const path = `characterAliasUpdates[${i}]`;
        object(update, path);
        const from = names(update.from, `${path}.from`);
        if (!from.length) invalid(`${path}.from`, '须包含旧称呼');
        return { to: text(update.to, `${path}.to`), from, evidence: text(update.evidence, `${path}.evidence`) };
    });
    return {
        factUpdates, newCharacters,
        characterAliasUpdates: sanitizeCharacterAliasUpdates(aliasUpdates),
        ...(parsed.storyUpdates === undefined ? {} : { storyUpdates: parseStoryUpdates(parsed.storyUpdates) }),
    };
}
