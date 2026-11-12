<template>
    <div>
        <h3>This is 'dayjs' component</h3>
        <div>{{ `format(${date.toString()} -> ${formatPattern}): ${format(date, formatPattern)}` }}</div>
        <div>{{ `fromNow(${date.toString()}): ${fromNow(date)}` }}</div>
    </div>
</template>

<script setup lang="ts">
import { computed } from '@vue/reactivity';
import { useDate } from '../composables/useDate';

const props = defineProps<{
    locale: "th" | "ko" | "en"
    date: string | Date
    formatPattern: string
}>()

const locale = computed(() => {
    return props.locale
})
const { format, fromNow } = useDate(locale)
</script>