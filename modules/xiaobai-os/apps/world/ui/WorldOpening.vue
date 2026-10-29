<script setup lang="ts">
import { ref, useId } from 'vue';

defineProps<{ overview: string }>();
const expanded = ref(false);
const overviewId = useId();
</script>

<template>
    <div v-if="overview" class="world-opening">
        <div v-if="overview" class="world-overview">
            <p :id="overviewId" class="world-overview-text" :class="{ 'is-expanded': expanded }">{{ overview }}</p>
            <button
                type="button" class="world-overview-toggle"
                :aria-expanded="expanded" :aria-controls="overviewId"
                :aria-label="expanded ? '收起世界近况' : '查看世界近况'" @click="expanded = !expanded"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true" :class="{ 'is-expanded': expanded }"><path d="m7 10 5 5 5-5" /></svg>
            </button>
        </div>
    </div>
</template>
