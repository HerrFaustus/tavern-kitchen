export const nameKey = name => String(name || '').trim().normalize('NFKC').toLowerCase();
export function protagonistIdentity(entities, playerName) {
    const people = entities.filter(entity => entity.kind === 'person' || entity.kind === 'subject');
    const namesOf = entity => [entity.name, ...(entity.aliases || [])].map(nameKey);
    const key = nameKey(playerName);
    const matches = key ? people.filter(entity => namesOf(entity).includes(key)) : [];
    const bound = people.find(entity => entity.bindings?.includes('["map","actor:player"]'));
    const hero = matches.length === 1 ? matches[0] : !key || matches.includes(bound) ? bound : undefined;
    const names = new Set(hero ? namesOf(hero) : key ? [key] : []);
    for (const other of people) if (other !== hero) for (const name of namesOf(other)) names.delete(name);
    return { hero, names, title: hero?.name || playerName };
}

