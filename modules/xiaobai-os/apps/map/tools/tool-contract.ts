import { bearings, featureLabels, geographyLabels } from '../../../domains/map/types.js';
import type { MaintenanceFunctionDeclaration } from '../../../capabilities/maintenance/registry.js';
import {
    MAX_MAP_ACTORS,
    MAX_MAP_BRIEF_LENGTH, MAX_MAP_FEATURE_NAME_LENGTH,
    MAX_MAP_ID_LENGTH,
    MAX_MAP_LABEL_LENGTH,
    MAX_MAP_LINKS,
    MAX_MAP_LOCATIONS,
    MAX_MAP_NAME_LENGTH,
} from '../../../domains/map/invariants.js';
import { DEFAULT_ATLAS_READ_LIMIT, MAX_ATLAS_QUERY_LENGTH, MAX_ATLAS_READ_LIMIT } from './atlas-reader.js';

export const MAP_MAINTENANCE_TOOL_NAMES = Object.freeze({
    ATLAS_READ: 'MapAtlasRead',
    ATLAS_EDIT: 'MapAtlasEdit',
    SCENE_READ: 'MapSceneRead',
    SCENE_EDIT: 'MapSceneEdit',
});

const locationScale = ['world', 'region', 'city', 'district', 'building', 'floor', 'room', 'outdoor'];
const locationStatus = ['mentioned', 'visited'];
const linkKind = ['door', 'stairs', 'elevator', 'path', 'road', 'portal', 'passage'];
const EDIT_ITEM_REPORTS = [
    'applied and skipped identify edits by index, id and, when available, collection. applied may include changed; skipped includes reason and hint. warnings lists additional notices.',
    'inputIssues, when present on a skipped edit, lists invalid arguments as {code,path,message,expected}. These paths refer to this tool call.',
    'A skipped edit may include validation:{issues:[{code,path,message}],unchecked}. Issues refer to the candidate map document; unchecked lists branches or reference checks that require valid structure first. Correct the reported issues together. A related location group shares one validation report on its first skipped entry.',
].join('\n');
const READ_REPORT = 'Returns {ok,status,changed,applied,skipped,warnings,data}. A successful read has status unchanged and changed false; it does not edit the draft.';

/** Result fields shared by the maintenance and administrator atlas reads. */
export const MAP_ATLAS_READ_RESULT = [
    'Continue collection reads with nextOffset while it is not null, keeping the same mode and filters.',
    'Read status includes containment: visiting a place also means its containing locations have been visited.',
    'needsRegion marks a concrete place without a containing region. Use the locations filter needsRegion: true to read these places for an atlas correction; worlds and regions themselves are not marked.',
].join('\n');

export const MAP_SCENE_READ_DESCRIPTION = [
    'Read one scene layout in MapSceneEdit vocabulary: {scene,viewBox,mood?,lighting?,elements}, or null when no layout exists.',
    'Use it to assess a layout or obtain current element IDs before patching it. Location names, scales and visit status belong to the atlas.',
].join('\n');

