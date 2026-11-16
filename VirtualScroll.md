# Vue 3 虛擬卷軸組件：需求、使用方式與設計思路

> 本文件整理自對話內容，組件原始碼（`VirtualScroll.vue`）另見獨立檔案，此處不重複收錄。

---

## 第一部分：需求

### Role

你是一位資深 Vue 3 前端工程師，擅長設計高重用性、職責單一（Single Responsibility Principle）的 UI 組件。

### Task

請使用 Vue 3（Composition API + `<script setup>` 語法糖）開發一個虛擬卷軸組件（Virtual Scroll Component）。

### Requirements

1. 支援項目是動態的高度或指定固定高度
2. 支援手機版本
3. 數據變更時重新計算

### Output Format

請提供完整的 `.vue` 單一文件組件程式碼（包含 `<template>`、`<script setup>` 與簡易的 `<style scoped>`）。

---

## 第二部分：組件交付說明

`VirtualScroll.vue` 使用 `<script setup lang="ts" generic="T">`，slot 的 `item` 會自動帶入型別。

### 使用方式

```vue
<!-- 固定高度 -->
<VirtualScroll :items="list" :item-height="56" height="100dvh">
  <template #default="{ item }">
    <div class="h-full px-4 flex items-center">{{ item.name }}</div>
  </template>
</VirtualScroll>

<!-- 動態高度 + 無限載入 -->
<VirtualScroll
  ref="vs"
  :items="messages"
  :estimated-item-height="80"
  item-key="id"
  @reach-bottom="loadMore"
>
  <template #default="{ item }"><ChatBubble :msg="item" /></template>
  <template #empty>還沒有任何訊息</template>
</VirtualScroll>
```

對外暴露的方法有 `scrollToIndex(i, { align, behavior })`、`scrollToOffset`、`scrollToTop`、`refresh(clearCache?)`。

### 三項需求的實作方式

1. **固定或動態高度**
   - 傳入 `itemHeight` 時直接以乘除計算可視範圍。
   - 不傳時，先用 `estimatedItemHeight` 估算，再由 ResizeObserver 實測每個項目。高度存放在以 key 為索引的快取裡，並以前綴和陣列加二分搜尋定位。
   - 某個項目高度改變時，只從該 index 往後重算。
   - 位於可視區上方的項目長高或變矮時，會自動補償 scrollTop，往上捲動時畫面不會跳動。

2. **手機版**
   - 使用 passive scroll 監聽。
   - iOS 回彈時把 scrollTop 夾在合法範圍內。
   - 以 `overscroll-behavior: contain` 避免捲到底時帶動 body 或觸發下拉刷新。
   - 容器本身也掛了 ResizeObserver，螢幕旋轉或虛擬鍵盤彈出導致高度變化時會自動重算。

3. **數據變更**
   - watch 同時監聽 `items` 的參考與長度，所以整個替換、原地 `push`、`splice` 都會觸發重建。
   - 已量測的高度依 key 保留，追加資料不會讓前面的項目重新估算。

### 注意事項

- **務必提供穩定的 `itemKey`。** 若退回使用 index 當 key，刪除或插入資料後，高度快取會對到錯誤的項目。
- **項目之間的間距請用 padding，不要用 margin。** ResizeObserver 量的是 border-box，margin 不會被計入。
- **整體版面寬度改變時（例如切換語系導致文字換行），請呼叫 `refresh(true)`。** 這是因為內容變化未必會改變已渲染項目的高度，舊的快取值可能已經不準。
- **Nuxt 4 SSR 可直接使用。** observer 只會在客戶端建立；伺服端只渲染開頭幾個項目，hydration 後才依實際視窗高度補齊。

---

## 第三部分：設計與思路詳解

以下按「要解決什麼問題 → 結構怎麼搭 → 每一塊為什麼這樣寫」的順序，把組件拆開說明。

### 一、核心問題：三件事

