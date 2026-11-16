<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';
import { createIdentifier } from '../../../../../shared/common/identifier.js';
import { parseMapDomain } from '../../../domains/map/invariants.js';
import { createEmptyMapDomain } from '../../../domains/map/state.js';
import {
    bearings,
    compassLabels,
    type MapDomainV1,
    type MapLinkKind,
    type MapLocation,
    type MapLocationScale,
    type MapLocationStatus,
    type MapTerrain,
    type PlaceFeature,
} from '../../../domains/map/types.js';

type PanelMode = '' | 'add-location' | 'edit-location' | 'delete-location' | 'links' | 'actors';

const props = defineProps<{
    map: MapDomainV1 | null;
    place?: MapLocation;
    busy: boolean;
    disabledReason: string;
    commit: (nextMap: MapDomainV1) => Promise<boolean>;
}>();

const emit = defineEmits<{ (event: 'select', key: string): void }>();

const mode = ref<PanelMode>('');
const formError = ref('');

const locName = ref('');
const locScale = ref<MapLocationScale>('district');
const locStatus = ref<MapLocationStatus>('mentioned');
const locParent = ref('');
const locBearing = ref('');
const locTerrain = ref('');
const locBrief = ref('');
const newFeatureName = ref('');
const newFeatureDesc = ref('');
const confirmDelete = ref(false);

const linkFrom = ref('');
const linkTo = ref('');
const linkKind = ref<MapLinkKind>('road');
const linkLabel = ref('');
const linkBidirectional = ref(true);

const newActorName = ref('');
const newActorIsPlayer = ref(false);
const newActorLocation = ref('');

const locations = computed(() => props.map?.atlas.locations ?? []);
const links = computed(() => props.map?.atlas.links ?? []);
const actors = computed(() => props.map?.atlas.actors ?? []);
const canEdit = computed(() => !props.busy && !props.disabledReason);

const scaleOptions: Array<[MapLocationScale, string]> = [
    ['world', '世界'],
    ['region', '区域'],
    ['city', '城镇'],
    ['district', '街区'],
    ['building', '建筑'],
    ['floor', '楼层'],
    ['room', '房间'],
    ['outdoor', '野外'],
];
const terrainOptions: Array<[MapTerrain, string]> = [
    ['urban', '城镇'],
    ['plain', '平原'],
    ['forest', '森林'],
    ['water', '水域'],
    ['mountain', '山地'],
    ['desert', '荒漠'],
    ['snow', '雪原'],
];
const linkKindOptions: Array<[MapLinkKind, string]> = [
    ['road', '道路'],
    ['path', '小径'],
    ['door', '门'],
    ['stairs', '楼梯'],
    ['elevator', '电梯'],
    ['passage', '通道'],
    ['portal', '传送门'],
];

const placeName = (key: string) => locations.value.find(item => item.key === key)?.name ?? key;

function closePanel() {
    mode.value = '';
    formError.value = '';
    confirmDelete.value = false;
}

function resetLocationForm(source?: MapLocation) {
    locName.value = source?.name ?? '';
    locScale.value = source?.scale ?? 'district';
    locStatus.value = source?.status ?? 'mentioned';
    locParent.value = source?.parent ?? '';
    locBearing.value = source?.bearing ?? '';
    locTerrain.value = source?.terrain ?? '';
    locBrief.value = source?.brief ?? '';
    newFeatureName.value = '';
    newFeatureDesc.value = '';
    confirmDelete.value = false;
}

function openMode(next: PanelMode) {
    formError.value = '';
    if (mode.value === next) {
        closePanel();
        return;
    }
    mode.value = next;
    if (next === 'add-location') {
        resetLocationForm();
    } else if (next === 'edit-location' || next === 'delete-location') {
        resetLocationForm(props.place);
    } else if (next === 'links') {
        linkFrom.value = props.place?.key || locations.value[0]?.key || '';
        linkTo.value = locations.value.find(item => item.key !== linkFrom.value)?.key || '';
        linkKind.value = 'road';
        linkLabel.value = '';
        linkBidirectional.value = true;
    } else if (next === 'actors') {
        newActorName.value = '';
        newActorIsPlayer.value = !actors.value.some(actor => actor.actorKey === 'player');
        newActorLocation.value = props.place?.key || locations.value[0]?.key || '';
    }
}

