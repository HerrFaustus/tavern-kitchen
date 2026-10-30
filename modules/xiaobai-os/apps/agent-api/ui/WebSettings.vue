<script setup lang="ts">
import { ref, toRaw } from 'vue';
import type { XiaobaiOsAppProps } from '../../../shell/app-contract.js';
import { normalizeWebSettings, WEB_PROVIDERS, WEB_SETTINGS_COPY } from '../../../../agent-core/web/settings.js';
const props = defineProps<{ bridge: XiaobaiOsAppProps['bridge'] }>();
const config = ref<Record<string, string>>(normalizeWebSettings({}));
const loaded = ref(false), busy = ref(false), message = ref('');
async function request(save = false) {
    if (busy.value) {return;}
    busy.value = true; message.value = save ? '正在保存…' : '正在加载…';
    try {
        const response = await props.bridge.request('agent-api/profiles', {
            action: save ? 'web-save' : 'web-load', settings: structuredClone(toRaw(config.value)),
        }, 35_000) as { result: Record<string, string> };
        config.value = response.result; loaded.value = true; message.value = save ? '已保存' : '';
    } catch (error) { message.value = error instanceof Error ? error.message : '联网设置加载失败'; }
    finally { busy.value = false; }
}
function open(event: Event) {
    if ((event.currentTarget as HTMLDetailsElement).open && !loaded.value) {
        request().catch(error => { message.value = String(error); });
    }
}
</script>
<template>
    <details class="text-api" @toggle="open">
        <summary>联网检索设置（全局）</summary>
        <fieldset :disabled="busy || !loaded">
            <label><span>联网渠道</span><select v-model="config.webProvider">
                <option v-for="provider in WEB_PROVIDERS" :key="provider.id" :value="provider.id">{{ provider.label }}</option>
            </select></label>
            <label><span>API Key</span><input v-model="config[config.webProvider + 'ApiKey']" type="password" autocomplete="off"></label>
            <p v-if="config.webProvider === 'exa'">{{ WEB_SETTINGS_COPY.exaBackend }}</p>
            <button type="button" @click="request(true)">保存联网设置</button>
        </fieldset>
        <p role="status">{{ message }}</p>
        <button v-if="!loaded" type="button" :disabled="busy" @click="request()">重新加载</button>
    </details>
</template>
