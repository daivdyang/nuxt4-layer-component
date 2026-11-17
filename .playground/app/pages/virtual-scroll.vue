<template>
  <!-- 整頁高度固定為視窗高度；VirtualScroll 以 flex: 1 吃掉標題與按鈕以外的剩餘空間 -->
  <div class="page">
    <h2>測試VirtualScroll組件</h2>
    <button class="btn" @click="onClick">切換 ({{ type }})</button>

    <!--
      Lazy 前綴：Nuxt 自動拆成獨立 chunk，用到時才下載組件程式碼
      :key="type" 切換模式時重新掛載，避免沿用另一種模式的量測結果
    -->
    <LazyVirtualScroll
      :key="type"
      class="page__list"
      :items="list"
      :item-height="type === 'fix' ? 56 : undefined"
      :estimated-item-height="80"
      item-key="id"
      @reach-bottom="loadMore"
    >
      <template #default="{ item }">
        <div v-if="type === 'fix'" class="row">{{ item.text }}</div>
        <LazyChatBubble v-else :msg="item" />
      </template>

      <template #empty>
        <span v-if="loading">載入中…</span>
        <span v-else-if="error">
          載入失敗：{{ error }}
          <button @click="loadMore">重試</button>
        </span>
        <span v-else>還沒有任何訊息</span>
      </template>

      <template v-if="list.length" #footer>
        <div class="status">
          <span v-if="loading">載入中…</span>
          <span v-else-if="error">
            載入失敗：{{ error }}
            <button @click="loadMore">重試</button>
          </span>
          <span v-else-if="!hasMore">沒有更多了（共 {{ list.length }} 筆）</span>
        </div>
      </template>
    </LazyVirtualScroll>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createFakeData, type ChatMessage } from '../utils/fakeData.ts'

const type = ref<'fix' | 'dynamic'>('dynamic')
const fake = createFakeData({ seed: 42 })

const list = ref<ChatMessage[]>([])
const loading = ref(false)
const hasMore = ref(true)
const error = ref<string | null>(null)
let nextPage = 0 // fetchPage 的頁碼從 0 開始

async function loadMore() {
  // 載入中或已到底就不再發請求（reach-bottom 可能在請求未回來前又觸發）
  if (loading.value || !hasMore.value) return
  loading.value = true
  error.value = null
  try {
    // failRate：模擬一成機率失敗，用來測試重試流程
    const res = await fake.fetchPage(nextPage, { total: 2000, failRate: 0.1 })
    list.value.push(...res.items)
    hasMore.value = res.hasMore
    nextPage++ // 成功才前進，失敗重試同一頁
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// 只在瀏覽器端載入第一頁，避免 SSR 與 hydration 的資料不一致
onMounted(loadMore)

function onClick() {
  type.value = type.value === 'dynamic' ? 'fix' : 'dynamic'
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

/* min-height: 0 讓 flex 子項可以比內容矮，否則會被內容撐開而失去捲動 */
.page__list {
  flex: 1;
  min-height: 0;
}

.btn {
  max-width: 200px;
}

.row {
  height: 100%;
  padding: 0 16px;
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.status {
  padding: 12px 16px;
  text-align: center;
  color: #888;
  font-size: 14px;
}

.status:empty {
  display: none;
}
</style>
