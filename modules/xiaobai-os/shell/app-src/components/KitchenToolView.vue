<script setup lang="ts">
import { ref, type Component } from 'vue';
import AppNavigationScope from './AppNavigationScope.vue';
import type { XiaobaiOsAppDefinition } from '../../app-catalog.js';
import type { XiaobaiOsFrameBridge } from '../frame-bridge.js';
import AppBoundary from './AppBoundary.vue';
const props = defineProps<{
    activeApp: XiaobaiOsAppDefinition | null;
    activeComponent: Component | null;
    activeState: unknown;
    appFailure: { message: string; retryable: boolean } | null;
    appLoading: boolean;
    appRenderKey: number;
    bridge: XiaobaiOsFrameBridge;
}>();
defineEmits<{ back: []; renderFailed: [error: unknown]; retry: []; reload: [] }>();
const navigation = ref<InstanceType<typeof AppNavigationScope> | null>(null);
defineExpose({ back: () => !props.appLoading && !props.appFailure
    && navigation.value?.owner === `${props.activeApp?.id}:${props.appRenderKey}` && navigation.value.back() });
</script>

<template>
    <div class="tk-tool-view">
        <nav v-if="!appLoading && !appFailure && navigation?.canBack" class="tk-context-nav" aria-label="页面导航">
            <button type="button" @click="$emit('back')"><span aria-hidden="true">←</span> 返回上一层</button>
        </nav>
        <div class="xiaobai-os-stage" :style="activeApp ? { '--app-accent': activeApp.accent } : null">
            <div v-if="!activeApp" class="xiaobai-os-app-loading" role="status">从后厨导航选择一个板块。</div>
            <section v-else-if="appFailure" class="xiaobai-os-app-failure" role="alert">
                <h1>{{ activeApp.name }}暂时无法打开</h1>
                <p>{{ appFailure.message }}</p>
                <div class="xiaobai-os-app-failure-actions">
                    <button v-if="appFailure.retryable" type="button" @click="$emit('retry')">重试</button>
                    <button type="button" @click="$emit('reload')">重新加载页面</button>
                </div>
            </section>
            <div v-else-if="appLoading" class="xiaobai-os-app-loading" role="status"><span aria-hidden="true" />正在打开{{ activeApp.name }}</div>
            <AppNavigationScope v-else-if="activeComponent" :key="`app:${activeApp.id}:${appRenderKey}`" ref="navigation" :owner="`${activeApp.id}:${appRenderKey}`">
                <AppBoundary @failed="$emit('renderFailed', $event)"><component :is="activeComponent" :bridge="bridge" :initial-state="activeState" /></AppBoundary>
            </AppNavigationScope>
        </div>
    </div>
</template>
