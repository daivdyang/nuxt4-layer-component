<!--
  VirtualScroll.vue
  - 固定高度：傳入 itemHeight，O(1) 計算可視範圍
  - 動態高度：不傳 itemHeight，以 estimatedItemHeight 估算，ResizeObserver 實測後修正（前綴和 + 二分搜尋）
  - 手機：passive scroll、iOS 回彈夾值、overscroll-behavior、容器尺寸變化（旋轉/鍵盤）自動重算
  - 數據變更：items 替換或 push/splice 皆會重建佈局，已量測的高度依 key 保留
-->
<template>
  <div
    ref="containerRef"
    class="virtual-scroll"
    :style="containerStyle"
    @scroll.passive="onScroll"
  >
    <div class="virtual-scroll__phantom" :style="{ height: `${totalHeight}px` }">
      <div
        class="virtual-scroll__content"
        :style="{ transform: `translate3d(0, ${offsetY}px, 0)` }"
      >
        <div
          v-for="row in visibleRows"
          :key="row.key"
          :ref="(el) => bindItemEl(el, row.key)"
          :data-index="row.index"
          class="virtual-scroll__item"
          :style="itemStyle"
        >
          <slot :item="row.item" :index="row.index" />
        </div>
      </div>
    </div>

    <!-- 列表尾端（載入中、沒有更多、重試等）；位於 phantom 之後，不影響項目位置計算 -->
    <div v-if="$slots.footer" class="virtual-scroll__footer">
      <slot name="footer" />
    </div>

    <div v-if="!items.length" class="virtual-scroll__empty">
      <slot name="empty">暫無資料</slot>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance,
  type CSSProperties,
} from 'vue'

type Key = string | number
type Align = 'start' | 'center' | 'end'

const props = withDefaults(
  defineProps<{
    /** 資料列表 */
    items: T[]
    /** 固定高度（px）；不傳則為動態高度模式 */
    itemHeight?: number
    /** 動態模式下尚未量測項目的預估高度（px） */
    estimatedItemHeight?: number
    /** 可視區上下額外渲染的項目數 */
    buffer?: number
    /** 唯一鍵：欄位名稱或函式；取不到時退回 index */
    itemKey?: string | ((item: T, index: number) => Key)
    /** 容器高度，數字視為 px */
    height?: string | number
    /** 距離底部多少 px 觸發 reach-bottom */
    bottomThreshold?: number
  }>(),
  {
    itemHeight: undefined,
    estimatedItemHeight: 60,
    buffer: 5,
    itemKey: 'id',
    height: '100%',
    bottomThreshold: 100,
  },
)

const emit = defineEmits<{
  scroll: [payload: { scrollTop: number; start: number; end: number }]
  'reach-bottom': []
}>()

defineSlots<{
  default(props: { item: T; index: number }): unknown
  empty?(): unknown
  footer?(): unknown
}>()

/* ------------------------------------------------------------------ */
/* 狀態                                                                */
/* ------------------------------------------------------------------ */

const containerRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)

/** 佈局資料刻意不做成響應式（避免大陣列被 Proxy 包裝），改以版本號觸發重算 */
const layoutVersion = ref(0)
let keys: Key[] = []
let offsets: number[] = [0] // offsets[i] = 第 i 項頂部位置；offsets[n] = 總高
const heightCache = new Map<Key, number>()

const isFixed = computed(() => typeof props.itemHeight === 'number' && props.itemHeight > 0)

/* ------------------------------------------------------------------ */
/* 佈局計算                                                            */
/* ------------------------------------------------------------------ */

function resolveKey(item: T, index: number): Key {
  const { itemKey } = props
  if (typeof itemKey === 'function') return itemKey(item, index)
  if (item !== null && typeof item === 'object') {
    const k = (item as Record<string, unknown>)[itemKey]
    if (typeof k === 'string' || typeof k === 'number') return k
  }
  return index
}

function sizeOf(index: number): number {
  if (isFixed.value) return props.itemHeight as number
  return heightCache.get(keys[index]) ?? props.estimatedItemHeight
}

function offsetOf(index: number): number {
  if (isFixed.value) return index * (props.itemHeight as number)
  return offsets[index] ?? 0
}

/** 從 from 開始重建前綴和（只重算受影響的後段） */
function rebuildFrom(from = 0) {
  if (!isFixed.value) {
    const n = keys.length
    offsets.length = n + 1
    offsets[0] = 0
    for (let i = Math.max(0, from); i < n; i++) offsets[i + 1] = offsets[i] + sizeOf(i)
  }
  layoutVersion.value++
}

/** 同步 keys，並清掉已不存在項目的高度快取 */
function syncItems() {
  keys = props.items.map(resolveKey)
  const alive = new Set(keys)
  heightCache.forEach((_, k) => {
    if (!alive.has(k)) heightCache.delete(k)
  })
}