export function mapTools(saveDescription: string): readonly MaintenanceFunctionDeclaration[] { return Object.freeze([
    {
        type: 'function',
        function: {
            name: MAP_MAINTENANCE_TOOL_NAMES.ATLAS_READ,
            description: [
                'Read locations, links and actor positions in the current atlas draft.',
                READ_REPORT,
                MAP_ATLAS_READ_RESULT,
                'Use it to page an atlas injected as a summary, to confirm a key, or to see edits made during this run.',
            ].join('\n'),
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['summary', 'document', 'locations', 'links', 'actors'], description: 'Default summary. Collection modes are paged.' },
                    query: { type: 'string', maxLength: MAX_ATLAS_QUERY_LENGTH, description: 'Case-insensitive text filter for the selected collection.' },
                    parent: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Optional exact parent key filter for locations.' },
                    status: { type: 'string', enum: locationStatus, description: 'Optional location status filter.' },
                    needsRegion: { type: 'boolean', description: 'Optional location filter for missing region ownership. Omit to include both assigned and unassigned places.' },
                    from: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Optional endpoint filter for links.' },
                    to: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Optional other-endpoint filter for links.' },
                    kind: { type: 'string', enum: linkKind, description: 'Optional link kind filter.' },
                    actorKey: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Optional exact actor key filter.' },
                    limit: { type: 'integer', minimum: 1, maximum: MAX_ATLAS_READ_LIMIT, description: `Records per page. Default ${DEFAULT_ATLAS_READ_LIMIT}, maximum ${MAX_ATLAS_READ_LIMIT}.` },
                    offset: { type: 'integer', minimum: 0, description: 'Zero-based record offset after filtering. Default 0.' },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: MAP_MAINTENANCE_TOOL_NAMES.ATLAS_EDIT,
            description: [
                'Add, update or remove atlas locations, routes and world-level actor positions.',
                saveDescription,
                EDIT_ITEM_REPORTS,
                'Use it for places, their hierarchy, routes and movement between places.',
            ].join('\n'),
            parameters: {
                type: 'object',
                properties: {
                    locations: {
                        type: 'array',
                        maxItems: MAX_MAP_LOCATIONS,
                        description: `Upsert setting-authored or coherently created places, including unvisited destinations. Parents may appear anywhere in the same call. Declarations connected by existing or requested parent chains are validated and accepted together; independent groups can succeed separately. The atlas holds at most ${MAX_MAP_LOCATIONS} locations.`,
                        items: {
                            type: 'object',
                            properties: {
                                key: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Stable identity; keep it unchanged when the display name changes.' },
                                name: { type: 'string', maxLength: MAX_MAP_NAME_LENGTH, description: 'Stable in-world place name; respect author-provided names.' },
                                scale: { type: 'string', enum: locationScale, description: 'Place hierarchy scale; default room for a new location.' },
                                status: { type: 'string', enum: locationStatus, description: 'Confirmed discovery state. New places default to mentioned; the player\'s actual location is always visited.' },
                                parent: {
                                    type: ['string', 'null'],
                                    maxLength: MAX_MAP_ID_LENGTH,
                                    description: 'Existing or same-call parent key. Concrete places need a region ancestor, directly or through another place. Worlds and regions may be at the Atlas root; null clears their parent.',
                                },
                                featureUpdates: {
                                    type: 'array', maxItems: 16, description: 'Patch only changed landmarks by their existing name. Omit other landmarks and unchanged fields.',
                                    items: { type: 'object', required: ['name'], additionalProperties: false, properties: {
                                        name: {type:'string',maxLength:MAX_MAP_FEATURE_NAME_LENGTH},
                                        ...Object.fromEntries(Object.entries(featureLabels).map(([key, description]) =>
                                            [key, {type:['string','null'], maxLength:MAX_MAP_BRIEF_LENGTH, description}])),
                                        placement: {type:['object','null'], additionalProperties:false, required:['bearing'], properties:{
                                            bearing:{type:'string',enum:bearings}, relativeTo:{type:'string',maxLength:MAX_MAP_FEATURE_NAME_LENGTH},
                                        }, description:'Explicit compass direction within this place, or relative to another named feature here. Replace as a unit; null clears it.'},
                                        remove: {type:'boolean',description:'Remove this feature when the story establishes its disappearance.'},
                                    } },
                                },
                                ...Object.fromEntries(Object.entries(geographyLabels).map(([key, description]) =>
                                    [key, {type:['string','null'], maxLength:MAX_MAP_BRIEF_LENGTH, description}])),
                                bearing: {type:['string','null'], enum:[...bearings,null], description:'Known compass direction within the parent area (N = north). Omit if unknown.'},
                                brief: { type: ['string','null'], maxLength: MAX_MAP_BRIEF_LENGTH, description: 'Lasting panorama: describe spatial layout, recognizable sensory details and everyday use at the level supported by the source. Keep temporary developments in situations.' },
                            },
                            required: ['key', 'name'], additionalProperties: false,
                        },
                    },
                    links: {
                        type: 'array',
                        maxItems: MAX_MAP_LINKS,
                        description: `Upsert world routes between existing or same-call locations. Respect authored connections and add plausible connections for newly created destinations. The atlas holds at most ${MAX_MAP_LINKS} links.`,
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Optional. Omit for the stable endpoint/kind-derived id; use an explicit id only for parallel same-kind routes.' },
                                from: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Existing or same-call source location key.' },
                                to: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Existing or same-call destination location key.' },
                                kind: { type: 'string', enum: linkKind, description: 'Route type connecting the two places.' },
                                label: { type: 'string', maxLength: MAX_MAP_LABEL_LENGTH, description: 'Optional short route name.' },
                                bidirectional: { type: 'boolean', description: 'Defaults true.' },
                            },
                            required: ['from', 'to', 'kind'], additionalProperties: false,
                        },
                    },
                    actors: {
                        type: 'array',
                        maxItems: MAX_MAP_ACTORS,
                        description: `Set world-level actor locations. The atlas holds at most ${MAX_MAP_ACTORS} actors.`,
                        items: {
                            type: 'object',
                            properties: {
                                actorKey: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Stable actor identity. The player is always "player".' },
                                displayName: { type: 'string', maxLength: MAX_MAP_NAME_LENGTH, description: 'Optional current display name. Omit it to preserve an existing actor name.' },
                                locationKey: { type: 'string', maxLength: MAX_MAP_ID_LENGTH, description: 'Existing or same-call location key the actor is now in.' },
                            },
                            required: ['actorKey', 'locationKey'], additionalProperties: false,
                        },
                    },
                    remove: {
                        type: 'object',
                        description: 'Remove records for explicit correction, disappearance or destruction, not merely because an actor left a place. Removing a location also removes its descendants, routes, actor positions and scenes.',
                        properties: {
                            locationKeys: { type: 'array', maxItems: MAX_MAP_LOCATIONS, items: { type: 'string', maxLength: MAX_MAP_ID_LENGTH } },
                            linkIds: { type: 'array', maxItems: MAX_MAP_LINKS, items: { type: 'string', maxLength: MAX_MAP_ID_LENGTH } },
                            actorKeys: { type: 'array', maxItems: MAX_MAP_ACTORS, items: { type: 'string', maxLength: MAX_MAP_ID_LENGTH } },
                        },
                        additionalProperties: false,
                    },
                },
                additionalProperties: false,
            },
        },
    },
]); }

export const MAP_MAINTENANCE_TOOLS = mapTools('Edits update the draft; the app saves after the run. Returns {ok,status,changed,applied,skipped,warnings,hint?,data?}. status is updated, unchanged (already matches; success), partial or failed.');