虛擬卷軸要做到的效果是：一萬筆資料只產生十幾個 DOM 節點，捲起來卻和全部渲染一樣。要騙過瀏覽器，元件每次捲動都得回答三個問題：

1. 整個列表總共多高？這決定捲軸的長度和可捲範圍。
2. 目前 scrollTop 下，應該渲染第幾項到第幾項？
3. 這一小段要擺在哪個垂直位置，才會剛好出現在原本該出現的地方？

整個元件的程式碼，都是在用最低成本回答這三題。

### 二、DOM 結構：三層各司其職

```text
              ┌──────────────────────┐
  scrollTop   │  ┆ item 0 ┆          │ ← Phantom：撐出總高 totalHeight
  offsetY     │  ┆ item 1 ┆          │
     │  │     │  ┆  ...   ┆          │   虛線項目：只存在於 offsets，未渲染
     │  ▼     │╔═════════════════╗   │
     │        │║ item 6 (buffer) ║   │ ← Content：以 translate3d(0, offsetY, 0) 定位
     ▼        │║ item 7 (buffer) ║   │
   ┏━━━━━━━━━━┿╋━━━━━━━━━━━━━━━━━╋━━━┿┓
   ┃          │║ item 8          ║   │┃ ← Viewport：使用者看到的區域
   ┃          │║ item 9          ║   │┃
   ┃          │║ item 10         ║   │┃
   ┗━━━━━━━━━━┿╋━━━━━━━━━━━━━━━━━╋━━━┿┛
              │║ item 11 (buffer)║   │ ← Buffer：上下各多渲染幾項
              │║ item 12 (buffer)║   │
              │╚═════════════════╝   │
              │  ┆  ...   ┆          │
              │  ┆ item n ┆          │
              └──────────────────────┘
```

最外層的 `.virtual-scroll` 是真正會捲動的容器，只負責提供 scrollTop 和 clientHeight。

第二層 `.virtual-scroll__phantom` 是一個沒有內容、只有高度的元素，高度等於 `totalHeight`，讓瀏覽器以為裡面真的有一萬筆資料。捲軸長度、慣性捲動、手機回彈這些行為都由瀏覽器原生處理，元件不需要模擬。

第三層 `.virtual-scroll__content` 以 absolute 疊在 phantom 頂端，只裝可視範圍內的項目，再用 `translate3d(0, offsetY, 0)` 推到正確位置。

定位用 transform，而不是 `padding-top` 或 `top`。原因是 transform 只影響合成層，不會觸發整個子樹重新排版；padding 每次變動都會讓瀏覽器重算 layout。捲動是每幀都在發生的事，這個差異在中低階手機上感受很明顯。`will-change: transform` 則是提示瀏覽器預先把這層提升為獨立圖層。

### 三、固定高度與動態高度：同一套介面，兩種演算法

`isFixed` 這個 computed 決定走哪一條路，但對外的三個答案（`totalHeight`、`range`、`offsetY`）在兩種模式下長得一模一樣。這是刻意的設計：模板和捲動邏輯完全不用知道現在是哪種模式。

固定高度最簡單。總高是 `n × h`，第一個可見項是 `floor(scrollTop / h)`，第 i 項的位置是 `i × h`，全部 O(1)，連快取都不需要。

動態高度的難處在於，項目還沒渲染就不知道它多高，但不知道高度又算不出該渲染哪些項目。解法是「先估算、再量測、後修正」的循環：

1. 每個項目先假設為 `estimatedItemHeight`。
2. 據此算出位置並渲染。
3. 渲染後量出真實高度，寫入 `heightCache`。
4. 重算位置。

隨著使用者捲動，被量過的項目越來越多，佈局就越來越準。

位置的計算靠前綴和陣列 `offsets`：`offsets[i]` 是第 i 項的頂部座標，`offsets[n]` 就是總高。有了它，「scrollTop 落在第幾項」變成在有序陣列上找「最後一個 `offsets[i] <= scrollTop` 的 i」，用二分搜尋就是 O(log n)，十萬筆也只要比較十七次左右。

