# Nuxt Config `extends` 詳解

`extends` 是 Nuxt **Layers（層）** 機制的入口。你可以把另一個 Nuxt 專案（有自己的 `nuxt.config`、元件、composables、頁面、server routes 等）當作「底層」，讓目前的專案疊在它上面。Nuxt 啟動時會把所有層的**設定**和**目錄內容**合併成一個應用程式，越上層的優先權越高。

常見用途有：多個站共用一套 UI 與邏輯、主題或品牌包、共用 auth 和 API 層，以及把大型專案拆成數個功能模組。

---

## 1. 寫法與來源類型

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '../base-layer',                    // 本地相對路徑（monorepo 最常見）
    '@my-org/ui-layer',                 // npm 套件
    'github:my-org/nuxt-layer#v1.2.0',  // git 遠端（底層用 giget 下載，可指定 tag/branch）
    ['github:my-org/private-layer', {   // tuple 形式可帶選項
      auth: process.env.GITHUB_TOKEN,   // 私有 repo
      install: true,                    // 自動安裝該 layer 的依賴
    }],
  ],
})
```

`extends` 可以是單一字串或陣列。遠端 git 來源支援 `github:`、`gitlab:`、`bitbucket:` 等前綴。

---

## 2. 一個 layer 長什麼樣

Layer 就是一個「不一定能單獨跑」的 Nuxt 專案。唯一必要的是 `nuxt.config.ts`，內容可以只寫 `defineNuxtConfig({})`。在 Nuxt 4 的目錄慣例下大致如下：

```
base-layer/
├─ nuxt.config.ts      ← 必要
├─ package.json        ← 發佈成 npm 時需要，"main": "./nuxt.config.ts"
├─ app/
│  ├─ app.config.ts
│  ├─ components/  composables/  utils/
│  ├─ layouts/  middleware/  pages/  plugins/
├─ server/             ← API routes、server middleware
├─ shared/
└─ public/
```

這些目錄全部會被 Nuxt 自動掃描並納入，效果就像寫在你的專案裡一樣：元件可以直接用、composables 會 auto-import、pages 會產生路由。

---

## 3. 合併規則：設定 vs 檔案

### 設定（nuxt.config / app.config）

設定透過 c12 載入，再用 `defu` 深度合併：

- **純量值**：由高優先層決定
- **物件**：遞迴合併
- **陣列**：串接

所以 layer 的 `modules: ['@nuxtjs/i18n']` 加上專案的 `modules: ['@pinia/nuxt']`，結果兩個都會載入。`css` 陣列也是同樣的道理。

```ts
// layer: runtimeConfig: { public: { apiBase: '/api', timeout: 5000 } }
// 專案: runtimeConfig: { public: { apiBase: '/v2' } }
// 結果: { apiBase: '/v2', timeout: 5000 }
```

`app.config.ts` 也是深度合併，很適合放主題色、品牌名稱這類「layer 給預設值、專案覆寫部分」的東西。

### 檔案

檔案則是**同名覆蓋**。如果 layer 有 `app/components/AppHeader.vue`，你的專案也建立一個同名檔案，就會整個取代 layer 的版本。pages（同路由）、layouts、composables 也一樣。

這就是 layer 最常用的「覆寫模式」：底層提供完整預設，上層只改需要客製的那幾個檔案。

---

## 4. 優先順序

由高到低：

1. **你的專案本身**（永遠最高）
2. **`~~/layers/` 目錄下自動掃描的 layer**：依字母排序，Z 比 A 高。可以用 `1.base`、`2.feature` 這種命名來控制順序。這些 layer 不需要寫進 `extends`。
3. **`extends` 陣列裡的 layer**：排在前面的優先權較高。

Layer 本身也可以再 `extends` 其他 layer，形成巢狀結構，越深層的優先權越低。

> 實際的細節建議以你所用版本的官方文件為準。

---

## 5. 最常踩的坑：路徑解析

Layer 的 `nuxt.config.ts` 裡的**相對路徑，是以「使用它的專案」為基準解析的**，不是以 layer 自己的位置。所以這樣寫會壞掉：

```ts
// ❌ 會去找專案底下的 ./app/assets/css/main.css
css: ['./app/assets/css/main.css']
```

正確的做法是用 layer 自己的絕對路徑：

```ts
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const currentDir = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  css: [join(currentDir, './app/assets/css/main.css')],
})
```

也可以用 `@nuxt/kit` 的 `createResolver(import.meta.url)`。

同理，layer 裡的 Vue 檔案若使用 `~/` 或 `@/` 別名，指向的是**專案的** srcDir，而不是 layer 的。在 layer 內部引用自己的檔案時，請用相對路徑，或者在 layer 的 config 設定名稱：

```ts
export default defineNuxtConfig({ $meta: { name: 'base' } })
```

在較新的版本中，這樣就能用 `#layers/base/...` 這個別名指向該 layer 的根目錄。

---

## 6. 依賴管理

Layer 用到的模組和套件，必須能從專案端被解析到：

- **npm layer**：把 `@nuxtjs/i18n`、`@primevue/nuxt-module` 這類依賴放在 `dependencies`，而不是 `devDependencies`
- **monorepo**：交給 workspace 處理
- **git 遠端 layer**：開啟 `install: true`

---

## 7. 和常見模組搭配時的注意點

### @nuxtjs/i18n

`@nuxtjs/i18n` 支援 layers：各層 `i18n.locales` 的翻譯檔會被合併，同一個 key 由專案覆寫 layer。所以可以讓 layer 放共用字串，專案只放差異部分。

要注意 `langDir` 是相對於各自 layer 的 i18n 目錄來解析。

### Tailwind CSS v4

Tailwind v4 的自動內容偵測預設會略過 `node_modules`。如果 layer 是以 npm 套件安裝的，需要在主 CSS 裡加上 `@source` 指向 layer 的路徑，否則 layer 元件用到的 class 可能不會被產生。

---

## 8. Layer 和 Module 的差別

| | Layer | Module |
|---|---|---|
| 本質 | 帶檔案的設定包 | 用程式介入建置流程 |
| 內容 | 元件、頁面、主題、預設設定 | 註冊 hook、修改 Vite 設定、動態加入元件 |
| 方式 | 宣告式疊加 | 程式化擴充 |

兩者常常一起用：一個 layer 可以在自己的 `modules` 裡啟用並設定好幾個 module。如果要寫 module，可以從 `nuxt.options._layers` 讀到所有 layer 的資訊。