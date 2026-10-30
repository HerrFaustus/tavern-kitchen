<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { mountTextApiSettings } from '../../../../text-api/settings-ui.js';
import type { XiaobaiOsAppProps } from '../../app-contract.js';
const props = defineProps<{ bridge: XiaobaiOsAppProps['bridge']; appId: string }>();
const root = ref<HTMLElement | null>(null);
let editor: ReturnType<typeof mountTextApiSettings> | undefined;
onMounted(() => {
    if (!root.value) {return;}
    editor = mountTextApiSettings(root.value, { feature: 'world', namespace: '',
        async transport(action: string, extra: Record<string, unknown>) {
            const response = await props.bridge.request(props.appId + '/model-profile', { action, ...extra }, 35_000) as { result: unknown };
            return response.result;
        },
    });
    editor.refresh();
});
onBeforeUnmount(() => editor?.destroy());
</script>
<template><section ref="root" aria-label="后台调用配置" /></template>
