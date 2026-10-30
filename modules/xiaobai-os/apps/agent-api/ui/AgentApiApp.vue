<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { mountTextApiSettings } from '../../../../text-api/settings-ui.js';
import type { XiaobaiOsAppProps } from '../../../shell/app-contract.js';
import './agent-api.css';
import WebSettings from './WebSettings.vue';

const props = defineProps<XiaobaiOsAppProps>();
const root = ref<HTMLElement | null>(null);
let editor: ReturnType<typeof mountTextApiSettings> | undefined;
onMounted(() => {
    if (!root.value) {return;}
    editor = mountTextApiSettings(root.value, {
        feature: 'library', namespace: '', library: true,
        async transport(action: string, extra: Record<string, unknown>) {
            const response = await props.bridge.request('agent-api/profiles', { action, ...extra },
                ['load', 'mutate'].includes(action) ? 35_000 : 130_000) as { result: unknown };
            return response.result;
        },
    });
    editor.refresh();
});
onBeforeUnmount(() => editor?.destroy());
</script>

<template>
    <main class="agent-api-app">
        <div class="agent-api-scroll">
            <div class="agent-api-content">
                <header class="agent-api-header">
                    <h1>模型接口</h1>
                    <p>集中管理有名称的 API 配置，各模块按需选用。</p>
                </header>
                <section ref="root" class="agent-api-panel" aria-label="模型接口配置库" />
                <WebSettings :bridge="props.bridge" />
            </div>
        </div>
    </main>
</template>
