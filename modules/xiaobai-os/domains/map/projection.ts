import { placeFeatures } from './features.js';
import { parseMapDomain } from './invariants.js';
import { compassLabels, type MapDomainV1, type MapLink, type MapLinkKind, type MapLocation } from './types.js';

export const MAX_MAP_PROMPT_CHARS = 800;

const LINK_KIND_LABELS: Readonly<Record<MapLinkKind, string>> = Object.freeze({
    door: '门',
    stairs: '楼梯',
    elevator: '电梯',
    path: '小径',
    road: '道路',
    portal: '传送门',
    passage: '通道',
});

function codePointLength(value: string): number {
    return Array.from(value).length;
}

/** Escapes XML and prevents a later host macro pass from interpreting map text. */
export function escapeMapPromptText(value: string, maxCharacters = 80): string {
    return Array.from(String(value ?? '')
        .normalize('NFC')
        .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim())
        .slice(0, maxCharacters)
        .join('')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        .replace(/{/g, '&#123;')
        .replace(/}/g, '&#125;');
}

function routeLabel(link: MapLink): string {
    return escapeMapPromptText(link.label || LINK_KIND_LABELS[link.kind], 64);
}

function directDestination(
    link: MapLink,
    currentKey: string,
    locationByKey: ReadonlyMap<string, MapLocation>,
): MapLocation | null {
    if (link.from === currentKey) {return locationByKey.get(link.to) ?? null;}
    if (link.bidirectional && link.to === currentKey) {return locationByKey.get(link.from) ?? null;}
    return null;
}

function directLine(location: MapLocation, link: MapLink): string {
    const oneWay = link.bidirectional ? '' : '，仅可前往';
    return `${escapeMapPromptText(location.name, 80)}（经由${routeLabel(link)}${oneWay}；${location.status === 'visited' ? '已到访' : '仅提及'}）`;
}

