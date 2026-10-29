import { getContext } from '../../../../../../extensions.js';
import {
    clearAllRules as clearAllCoreRules,
    clearRule as clearCoreRule,
    getParentPath,
    getRuleNode,
    getRulesSnapshot,
    replaceRules,
    setRule,
    validate,
} from './guard-core.js';

const TK_RULES_V2_KEY = 'TK_RULES_V2';

export {
    getParentPath,
    getRuleNode,
    setRule,
    validate,
};

export function loadRulesFromMeta() {
    try {
        const meta = getContext()?.chatMetadata || {};
        replaceRules(meta[TK_RULES_V2_KEY] || {});
    } catch {
        replaceRules({});
    }
}

export function saveRulesToMeta() {
    try {
        const meta = getContext()?.chatMetadata || {};
        meta[TK_RULES_V2_KEY] = getRulesSnapshot();
        getContext()?.saveMetadataDebounced?.();
    } catch (caughtError) { console.warn({ source: import.meta.url, operation: "saveRulesToMeta" }, caughtError); }
}

export function clearRule(path) {
    clearCoreRule(path);
    saveRulesToMeta();
}

export function clearAllRules() {
    clearAllCoreRules();
    saveRulesToMeta();
}
