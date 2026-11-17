<template>
    <h2>測試VirtualScroll組件</h2>
    <button @click="onClick">切換 ({{ type }})</button>
    <!-- 固定高度 -->
    <VirtualScroll v-if="type === 'fix'" :items="list" :item-height="56" height="100dvh">
        <template #default="{ item }">
            <div class="h-full px-4 flex items-center">{{ item.text }}</div>
        </template>
    </VirtualScroll>

    <!-- 動態高度 + 無限載入 -->
    <VirtualScroll
        v-else
        ref="vs"
        :items="list"
        :estimated-item-height="80"
        item-key="id"
        @reach-bottom="loadMore"
        >
        <template #default="{ item }"><ChatBubble :msg="item" /></template>
        <template #empty>還沒有任何訊息</template>
    </VirtualScroll>

</template>

<script setup lang="ts">
import { ref } from 'vue'
import { createFakeData, type ChatMessage } from '../utils/fakeData.ts'
import VirtualScroll from '../../../app/components/VirtualScroll.vue'
import ChatBubble from '../../../app/components/ChatBubble.vue'

const type = ref<'fix' | 'dynamic'>('dynamic')
const fake = createFakeData({ seed: 42 })
const list = ref<ChatMessage[]>(fake.messages(200))
let page = 1

async function loadMore() {
  const { items, hasMore } = await fake.fetchPage(page++, { total: 2000 })
  list.value.push(...items)
}

function onClick() {
    type.value = type.value === 'dynamic' ? 'fix' : 'dynamic'
}
</script>