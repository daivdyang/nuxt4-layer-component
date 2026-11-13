# 使用 Monorepo 的方式來避免 `.c12` 套件將layer庫引入自己的資料夾中，造成巢狀的函式庫無法被vite轉換

## 問題發生點

當layer內使用其他函式庫，如：`dayjs`，外部的主應用再加載此layer內的組件，composable時，用 `github:` 引用的 layer 會被下載到 `node_modules/.c12/` 底下，`install: true` 又在那裡另外裝了一份 `node_modules`，所以 `dayjs` 位在 layer 下載目錄內的巢狀 `node_modules` 中。

主應用的Vite 在 dev 模式下，會把 CommonJS 套件預先轉成 ESM（dependency pre-bundling）。但這個巢狀路徑不在它正常掃描的範圍內（它在`node_modules/.c12/xxx-xxx/node_modules/dayjs`），所以 dayjs 沒有被轉換，而是透過 /@fs/ 直接以原始檔案提供給瀏覽器。

主應用下的 `node_modules/.c12/xxx-xxx/node_modules/dayjs` 內的 `dayjs.min.js` 是 UMD 格式，沒有 ESM 的 export default，所以 import dayjs from 'dayjs' 就失敗了。

### 解法一（建議）：layer 改用 dayjs 的 ESM 版本

Dayjs 套件本身就附帶了 ESM 版本，放在 dayjs/esm 底下。直接 import 它，就不需要 Vite 做任何轉換：

```typescript
import dayjs from 'dayjs/esm'
import utc from 'dayjs/esm/plugin/utc'
import timezone from 'dayjs/esm/plugin/timezone'
import relativeTime from 'dayjs/esm/plugin/relativeTime'
import 'dayjs/esm/locale/zh-tw'
import 'dayjs/esm/locale/ko'
import 'dayjs/esm/locale/th'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(relativeTime)
```

其餘的程式碼都不用改。這個修正在 layer 內就能完成，不需要主專案做任何設定，不管 layer 是透過 Git、npm 或 monorepo 引用都能正常運作。

要注意，插件和語系也必須一起改成 dayjs/esm/... 的路徑。如果混用，dayjs/esm 和 dayjs 會是兩個不同的實例，插件會 extend 到錯的那一個。

## 解法二：不用 Git 遠端引用 layer

這個問題本質上是 `.c12` 的巢狀依賴造成的。只要 layer 會帶自己的依賴，就容易遇到類似的狀況，換其他 CommonJS 套件也一樣。改成以下任一種引用方式，layer 和它的依賴就會進入正常的 node_modules，Vite 的預先轉換也能正常運作：

- 私有 npm registry：npm i @your-org/ui-layer，extends: ['@your-org/ui-layer']
- Monorepo workspace："@your-org/ui-layer": "workspace:*"

## Monorepo workspace的解決方式

Monorepo 的做法是把主應用和 layer 放在同一個 repo 裡，由套件管理器的 workspace 功能把它們連結起來。這樣 layer 不再被下載到 `node_modules/.c12/`，像是相異layer的套件 `dayjs` 錯誤也會從根本上消失。下面用 pnpm 示範，最後再補充 npm workspaces 的差異。

### 為什麼這樣能解決問題

Vite 在 dev 模式下有一條規則：如果發出 import 的檔案本身位於 node_modules 裡，`Vite 不會為它 import 的套件做預先轉換`，因為它假設 `node_modules` 裡的程式碼已經由所屬套件處理好了。

用 Git 遠端引用時，layer 的 `useDate.ts` 位於 `node_modules/.c12/...` 裡，所以它 `import` 的 `dayjs` **被跳過轉換**，`CommonJS` 格式的檔案就直接被送到瀏覽器。

在 workspace 中，主應用的 `node_modules/@your-org/ui-layer` 只是一個指向 `layers/ui` 的符號連結。Vite 解析時會使用真實路徑，於是 layer 的檔案被視為一般的原始碼，它 `import` 的 `dayjs` 就會正常經過預先轉換。附帶的好處是，修改 layer 的檔案時，主應用也能即時 HMR 更新。

1. 目錄結構

    ```text
    nuxt-monorepo/
    ├─ apps/
    │  └─ web/                 # 主應用
    │     ├─ app/
    │     ├─ nuxt.config.ts
    │     ├─ tsconfig.json
    │     └─ package.json
    ├─ layers/
    │  └─ ui/                  # layer
    │     ├─ .playground/
    │     ├─ app/
    │     ├─ nuxt.config.ts
    │     ├─ tsconfig.json
    │     └─ package.json
    ├─ package.json
    └─ pnpm-workspace.yaml
    ```
2. 根目錄設定

    ```yaml
    # pnpm-workspace.yaml
    packages:
    - apps/*
    - layers/*
    ```

    ```json
    // package.json
    {
        "name": "nuxt-monorepo",
        "private": true,
        "scripts": {
            "dev": "pnpm --filter web dev",
            "dev:ui": "pnpm --filter @your-org/ui-layer dev",
            "build": "pnpm --filter web build",
            "typecheck": "pnpm -r typecheck"
        }
    }
    ```

    根目錄不需要安裝 nuxt，它只負責管理 workspace 和集中常用指令。

