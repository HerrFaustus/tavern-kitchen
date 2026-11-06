import { reviewedRounds } from '../../data/summary-layers.js';
const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase();

export function getRawEntityVocabulary(store, context) {
    const data = store?.json || {};
    const names = [context.name2,
        ...(data.characters?.main || []).map(item => typeof item === 'string' ? item : item.name),
        ...(data.arcs || []).map(arc => arc.name),
        ...(data.storyRecords || []).flatMap(record => [record.name, record.person, record.location, ...(record.participants || [])]),
        ...reviewedRounds(store?.summaryHistory).flatMap(batch => batch.memoryTags?.characters || []),
    ];
    const displayMap = new Map();
    const user = normalize(context.name1);
    for (const name of names) if (typeof name === 'string' && normalize(name) && normalize(name) !== user) displayMap.set(normalize(name), name.trim());
    for (const alias of data.characterAliases || []) if (typeof alias.from === 'string' && typeof alias.to === 'string'
        && normalize(alias.from) !== user && normalize(alias.to) !== user) displayMap.set(normalize(alias.from), alias.to);
    return { lexicon: new Set(displayMap.keys()), displayMap, blockedTerms: context.name1 ? [context.name1] : [] };
}
