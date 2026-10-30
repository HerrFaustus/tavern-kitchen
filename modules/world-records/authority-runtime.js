import { canonical } from './domain.js';
import { buildAuthorityContext } from './authority.js';

export function createAuthorityRuntime({ getIdentity, getStoryIdentity, sync, onChange = () => {} }) {
    let snapshot = null, fingerprint = '', epoch = 0;
    const current = () => snapshot?.owner === getIdentity() ? snapshot : null;
    return {
        read() { const value = current(); return value ? { identity: value.identity, state: value.state } : null; },
        publish(state, owner) {
            if (owner !== getIdentity()) return;
            if (!state) { if (snapshot) { snapshot = null; fingerprint = ''; onChange(); } return; }
            const next = canonical([owner, state.branchId, state.entities.map(({ id, name, kind, aliases, bindings, fields }) => ({ id, name, kind, aliases, bindings, fields }))]);
            snapshot = { owner, identity: getStoryIdentity(), state };
            if (next !== fingerprint) { fingerprint = next; onChange(); }
        },
        async prepare(query = '') {
            const owner = getIdentity(), token = epoch;
            if (!owner) return '';
            try { await sync(); }
            catch (error) { snapshot = null; fingerprint = ''; onChange(); throw error; }
            if (token !== epoch || owner !== getIdentity()) throw new Error('世界状态读取期间对话已切换');
            return buildAuthorityContext(current()?.state, query);
        },
        reset() { epoch++; snapshot = null; fingerprint = ''; onChange(); },
    };
}