高度改變時，`rebuildFrom(minIndex)` 只從受影響的那一項往後重算。一批量測結果裡取最小的 index，整批只重建一次。更嚴謹的做法是用 Fenwick tree（樹狀陣列），單點更新和查詢都是 O(log n)，但程式碼複雜度高不少。考量一般列表在十萬筆以內，而且 ResizeObserver 本身會把同一幀的變化合併成一批，線性重建的實際成本很低，所以選了較簡單的方案。如果場景是數十萬筆、且高度頻繁變動，這是第一個值得升級的地方。

`heightCache` 以 key 而不是 index 為索引，這點很關鍵。資料在前面插入一筆時，所有 index 都會位移，但 key 不變，所以已量測的高度不會錯位。這也是為什麼 `itemKey` 必須穩定。

### 四、響應式策略：故意不讓 Vue 追蹤佈局資料

`keys`、`offsets`、`heightCache` 都是普通變數，不是 `ref` 或 `reactive`，改由 `layoutVersion` 這個數字 ref 當作「手動失效開關」。

原因有兩個。第一，Vue 會對 reactive 陣列建立 Proxy，存取每個元素都要經過 getter 並收集依賴；`rebuildFrom` 的迴圈一次寫入上萬次，每次寫入都觸發 trigger，成本遠高於計算本身。第二，佈局資料總是整批改變，沒必要細粒度追蹤。

所以做法是：每次改完佈局資料就 `layoutVersion.value++`，而需要佈局的 computed 開頭寫一行 `void layoutVersion.value`。這行看起來沒做事，其實是在向 Vue 登記依賴，版本號一變，`range`、`offsetY`、`totalHeight` 就會重算。這個模式在處理大量非響應式資料時很好用，代價是要自己記得在每個修改點遞增版本號。

### 五、量測：為什麼選 ResizeObserver

量測高度有兩種常見做法：在 `onUpdated` 裡用 `getBoundingClientRect` 逐一讀取，或用 ResizeObserver。選後者的理由有三：

1. **時機正確。** ResizeObserver 的回呼在瀏覽器完成 layout 之後、paint 之前觸發，讀到的是真實尺寸，也不會造成強制同步排版（layout thrashing）。
2. **自動批次。** 同一幀內多個元素變化，只會觸發一次回呼。
3. **抓得到非同步變化。** 這是最重要的一點。圖片載入完成、文字展開、字型替換，這些都不會觸發 Vue 的 `onUpdated`，但 ResizeObserver 都抓得到。用 `onUpdated` 方案，圖片晚一秒載入，高度就會一直是錯的。

量測值取 `borderBoxSize.blockSize`，也就是包含 padding 和 border、但不含 margin。這就是為什麼項目間距要用 padding。項目容器加上 `display: flow-root`，是為了建立新的 BFC，讓子元素的 margin 不會穿出去和相鄰項目摺疊，否則量出來的高度會和實際佔用空間不符。

元素和 observer 的綁定用的是 function ref，而且閉包帶著 key：`:ref="(el) => bindItemEl(el, row.key)"`。這樣寫有個不明顯的原因：Vue 在元素卸載時，會以 `null` 呼叫最後一次的 ref 函式。如果函式裡不知道自己對應哪個 key，就無法得知該 unobserve 哪個元素。ResizeObserver 會強引用被觀察的元素，不解綁就會記憶體洩漏。帶上 key 後，`keyToEl` 這個 Map 就能精確地做到「新的 observe、舊的 unobserve、同一個略過」。

回呼裡用 `data-index` 從 DOM 反查是第幾項，因為回呼觸發時 DOM 已經是最新渲染結果，index 一定和當下的 `keys` 對得上。

### 六、捲動錨定：解決往上捲時的跳動

