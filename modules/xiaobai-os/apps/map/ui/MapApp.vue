<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { XiaobaiOsAppProps } from '../../../shell/app-contract.js';
import { placeFeatures } from '../../../domains/map/features.js';
import PlaceText from './PlaceText.vue';
import { mentionIndex } from './place-mentions.js';
import AtlasBrowser from './AtlasBrowser.vue';
import { compassLabels, featureLabels, geographyLabels } from '../../../domains/map/types.js';
import { locationTrail, visitedMapLocationKeys } from '../../../domains/map/hierarchy.js';
import { useMapState } from './use-map-state.js';

const props = defineProps<XiaobaiOsAppProps>();
const selection = ref('');
const featureName = ref('');
function select(key: string, feature = '') {
    selection.value = key;
    featureName.value = feature;
}
const { state, status, notice, refresh, adopt } = useMapState(props, message => {
    if (message.type === 'map/focus-place') {
        focusByTarget(message.payload as { placeKey?: string; placeName?: string } | undefined);
    }
});
const map = computed(() => state.value.map);
const places = computed(() => map.value?.atlas.locations ?? []);
const current = computed(() => map.value?.atlas.actors.find(actor => actor.actorKey === 'player')?.locationKey);
const place = computed(() => places.value.find(p => p.key === selection.value)
    ?? places.value.find(p => p.key === current.value) ?? places.value[0]);
const nameOf = (key: string) => places.value.find(p => p.key === key)?.name ?? key;
const connections = computed(() => (map.value?.atlas.links ?? []).filter(link => link.from === place.value?.key || link.to === place.value?.key));
const routeNames = {door:'门', stairs:'楼梯', elevator:'电梯', path:'小径', road:'道路', portal:'传送门', passage:'通道'};
const features = computed(() => map.value && place.value ? placeFeatures(map.value, place.value) : []);
const feature = computed(() => features.value.find(item => item.name === featureName.value));
const mentions = computed(() => mentionIndex(places.value,place.value?.key ?? '',features.value));
const activeEntry = computed(() => ({key:place.value?.key ?? '',feature:feature.value?.name}));
const trail = computed(() => map.value && place.value ? locationTrail(map.value.atlas,place.value.key) : []);
const localConditions = computed(() => {
    const keys = new Set(trail.value.map(item => item.key));
    return (state.value.localConditions ?? []).filter(item => item.places.some(key => keys.has(key)));
});
const localActors = computed(() => {
    if (!place.value) { return []; }
    const key = place.value.key;
    const name = place.value.name;
    return (state.value.localActors ?? []).filter(actor => actor.locationKey === key || actor.locationName === name);
});
const showActions = computed(() => Boolean(status.value || notice.value || ['conflict', 'error', 'blocked'].includes(state.value.status)));
const visited = computed(() => map.value && visitedMapLocationKeys(map.value.atlas));
watch(() => state.value.chatIdentity, () => select(''));

function focusByTarget(payload: { placeKey?: string; placeName?: string } | undefined) {
    if (!payload) { return; }
    const wantKey = String(payload.placeKey || '').trim();
    const wantName = String(payload.placeName || '').trim().toLowerCase();
    const matched = places.value.find(p => (wantKey && p.key === wantKey) || (wantName && p.name.toLowerCase() === wantName));
    if (matched) { select(matched.key); }
}

function openPerson(actor: { id: string; name: string }) {
    props.bridge.post?.('os/navigate-kitchen', { route: 'people', detail: { personId: actor.id, personName: actor.name } });
}

function enlargeMap(payload: Record<string, unknown>) {
    props.bridge.post?.('os/open-wide-map', payload);
}

