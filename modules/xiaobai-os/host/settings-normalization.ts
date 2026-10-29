import { normalizeMapSettings } from '../apps/map/settings.js';
import type { MapSettings } from '../apps/map/types.js';
import { normalizeDiceSettings } from '../apps/dice/settings.js';
import type { DiceSettings } from '../apps/dice/types.js';
import { normalizeWorldSettings } from '../apps/world/settings.js';
import type { WorldSettings } from '../apps/world/types.js';
import type { XiaobaiOsSettings as XiaobaiOsSettingsRoot } from '../types.js';
import { jsonValuesEqual } from './json-values-equal.js';
import { normalizeAppOrder } from '../shell/app-order.js';

type UnknownRecord = Record<string, unknown>;
const DEFAULT_OS_ENABLED = true;

export type XiaobaiOsSettings = XiaobaiOsSettingsRoot<{
    map: MapSettings;
    dice: DiceSettings;
    world: WorldSettings;
}>;

export const LEGACY_FOURTH_WALL_SETTING_KEYS: readonly string[] = Object.freeze([]);

export type LegacyFourthWallSettingKey = (typeof LEGACY_FOURTH_WALL_SETTING_KEYS)[number];

function isRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): UnknownRecord {
    return isRecord(value) ? value : {};
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

export function createDefaultXiaobaiOsSettings(): XiaobaiOsSettings {
    return {
        enabled: DEFAULT_OS_ENABLED,
        appOrder: [],
        apps: {
            map: normalizeMapSettings(undefined),
            dice: normalizeDiceSettings(undefined),
            world: normalizeWorldSettings(undefined),
        },
    };
}

/**
 * Normalizes user preferences by their current owners. Obsolete root/app version
 * markers are intentionally not copied into the installed settings object.
 */
export function normalizeXiaobaiOsSettings(value: unknown): XiaobaiOsSettings {
    const root = recordOrEmpty(value);
    const apps = recordOrEmpty(root.apps);
    return {
        enabled: booleanOr(root.enabled, DEFAULT_OS_ENABLED),
        appOrder: normalizeAppOrder(root.appOrder),
        apps: {
            map: normalizeMapSettings(apps.map),
            dice: normalizeDiceSettings(apps.dice),
            world: normalizeWorldSettings(apps.world),
        },
    };
}


export function isXiaobaiOsSettings(value: unknown): value is XiaobaiOsSettings {
    if (!isRecord(value) || typeof value.enabled !== 'boolean' || !isRecord(value.apps)) {
        return false;
    }
    const normalized = normalizeXiaobaiOsSettings(value);
    return jsonValuesEqual(value, normalized);
}

// This fork starts in its own namespace; it never consumes or erases upstream preferences.
export function migrateUpstreamFourthWallSettings(_value: unknown): {
    value: XiaobaiOsSettings; legacyKeys: LegacyFourthWallSettingKey[];
} {
    return { value: createDefaultXiaobaiOsSettings(), legacyKeys: [] };
}