這是動態高度虛擬列表最常見、也最惱人的 bug。情境是這樣的：使用者從中間往上捲，上方原本只是估算高度 60px 的項目，第一次渲染後量出來是 120px。它長高了 60px，下方所有內容（包括使用者正在看的那一項）就被往下推 60px，畫面看起來就是突然跳了一下。

解法是在回呼裡判斷：如果變化的項目完全位於可視區上方（`offsets[index] + prev <= currentTop`），就把高度差累加到 `anchorDelta`，然後把 scrollTop 加上這個差值。內容往下推多少，視窗就跟著往下移多少，使用者看到的畫面維持不動。

補償放在 `nextTick` 而不是立即執行，是因為必須等 Vue 把新的 `totalHeight` 寫進 phantom 之後才能設定 scrollTop。否則 phantom 還是舊的高度，瀏覽器會把超出範圍的 scrollTop 夾掉，補償就失效了。

容器上設 `overflow-anchor: none`，是要關掉 Chrome 和 Firefox 內建的捲動錨定，避免瀏覽器和元件各補償一次、變成補償兩倍。

這裡有一個要誠實說明的取捨：iOS Safari 上，在慣性捲動途中以程式設定 scrollTop，會中斷慣性。所以快速往上甩動時，偶爾會感覺到被「煞車」一下。目前沒有完美解，常見的折衷是先暫存 delta，等捲動停止後再補償，但這樣捲動過程中就會看到跳動。這裡選擇優先保證畫面穩定。

### 七、可視範圍與 buffer

`range` 先用二分搜尋找出 scrollTop 和 scrollTop + viewportHeight 分別落在哪一項，再往上下各擴展 `buffer` 項。

buffer 存在的原因是：快速捲動時，瀏覽器的合成執行緒可能比 JS 早一步把畫面捲過去。如果只渲染剛好可見的項目，邊緣就會短暫露出空白。多渲染幾項等於預留緩衝區。buffer 越大越不容易閃白，但 DOM 也越多。預設 5 對一般列表夠用，項目很矮、甩動很快的場景（例如手機上的長清單）可以調到 10。

元件掛載前 `viewportHeight` 是 0，此時 range 只會算出開頭 1 + buffer 項。這剛好符合 SSR 的需求：伺服端渲染一小段讓首屏有內容，hydration 後讀到真實容器高度再補齊。

### 八、捲動事件處理

scroll handler 直接同步更新 `scrollTop.value`，沒有另外用 requestAnimationFrame 節流。這是刻意的。瀏覽器的 scroll 事件本來就是在每幀的渲染步驟中、最多觸發一次，而 Vue 的響應式更新會在微任務中批次執行，所以同一幀內就會完成「讀 scrollTop → 重算 range → patch DOM」，趕在 paint 之前。再包一層 rAF 不會減少工作量，反而可能多延遲一幀，在快速捲動時更容易閃白。

讀取 scrollTop 時會夾在 `[0, scrollHeight - clientHeight]` 之間。iOS 回彈時 scrollTop 可能是負數或超出上限，直接拿來算 range 會得到奇怪的結果。

`reach-bottom` 用 `bottomEmitted` 旗標做閂鎖：進入底部閾值時只發一次，離開閾值後才重置。否則使用者在底部附近微微滑動，每個 scroll 事件都會觸發一次載入。資料變更時也會重置旗標，這樣載入更多資料、列表變長後，下次再捲到底才能再次觸發。

### 九、手機適配

前面已提到 passive listener 和回彈夾值，其餘幾點如下：

