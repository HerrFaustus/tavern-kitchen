<script setup lang="ts">
import AppDialog from '../../../shell/app-src/components/AppDialog.vue';

import MapIcon from './MapIcon.vue';
import { MAP_PROJECTION_COPY } from './map-copy.js';
defineProps<{ autoMaintenance: boolean; projectToChat: boolean; busy: boolean; refreshDisabled: boolean; autoToggleBusy: boolean; disabledReason: string; hasMap: boolean; status: string; maintenanceMessage: string; maintenanceError: boolean; notice: string; noticeError: boolean }>();
defineEmits<{ close: []; setAuto: [enabled: boolean]; setProjection: [enabled: boolean]; update: []; rebuild: []; refresh: [] }>();
</script>
<template>
    <AppDialog class="map-dialog map-settings" aria-labelledby="map-settings-title" @close="$emit('close')">
        <header class="map-dialog-header"><div><h2 id="map-settings-title">地图设置</h2></div><button type="button" class="map-round-button" aria-label="关闭地图设置" @click="$emit('close')"><MapIcon name="close" /></button></header>
        <section v-if="status || notice || maintenanceMessage" class="map-settings-feedback" :class="{ 'is-error': notice ? noticeError : maintenanceError }" role="status">
            <strong>{{ notice ? (notice === maintenanceMessage ? '最近一次更新' : '操作提示') : status || '最近一次更新' }}</strong>
            <p v-if="notice || maintenanceMessage">{{ notice || maintenanceMessage }}</p>
        </section>
        <div class="map-settings-content">
            <section class="map-auto-setting"><div><h3>随对话自动更新</h3><p>你发送下一条消息时，根据上一轮对话更新地图。适用于所有普通聊天。</p></div><input type="checkbox" class="map-switch" role="switch" :checked="autoMaintenance" aria-label="随对话自动更新" :disabled="autoToggleBusy" @click.prevent="$emit('setAuto', !autoMaintenance)"></section>
            <section class="map-auto-setting"><div><h3>{{ MAP_PROJECTION_COPY.label }}</h3><p>{{ MAP_PROJECTION_COPY.description }}</p></div><input type="checkbox" class="map-switch" role="switch" :checked="projectToChat" :aria-label="MAP_PROJECTION_COPY.label" :disabled="autoToggleBusy" @click.prevent="$emit('setProjection', !projectToChat)"></section>
            <section v-if="hasMap" class="map-settings-section"><MapIcon name="refresh" /><h3>补充最近的变化</h3><p>根据最近一轮对话更新位置和地点，并补全当前区域尚缺少的探索去处。</p><button type="button" class="map-primary-button" :disabled="busy || Boolean(disabledReason)" @click="$emit('update')">{{ busy ? status || '请稍候…' : '更新地图' }}</button></section>
            <details class="map-settings-advanced" :open="!hasMap">
                <summary>模型与高级操作</summary>
                <div class="map-settings-advanced-body">
                    <slot name="model-profile" />
                    <section v-if="!hasMap" class="map-settings-section"><MapIcon name="globe" /><h3>建立世界地图</h3><p>依据角色与世界设定建立地图；设定未写明的地方，会合理补全。结合当前聊天保留已发生的故事。</p><button type="button" class="map-primary-button" :disabled="busy || Boolean(disabledReason)" @click="$emit('rebuild')">{{ busy ? status || '请稍候…' : '绘制世界地图' }}</button></section>
                    <section v-else class="map-settings-section"><MapIcon name="globe" /><h3>重新绘制世界</h3><p>依据角色与世界设定重新建立地图；设定未写明的地方，会合理补全。结合当前聊天保留已发生的故事。</p><p>新地图保存成功后替换原图；失败时保留原图。</p><button type="button" class="map-secondary-button" :disabled="busy || Boolean(disabledReason)" @click="$emit('rebuild')">{{ busy ? status || '请稍候…' : '重新绘制' }}</button></section>
                    <button type="button" class="map-sync-button" :disabled="busy || refreshDisabled" @click="$emit('refresh')"><MapIcon name="refresh" />重新加载地图</button>
                    <p class="map-setting-note">只加载已保存的地图，不会重新绘制。绘制或更新时可以离开此页面。</p>
                </div>
            </details>
            <p v-if="disabledReason" class="map-setting-note" role="status">{{ disabledReason }}</p>
        </div>
    </AppDialog>
</template>
