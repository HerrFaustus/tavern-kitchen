import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacySettings } from '../migration.js';
import { upgradeProfiles, vectorProfiles, acceptsProfile } from '../profiles.js';
import { agentSettingsForProfile, resolveAgentProfile } from '../profile-runtime.js';
import { applyPresetAction, createPreset, resolveFeaturePreset, TEXT_API_SETTINGS_KEY } from '../model.js';
import { snapshotTavernApi } from '../tavern-import.js';
import { createTextApiRepository } from '../repository.js';

const legacyAgent = { currentPresetName: '主助手', presets: {
    '主助手': { provider: 'openai-compatible', modelConfigs: { 'openai-compatible': {
        baseUrl: 'https://fixture.test/v1', apiKey: 'fake-secret', model: 'old-model', temperature: 0.4, sendTemperature: false,
    } } },
} };
const migrated = () => upgradeProfiles(migrateLegacySettings({}), legacyAgent, {
    embeddingApi: { provider: 'custom', url: 'https://embedding.test/v1', key: 'fake-vector', model: 'embed-old' },
});
test('upgrade keeps old profiles, binds each former consumer, and is idempotent', () => {
    const settings = migrated();
    assert.equal(settings.bindings.summary, 'summary-default');
    assert.equal(resolveFeaturePreset(settings, 'world').model, 'old-model');
    assert.equal(resolveFeaturePreset(settings, 'memory').apiKey, 'fake-secret');
    assert.equal(resolveFeaturePreset(settings, 'embedding').model, 'embed-old');
    assert.deepEqual(upgradeProfiles(settings, {}), settings);
    assert.equal(resolveAgentProfile(settings, 'world').sendTemperature, false);
    const projected = agentSettingsForProfile(settings, 'world');
    assert.equal(projected.presets['已绑定配置'].modelConfigs['openai-compatible'].model, 'old-model');
});
test('library creation, editing, naming never rebind consumers; used profiles cannot be deleted', () => {
    const settings = migrated(), bindings = structuredClone(settings.bindings);
    const added = applyPresetAction(settings, 'library', { type: 'add', id: 'new', name: '新配置',
        preset: createPreset('new', '新配置', { provider: 'openai-compatible', model: 'new-model' }) });
    assert.deepEqual(added.bindings, bindings);
    const saved = applyPresetAction(added, 'library', { type: 'save', id: 'new', preset: { ...added.presets.at(-1), model: 'edited-model' } });
    assert.deepEqual(saved.bindings, bindings);
    assert.equal(resolveFeaturePreset(saved, 'world').model, 'old-model');
    const renamed = applyPresetAction(saved, 'library', { type: 'rename', id: bindings.world, name: '改名' });
    assert.equal(resolveFeaturePreset(renamed, 'world').name, '改名');
    assert.throws(() => applyPresetAction(renamed, 'library', { type: 'delete', id: bindings.world }), /仍被模块/);
    assert.throws(() => resolveFeaturePreset({ ...settings, bindings: { world: 'missing' } }, 'world'), /未选择/);
});
test('vector consumers resolve selected profiles and reject wrong protocols', () => {
    const settings = migrated();
    const config = vectorProfiles(settings, { enabled: true, embeddingApi: { model: 'stale' } });
    assert.equal(config.embeddingApi.model, 'embed-old');
    assert.equal(config.embeddingApi.key, 'fake-vector');
    assert.equal(acceptsProfile('embedding', createPreset('', '', { provider: 'openai-compatible' })), false);
    assert.equal(acceptsProfile('world', createPreset('', '')), false);
});
test('main API import is a snapshot; connection copy clears model; missing secret is disclosed', async () => {
    const settings = { chat_completion_source: 'custom', custom_url: 'https://snapshot.test/v1',
        temp_openai: 0.6, openai_max_tokens: 2048, top_p_openai: 0.9 };
    const before = structuredClone(settings);
    const source = { mainApi: 'openai', settings, model: 'main-model', secretKeys: { CUSTOM: 'custom' }, findSecret: async key => key === 'custom' ? 'fake-key' : null };
    const full = await snapshotTavernApi(source);
    const connection = await snapshotTavernApi(source, true);
    assert.equal(full.preset.model, 'main-model');
    assert.equal(connection.preset.model, '');
    assert.equal(connection.preset.temperature, null);
    assert.equal(connection.preset.baseUrl, full.preset.baseUrl);
    full.preset.model = 'other'; assert.deepEqual(settings, before);
    const missing = await snapshotTavernApi({ ...source, findSecret: async () => null });
    assert.match(missing.message, /补填/);
    await assert.rejects(snapshotTavernApi({ ...source, mainApi: 'textgenerationwebui' }), /不是聊天补全/);
    await assert.rejects(snapshotTavernApi({ ...source, settings: { chat_completion_source: 'unknown' } }), /暂不支持/);
});
test('failed migration preserves old data and can retry; mutation rejects type changes in use', async () => {
    const records = { [TEXT_API_SETTINGS_KEY]: migrateLegacySettings({}), storySummaryPanelConfig: {} };
    const initial = structuredClone(records);
    let fail = true;
    const common = { getStrict: async key => structuredClone(records[key] ?? null), clearCache() {},
        updateAndSave: async fn => { const draft = structuredClone(records); fn(draft); if (fail) throw new Error('offline'); Object.assign(records, draft); } };
    const agent = { getStrict: async () => legacyAgent };
    const planner = { getStrict: async () => null };
    const repo = createTextApiRepository({ common, agent, planner });
    await assert.rejects(repo.load(), /offline/); assert.deepEqual(records, initial);
    fail = false; const recovered = await repo.load();
    assert.equal(recovered.profilesVersion, 1);
    const p = resolveFeaturePreset(recovered, 'world');
    await assert.rejects(repo.mutate('library', { type: 'save', id: p.id, preset: { ...p, kind: 'embedding' } }), /接口类型/);
    assert.equal(resolveFeaturePreset(await repo.load(), 'world').kind, 'text');
});

test('migration also retains configured inactive provider connections', () => {
    const agent = structuredClone(legacyAgent);
    agent.presets['主助手'].modelConfigs.anthropic = { baseUrl: 'https://alternate.test/v1',
        apiKey: 'fake-alternate', model: 'alternate-model' };
    const settings = upgradeProfiles(migrateLegacySettings({}), agent);
    const alternate = settings.presets.find(p => p.apiKey === 'fake-alternate');
    assert.equal(alternate.provider, 'anthropic');
    assert.equal(alternate.model, 'alternate-model');
    assert.equal(resolveFeaturePreset(settings, 'world').model, 'old-model');
});