- **`overscroll-behavior: contain`**：捲到底或頂時，捲動不會傳遞給 body。這避免了整頁跟著捲，也避免觸發 Android Chrome 的下拉刷新。
- **`-webkit-overflow-scrolling: touch`**：舊版 iOS 需要這行才有慣性捲動，新版已是預設，留著無害。
- **容器上的 ResizeObserver**：手機上容器高度變化很頻繁，例如螢幕旋轉、虛擬鍵盤彈出收起、iOS Safari 網址列伸縮。用 window resize 事件抓不到容器本身的變化，所以直接觀察容器。
- **`height` 參數接受任意 CSS 值**：建議手機全螢幕列表用 `100dvh`，它會隨網址列伸縮動態調整，`100vh` 在 iOS 上則會被網址列遮住一截。

### 十、數據變更

watch 的 getter 回傳 `[props.items, props.items.length, props.itemKey]`，同時監聽三樣東西。只監聽 `props.items` 的話，父層用 `list.value.push(x)` 原地修改陣列時參考不變，watch 不會觸發；加上 length 就能涵蓋 push、pop、splice。剩下抓不到的只有「長度不變、原地替換某一項」這種情況，這時呼叫 `refresh()` 即可。沒有用 `deep: true`，因為深層監聽一萬筆物件的成本很高，而且項目內容變化造成的高度改變，ResizeObserver 本來就會處理。

觸發後依序做四件事：

1. 重新產生 keys，並清掉已不存在項目的高度快取。
2. 從頭重建 offsets。
3. 重置 reach-bottom 閂鎖。
4. 在 `nextTick` 從 DOM 同步 scrollTop。

第四步的原因是：資料變少時，phantom 變矮，瀏覽器會自動把 scrollTop 夾小，但這個變化不保證會觸發 scroll 事件。不手動同步的話，元件內的 scrollTop 會停在舊值，算出空白的 range。

### 十一、scrollToIndex 的修正迴圈

固定高度模式下，目標位置是精確的，跳一次就到。動態高度模式下，目標項目和它上方的項目可能都還沒量測過，算出的位置只是估計值。跳過去後，那一帶的項目被渲染、量測，真實位置就變了。

所以跳轉後會在下一幀重算目標位置，偏差超過 1px 就再修正一次，最多三次。通常一到兩次就會收斂，因為第一次跳轉後，目標附近的項目都已經量測完成。

`behavior: 'smooth'` 時跳過修正。平滑捲動是持續數百毫秒的動畫，中途設定 scrollTop 會打斷它，造成卡頓。代價是平滑捲動到未量測區域時，最後可能有些微偏差。

### 十二、單一職責：元件刻意不做的事

這個元件只負責一件事：決定哪些項目該被渲染，以及擺在哪裡。以下這些都刻意留在外面：

- **項目長什麼樣**：交給預設 slot，元件不給項目加任何視覺樣式，只在固定高度模式下設定高度。
- **資料從哪來、怎麼載入更多**：交給父層監聽 `reach-bottom`，元件不知道 API、分頁或 loading 狀態。
- **空狀態長什麼樣**：交給 `empty` slot，只提供一個預設文字。
- **型別**：用 `generic="T"` 讓 slot 的 `item` 自動推導型別，元件本身不假設資料結構，唯一的要求是能取得 key。

這樣切分的好處是，同一個元件能用在聊天訊息、下注紀錄、遊戲大廳清單這些外觀完全不同的場景，而且每個場景的業務邏輯都不會滲進元件裡。

### 十三、已知限制與擴充方向

以下是目前沒有處理、但實務上可能遇到的情況：

- **只支援垂直方向。** 橫向列表或網格（例如遊戲大廳的卡片牆）需要另外處理。網格可以把每一「列」視為一個項目，套用同樣的邏輯。
- **捲出可視範圍的項目會被銷毀。** 項目內若有輸入框或展開狀態，捲回來時會遺失，這類狀態需要提升到資料層保存。
- **不支援底部錨定的反向列表**，也就是聊天室那種新訊息從底部進來、要維持貼底的情境。這需要額外處理「資料增加時保持距離底部不變」，是另一套錨定邏輯。
- **超大資料量且高度頻繁變動時**，如第三節所說，可以把前綴和換成 Fenwick tree。