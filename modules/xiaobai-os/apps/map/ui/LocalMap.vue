<script setup lang="ts">
import { computed } from 'vue';
import { compassLabels, type PlaceFeature } from '../../../domains/map/types.js';

const props = defineProps<{place:string; features:PlaceFeature[]; selected:string}>();
defineEmits<{select:[name:string]}>();
const slots = {NW:1,N:2,NE:3,W:4,E:6,SW:7,S:8,SE:9} as const;
const charts = computed(() => {
    const anchors = new Map<string, Map<keyof typeof slots, PlaceFeature[]>>();
    for (const feature of props.features) {
        if (!feature.placement) { continue; }
        const {bearing,relativeTo = ''} = feature.placement;
        const directions = anchors.get(relativeTo) ?? new Map<keyof typeof slots, PlaceFeature[]>();
        const group = directions.get(bearing) ?? [];
        group.push(feature);
        directions.set(bearing,group);
        anchors.set(relativeTo,directions);
    }
    return anchors;
});
const unplaced = computed(() => props.features.filter(item => !item.placement));
</script>
<template>
    <section aria-label="局部示意图">
        <h4>{{ place }} · 局部示意图</h4>
        <div v-for="[anchor,directions] in charts" :key="anchor" class="compass" :aria-label="'参照：'+(anchor || place)">
            <div class="origin">
                <small>{{ anchor ? '参照要素' : '所在地点' }}</small>
                <button v-if="anchor" type="button" class="menu_button" :aria-current="anchor === selected" @click="$emit('select',anchor)">{{ anchor }}</button>
                <strong v-else>{{ place }}</strong>
            </div>
            <div v-for="[bearing,items] in directions" :key="bearing" class="direction" :data-bearing="bearing" :style="{gridRow:Math.ceil(slots[bearing]/3),gridColumn:(slots[bearing]-1)%3+1}">
                <small>{{ compassLabels[bearing] }}</small>
                <button v-for="item in items" :key="item.name" type="button" class="menu_button" :aria-current="item.name === selected" @click="$emit('select',item.name)">{{ item.name }}</button>
            </div>
        </div>
        <div v-if="unplaced.length" class="unplaced">
            <small>方位待定</small>
            <button v-for="item in unplaced" :key="item.name" type="button" class="menu_button" :aria-current="item.name === selected" @click="$emit('select',item.name)">{{ item.name }}</button>
        </div>
    </section>
</template>
<style scoped>
.compass {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(3,minmax(2.1em,auto));gap:.25em;margin:.5em 0;padding:.4em;border:1px solid var(--SmartThemeBorderColor);border-radius:.3em}
.origin,.direction {display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;overflow-wrap:anywhere}
.origin {grid-area:2 / 2;text-align:center}
small {opacity:.75}
button {max-width:100%;white-space:normal;overflow-wrap:anywhere}
button[aria-current=true] {text-decoration:underline}
.unplaced {display:flex;flex-wrap:wrap;gap:.35em;align-items:center}
</style>
