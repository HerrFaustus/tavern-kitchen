<script setup lang="ts">
import type { XiaobaiOsAppProps } from '../../../shell/app-contract.js';
import WorldOpening from './WorldOpening.vue';
import { useWorldState } from './use-world-state.js';
import './world.css';

const props = defineProps<XiaobaiOsAppProps>();
const { state, pending, notice, error, request } = useWorldState(props);
</script>

<template>
    <section class="world-app" aria-label="世界概况">
        <header class="world-toolbar">
            <h1 class="world-toolbar-title" tabindex="-1">世界</h1>
        </header>

        <div v-if="notice" class="world-notice" :class="{ 'is-error': error }" role="status" aria-live="polite">
            <span>{{ notice }}</span>
            <button v-if="state.pendingSave && state.writeState === 'failed'" :disabled="pending" type="button" @click="request('confirm-save')">重试保存</button>
            <button v-else-if="state.writeState === 'conflict'" :disabled="pending" type="button" @click="request('adopt-server-state')">使用已保存版本</button>
            <button
                v-else-if="state.writeState === 'failed' || error" :disabled="pending || state.writeState === 'saving'" type="button"
                @click="request('read')"
            >
                重新加载
            </button>
        </div>

        <div class="world-scroll world-listing">
            <WorldOpening :overview="state.world.overview" />

            <section class="world-empty">
                <h2>世界推演已整合至楼尾推演框</h2>
                <small>每轮 AI 回复后，推演 Agent 会在对话楼尾「推演框」直接生成后台正文；此处仅保留世界概况。</small>
            </section>
        </div>
    </section>
</template>
