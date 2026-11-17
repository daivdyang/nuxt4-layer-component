<template>
    <div>
        <h2>測試使用dayjs庫的組件</h2>
        <DateComp :format-pattern="'YY/MM/DD'" :locale="locale" :date="'2026-12-24'" />
        <hr />
        <h4>composable</h4>
        <div>{{ `format: ${format(new Date(2025, 0, 25, 19, 20, 30))}` }}</div>
        <div>{{ `fromNow: ${fromNow(new Date(1999, 1, 28, 13, 50, 40))}` }}</div>
        <button @click="onClick">Change Language ({{ locale }})</button>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useDate } from '../../../app/composables/useDate.ts'

import DateComp from '../../../app/components/DateComp.vue';

const locale = ref<'ko' | 'en' | 'th'>('ko')
const next = {
    'ko': 'en',
    'en': 'th',
    'th': 'ko'
} as const
const { format, fromNow } = useDate(locale)

function onClick() {
    locale.value = next[locale.value]
}
</script>