watch(() => props.place?.key, () => {
    if (mode.value === 'edit-location' || mode.value === 'delete-location') {
        if (props.place) { resetLocationForm(props.place); }
        else { closePanel(); }
    }
});

async function runMutation(mutate: (draft: MapDomainV1) => string | void): Promise<void> {
    formError.value = '';
    const draft = props.map ? structuredClone(toRaw(props.map)) : createEmptyMapDomain();
    try {
        const nextSelection = mutate(draft);
        const validated = parseMapDomain(draft);
        const ok = await props.commit(validated);
        if (ok) {
            if (typeof nextSelection === 'string') { emit('select', nextSelection); }
            if (mode.value === 'add-location' || mode.value === 'delete-location' || mode.value === 'edit-location') {
                closePanel();
            }
        }
    } catch (error) {
        formError.value = error instanceof Error ? error.message : String(error);
    }
}

async function saveLocation() {
    const name = locName.value.trim();
    if (!name) {
        formError.value = '地点名称不能为空。';
        return;
    }
    const isAdd = mode.value === 'add-location';
    const key = isAdd ? `loc-${createIdentifier()}` : props.place?.key;
    if (!key) { return; }
    await runMutation(draft => {
        const existing = isAdd ? undefined : draft.atlas.locations.find(item => item.key === key);
        const updated: MapLocation = {
            ...(existing ? structuredClone(existing) : {}),
            key,
            name,
            scale: locScale.value,
            status: locStatus.value,
        };
        if (locParent.value) { updated.parent = locParent.value; }
        else { delete updated.parent; }
        if (locBearing.value) { updated.bearing = locBearing.value as (typeof bearings)[number]; }
        else { delete updated.bearing; }
        if (locTerrain.value) { updated.terrain = locTerrain.value as MapTerrain; }
        else { delete updated.terrain; }
        if (locBrief.value.trim()) { updated.brief = locBrief.value.trim(); }
        else { delete updated.brief; }
        if (isAdd) {
            draft.atlas.locations.push(updated);
        } else {
            const idx = draft.atlas.locations.findIndex(item => item.key === key);
            if (idx >= 0) { draft.atlas.locations[idx] = updated; }
        }
        return key;
    });
}

async function addFeatureToPlace() {
    const target = props.place;
    const name = newFeatureName.value.trim();
    if (!target || !name) {
        formError.value = '请填写地点要素名称。';
        return;
    }
    const desc = newFeatureDesc.value.trim();
    await runMutation(draft => {
        const loc = draft.atlas.locations.find(item => item.key === target.key);
        if (!loc) { return; }
        const list = (loc.features ??= []);
        const entry: PlaceFeature = desc ? { name, description: desc } : { name };
        const existingIdx = list.findIndex(item => (typeof item === 'string' ? item : item.name) === name);
        if (existingIdx >= 0) { list[existingIdx] = entry; }
        else { list.push(entry); }
        newFeatureName.value = '';
        newFeatureDesc.value = '';
    });
}

async function removeFeatureFromPlace(name: string) {
    const target = props.place;
    if (!target) { return; }
    await runMutation(draft => {
        const loc = draft.atlas.locations.find(item => item.key === target.key);
        if (!loc?.features) { return; }
        loc.features = loc.features.filter(item => (typeof item === 'string' ? item : item.name) !== name);
        // Strip dangling relativeTo references so parseMapDomain invariant stays satisfied.
        for (const item of loc.features) {
            if (typeof item !== 'string' && item.placement?.relativeTo === name) {
                delete item.placement.relativeTo;
            }
        }
        if (!loc.features.length) { delete loc.features; }
    });
}

