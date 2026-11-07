<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { isMapSceneLocation, locationTrail } from '../../../domains/map/hierarchy.js';
import type { MapDomainV1 } from '../../../domains/map/types.js';
import { buildAtlasTree, type AtlasEntry } from './atlas-tree.js';
import LocalMap from './LocalMap.vue';
import { placeFeatures } from '../../../domains/map/features.js';
import MapViewport from './MapViewport.vue';
import { layoutWorldMap } from './world-map.js';

const props = defineProps<{map: MapDomainV1; selected: string; current?: string; feature: string}>();
const emit = defineEmits<{select:[key: string, feature?: string]}>();
const focusSequence = ref(0);
const mode = ref<'list'|'map'|'local'>('list');
const place = computed(() => props.map.atlas.locations.find(location => location.key === props.selected));
const localFeatures = computed(() => place.value && isMapSceneLocation(place.value) ? placeFeatures(props.map,place.value) : []);
watch(localFeatures, items => { if (!items.length && mode.value === 'local') { mode.value = 'map'; } });
const expanded = ref(new Set<string>());
const roots = computed(() => buildAtlasTree(props.map));
const levels = ['世界','地区','地点','地点要素'];
const arrow = 'atlas-arrow-' + useId();
function toggle(id: string) {
    if (!expanded.value.delete(id)) { expanded.value.add(id); }
}
function reveal(key: string, feature: string) {
    function find(nodes: AtlasEntry[]): boolean {
        for (const node of nodes) {
            if (node.key === key && (node.feature ?? '') === feature) {
                if (node.children.length) { expanded.value.add(node.id); }
                return true;
            }
            if (find(node.children)) { expanded.value.add(node.id); return true; }
        }
        return false;
    }
    find(roots.value);
}
watch([() => props.selected, () => props.feature, roots], () => reveal(props.selected, props.feature), {immediate:true});
function returnToPlayer() {
    if (props.current) { reveal(props.current,''); emit('select',props.current); focusSequence.value++; }
}
const rows = computed(() => {
    const visible: {node: AtlasEntry; depth:number}[] = [];
    function visit(nodes: AtlasEntry[], depth: number) {
        for (const node of nodes) {
            visible.push({node,depth});
            if (expanded.value.has(node.id)) { visit(node.children,depth + 1); }
        }
    }
    visit(roots.value,0);
    return visible;
});
const scope = computed(() => {
    const atlas = props.map.atlas;
    const trail = locationTrail(atlas,props.selected).reverse();
    const world = trail.find(p => p.scale === 'world');
    const region = trail.find(p => p.scale === 'region');
    const top = roots.value.find(n => n.key === world?.key);
    const overview = trail[0]?.scale === 'world';
    const group = overview ? top : top?.children.find(n => n.key === region?.key);
    const keys = new Set(group?.children.map(n => n.key));
    return {id:group?.id ?? '',locations:atlas.locations.filter(p => keys.has(p.key)),positionParent:group?.key ?? '',label:group?.name};
});
const drawing = computed(() => {
    const atlas = props.map.atlas;
    const keys = new Set(scope.value.locations.map(p => p.key));
    const links = atlas.links.filter(edge => keys.has(edge.from) && keys.has(edge.to));
    const layout = layoutWorldMap({...atlas,links},scope.value);
    const routes = layout.routes.map(route => {
        const dx = route.to.x - route.from.x;
        const dy = route.to.y - route.from.y;
        const distance = Math.hypot(dx,dy) || 1;
        return {...route, endX:route.to.x - 21*dx/distance, endY:route.to.y - 21*dy/distance};
    });
    return {...layout,routes};
});
const focusPoint = computed<[number,number] | undefined>(() => {
    const point = drawing.value.nodes.find(node => node.location.key === props.current);
    return point ? [point.x,point.y] : undefined;
});
</script>
<template>
    <nav aria-label="地图视图">
        <button type="button" class="menu_button" :aria-pressed="mode === 'list'" @click="mode = 'list'">地点列表</button>
        <button type="button" class="menu_button" :aria-pressed="mode === 'map'" @click="mode = 'map'">区域地图</button>
        <button v-if="localFeatures.length" type="button" class="menu_button" :aria-pressed="mode === 'local'" @click="mode = 'local'">局部地图</button>
        <button v-if="current" type="button" class="menu_button" @click="returnToPlayer">回到当前位置</button>
    </nav>
    <section v-if="mode === 'list'" aria-label="地点列表" class="geo-list">
        <div v-for="{node,depth} in rows" :key="node.id" class="geo-row" :style="{paddingInlineStart:depth * 1.1 + 'em'}">
            <button v-if="node.children.length" class="disclose" type="button" :aria-expanded="expanded.has(node.id)" :aria-label="(expanded.has(node.id) ? '收起' : '展开') + node.name" @click="toggle(node.id)">{{ expanded.has(node.id) ? '▾' : '▸' }}</button>
            <span v-else class="spacer" />
            <button class="entry" type="button" :aria-current="!!node.key && node.key === selected && (node.feature ?? '') === feature" @click="node.key ? emit('select',node.key,node.feature) : toggle(node.id)">
                <small>{{ levels[depth] }}</small> {{ node.name }} <small v-if="node.key && node.key === current && !node.feature">· 当前位置</small>
            </button>
        </div>
    </section>
    <LocalMap v-else-if="mode === 'local' && place" :place="place.name" :features="localFeatures" :selected="feature" @select="emit('select',selected,$event)" />
    <section v-else aria-label="区域地图">
        <small>{{ scope.label }} · 位置示意</small>
        <MapViewport v-if="drawing.nodes.length" class="atlas" :view-box="drawing.viewBox" :reset-key="scope.id" :focus-point="focusPoint" :focus-sequence="focusSequence" label="地点与已知连接">
            <defs><marker :id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10Z" fill="currentColor" /></marker></defs>
            <g v-for="route in drawing.routes" :key="route.link.id">
                <line :x1="route.from.x" :y1="route.from.y" :x2="route.endX" :y2="route.endY" stroke="currentColor" stroke-width="2" :marker-end="route.link.bidirectional ? undefined : 'url(#'+arrow+')'"><title>{{ route.from.location.name }} {{ route.link.bidirectional ? '↔' : '→' }} {{ route.to.location.name }} {{ route.link.label }}</title></line>
            </g>
            <g v-for="{location,x,y} in drawing.nodes" :key="location.key" role="button" tabindex="0" :aria-label="'查看'+location.name" :aria-current="location.key === selected" :transform="'translate('+x+' '+y+')'" @click="emit('select',location.key)" @keydown.enter="emit('select',location.key)" @keydown.space.prevent="emit('select',location.key)">
                <circle v-if="location.key === selected" r="19" class="ring" />
                <circle r="12" :class="{here:location.key === current}" />
                <text y="39" text-anchor="middle">{{ location.name.length > 12 ? location.name.slice(0,12) + '…' : location.name }}</text>
                <title>{{ location.name }}</title>
                <text v-if="location.key === current" y="63" text-anchor="middle">当前位置</text>
            </g>
        </MapViewport>
        <p v-else>这里还没有可绘制的地点。</p>
    </section>
