<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, toRaw } from 'vue';
import { useAppBack } from '../../../shell/app-src/navigation/app-navigation.js';
import type { XiaobaiOsAppProps } from '../../../shell/app-contract.js';
import type { WorldNews } from '../../../domains/world/types.js';
import NewsArticle from './NewsArticle.vue';
import WorldOpening from './WorldOpening.vue';
import { useWorldState } from './use-world-state.js';
import './world.css';
import { observeBackgroundTask } from '../../../../../shared/common/async-errors.js';


const props = defineProps<XiaobaiOsAppProps>();
const { state, pending, notice, error, request } = useWorldState(props);
const reading = shallowRef<WorldNews | null>(null);
const listing = ref<HTMLElement | null>(null);
const articlePage = ref<HTMLElement | null>(null);
const title = ref<HTMLHeadingElement | null>(null);
let listScroll = 0;
let returnId = '';
const latest = computed(() => state.value.world.news.find(item => item.id === reading.value?.id));
const articleUpdate = computed(() => !latest.value ? 'removed'
    : JSON.stringify(latest.value) === JSON.stringify(reading.value) ? 'same' : 'updated');

async function openArticle(item: WorldNews) {
    listScroll = listing.value?.scrollTop ?? 0;
    returnId = item.id;
    reading.value = structuredClone(toRaw(item));
    await nextTick();
    articlePage.value?.querySelector('h1')?.focus({ preventScroll: true });
}
async function back() {
    reading.value = null;
    await nextTick();
    if (listing.value) {
        listing.value.scrollTop = listScroll;
        const buttons = listing.value.querySelectorAll<HTMLButtonElement>('[data-article-id]');
        const target = [...buttons].find(button => button.dataset.articleId === returnId) ?? title.value;
        target?.focus({ preventScroll: true });
    }
}
async function readLatest() {
    if (!latest.value) { return; }
    reading.value = structuredClone(toRaw(latest.value));
    await nextTick();
    if (articlePage.value) { articlePage.value.scrollTop = 0; }
    articlePage.value?.querySelector('h1')?.focus({ preventScroll: true });
}
useAppBack(() => {
    if (reading.value) { observeBackgroundTask(back(), { source: import.meta.url, operation: "callback" }); return true; }
    return false;
}, () => !!reading.value);
</script>

<template>
    <section class="world-app" aria-label="世界新闻">
        <header class="world-toolbar">
            <button v-if="reading" type="button" class="world-back" @click="back">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
                <span>见闻</span>
            </button>
            <h1 v-else ref="title" class="world-toolbar-title" tabindex="-1">世界</h1>
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

        <div v-show="!reading" ref="listing" class="world-scroll world-listing">
            <WorldOpening :overview="state.world.overview" />

            <section v-if="state.world.news.length" class="world-news-list" aria-label="各处见闻">
                <article v-for="item in state.world.news" :key="item.id" class="world-news-item">
                    <button type="button" :data-article-id="item.id" @click="openArticle(item)">
                        <span class="world-item-text"><h2>{{ item.title }}</h2><span class="world-item-preview">{{ item.body }}</span></span>
                    </button>
                </article>
            </section>
            <section v-else class="world-empty">
                <h2>暂无见闻</h2>
                <small>见闻将随对话由统一世界推演队列（simulation）自动生成。</small>
            </section>
        </div>

        <div v-if="reading" ref="articlePage" class="world-scroll world-reading">
            <NewsArticle :article="reading" :update="articleUpdate" @latest="readLatest" />
            <button type="button" class="world-bottom-back" @click="back">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
                返回见闻
            </button>
        </div>
    </section>
</template>
