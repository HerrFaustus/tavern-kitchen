import type { MAP_ARTIFICIAL_LIGHTS, MAP_ICON_TOKENS, MAP_LIGHTING_SPACES, MAP_MATERIALS, MAP_NATURAL_LIGHTS } from './semantics.js';

export type MapLocationScale = 'world' | 'region' | 'city' | 'district' | 'building' | 'floor' | 'room' | 'outdoor';
export type MapTerrain = 'urban' | 'plain' | 'forest' | 'water' | 'mountain' | 'desert' | 'snow';
export type MapLocationStatus = 'mentioned' | 'visited';
export type MapLinkKind = 'door' | 'stairs' | 'elevator' | 'path' | 'road' | 'portal' | 'passage';
export type MapSceneStatus = 'uninitialized' | 'active';
export type MapSceneMood = 'neutral' | 'warm' | 'cold' | 'dark' | 'mystic' | 'danger' | 'calm';

export type MapElementCategory =
    | 'wall'
    | 'road'
    | 'water'
    | 'terrain'
    | 'furniture'
    | 'decoration'
    | 'door'
    | 'danger'
    | 'marker'
    | 'actor'
    | 'label'
    | 'grid'
    | 'magic'
    | 'secret'
    | 'light';

export type MapElementShape = 'rect' | 'circle' | 'path' | 'curve' | 'icon' | 'label';

/** Closed logic semantics. Visual glyphs live in MapIconToken. */
export type MapElementKind =
    | 'door'
    | 'stairs'
    | 'elevator'
    | 'portal'
    | 'passage'
    | 'entrance'
    | 'exit'
    | 'north'
    | 'south'
    | 'east'
    | 'west'
    | 'up'
    | 'down'
    | 'trap'
    | 'chest'
    | 'marker'
    | 'player'
    | 'actor';

/** Closed material recipes understood by the renderer. */
export type MapMaterial = (typeof MAP_MATERIALS)[number];

/** Local renderer vocabulary; arbitrary SVG, CSS and remote icon names are never persisted. */
export type MapIconToken = (typeof MAP_ICON_TOKENS)[number];

export interface RectGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CircleGeometry {
    x: number;
    y: number;
    radius: number;
}

export interface PointGeometry {
    x: number;
    y: number;
}

export interface PointsGeometry {
    points: Array<[number, number]>;
}

export type MapGeometry = RectGeometry | CircleGeometry | PointGeometry | PointsGeometry;

export interface MapElement {
    id: string;
    category: MapElementCategory;
    shape: MapElementShape;
    geometry: MapGeometry;
    kind?: MapElementKind;
    icon?: MapIconToken;
    label?: string;
    actorKey?: string;
    material?: MapMaterial;
    certainty?: 'confirmed' | 'inferred' | 'unknown';
    closed?: boolean;
    /** Clockwise degrees around a rectangle/circle centre; absent means axis-aligned. */
    rotation?: number;
}

export interface MapSceneLighting {
    space: (typeof MAP_LIGHTING_SPACES)[number];
    natural: (typeof MAP_NATURAL_LIGHTS)[number];
    artificial: (typeof MAP_ARTIFICIAL_LIGHTS)[number];
}

export interface MapScene {
    key: string;
    name: string;
    status: MapSceneStatus;
    viewBox: [number, number, number, number];
    mood?: MapSceneMood;
    lighting?: MapSceneLighting;
    elements: MapElement[];
}

export const bearings = ['N','NE','E','SE','S','SW','W','NW'] as const;
export const compassLabels = {N:'北',NE:'东北',E:'东',SE:'东南',S:'南',SW:'西南',W:'西',NW:'西北'} as const;
export const geographyLabels = {
    extent: '范围与边界', layout: '空间格局', role: '功能与地位',
    landscape: '地貌与环境', life: '居民与日常', customs: '秩序与习俗',
    history: '来历与变迁', access: '通行条件', atmosphere: '常态印象',
} as const;
export const featureLabels = {
    description: '外观', positionHint: '所在位置', purpose: '用途', history: '来历与痕迹', state: '当前状态',
} as const;
export const geographyFields = Object.keys(geographyLabels) as Array<keyof typeof geographyLabels>;
export const featureFields = Object.keys(featureLabels) as Array<keyof typeof featureLabels>;

export interface PlaceFeature extends Partial<Record<keyof typeof featureLabels, string>> {
    name: string;
    placement?: {bearing: typeof bearings[number]; relativeTo?: string};
}

export interface MapLocation extends Partial<Record<keyof typeof geographyLabels, string>> {
    key: string;
    name: string;
    scale: MapLocationScale;
    status: MapLocationStatus;
    parent?: string;
    sceneKey?: string;
    brief?: string;
    features?: Array<string | PlaceFeature>;
    /** Compass direction relative to the containing area, when established. */
    bearing?: typeof bearings[number];
    /** Stable map position within the parent region; north is smaller y. Not GPS or distance. */
    position?: [number, number];
    terrain?: MapTerrain;
}

export interface MapLink {
    id: string;
    from: string;
    to: string;
    kind: MapLinkKind;
    label?: string;
    bidirectional: boolean;
}

export interface MapActorPosition {
    actorKey: string;
    displayName: string;
    locationKey: string;
}

export interface MapAtlas {
    locations: MapLocation[];
    links: MapLink[];
    actors: MapActorPosition[];
}

export interface MapDomainV1 {
    schemaVersion: 1;
    revision: number;
    atlas: MapAtlas;
    scenes: Record<string, MapScene>;
}
