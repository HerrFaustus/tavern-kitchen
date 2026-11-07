<script setup lang="ts">
import { computed } from 'vue';
import { linkPlaceMentions, type mentionIndex, type PlaceMention } from './place-mentions.js';

const props = defineProps<{text:string; names:ReturnType<typeof mentionIndex>; current:PlaceMention}>();
defineEmits<{select:[key:string,feature?:string]}>();
const parts = computed(() => linkPlaceMentions(props.text, props.names, props.current));
</script>
<template>
    <span class="place-text"><template v-for="(part,index) in parts" :key="index"><button v-if="part.target" type="button" class="mention" @click="$emit('select',part.target.key,part.target.feature)">{{ part.text }}</button><template v-else>{{ part.text }}</template></template></span>
</template>
<style scoped>
.mention {display:inline; color:inherit; background:transparent; border:0; padding:0; font:inherit; text-decoration:underline dotted; text-underline-offset:.18em; cursor:pointer}
</style>