onMounted(() => {
    props.bridge.post?.('os/consume-focus');
});
</script>
<template>
    <section class="place-index">
        <div class="tk-module-data">
            <AtlasBrowser v-if="map && place" :key="state.chatIdentity ?? ''" :map="map" :selected="place.key" :current="current" :feature="feature?.name ?? ''" @select="select" @enlarge="enlargeMap" />
            <article v-if="place && feature">
                <small>{{ trail.map(item => item.name).join(' › ') }} › 地点要素</small>
                <h3>{{ feature.name }}</h3>
                <dl>
                    <template v-for="(label,field) in featureLabels" :key="field">
                        <template v-if="feature[field]"><dt>{{ label }}</dt><dd><PlaceText :text="feature[field]" :names="mentions" :current="activeEntry" @select="select" /></dd></template>
                    </template>
                </dl>
                <p v-if="feature.placement">相对方位 · {{ feature.placement.relativeTo || place.name }}的{{ compassLabels[feature.placement.bearing] }}侧</p>
                <button type="button" class="menu_button" @click="select(place.key)">返回{{ place.name }}</button>
            </article>
            <article v-else-if="place">
                <small>{{ trail.map(item => item.name).join(' › ') }}</small>
                <h3>{{ place.name }}</h3>
                <div class="place-meta-row">
                    <span class="tk-status-badge">{{ visited?.has(place.key) ? '已到访' : '已提及' }}</span>
                    <button v-if="place.parent" type="button" class="menu_button" @click="select(place.parent)">所属 · {{ nameOf(place.parent) }}</button>
                </div>
                <p v-if="place.bearing">方位 · {{ place.parent ? nameOf(place.parent) : '所属区域' }}{{ compassLabels[place.bearing] }}部</p>
                <p v-if="place.brief"><PlaceText :text="place.brief" :names="mentions" :current="activeEntry" @select="select" /></p>
                <section v-if="localActors.length" aria-label="在此地的人物" class="local-actors">
                    <h4>在此地的人物</h4>
                    <div class="local-actor-list">
                        <button v-for="actor in localActors" :key="actor.id" type="button" class="tk-chip-link" @click="openPerson(actor)">{{ actor.name }}<span v-if="actor.isPlayer">（主角）</span></button>
                    </div>
                </section>
                <section v-if="localConditions.length" aria-label="此刻" class="local-conditions">
                    <h4>此刻</h4>
                    <div v-for="item in localConditions" :key="item.id">
                        <strong>{{ item.title }}</strong><small v-if="item.phase"> · {{ item.phase }}</small>
                        <p><PlaceText :text="item.detail" :names="mentions" :current="activeEntry" @select="select" /></p>
                    </div>
                </section>
                <template v-if="features.length">
                    <h4>要素</h4>
                    <ul>
                        <li v-for="item in features" :key="item.name">
                            <button type="button" class="menu_button" @click="select(place.key,item.name)">{{ item.name }}</button>
                        </li>
                    </ul>
                </template>
                <dl>
                    <template v-for="(label,field) in geographyLabels" :key="field">
                        <template v-if="place[field]"><dt>{{ label }}</dt><dd><PlaceText :text="place[field]" :names="mentions" :current="activeEntry" @select="select" /></dd></template>
                    </template>
                </dl>
                <template v-if="connections.length">
                    <h4>连接</h4>
                    <ul>
                        <li v-for="edge in connections" :key="edge.id">
                            {{ edge.bidirectional ? '相通' : edge.from === place.key ? '通往' : '来自' }} · {{ edge.label || routeNames[edge.kind] }}
                            <button class="menu_button" @click="select(edge.from === place.key ? edge.to : edge.from)">{{ nameOf(edge.from === place.key ? edge.to : edge.from) }}</button>
                        </li>
                    </ul>
                </template>
            </article>
            <p v-else>{{ state.status === 'loading' ? '正在读取地点…' : '还没有地点词条。' }}</p>
        </div>
        <div v-if="showActions" class="tk-module-actions" aria-label="地图操作">
            <p v-if="status || notice" role="status">{{ status || notice }}</p>
            <button v-if="state.status === 'conflict'" class="menu_button" @click="adopt">放弃未保存的更改并恢复</button>
            <button v-if="state.status === 'error' || state.status === 'blocked'" class="menu_button" @click="refresh">重新加载</button>
        </div>
    </section>
</template>
<style scoped>
.place-index { display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; height: 100%; box-sizing: border-box; padding: .6em; color: var(--SmartThemeBodyColor); }
.place-index > .tk-module-data { grid-row: 2; min-height: 0; overflow-y: auto; box-sizing: border-box; margin-block: 0; }
.place-index > .tk-module-actions { grid-row: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-bottom: .6em; border-bottom: 1px solid var(--SmartThemeBorderColor); }
.place-index > .tk-module-actions p { margin: 0; }
.place-meta-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0 8px; }
.local-actors { margin: 8px 0; }
.local-actors h4 { margin: 0 0 6px; }
.local-actor-list { display: flex; flex-wrap: wrap; gap: 6px; }
.local-conditions {border-inline-start:2px solid var(--SmartThemeBorderColor); padding-inline-start:.75em}
.local-conditions p {margin-block:.2em .65em}
.place-index dt { font-weight: bold; }
.place-index dd { margin: .2em 0 .65em; white-space: pre-line; }
.place-index article { margin-block: .6em; padding-top: .6em; border-top: 1px solid var(--SmartThemeBorderColor); }
.place-index article h3 { margin: .25em 0 .35em; }
.place-index ul { padding-inline-start: 1.4em; }
.place-index button { cursor:pointer; }
</style>
