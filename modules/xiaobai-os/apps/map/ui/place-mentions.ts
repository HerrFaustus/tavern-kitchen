import type { MapLocation, PlaceFeature } from '../../../domains/map/types.js';

export interface PlaceMention {key: string; feature?: string}
export function mentionIndex(places: MapLocation[], owner: string, features: PlaceFeature[]) {
    const names = new Map<string, PlaceMention | null>();
    function add(name: string, target: PlaceMention) {
        if (name) { names.set(name,names.has(name) ? null : target); }
    }
    for (const place of places) { add(place.name,{key:place.key}); }
    for (const item of features) { add(item.name,{key:owner,feature:item.name}); }
    return [...names].sort(([a],[b]) => b.length-a.length);
}

/** Keep literal text intact. An ambiguous longer name must not link a shorter substring. */
export function linkPlaceMentions(text: string, names: ReturnType<typeof mentionIndex>, current: PlaceMention) {
    const parts: {text:string; target?:PlaceMention}[] = [];
    let start = 0;
    const word = /[a-z0-9_]/i;
    for (let i = 0; i < text.length;) {
        const hit = names.find(([name]) => text.startsWith(name,i)
            && !(word.test(name[0]) && word.test(text[i-1] ?? ''))
            && !(word.test(name[name.length-1]) && word.test(text[i+name.length] ?? '')));
        if (!hit) { i++; continue; }
        const [name,target] = hit;
        if (target && (target.key !== current.key || target.feature !== current.feature)) {
            if (start < i) { parts.push({text:text.slice(start,i)}); }
            parts.push({text:name,target});
            start = i+name.length;
        }
        i += name.length;
    }
    if (start < text.length) { parts.push({text:text.slice(start)}); }
    return parts;
}