3. Layer 的 `package.json`

    ```json
    {
        "name": "@your-org/ui-layer",
        "private": true,
        "type": "module",
        "main": "./nuxt.config.ts",
        "scripts": {
            "dev": "nuxt dev .playground",
            "postinstall": "nuxt prepare && nuxt prepare .playground",
            "typecheck": "nuxt typecheck"
        },
        "peerDependencies": {
            "nuxt": "^4.0.0"
        },
        "dependencies": {
            "dayjs": "^1.11.0"
        },
        "devDependencies": {
            "nuxt": "^4.x",
            "vue": "^3.x",
            "typescript": "^5.x",
            "vue-tsc": "^2.x"
        }
    }
    ```

和之前的寫法幾乎一樣，有兩點不同：

- `private: true`：如果只在 monorepo 內部使用，不打算發佈，加上這個可以防止誤發佈。之後若要發佈到私有 registry，再移除即可。
- `vue` 列在 `devDependencies`：pnpm 的嚴格模式下，套件只能存取自己宣告的依賴。不列出來的話，layer 裡寫 `import { ref } from 'vue'` 會出現型別找不到的問題。

4. 主應用的設定

    ```json
    // apps/web/package.json
    {
        "name": "web",
        "private": true,
        "type": "module",
        "scripts": {
            "dev": "nuxt dev",
            "build": "nuxt build",
            "postinstall": "nuxt prepare",
            "typecheck": "nuxt typecheck"
        },
        "dependencies": {
            "@your-org/ui-layer": "workspace:*",
            "nuxt": "^4.x",
            "vue": "^3.x",
            "vue-router": "^4.x"
        }
    }
    ```

    ```typescript
    // apps/web/nuxt.config.ts
    export default defineNuxtConfig({
        extends: ['@your-org/ui-layer'],
    })
    ```

    `workspace:*` 告訴 `pnpm` 這個依賴要從 workspace 中取得，不要去 registry 下載。`extends` 則直接寫套件名稱，和日後從 npm 安裝時的寫法完全相同。

    其實寫 `extends: ['../../layers/ui']` 這種相對路徑也能運作，但用套件名稱有兩個好處：pnpm 能正確追蹤主應用依賴 layer 的關係；之後如果要把 layer 發佈出去，主應用的設定不需要修改。

5. 從目前的設定遷移過來

    1. 把 layer 的 repo 內容移到 `layers/ui/`，主應用移到 `apps/web/`。
    2. 移除主應用 `extends` 中的 `github:` 寫法，改成套件名稱。
    3. 刪除舊的下載快取和依賴：

        ```bash
        rm -rf node_modules apps/*/node_modules layers/*/node_modules
        rm -rf apps/web/node_modules/.c12 apps/web/.nuxt
        ```

    4. 在根目錄執行 `pnpm install`。每個子專案的 `postinstall` 都會自動執行，產生各自的 `.nuxt/` 型別檔。
    5. 執行 pnpm dev 啟動主應用。

這時候 layer 裡的 `import dayjs from 'dayjs'` 不需要改成 `dayjs/esm` 也能正常運作。  
不過如果 layer 之後可能會被其他非 workspace 的專案引用，保留 `dayjs/esm` 的寫法會更保險。

6. 讓版本保持一致

主應用和 layer 都會列出 `nuxt`、`vue`、`typescript`。版本不一致時可能裝出兩份 `Vue`，導致元件的型別或執行時行為出問題。`pnpm 9.5` 以上可以用 catalog 統一管理版本：

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - layers/*

catalog:
  nuxt: ^4.1.0
  vue: ^3.5.0
  typescript: ^5.6.0
  dayjs: ^1.11.0
```

各個 `package.json` 改寫成：

```json
{
  "devDependencies": {
    "nuxt": "catalog:",
    "vue": "catalog:"
  }
}
```

這樣升級時只需要修改一處。

7. 日常開發

- `pnpm dev`：啟動主應用，修改 layer 的檔案會即時更新。
- `pnpm dev:ui`：只啟動 layer 的 playground，單獨測試 layer 元件。
- `pnpm typecheck`：檢查所有子專案的型別。

在 layer 新增元件檔案時，主應用的 dev server 會偵測到並重新產生元件清單，通常不需要重啟。如果偶爾沒有反應，重啟 dev server 即可。

如果使用 npm workspaces

概念相同，差別如下：

```json
// 根目錄 package.json
{
  "private": true,
  "workspaces": ["apps/*", "layers/*"]
}
```

- `npm` 不支援` workspace:` 協定，主應用的依賴要寫成 `"@your-org/ui-layer": "*"`，npm 會自動連結到 workspace 中的套件。
- `npm` 會把所有依賴提升到根目錄的 `node_modules`，所以 layer 沒有宣告 `vue` 也能解析到。這比較方便，但也可能讓 layer 不小心依賴了沒有宣告的套件，日後單獨發佈時才出錯。
- npm 沒有 `catalog` 功能，版本一致性需要自己注意。

