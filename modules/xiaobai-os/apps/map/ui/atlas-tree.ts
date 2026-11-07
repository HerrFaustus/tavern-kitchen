import { placeFeatures } from '../../../domains/map/features.js';
import { locationTrail } from '../../../domains/map/hierarchy.js';
import type { MapDomainV1, MapLocation } from '../../../domains/map/types.js';

export interface AtlasEntry {
    id: string;
    name: string;
    key?: string;
    feature?: string;
    children: AtlasEntry[];
}

/** Legacy records without a named parent remain browsable without editing the atlas. */
export function buildAtlasTree(map: MapDomainV1): AtlasEntry[] {
    const roots: AtlasEntry[] = [];
    const groups = new Map<string, AtlasEntry>();
    function group(container: AtlasEntry[], id: string, place: MapLocation | undefined, fallback: string) {
        const existing = groups.get(id);
        if (existing) { return existing; }
        const entry: AtlasEntry = {id, key:place?.key, name:place?.name ?? fallback, children:[]};
        groups.set(id, entry);
        container.push(entry);
        return entry;
    }
    for (const place of map.atlas.locations) {
        const trail = locationTrail(map.atlas, place.key).reverse();
        const world = trail.find(p => p.scale === 'world');
        const top = group(roots, JSON.stringify(['world', world?.key]), world, '世界待归属');
        if (place.scale === 'world') { continue; }
        const region = trail.find(p => p.scale === 'region');
        const area = group(top.children, JSON.stringify(['region', world?.key, region?.key]), region, '地区待归属');
        if (place.scale === 'region') { continue; }
        const node = group(area.children, JSON.stringify(['place', place.key]), place, '');
        node.children = placeFeatures(map, place).map(item => ({
            id:JSON.stringify(['feature', place.key, item.name]), name:item.name, key:place.key, feature:item.name, children:[],
        }));
    }
    return roots;
}