async function deleteCurrentLocation() {
    const target = props.place;
    if (!target) { return; }
    if (!confirmDelete.value) {
        formError.value = '请先勾选确认删除该地点。';
        return;
    }
    await runMutation(draft => {
        draft.atlas.locations = draft.atlas.locations.filter(item => item.key !== target.key);
        for (const child of draft.atlas.locations) {
            if (child.parent === target.key) { delete child.parent; }
        }
        draft.atlas.links = draft.atlas.links.filter(edge => edge.from !== target.key && edge.to !== target.key);
        draft.atlas.actors = draft.atlas.actors.filter(actor => actor.locationKey !== target.key);
        if (target.sceneKey) { delete draft.scenes[target.sceneKey]; }
        return draft.atlas.locations[0]?.key || '';
    });
}

async function addLink() {
    if (!linkFrom.value || !linkTo.value || linkFrom.value === linkTo.value) {
        formError.value = '请选择两个不同的地点建立连接。';
        return;
    }
    await runMutation(draft => {
        draft.atlas.links.push({
            id: `link-${createIdentifier()}`,
            from: linkFrom.value,
            to: linkTo.value,
            kind: linkKind.value,
            bidirectional: linkBidirectional.value,
            ...(linkLabel.value.trim() ? { label: linkLabel.value.trim() } : {}),
        });
        linkLabel.value = '';
    });
}

async function removeLink(id: string) {
    await runMutation(draft => {
        draft.atlas.links = draft.atlas.links.filter(edge => edge.id !== id);
    });
}

async function addActor() {
    const name = newActorName.value.trim();
    if (!name || !newActorLocation.value) {
        formError.value = '请填写人物名称与所在地点。';
        return;
    }
    const actorKey = newActorIsPlayer.value && !actors.value.some(a => a.actorKey === 'player')
        ? 'player'
        : `actor-${createIdentifier()}`;
    await runMutation(draft => {
        draft.atlas.actors.push({ actorKey, displayName: name, locationKey: newActorLocation.value });
        if (actorKey === 'player') {
            const loc = draft.atlas.locations.find(item => item.key === newActorLocation.value);
            if (loc) { loc.status = 'visited'; }
        }
        newActorName.value = '';
        newActorIsPlayer.value = false;
    });
}

async function moveActor(actorKey: string, locationKey: string) {
    await runMutation(draft => {
        const actor = draft.atlas.actors.find(item => item.actorKey === actorKey);
        if (!actor) { return; }
        actor.locationKey = locationKey;
        if (actorKey === 'player') {
            const loc = draft.atlas.locations.find(item => item.key === locationKey);
            if (loc) { loc.status = 'visited'; }
        }
    });
}