/** 找出頂部位置 <= offset 的最後一項 */
function findIndexByOffset(offset: number): number {
  const n = keys.length
  if (n === 0) return 0
  if (isFixed.value) {
    return Math.min(n - 1, Math.max(0, Math.floor(offset / (props.itemHeight as number))))
  }
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

const totalHeight = computed(() => {
  void layoutVersion.value
  return isFixed.value ? keys.length * (props.itemHeight as number) : offsets[keys.length] ?? 0
})

const range = computed(() => {
  void layoutVersion.value
  const n = keys.length
  if (!n) return { start: 0, end: 0 }
  const top = scrollTop.value
  const bottom = top + viewportHeight.value
  const start = Math.max(0, findIndexByOffset(top) - props.buffer)
  const end = Math.min(n, findIndexByOffset(bottom) + 1 + props.buffer)
  return { start, end }
})

const offsetY = computed(() => {
  void layoutVersion.value
  return offsetOf(range.value.start)
})

const visibleRows = computed(() => {
  const { start, end } = range.value
  const rows: { item: T; index: number; key: Key }[] = []
  for (let i = start; i < end; i++) rows.push({ item: props.items[i], index: i, key: keys[i] })
  return rows
})

const containerStyle = computed<CSSProperties>(() => ({
  height: typeof props.height === 'number' ? `${props.height}px` : props.height,
}))

const itemStyle = computed<CSSProperties | undefined>(() =>
  isFixed.value ? { height: `${props.itemHeight}px`, overflow: 'hidden' } : undefined,
)

/* ------------------------------------------------------------------ */
/* 動態高度量測（ResizeObserver）                                       */
/* ------------------------------------------------------------------ */

// SSR（Nuxt）安全：伺服端不建立 observer
const canObserve = typeof window !== 'undefined' && 'ResizeObserver' in window
const itemObserver = canObserve ? new ResizeObserver(onItemsResize) : null
let containerObserver: ResizeObserver | null = null
const keyToEl = new Map<Key, HTMLElement>()

/** 綁定 / 解綁項目元素；閉包帶 key，卸載時 Vue 會以 null 呼叫 */
function bindItemEl(el: Element | ComponentPublicInstance | null, key: Key) {
  const prev = keyToEl.get(key)
  const next = el instanceof HTMLElement ? el : null
  if (prev === next) return
  if (prev) {
    itemObserver?.unobserve(prev)
    keyToEl.delete(key)
  }
  if (next) {
    keyToEl.set(key, next)
    if (!isFixed.value) itemObserver?.observe(next)
  }
}

function onItemsResize(entries: ResizeObserverEntry[]) {
  if (isFixed.value) return
  const currentTop = containerRef.value?.scrollTop ?? scrollTop.value
  let minIndex = Infinity
  let anchorDelta = 0

  for (const entry of entries) {
    const el = entry.target as HTMLElement
    if (!el.isConnected) continue
    const index = Number(el.dataset.index)
    const key = keys[index]
    if (key === undefined) continue

    const size = entry.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height
    if (!size) continue // display:none 等情況不記錄

    const cached = heightCache.get(key)
    if (cached !== undefined && Math.abs(cached - size) < 0.5) continue
    const prev = cached ?? props.estimatedItemHeight
    heightCache.set(key, size)
    if (Math.abs(prev - size) < 0.5) continue

    // 位於可視區上方的項目高度改變 → 補償捲動位置，避免畫面跳動
    if (offsets[index] + prev <= currentTop) anchorDelta += size - prev
    minIndex = Math.min(minIndex, index)
  }

  if (minIndex === Infinity) return
  rebuildFrom(minIndex)

  if (anchorDelta) {
    nextTick(() => {
      const el = containerRef.value
      if (!el) return
      el.scrollTop += anchorDelta
      scrollTop.value = el.scrollTop
    })
  }
}

/* ------------------------------------------------------------------ */
/* 捲動                                                                */
/* ------------------------------------------------------------------ */

let bottomEmitted = false

function onScroll() {
  const el = containerRef.value
  if (!el) return
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  // iOS 回彈時 scrollTop 可能為負或超出上限
  const top = Math.min(Math.max(el.scrollTop, 0), max)
  scrollTop.value = top

  const { start, end } = range.value
  emit('scroll', { scrollTop: top, start, end })

  checkBottom()
}

/** 接近底部時發出 reach-bottom；以 bottomEmitted 閂鎖，離開閾值後才會再次觸發 */
function checkBottom() {
  const el = containerRef.value
  if (!el || !keys.length) return
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const top = Math.min(Math.max(el.scrollTop, 0), max)
  const nearBottom = max - top <= props.bottomThreshold
  if (nearBottom && !bottomEmitted) {
    bottomEmitted = true
    emit('reach-bottom')
  } else if (!nearBottom) {
    bottomEmitted = false
  }
}

function syncFromDom() {
  const el = containerRef.value
  if (!el) return
  scrollTop.value = el.scrollTop
  viewportHeight.value = el.clientHeight
}

function getTargetOffset(index: number, align: Align): number {
  const vh = viewportHeight.value
  const top = offsetOf(index)
  const size = sizeOf(index)
  let target = top
  if (align === 'center') target = top - (vh - size) / 2
  else if (align === 'end') target = top - vh + size
  return Math.max(0, Math.min(target, totalHeight.value - vh))
}

function scrollToOffset(offset: number, behavior: ScrollBehavior = 'auto') {
  containerRef.value?.scrollTo({ top: offset, behavior })
}

function scrollToIndex(
  index: number,
  { align = 'start', behavior = 'auto' }: { align?: Align; behavior?: ScrollBehavior } = {},
) {
  const n = keys.length
  if (!n) return
  const i = Math.min(n - 1, Math.max(0, index))
  scrollToOffset(getTargetOffset(i, align), behavior)

  // 動態高度：跳轉後新渲染的項目量測完，位置可能改變，做幾次修正
  if (isFixed.value || behavior === 'smooth') return
  let tries = 0
  const correct = () => {
    const el = containerRef.value
    if (!el) return
    const target = getTargetOffset(i, align)
    if (Math.abs(el.scrollTop - target) > 1 && tries++ < 3) {
      el.scrollTop = target
      scrollTop.value = el.scrollTop
      requestAnimationFrame(correct)
    }
  }
  requestAnimationFrame(correct)
}

function scrollToTop(behavior: ScrollBehavior = 'auto') {
  scrollToOffset(0, behavior)
}

/** 手動重算；clearCache = true 會丟棄所有已量測高度（例如字體大小、版面寬度改變後） */
function refresh(clearCache = false) {
  if (clearCache) heightCache.clear()
  syncItems()
  rebuildFrom(0)
  nextTick(syncFromDom)
}

/* ------------------------------------------------------------------ */
/* 監聽與生命週期                                                       */
/* ------------------------------------------------------------------ */

// 同時監聽參考與長度：整個替換或原地 push/splice 都會觸發
watch(
  () => [props.items, props.items.length, props.itemKey] as const,
  () => {
    syncItems()
    rebuildFrom(0)
    bottomEmitted = false
    nextTick(() => {
      syncFromDom() // 資料縮短時瀏覽器會自動夾住 scrollTop，這裡同步回來
      // 資料不足以填滿容器時不會有 scroll 事件，這裡主動檢查，讓父層繼續載入
      checkBottom()
    })
  },
  { immediate: true },
)

watch(
  () => [props.itemHeight, props.estimatedItemHeight] as const,
  () => {
    if (itemObserver) {
      if (isFixed.value) itemObserver.disconnect()
      else keyToEl.forEach((el) => itemObserver.observe(el))
    }
    rebuildFrom(0)
  },
)

onMounted(() => {
  const el = containerRef.value
  if (!el) return
  syncFromDom()
  // 容器高度等於內容高度，代表高度是被內容撐開的：容器不會捲動，虛擬化也會失效
  if (import.meta.dev && keys.length && Math.abs(el.clientHeight - totalHeight.value) < 1) {
    console.warn(
      '[VirtualScroll] 容器沒有固定高度，高度被內容撐開，因此無法捲動。' +
        '請傳入 height（例如 "400px"），或讓父層有明確高度（flex 版面需加 min-height: 0）。',
      el,
    )
  }
  if (canObserve) {
    // 手機旋轉、虛擬鍵盤、父層尺寸變動
    containerObserver = new ResizeObserver(() => {
      viewportHeight.value = el.clientHeight
    })
    containerObserver.observe(el)
  }
})

onBeforeUnmount(() => {
  itemObserver?.disconnect()
  containerObserver?.disconnect()
  keyToEl.clear()
})

defineExpose({ scrollToIndex, scrollToOffset, scrollToTop, refresh })
</script>

<style scoped>
.virtual-scroll {
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch; /* 舊版 iOS 慣性捲動 */
  overscroll-behavior: contain; /* 不把捲動傳給 body，避免觸發下拉刷新 */
  overflow-anchor: none; /* 由元件自行做捲動錨定，避免與瀏覽器重複修正 */
}

.virtual-scroll__phantom {
  position: relative;
  width: 100%;
}

.virtual-scroll__content {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

.virtual-scroll__item {
  box-sizing: border-box;
  display: flow-root; /* 防止子元素 margin 溢出，確保量測高度正確 */
}

.virtual-scroll__footer {
  display: flow-root;
}

.virtual-scroll__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #888;
  font-size: 14px;
}
</style>