function locationPath(place: MapLocation, index: Map<string, MapLocation>): string {
    const names: string[] = [];
    const seen = new Set<string>();
    let node: MapLocation | undefined = place;
    while (node && !seen.has(node.key)) {
        seen.add(node.key);
        names.unshift(escapeMapPromptText(node.name, 64));
        node = node.parent ? index.get(node.parent) : undefined;
    }
    return names.join(' › ');
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().trim();

function mentions(text: string, name: string): boolean {
    const term = normalize(name);
    if (!term) { return false; }
    const word = /[a-z0-9_]/u;
    let start = text.indexOf(term);
    while (start >= 0) {
        const end = start + term.length;
        if (!(word.test(term[0]) && word.test(text[start - 1] ?? ''))
            && !(word.test(term[term.length - 1]) && word.test(text[end] ?? ''))) { return true; }
        start = text.indexOf(term, start + 1);
    }
    return false;
}

function mentionedPlaces(domain: MapDomainV1, query: string): Set<string> {
    const matches = new Set<string>();
    const text = query;
    if (!text) { return matches; }
    // A shared feature name alone cannot identify which distant place is being discussed.
    const candidates = new Map<string, Set<string>>();
    function add(name: string, key: string) {
        const term = normalize(name);
        if (!mentions(text, term)) { return; }
        const locations = candidates.get(term) ?? new Set<string>();
        locations.add(key);
        candidates.set(term, locations);
    }
    for (const place of domain.atlas.locations) {
        add(place.name, place.key);
        for (const feature of placeFeatures(domain, place)) { add(feature.name, place.key); }
    }
    for (const actor of domain.atlas.actors) {
        if (actor.actorKey !== 'player') { add(actor.displayName, actor.locationKey); }
    }
    for (const locations of candidates.values()) {
        if (locations.size === 1) { for (const key of locations) { matches.add(key); } }
    }
    return matches;
}

export function buildMapPromptBlock(value: unknown, turnText = '', scope: 'turn' | 'background' = 'turn'): string {
    let domain: MapDomainV1;
    try { domain = parseMapDomain(value); }
    catch { return ''; }
    const { locations, actors, links } = domain.atlas;
    const index = new Map(locations.map(place => [place.key,place]));
    const player = actors.find(actor => actor.actorKey === 'player');
    const current = player && index.get(player.locationKey);
    const text = normalize(turnText);
    const related = mentionedPlaces(domain, text);
    const labelled = links.filter(link => link.label && mentions(text, link.label));
    const counts = new Map<string, number>();
    for (const link of labelled) {
        const label = normalize(link.label!);
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const mentionedLinks = new Set(labelled.filter(link => counts.get(normalize(link.label!)) === 1
        || [link.from, link.to].some(key => key === current?.key || related.has(key))));
    for (const link of mentionedLinks) { related.add(link.from); related.add(link.to); }
    if (current) { related.delete(current.key); }
    if (!locations.length || (!current && !related.size && scope === 'turn')) { return ''; }

    const closing = '</current_map>';
    const lines = ['<current_map>', '当前位置：' + (current ? escapeMapPromptText(current.name) : '尚未确定')];
    function append(line: string) {
        if (codePointLength([...lines, line, closing].join('\n')) <= MAX_MAP_PROMPT_CHARS) { lines.push(line); }
    }
    if (current) {
        if (current.parent) { append('所在路径：' + locationPath(current, index)); }
        if (current.brief) { append('地点概况：' + escapeMapPromptText(current.brief, 120)); }
    }
    function featureLine(place: MapLocation, feature: ReturnType<typeof placeFeatures>[number]): string {
        const fields = [escapeMapPromptText(feature.name, 60)];
        if (feature.state) { fields.push('状态：' + escapeMapPromptText(feature.state, 70)); }
        if (feature.description) { fields.push(escapeMapPromptText(feature.description, 70)); }
        if (mentions(text, feature.name)) {
            if (feature.placement) {
                fields.push(escapeMapPromptText(feature.placement.relativeTo || place.name, 45) + '的' + compassLabels[feature.placement.bearing] + '侧');
            }
            for (const value of [feature.positionHint, feature.purpose, feature.history]) {
                if (value) { fields.push(escapeMapPromptText(value, 45)); }
            }
        }
        return escapeMapPromptText(place.name, 50) + ' · ' + fields.join('，');
    }
    const localFeatures = current ? placeFeatures(domain,current).map(feature => featureLine(current,feature)) : [];
    const destinations: string[] = [];
    const relevantDetails: string[] = [];
    for (const key of related) {
        const place = index.get(key);
        if (!place) { continue; }
        destinations.push('本轮相关地点：' + locationPath(place,index) + (place.brief ? ' · ' + escapeMapPromptText(place.brief, 60) : ''));
        for (const feature of placeFeatures(domain,place)) {
            if (mentions(text, feature.name)) { relevantDetails.push(featureLine(place,feature)); }
        }
        for (const actor of actors) {
            if (actor.locationKey === key && mentions(text,actor.displayName)) {
                relevantDetails.push(escapeMapPromptText(actor.displayName) + '最后记录在' + escapeMapPromptText(place.name));
            }
        }
    }
    const routes: string[] = [];
    for (const link of links) {
        const next = current && directDestination(link, current.key, index);
        if (next) { routes.push('可直接到达：' + directLine(next,link)); }
        else if (mentionedLinks.has(link)) {
            routes.push('已知路线：' + escapeMapPromptText(index.get(link.from)!.name) + (link.bidirectional ? ' ↔ ' : ' → ')
                + escapeMapPromptText(index.get(link.to)!.name) + '（' + routeLabel(link) + '）');
        }
    }
    // Give each kind of fact a turn under the shared budget, even at a busy crossroads.
    const groups = [destinations, localFeatures, routes, relevantDetails];
    const longest = Math.max(...groups.map(group => group.length));
    for (let i = 0; i < longest; i++) {
        for (const group of groups) { if (group[i]) { append(group[i]); } }
    }
    if (current) {
        for (const value of [current.atmosphere, current.access, current.landscape]) {
            if (value) { append('地点常态：' + escapeMapPromptText(value,70)); }
        }
    }
    if (scope === 'background') {
        // Maintenance also needs an overview when the player has no confirmed location.
        for (const place of locations) {
            if (place !== current) { append('已知地点：' + locationPath(place,index)); }
        }
        for (const link of links) {
            append(escapeMapPromptText(index.get(link.from)!.name) + (link.bidirectional ? ' ↔ ' : ' → ')
                + escapeMapPromptText(index.get(link.to)!.name) + '（' + routeLabel(link) + '）');
        }
    }
    return [...lines,closing].join('\n');
}