async function removeActor(actorKey: string) {
    await runMutation(draft => {
        draft.atlas.actors = draft.atlas.actors.filter(item => item.actorKey !== actorKey);
    });
}
</script>
<template>
    <div class="tk-map-editor">
        <div class="tk-map-editor-bar">
            <button type="button" class="menu_button" :disabled="!canEdit" @click="openMode('add-location')">+ 新增地点</button>
            <button v-if="place" type="button" class="menu_button" :disabled="!canEdit" @click="openMode('edit-location')">编辑地点</button>
            <button v-if="place" type="button" class="menu_button" :disabled="!canEdit" @click="openMode('delete-location')">删除地点</button>
            <button v-if="locations.length >= 2" type="button" class="menu_button" :disabled="!canEdit" @click="openMode('links')">管理通路</button>
            <button v-if="locations.length >= 1" type="button" class="menu_button" :disabled="!canEdit" @click="openMode('actors')">管理人物位置</button>
        </div>

        <form v-if="mode === 'add-location' || (mode === 'edit-location' && place)" class="tk-map-editor-form" @submit.prevent="saveLocation">
            <h4>{{ mode === 'add-location' ? '新增地点' : `编辑地点：${place?.name}` }}</h4>
            <label><span>名称</span><input v-model="locName" class="text_pole" type="text" maxlength="120" required></label>
            <label><span>层级规模</span>
                <select v-model="locScale" class="text_pole">
                    <option v-for="[val, text] in scaleOptions" :key="val" :value="val">{{ text }}</option>
                </select>
            </label>
            <label><span>探索状态</span>
                <select v-model="locStatus" class="text_pole">
                    <option value="mentioned">已提及</option>
                    <option value="visited">已到访</option>
                </select>
            </label>
            <label><span>上级地点</span>
                <select v-model="locParent" class="text_pole">
                    <option value="">无上级地点</option>
                    <option v-for="item in locations.filter(l => mode === 'add-location' || l.key !== place?.key)" :key="item.key" :value="item.key">{{ item.name }}</option>
                </select>
            </label>
            <label><span>相对方位</span>
                <select v-model="locBearing" class="text_pole">
                    <option value="">未指定</option>
                    <option v-for="dir in bearings" :key="dir" :value="dir">{{ compassLabels[dir] }}</option>
                </select>
            </label>
            <label><span>地貌类型</span>
                <select v-model="locTerrain" class="text_pole">
                    <option value="">未指定</option>
                    <option v-for="[val, text] in terrainOptions" :key="val" :value="val">{{ text }}</option>
                </select>
            </label>
            <label><span>地点概述</span><textarea v-model="locBrief" class="text_pole" rows="2" maxlength="1200" /></label>
            <div class="tk-map-editor-actions">
                <button type="submit" class="menu_button" :disabled="!canEdit">保存地点</button>
                <button type="button" class="menu_button" @click="closePanel">取消</button>
            </div>

            <div v-if="mode === 'edit-location' && place" class="tk-map-editor-sub">
                <h5>地点要素维护</h5>
                <ul v-if="place.features?.length">
                    <li v-for="item in place.features" :key="typeof item === 'string' ? item : item.name">
                        <span>{{ typeof item === 'string' ? item : item.name }}</span>
                        <button type="button" class="menu_button" :disabled="!canEdit" @click="removeFeatureFromPlace(typeof item === 'string' ? item : item.name)">移除要素</button>
                    </li>
                </ul>
                <label><span>新增要素名</span><input v-model="newFeatureName" class="text_pole" type="text" maxlength="500"></label>
                <label><span>要素外观说明（可选）</span><input v-model="newFeatureDesc" class="text_pole" type="text" maxlength="1200"></label>
                <button type="button" class="menu_button" :disabled="!canEdit" @click="addFeatureToPlace">添加要素</button>
            </div>
        </form>

        <div v-else-if="mode === 'delete-location' && place" class="tk-map-editor-form">
            <h4>删除地点：{{ place.name }}</h4>
            <p>删除后将清除与该地相连的通路及停留在当地的人物标记，下级地点的所属关系将清空。</p>
            <label class="tk-map-check"><input v-model="confirmDelete" type="checkbox"><span>确认永久删除该地点</span></label>
            <div class="tk-map-editor-actions">
                <button type="button" class="menu_button" :disabled="!canEdit" @click="deleteCurrentLocation">确认删除</button>
                <button type="button" class="menu_button" @click="closePanel">取消</button>
            </div>
        </div>

        <div v-else-if="mode === 'links'" class="tk-map-editor-form">
            <h4>通路连接管理</h4>
            <ul v-if="links.length">
                <li v-for="edge in links" :key="edge.id">
                    <span>{{ placeName(edge.from) }} {{ edge.bidirectional ? '↔' : '→' }} {{ placeName(edge.to) }}（{{ edge.label || edge.kind }}）</span>
                    <button type="button" class="menu_button" :disabled="!canEdit" @click="removeLink(edge.id)">删除通路</button>
                </li>
            </ul>
            <label><span>起点</span>
                <select v-model="linkFrom" class="text_pole">
                    <option v-for="item in locations" :key="item.key" :value="item.key">{{ item.name }}</option>
                </select>
            </label>
            <label><span>终点</span>
                <select v-model="linkTo" class="text_pole">
                    <option v-for="item in locations" :key="item.key" :value="item.key">{{ item.name }}</option>
                </select>
            </label>
            <label><span>类型</span>
                <select v-model="linkKind" class="text_pole">
                    <option v-for="[val, text] in linkKindOptions" :key="val" :value="val">{{ text }}</option>
                </select>
            </label>
            <label><span>说明（可选）</span><input v-model="linkLabel" class="text_pole" type="text" maxlength="160"></label>
            <label class="tk-map-check"><input v-model="linkBidirectional" type="checkbox"><span>双向通行</span></label>
            <div class="tk-map-editor-actions">
                <button type="button" class="menu_button" :disabled="!canEdit" @click="addLink">添加通路</button>
                <button type="button" class="menu_button" @click="closePanel">完成</button>
            </div>
        </div>

        <div v-else-if="mode === 'actors'" class="tk-map-editor-form">
            <h4>人物位置管理</h4>
            <ul v-if="actors.length">
                <li v-for="actor in actors" :key="actor.actorKey">
                    <span>{{ actor.displayName }}{{ actor.actorKey === 'player' ? '（主角）' : '' }}</span>
                    <select class="text_pole" :value="actor.locationKey" :disabled="!canEdit" @change="moveActor(actor.actorKey, ($event.target as HTMLSelectElement).value)">
                        <option v-for="item in locations" :key="item.key" :value="item.key">{{ item.name }}</option>
                    </select>
                    <button type="button" class="menu_button" :disabled="!canEdit" @click="removeActor(actor.actorKey)">移除</button>
                </li>
            </ul>
            <label><span>新人物名称</span><input v-model="newActorName" class="text_pole" type="text" maxlength="120"></label>
            <label><span>所在地点</span>
                <select v-model="newActorLocation" class="text_pole">
                    <option v-for="item in locations" :key="item.key" :value="item.key">{{ item.name }}</option>
                </select>
            </label>
            <label v-if="!actors.some(a => a.actorKey === 'player')" class="tk-map-check"><input v-model="newActorIsPlayer" type="checkbox"><span>设为主角标记</span></label>
            <div class="tk-map-editor-actions">
                <button type="button" class="menu_button" :disabled="!canEdit" @click="addActor">添加位置标记</button>
                <button type="button" class="menu_button" @click="closePanel">完成</button>
            </div>
        </div>

        <p v-if="formError" role="alert" class="tk-map-error">{{ formError }}</p>
    </div>
</template>
<style scoped>
.tk-map-editor { display: grid; gap: .5em; width: 100%; box-sizing: border-box; }
.tk-map-editor-bar, .tk-map-editor-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.tk-map-editor-form { display: grid; gap: .45em; padding: .6em; border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; max-width: 100%; box-sizing: border-box; }
.tk-map-editor-form h4, .tk-map-editor-sub h5 { margin: 0 0 .25em; }
.tk-map-editor-form label { display: grid; gap: .2em; min-width: 0; }
.tk-map-editor-form label.tk-map-check { display: flex; align-items: center; gap: .4em; }
.tk-map-editor-form input.text_pole, .tk-map-editor-form select.text_pole, .tk-map-editor-form textarea.text_pole { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
.tk-map-editor-sub { border-top: 1px solid var(--SmartThemeBorderColor); padding-top: .5em; display: grid; gap: .4em; }
.tk-map-editor-form ul { list-style: none; padding: 0; margin: 0; display: grid; gap: .35em; }
.tk-map-editor-form li { display: flex; flex-wrap: wrap; align-items: center; gap: .4em; justify-content: space-between; }
.tk-map-error { margin: 0; color: #ff6b6b; }
</style>
