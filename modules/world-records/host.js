import { createNoteStore } from '../story-planner/storage.js';
import { createWorldCardData } from '../kitchen-data/world.js';
import { plannerSnapshot } from '../story-planner/notes.js';
import { ambientControl, ambientPrompt, mapLocalConditions } from '../story-state/ambient.js';
import { readInvolvement } from '../story-state/involvement.js';
import { protagonistIdentity } from '../story-state/protagonist-identity.js';
import { registerInvolvement, registerMapConditions, registerSituationCatalog } from '../story-state/situation-links.js';
import { availableStoryRecords } from '../story-state/records.js';
import { worldStoryRecords } from './world-story-state.js';
import { createWorldStorage } from './storage.js';
import { createWorldService } from './service.js';
import { createProtagonistView, createSuspenseBook } from '../story-state/view.js';
import { memoryRecords } from './imports.js';
import { readWorldSources, registerWorldSource, registerWorldAuthority, storyIdentityKey, subscribeWorldSources } from './sources.js';
import { createAuthorityRuntime } from './authority-runtime.js';
import { captureStoryIdentity } from '../xiaobai-os/host/story-identity.js';
import { registerWorldBridge, publishWorldBridgeState } from './bridge.js';
import { registerTurnRuntime } from './turn-runtime.js';
import { getSummarySourceEnd } from '../story-summary/generate/source-boundary.js';
import { captureRangeSource, isRangeSourceCurrent } from '../story-summary/data/turn-source.js';
import { memoryDigest } from '../story-summary/data/memory-policy.js';
import { buildUpdateContext, UPDATE_PREFIX } from './update-context.js';