</template>
<style scoped>
nav {display:flex; gap:.35em; flex-wrap:wrap; align-items:center; margin-bottom:.65em}
nav button[aria-pressed=true] {box-shadow:inset 0 -2px currentColor}
.geo-row {display:flex; align-items:baseline; min-height:2em}
.entry,.disclose {background:transparent; color:inherit; border:0; font:inherit; cursor:pointer; text-align:start}
.entry small {opacity:.7}
.entry[aria-current=true] {font-weight:bold; text-decoration:underline; text-underline-offset:.22em}
.disclose,.spacer {width:1.6em; flex:none}
.atlas {display:block; width:100%; height:clamp(15em,40vh,29em); border-block:1px solid var(--SmartThemeBorderColor)}
.atlas :deep(.map-viewport-svg) {width:100%;height:100%;touch-action:none}
.atlas {position:relative}
.atlas :deep(.map-viewport-controls) {position:absolute;bottom:.4em;right:.4em;display:flex;gap:.25em}
.atlas :deep(.map-viewport-controls button) {background:var(--SmartThemeBlurTintColor,#333);color:inherit;border:1px solid var(--SmartThemeBorderColor);border-radius:.25em;min-width:2em}
.atlas [role=button] {cursor:pointer}
.atlas circle {stroke:currentColor; stroke-width:2; fill:var(--SmartThemeBlurTintColor,#333)}
.atlas .here,.atlas text {fill:currentColor}
.atlas .ring {fill:none; stroke-dasharray:4 3}
.atlas text {font-size:20px;paint-order:stroke;stroke:var(--SmartThemeBlurTintColor,#333);stroke-width:3px}
</style>

