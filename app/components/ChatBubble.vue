<!--
  ChatBubble.vue — VirtualScroll 動態高度模式下的單則訊息項目
  只負責顯示一則 ChatMessage，不處理捲動、載入或列表狀態
-->
<template>
  <article class="bubble" :lang="msg.lang">
    <div class="bubble__avatar" :style="{ backgroundColor: msg.user.color }" aria-hidden="true">
      {{ initial }}
    </div>

    <div class="bubble__body">
      <header class="bubble__meta">
        <span class="bubble__name">{{ msg.user.name }}</span>
        <time class="bubble__time" :datetime="msg.createdAt">{{ timeText }}</time>
      </header>

      <p v-if="msg.text" class="bubble__text">{{ msg.text }}</p>

      <!-- 以 aspect-ratio 預留空間：圖片載入前高度就正確，減少 ResizeObserver 事後修正 -->
      <img
        v-if="msg.image"
        class="bubble__image"
        :src="msg.image.url"
        :width="msg.image.width"
        :height="msg.image.height"
        :style="{ aspectRatio: `${msg.image.width} / ${msg.image.height}` }"
        decoding="async"
        alt=""
      />
    </div>
  </article>
</template>

<script lang="ts">
// 模組層級：所有 ChatBubble 實例共用，避免每則訊息都建立新的 Intl 格式器
const formatters = new Map<string, Intl.DateTimeFormat>()

function getFormatter(lang: string): Intl.DateTimeFormat {
  let f = formatters.get(lang)
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
    formatters.set(lang, f)
  }
  return f
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from './fakeData'

const props = defineProps<{ msg: ChatMessage }>()

// Array.from 以字元（code point）切分，避免 emoji 等代理對被切成半個字
const initial = computed(() => Array.from(props.msg.user.name)[0] ?? '?')

const timeText = computed(() => getFormatter(props.msg.lang).format(new Date(props.msg.createdAt)))
</script>

<style scoped>
/* 間距一律用 padding：VirtualScroll 量的是 border-box，margin 不會被計入 */
.bubble {
  display: flex;
  gap: 10px;
  padding: 8px 16px;
}

.bubble__avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 15px;
  line-height: 1;
}

.bubble__body {
  min-width: 0; /* 讓 flex 子項可以縮小，長字串才會換行而不是撐寬 */
  flex: 1;
}

.bubble__meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
}

.bubble__name {
  font-weight: 600;
  color: #374151;
}

.bubble__text {
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-wrap; /* 保留 \n 換行 */
  overflow-wrap: anywhere; /* 不斷行的長網址也能折行 */
}

/* 韓文依空白斷行，避免單字被拆開 */
.bubble__text:lang(ko) {
  word-break: keep-all;
}

.bubble__image {
  display: block;
  margin-top: 6px;
  width: 100%;
  max-width: 320px;
  height: auto;
  border-radius: 8px;
  object-fit: cover;
  background: #e5e7eb; /* 載入前的佔位色 */
}
</style>