export function createWorldArchive({ getContext, createOpening, getAccountId = () => 'default-user', getMemorySnapshot, getAmbientPreferences, getMount, isVisible, onError, onAuthorityChange = () => {} }) {
    const sourceIdentity = () => storyIdentityKey(captureStoryIdentity(getContext()));
    const identity = (branch = getMemorySnapshot()?.store?.dataBranch) => { const story = sourceIdentity(); return story ? JSON.stringify([getAccountId(), story, ...(branch ? [branch] : [])]) : ''; };
    const storage = createWorldStorage();
    let authority, latestState = null;
    const service = createWorldService({ storage, getIdentity: identity, isSourceCurrent: turn => !!turn
        && isRangeSourceCurrent(turn.source, getContext().chat || [])
        && getSummarySourceEnd(getContext().chat, turn.source.end) >= turn.source.end,
        isUpdateSourceCurrent: update => !!update && isRangeSourceCurrent(update.source, getContext().chat || [])
            && getSummarySourceEnd(getContext().chat, update.source.end) >= update.source.end,
        getReviewContext: () => {
            const snapshot = getMemorySnapshot();
            return { available: !!snapshot?.enabled && snapshot.invalidFrom === undefined && !snapshot.store?.summaryInvalid,
                history: snapshot?.store?.summaryHistory || [], storyRecords: snapshot?.store?.json?.storyRecords || [] };
        }, onChanged: (state, owner) => {
        if (owner === identity()) latestState = state;
        authority?.publish(state, owner);
        publishWorldBridgeState(sourceIdentity(), owner, state);
    } });
    const initialize = createOpening?.({getContext,identity,service});
    const unregisterBridge = registerWorldBridge(() => ({ storyIdentity: sourceIdentity(), identity: identity(), service }));
    authority = createAuthorityRuntime({ getIdentity: identity, getStoryIdentity: sourceIdentity, sync: async () => {
        const state = await sync(); if (state) service.assertSourcesConsistent(state); return state;
    }, onChange: onAuthorityChange });
    const unregisterAuthority = registerWorldAuthority('world-records', authority.read);
    const unregisterConditions = registerMapConditions((key, atlas) => key && key === captureStoryIdentity(getContext())?.key
        ? mapLocalConditions(authority.read()?.state, getMemorySnapshot(), atlas) : []);
    const unregisterCatalog = registerSituationCatalog(key => {
        if (!key || captureStoryIdentity(getContext())?.key !== key) return [];
        const memory = getMemorySnapshot();
        const baseline = memory?.enabled ? availableStoryRecords(memory.store, memory.invalidFrom) : [];
        return worldStoryRecords(authority.read()?.state, baseline).filter(record => record.kind === 'situation')
            .map(({ id, title }) => ({ id, title }));
    });
    const involvementFor = (world, options) => readInvolvement(world, getMemorySnapshot(), getContext().name1, options);
    const disconnectFocus = registerInvolvement(key => key && captureStoryIdentity(getContext())?.key === key ? involvementFor(authority.read()?.state, {includeAgendas:true}) : []);
    const protagonist = createProtagonistView({ getInvolvement: involvementFor, getSnapshot: getMemorySnapshot, getPlayerName: () => getContext().name1 });
    const views = { overview: protagonist, clues: createSuspenseBook({getSnapshot:getMemorySnapshot, clues:true}), suspense: createSuspenseBook({ getSnapshot: getMemorySnapshot }) };
    let disposed = false, scheduled = false, epoch = 0;
    const observation = () => {
        const context = getContext(), chat = context.chat || [], snapshot = getMemorySnapshot();
        return { chat, snapshot, end: getSummarySourceEnd(chat, chat.length - 1) };
    };
    const observationDigest = value => memoryDigest({ source: value.end >= 0 ? captureRangeSource(value.chat, 0, value.end) : null, length: value.chat.length,
        end: value.end, enabled: !!value.snapshot?.enabled, invalidFrom: value.snapshot?.invalidFrom ?? null, history: value.snapshot?.store?.summaryHistory || [] });
    async function sync() {
        const key = identity(), token = epoch; if (!key || disposed) return null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const input = observation(), digest = observationDigest(input);
            try {
                await service.syncTurns(input.chat, { end: input.end, history: input.snapshot?.store?.summaryHistory || [],
                    memoryAvailable: !!input.snapshot?.enabled,
                    guard: () => token === epoch && key === identity() && !disposed && observationDigest(observation()) === digest });
                await service.autoConfirm({ guard: () => token === epoch && key === identity() && !disposed && observationDigest(observation()) === digest });
            } catch (error) {
                if (token === epoch && key === identity() && !disposed && observationDigest(observation()) !== digest) continue;
                throw error;
            }
            if (token !== epoch || key !== identity() || disposed) throw new Error('正文来源读取期间对话已切换');
            if (observationDigest(observation()) !== digest) continue;
            const state = await service.sync(readWorldSources().filter(s => s.identity === sourceIdentity()));
            return token === epoch && key === identity() && !disposed ? state : null;
        }
        throw new Error('正文来源仍在变化，请稍后重试');
    }
    const unregisterTurns = registerTurnRuntime({ async prepare(start, end, { unified = false } = {}) {
        const owner = identity(), token = epoch, scope = service.scopeVersion();
        if (!owner || disposed) throw new Error('请先选择对话后整理记忆');
        const state = await sync();
        if (!state) throw new Error('世界来源尚未就绪');
        const receipt = service.memorySourceReceipt(state, getContext().chat, start, end);
        if (unified) service.assertSourcesConsistent(state);
        const memorySnapshot = getMemorySnapshot(), store = memorySnapshot?.store;
        if (unified && (!memorySnapshot?.enabled || !store || memorySnapshot.invalidFrom !== undefined)) throw new Error('剧情记忆或原文来源尚未就绪，不能读取完整更新基线，请先完成恢复');
        const memoryVersion = snapshot => memoryDigest([snapshot?.json || {}, (snapshot?.summaryHistory || []).map(batch =>
            [batch.endMesId, batch.summary, batch.roundRevisions, batch.layers, batch.reviewLayers, batch.memoryTags,
                batch.floorEntry?.omitted, batch.floorEntry?.deleted, batch.legacyRoundChanges, batch.legacyRoundBase, batch.importedRounds,
                batch.involvement, batch.ambient])]);
        const memoryBasis = unified ? memoryVersion(store) : '';
        const updateContext = unified ? buildUpdateContext(state, store, getContext().chat, receipt, memorySnapshot.keepVisibleTurns) : null;
        if (updateContext) {
            updateContext.involvementContext = involvementFor(state);
            updateContext.playerNames = [...protagonistIdentity(state.entities,getContext().name1).names];
        }
        const prefs = getAmbientPreferences?.();
        if (updateContext && prefs) updateContext.ambientControl = ambientControl(store, state, receipt, prefs);
        const assertCurrent = () => {
            if (disposed || owner !== identity() || token !== epoch || scope !== service.scopeVersion()
                || latestState?.worldId !== state.worldId || latestState?.branchId !== state.branchId
                || !isRangeSourceCurrent(receipt.source, getContext().chat || [])
                || getSummarySourceEnd(getContext().chat, end) < end) throw new Error('聊天、世界分支或正文来源已变化，本次记忆未写入');
            if (unified && (latestState?.version !== state.version || memoryVersion(getMemorySnapshot()?.store) !== memoryBasis)) {
                throw new Error('完整世界或记忆基线已更新，本次整理结果未保存，请重新整理');
            }
        };
        assertCurrent();
        return { receipt, updateContext, getAmbientPreferences, assertCurrent, async validate() { await service.read(); assertCurrent(); },
            async deliver() {
                if (disposed || owner !== identity() || token !== epoch || scope !== service.scopeVersion()) throw new Error('世界分支已切换，提案仍保留在原摘要批次中');
                const delivered = await sync();
                return delivered?.sources[`${UPDATE_PREFIX}${receipt.id}`] || null;
            } };
    } });
    const unregisterMemory = registerWorldSource('memory', () => {
        const snapshot = getMemorySnapshot();
        return { available: !!snapshot?.enabled, identity: sourceIdentity(), label: '剧情记忆', records: snapshot?.invalidFrom === undefined ? memoryRecords(snapshot?.store) : [] };
    });
    const unsubscribe = subscribeWorldSources(() => {
        if (scheduled || disposed) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            sync().then(state => { if (state) for (const [route, view] of Object.entries(views)) if (isVisible(route) && !view.isEditing()) view.show(state); }).catch(error => onError(error));
        });
    });
    const noteStore = createNoteStore();
    return {
        cardData: createWorldCardData({ identity, storage, service, noteStore }),
        initialize,
        plannerSnapshot() {
            const ctx = getContext();
            const snap = plannerSnapshot(authority.read()?.state, getMemorySnapshot(), ctx.chat || [], identity());
            if (snap) {
                const card = ctx.characters?.[ctx.characterId];
                snap.cast = { player: ctx.name1, character: ctx.name2, description: card?.description,
                    personality: card?.personality, scenario: card?.scenario };
            }
            return snap;
        },
        async prepare(query) {
            const factText = await authority.prepare(query, getContext().name1, state => involvementFor(state));
            const state = authority.read()?.state, memory = getMemorySnapshot();
            if (!state || !memory?.enabled || memory.invalidFrom != null) return factText;
            const local = ambientPrompt(memory.store, state, worldStoryRecords(state, availableStoryRecords(memory.store)), getAmbientPreferences?.() || {});
            return [factText, local].filter(Boolean).join('\n');
        },
        async open(route = 'overview') {
            const view = views[route]; if (!view) return;
            view.mount(getMount(route));
            if (!identity()) { view.empty(); return; }
            await service.ensure(getContext().chatId || '当前故事');
            const state = await sync(); if (isVisible(route) && !disposed) view.show(state || await service.read());
        },
        reset() { epoch++; latestState = null; service.invalidate(); authority.reset(); for (const view of Object.values(views)) view.reset(); },
        dispose() { disposed = true; service.invalidate(); authority.reset(); disconnectFocus(); unregisterConditions(); unregisterCatalog(); unregisterTurns(); unregisterBridge(); unregisterAuthority(); unsubscribe(); unregisterMemory(); for (const view of Object.values(views)) view.reset(); storage.close().catch(error => onError(error)); },
    };
}
