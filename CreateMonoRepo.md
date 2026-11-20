# Monorepo 遷移與實務指南（Nuxt 4 + PrimeVue + Tailwind）

## 目錄

1. [手動將現有專案轉移成 monorepo](#一手動將現有專案轉移成-monorepo)
2. [多套件 monorepo 與在現有 repo 寫元件的差別](#二多套件-monorepo-與在現有-repo-寫元件的差別)
3. [多個應用在同一個 repo 時的版本管理](#三多個應用在同一個-repo-時的版本管理)
4. [應用建置時對套件做 tree shaking](#四應用建置時對套件做-tree-shaking)

---

## 一、手動將現有專案轉移成 monorepo

以下以 Nuxt 4 + PrimeVue + Tailwind 為例，說明如何把單一專案手動改成 **pnpm workspace + Turborepo** 的 monorepo。每一步都附上它背後的原理。

### 先理解原理：monorepo 是怎麼運作的

Monorepo 就是「一個 git repo 裡放多個套件」。它不是靠特殊工具硬湊出來的，而是由三層機制組成：

1. **套件管理器的 workspace 功能**（pnpm / npm / yarn）：根目錄宣告哪些資料夾是套件。安裝時只產生**一份 lockfile**。套件之間的引用不從 npm registry 下載，而是用 **symlink** 直接指到本地資料夾。所以你改了 `packages/ui` 的程式碼，`apps/web` 立刻就看得到。
2. **`workspace:*` 協定**：在 `package.json` 裡寫 `"@my/ui": "workspace:*"`，pnpm 就知道這個依賴一定要從 workspace 內解析，不會跑去 npm 找同名套件。
3. **Task runner**（Turborepo / Nx，選用）：它會分析套件之間的依賴圖，決定 build 的順序，並依檔案內容的 hash 做快取。沒改過的套件就不會重新 build。

pnpm 本身就能完成 1 和 2。Turborepo 處理的是 3，可以等到後面有需要再加。

### 目標結構

```
my-platform/
├─ apps/
│  └─ web/                 ← 原本的 Nuxt 專案整個搬進來
├─ packages/
│  ├─ i18n/                ← 共用語系檔（zh-TW / ko / th / en）
│  ├─ ui/                  ← PrimeVue 包裝元件
│  └─ tsconfig/            ← 共用 TS 設定（選用）
├─ package.json            ← 根目錄，private
├─ pnpm-workspace.yaml
├─ turbo.json
└─ .gitignore
```

`apps/` 放「可部署的應用」，`packages/` 放「被引用的函式庫」。這只是慣例，不是規定，但幾乎所有工具和文件都採用這個慣例。

### 步驟 1：開新分支，清掉產出物

```bash
git checkout -b chore/monorepo
git status          # 確認工作區乾淨
rm -rf node_modules .nuxt .output .data
```

**原理**：搬移時只應該移動被 git 追蹤的檔案。`node_modules` 和 build 產出物之後都會在新位置重新產生，留著只會造成混亂。

### 步驟 2：用 `git mv` 搬移，保留 git 歷史

```bash
mkdir -p apps/web
for f in $(git ls-files | cut -d/ -f1 | sort -u); do
  git mv "$f" apps/web/
done

# .gitignore 根目錄也需要一份，先複製回來
cp apps/web/.gitignore .gitignore
git add .gitignore

git commit -m "chore: move project into apps/web"
```

**原理**：git 其實不會記錄「重新命名」這件事。它是在比對時用**檔案內容的相似度**推測出 rename。所以這個 commit **只做搬移、不改任何內容**，git 才能 100% 偵測到 rename。之後用 `git log --follow apps/web/xxx.vue` 就能追到搬移前的完整歷史，`git blame` 也照常運作。

如果你在同一個 commit 裡又改了 `package.json` 和設定檔，相似度就會下降，部分檔案的歷史可能就斷了。

### 步驟 3：建立根目錄的 workspace 設定

根目錄的 `package.json`：

```json
{
  "name": "my-platform",
  "private": true,
  "packageManager": "pnpm@<你實際使用的版本>",
  "scripts": {
    "dev": "pnpm --filter web dev",
    "build": "pnpm --filter web build"
  }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

接著把 `apps/web/package.json` 的 `name` 改成 `"web"`（或 `"@my/web"`），方便之後用 `--filter` 指定。

**原理**：

- `private: true` 可以防止根目錄被誤發佈到 npm。根目錄只是一個容器，不是套件。
- `packageManager` 欄位會讓 Corepack 鎖定全團隊使用同一個 pnpm 版本，避免 lockfile 格式不一致。
- `pnpm-workspace.yaml` 的 glob 決定「哪些資料夾算是 workspace 成員」。只有列在這裡的套件，才能用 `workspace:*` 互相引用。

### 步驟 4：統一 lockfile 並安裝

```bash
# 若原本是 npm 或 yarn，先刪掉舊 lockfile
rm -f apps/web/package-lock.json apps/web/yarn.lock

# 若原本就是 pnpm，把 lockfile 移到根目錄
git mv apps/web/pnpm-lock.yaml ./pnpm-lock.yaml   # 有的話

pnpm install
```

如果原本用 npm，又想保留目前已鎖定的版本，可以在刪除之前先把 `package-lock.json` 移到根目錄，再執行 `pnpm import`，它會轉換出對應版本的 `pnpm-lock.yaml`。

**原理**：monorepo 只能有**一份**位於根目錄的 lockfile。這樣整個 repo 的依賴解析結果是一致的，同一個套件（例如 `vue`）才能盡量只安裝一份。

#### 這一步最常遇到的問題：幽靈依賴（phantom dependencies）

npm 和 yarn v1 會把所有依賴「攤平」到 `node_modules` 頂層。所以你的程式碼可能 `import` 了一個沒寫在 `package.json` 裡、只是被其他套件間接安裝的東西，而且一直都能跑。pnpm 的 `node_modules` 是**嚴格**的：只有你明確宣告的依賴才 import 得到。

如果出現 `Cannot find module 'xxx'`，正確的修法是：

```bash
pnpm --filter web add xxx
```

真的來不及一次修完的話，可以在根目錄 `.npmrc` 暫時加上 `shamefully-hoist=true` 回到攤平模式，但建議之後再拿掉。

### 步驟 5：確認應用照常運作，然後 commit

```bash
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web preview
```

到這一步，你已經擁有一個「只有一個成員的 monorepo」。功能應該跟搬移前完全一樣。**先 commit 一次**，之後抽套件時如果出問題，可以清楚分辨是哪一步造成的。

### 步驟 6：抽出第一個共用套件，以 i18n 為例

四種語系的語系檔很適合優先抽出來（例如之後後台管理系統也要共用）。

`packages/i18n/package.json`：

```json
{
  "name": "@my/i18n",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./*": "./src/*.ts"
  }
}
```

`packages/i18n/src/zh-TW.ts`：

```ts
export default {
  common: { login: '登入', deposit: '存款' },
  // ...
}
```

在 `apps/web` 加入依賴：

```bash
pnpm --filter web add @my/i18n@workspace:*
```

Nuxt 端的 `i18n/locales/zh-TW.ts` 只需要轉出：

```ts
export { default } from '@my/i18n/zh-TW'
```

這樣 `@nuxtjs/i18n` 的 `locales` 設定完全不用改。

**原理**：

- `pnpm install` 之後，`apps/web/node_modules/@my/i18n` 其實是一個 symlink，指向 `packages/i18n`。
- `exports` 欄位定義了這個套件「對外公開哪些路徑」。沒列出來的檔案，外部無法 import，這是一種封裝。
- 這種寫法叫做 **internal package / source package**：套件本身**不需要 build**，直接輸出 `.ts` 原始碼，交給使用方的打包工具編譯。Vite 會把「實際路徑不在 `node_modules` 內的 linked 套件」視為原始碼處理，所以 TS 和 Vue SFC 都能直接編譯，也支援 HMR。內部套件用這種方式最省事。

### 步驟 7：抽出 UI 套件（PrimeVue 元件），有兩種做法

#### 做法 A：Nuxt Layer（Nuxt 專案最推薦）

如果共用的對象都是 Nuxt 專案，可以把 `packages/ui` 做成一個 **Nuxt Layer**：

```
packages/ui/
├─ components/AppButton.vue
├─ composables/useToastMessage.ts
├─ nuxt.config.ts
└─ package.json
```

```ts
// apps/web/nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@my/ui'],
})
```

**原理**：Layer 會被 Nuxt 合併進應用，裡面的 `components/`、`composables/`、`nuxt.config` 都和應用本身的檔案一樣，享有自動匯入和設定合併。你甚至可以把 PrimeVue 的 module 設定（主題、preset）放在 layer 裡，讓所有 app 一致。

#### 做法 B：一般 Vue 套件

如果未來也要給非 Nuxt 專案使用，就做成一般套件：

```json
{
  "name": "@my/ui",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "peerDependencies": {
    "vue": "^3.5.0",
    "primevue": "^4.0.0"
  }
}
```

**關鍵原理：Vue 和 PrimeVue 一定要放在 `peerDependencies`**。如果放在 `dependencies`，可能會安裝出第二份 Vue。兩份 Vue 實例之間的 `provide/inject` 互不相通，就會出現「PrimeVue config 找不到」、「元件 inject 回傳 undefined」這類很難查的錯誤。`peerDependencies` 的意思是「我需要 Vue，但請使用宿主應用的那一份」。

#### Tailwind 也要知道去掃描套件

Tailwind 只會為它掃描到的 class 產生 CSS。如果套件裡的 class 沒被掃到，樣式就會消失：

```css
/* Tailwind v4：apps/web 的主 CSS */
@import "tailwindcss";
@source "../../../packages/ui";
```

如果是 Tailwind v3，則是在 `content` 陣列加入 `../../packages/ui/**/*.{vue,ts}`。

### 步驟 8：加入 Turborepo（套件變多之後）

```bash
pnpm add -Dw turbo
```

`turbo.json`：

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".output/**", "dist/**"]
    },
    "lint": {},
    "typecheck": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

根目錄 scripts 改成 `"build": "turbo run build"`。

**原理**：

- `"^build"` 的 `^` 表示「先跑**我所依賴的套件**的 build」。Turbo 會從各個 `package.json` 的依賴關係建立一張有向圖，依拓撲順序執行，彼此無關的任務則平行執行。
- 快取的 key 是「輸入檔案內容 + 環境變數 + 依賴」的 hash。hash 沒變就直接還原 `outputs`，不必重跑。這在 CI 上的效益最明顯。
- `-w`（`--workspace-root`）表示裝在根目錄。pnpm 預設會阻止你在根目錄安裝依賴，避免你誤把應用的依賴裝錯位置。

### 步驟 9：調整周邊設定

這一步最容易漏掉，建議逐項檢查：

- **環境變數**：Nuxt 讀取的是 `apps/web/.env`，不是根目錄的 `.env`。搬移後記得確認位置正確。
- **CI/CD**：安裝指令改在根目錄執行 `pnpm install --frozen-lockfile`，build 改成 `pnpm turbo run build --filter web`。cache 路徑改為 pnpm store。
- **Docker**：不要把整個 monorepo 都 COPY 進去。可以使用 `turbo prune web --docker`，它會只裁剪出 `web` 及其依賴套件和對應的 lockfile 片段。也可以用 `pnpm deploy`，產生一個獨立可部署的資料夾。
- **編輯器**：VS Code 從根目錄開啟即可，Vue 官方擴充（Volar）支援多個 tsconfig。若型別出錯，先在 `apps/web` 執行 `pnpm nuxt prepare`，重新產生 `.nuxt/tsconfig.json`。
- **Git hooks**（husky、lint-staged）：一律放在根目錄，因為 `.git` 在根目錄。

### 補充：如果要合併多個既有的 repo

如果你還有其他獨立的 repo（例如後台或活動頁）也要一起併入，並且保留各自的歷史，可以在**原 repo 的副本**上先把所有內容改寫進子目錄，再合併進來：

```bash
# 在 admin repo 的 clone 裡
git filter-repo --to-subdirectory-filter apps/admin

# 回到 monorepo
git remote add admin ../admin-clone
git fetch admin
git merge admin/main --allow-unrelated-histories
```

**原理**：`filter-repo` 會改寫每一個 commit，讓所有檔案路徑都加上 `apps/admin/` 前綴。這樣合併時就不會和現有檔案衝突，而且每個檔案的歷史都是完整的。

### 建議的遷移順序

搬移（純 rename commit）→ 建立 workspace 並讓 app 正常運作 → 修好幽靈依賴 → 抽出 i18n → 抽出 UI → 加入 Turbo → 調整 CI 與部署。

每一步都獨立 commit、獨立驗證。這樣出問題時可以馬上定位，也方便 code review。

---

## 二、多套件 monorepo 與在現有 repo 寫元件的差別

如果只有**一個應用**，兩者的差別其實不大。monorepo 真正的價值，要等到**有第二個以上的應用要共用同一份程式碼**時才會出現。差別主要在以下幾點。

### 1. 邊界是「約定」還是「強制」

在現有 repo 裡寫 `components/ui/`，它只是一個資料夾。任何檔案都可以 `import '~/components/ui/internal/xxx'`，也可以反過來 import 應用裡的 store、composable、`useRuntimeConfig()`。久了之後，「共用元件」常常會偷偷依賴某個業務邏輯，想拆也拆不乾淨。

抽成套件之後，邊界就由工具強制執行：

- 外部只能 import `package.json` 的 `exports` 有列出的路徑，內部實作藏得住。
- 套件裡用到的東西必須寫進自己的 `dependencies` 或 `peerDependencies`，否則在 pnpm 的嚴格模式下會直接報錯。
- 套件**無法** import 應用的程式碼，因為依賴方向是單向的：app → package。

換句話說，資料夾靠的是大家的自律，套件靠的是機制。

### 2. 能不能被多個應用使用

假設之後除了前台，還有後台管理系統、活動 landing page、代理商後台：

- **全部寫在同一個 repo 的資料夾裡**：其他應用要用，只能複製貼上，或用相對路徑跨專案 import（`../../web/components/...`）。前者會讓多份程式碼分歧，後者會讓建置設定一團亂。
- **monorepo 的套件**：每個 app 只要寫一行 `"@my/ui": "workspace:*"` 就能使用。改一次，所有 app 同步生效。

四種語系的翻譯檔就是典型的例子：前台和後台都需要同一份 zh-TW / ko / th / en 的翻譯，抽成 `@my/i18n` 就只需要維護一份。

### 3. 建置、測試、部署可以分開

| | 單一 repo + 資料夾 | monorepo 多套件 |
|---|---|---|
| 改了一個元件 | 整個應用重新 lint、測試、build | Turbo 只重跑受影響的套件與應用 |
| 部署 | 只有一個應用 | 每個 app 獨立部署，互不影響 |
| 依賴版本 | 全部擠在同一份 `package.json` | 每個套件宣告自己需要什麼 |
| 測試 | 元件測試和應用混在一起 | 套件可以獨立測試 |

### 4. 代價

monorepo 不是免費的，它會帶來額外的複雜度：

- 多了 workspace、`exports`、`peerDependencies` 等概念要理解。
- Tailwind 要額外設定掃描套件路徑。
- CI 和 Docker 設定變得比較複雜。
- 偶爾會遇到重複的 Vue 實例、型別解析之類的問題。

### 怎麼判斷你需不需要

**只有一個 Nuxt 應用，短期內也不會有第二個**：在現有 repo 裡好好整理資料夾就夠了。如果想要比資料夾更清楚的邊界，Nuxt 4 本身就支援在專案內放 `layers/` 目錄（例如 `layers/ui/`），會自動註冊成 layer，不需要 monorepo 就能得到類似套件的隔離效果。

**已經有或即將有第二個應用要共用元件、翻譯、型別、API client**：這時候才值得轉成 monorepo。

一個實用的做法是，先用 `layers/` 把共用的部分在現有專案內隔離好。等真的出現第二個應用，再把那個 layer 原封不動地搬到 `packages/`。到那時，遷移成本會非常低。

---

## 三、多個應用在同一個 repo 時的版本管理

「版本」在 monorepo 裡其實指三件不同的事，處理方式也各不相同：

1. **內部套件的版本**：例如 `@my/ui`、`@my/i18n`
2. **應用本身的版本**：例如前台 `web`、後台 `admin` 的發佈版本
3. **第三方依賴的版本**：例如 Vue、PrimeVue、Nuxt

### 1. 內部套件：預設「不分版本」

monorepo 最主流的做法（Google、Meta、Vercel 都是這樣）是：**內部套件沒有版本，所有應用永遠使用同一份最新的原始碼**。

```json
"@my/ui": "workspace:*"
```

`workspace:*` 的意思是「不管版本號是什麼，都連結到 repo 裡現在這一份」。所以 `@my/ui` 的 `version` 欄位可以一直維持 `0.0.0`，它沒有實際意義。

#### 原理：原子性修改（atomic change）

這正是 monorepo 最大的價值。假設你要把 `<AppButton>` 的 `type` prop 改名為 `variant`：

- **多 repo、多版本**：先發佈 ui 2.0 → 前台找時間升級 → 後台找時間升級 → 活動頁一直沒升級。結果線上同時存在三個版本的按鈕，每次修 bug 都要問「這是哪一版？」
- **monorepo**：在**同一個 commit / PR** 裡改套件，同時改好所有使用它的應用。CI 會跑所有受影響的應用，任何一個壞掉就不能合併。

換句話說，monorepo 用「改的人有責任把所有使用方一起改好」，取代了「用版本號隔離」。

#### 那 breaking change 改不完怎麼辦？

一次 PR 改不完所有應用時，常見的做法是**新舊並存、漸進遷移**，而不是開版本：

```ts
// packages/ui/src/index.ts
export { default as AppButton } from './AppButton.vue'        // 舊版，標記 @deprecated
export { default as AppButtonV2 } from './AppButtonV2.vue'    // 新版
```

或者讓新 prop 和舊 prop 暫時都能用，並在開發環境印出 deprecation 警告。等到所有應用都遷移完成，再刪掉舊的。這和後端 API 的版本演進是同一個思路。

### 2. 某個應用真的必須鎖舊版：發佈到私有 registry

如果真的有某個應用必須長期停在舊版（例如外包維護的代理商後台，無法跟著改），就要讓內部套件**真正擁有版本**，並發佈到私有 registry（GitHub Packages、GitLab Package Registry、自架 Verdaccio 等）。

最常用的工具是 **Changesets**：

```bash
pnpm add -Dw @changesets/cli
pnpm changeset init
```

流程如下：

```bash
pnpm changeset            # 開發者描述這次改了哪些套件、是 major/minor/patch
pnpm changeset version    # 依照描述自動更新版本號與 CHANGELOG
pnpm changeset publish    # 發佈到 registry，並打上 @my/ui@2.0.0 這類 tag
```

接著，兩個應用就可以使用不同的版本：

```jsonc
// apps/web/package.json —— 永遠用最新原始碼
"@my/ui": "workspace:*"

// apps/agent-admin/package.json —— 鎖在舊版，從 registry 下載
"@my/ui": "1.4.2"
```

**原理**：在 pnpm 9 之後的預設設定下，只有寫 `workspace:` 協定的依賴才會連結到本地資料夾。寫一般的版本號，pnpm 就會去 registry 下載。所以同一個 repo 裡，可以有一個應用連結本地原始碼，另一個應用使用發佈過的舊版。

另外，`pnpm publish` 發佈時會自動把 `workspace:*` 替換成實際的版本號，所以發佈出去的套件可以正常被外部安裝。

**代價**：你需要架設或購買 registry、在 CI 設定發佈流程，而且內部套件不能是 `private: true`、需要有 build 步驟。你也重新回到了「線上存在多個版本」的狀況。所以這個方案最好只用在**真正需要的那一兩個應用**，不要讓所有應用都這樣做。

### 3. 應用本身的版本

應用不會被別人 `npm install`，所以它的「版本」其實就是**部署紀錄**。常見做法有：

**直接用 commit SHA 或日期**當作部署識別，例如映像檔標記成 `web:2026.11.20-a1b2c3d`。這是最簡單的做法，也是多數團隊採用的。

**每個應用各自打 git tag**，例如 `web@3.2.0`、`admin@1.8.0`。Changesets 也可以處理不發佈的私有應用，只要在 `.changeset/config.json` 裡設定：

```json
{
  "privatePackages": { "version": true, "tag": true }
}
```

這樣應用會自動依照 changeset 更新版本、產生 CHANGELOG 並打 tag，但不會被發佈。

**只部署有變動的應用**：用 Turbo 的 filter 找出這次改動影響到哪些應用：

```bash
turbo run build --filter="...[origin/main]"
```

`[origin/main]` 選出和 main 相比有變動的套件，前面的 `...` 再把**依賴它們的套件**也一起選進來。所以改了 `@my/i18n`，前台和後台都會重新 build；只改了前台的頁面，後台就不會動。

### 4. 第三方依賴：每個應用可以各自不同

每個應用和套件都有自己的 `package.json`，pnpm 可以在同一個 repo 裡同時安裝不同版本，例如前台用 PrimeVue 4、舊後台還停在 PrimeVue 3，這完全沒問題。

#### 用 catalog 集中管理版本

應用一多，最常見的問題是版本慢慢分歧（前台 `vue@3.5.13`、後台 `vue@3.4.x`）。pnpm 的 **catalog** 可以在一個地方統一定義：

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  vue: ^3.5.13
  nuxt: ^4.0.0
  primevue: ^4.3.0

catalogs:
  legacy:
    primevue: ^3.53.0
```

```jsonc
// apps/web/package.json
"primevue": "catalog:"           // 使用預設 catalog → v4

// apps/agent-admin/package.json
"primevue": "catalog:legacy"     // 使用 legacy catalog → v3
```

這樣升級 Vue 時只要改一行，所有應用就會一起升級。哪些應用刻意停在舊版，也一目了然。

#### 要特別注意：共用套件和不同大版本

如果 `@my/ui` 依賴 PrimeVue，而兩個應用使用的是**不相容的大版本**（PrimeVue 3 和 4 的主題系統完全不同），那同一份 `@my/ui` 原始碼不可能同時支援兩者。這時候只有三個選擇：

- 把舊應用升級（最治本）
- 讓舊應用使用從 registry 發佈的舊版 `@my/ui`（第 2 節的做法）
- 暫時拆出一個 `@my/ui-legacy` 套件，舊應用維護期間凍結它，只修 bug

`peerDependencies` 寫成 `"primevue": "^3.0.0 || ^4.0.0"` 只有在你的元件真的同時相容兩版時才成立，不能用來掩蓋不相容的問題。

### 建議做法

如果前台、後台、活動頁都由同一個團隊維護，建議全部使用 `workspace:*` 加上 catalog 統一第三方版本，不要為內部套件開版本。遇到 breaking change 就在同一個 PR 裡把所有應用改好，或採用新舊並存的方式漸進遷移。應用的版本就用部署時的 commit SHA 或 tag 來追蹤。

只有在出現「這個應用不歸我們管，或者明確不會再跟著升級」的情況時，才針對它引入 Changesets 和私有 registry。一開始就為所有內部套件建立版本流程，通常只會增加負擔，卻享受不到 monorepo 原子性修改的好處。

---

## 四、應用建置時對套件做 tree shaking

可以，而且在 monorepo 裡，內部套件通常比從 npm 安裝的套件**更容易**做 tree shaking。不過前提是套件的寫法要符合幾個條件，否則打包工具會「不敢刪」。

### 原理：打包工具怎麼決定能不能刪

Tree shaking 是 Nuxt 在 production build 時，由 Vite 底層的 Rollup 執行的。它的運作分成兩個判斷：

1. **這個 export 有沒有被用到？** 這要靠 ESM 的 `import` / `export` 是**靜態**的。打包工具不需要執行程式碼，光看語法就知道 `import { AppButton } from '@my/ui'` 只用到了 `AppButton`。
2. **沒用到的模組，刪掉安不安全？** 一個模組就算沒有任何 export 被用到，只要它在頂層執行了某些事情（修改全域變數、註冊東西、載入 CSS），刪掉它就會改變程式的行為。這類行為稱為**副作用（side effect）**。打包工具無法確定時，會保守地保留它。

所以 tree shaking 能不能成功，關鍵在於：**程式碼是不是 ESM**，以及**打包工具能不能確定它沒有副作用**。

### 內部原始碼套件：天生就適合 tree shaking

直接輸出 `.ts` 和 `.vue` 原始碼（`"exports": { ".": "./src/index.ts" }`）、不經過預先 build 的套件，在 Vite 眼中**就跟應用自己的原始碼一樣**，會和應用一起編譯、一起分析。效果包括：

- 全部都是 ESM，靜態分析沒有障礙。
- 不會因為預先 build 而被包成一大塊，每個元件都是獨立模組。
- 壓縮器可以跨套件邊界做最佳化，例如把小函式內聯（inline）進來。

這是 internal package 模式相較於「發佈到 npm 再安裝」的一大優勢。

### 讓 tree shaking 生效的條件

#### 1. 在 `package.json` 宣告 `sideEffects`

```jsonc
{
  "name": "@my/ui",
  "sideEffects": ["**/*.css"]
}
```

這等於告訴打包工具：「除了 CSS 檔以外，這個套件裡的模組都沒有副作用。沒用到就可以整個刪掉。」

為什麼要特別排除 CSS？因為 `import '@my/ui/styles.css'` 這種寫法本身沒有 import 任何東西，完全靠副作用把樣式載入。如果直接寫 `"sideEffects": false`，這行可能會被刪掉，樣式就消失了。

`.vue` 元件內的 `<style>` 不需要特別處理。元件有被用到，它的樣式就會跟著一起被打包；元件沒被用到，樣式也一起被刪掉，這正是你想要的結果。

#### 2. 用具名匯出，不要匯出一個大物件

```ts
// ✅ 可以 tree shake
export { default as AppButton } from './AppButton.vue'
export { default as AppDialog } from './AppDialog.vue'

// ❌ 無法 tree shake：只要用到這個物件，所有元件都會被保留
export default { AppButton, AppDialog }
```

打包工具追蹤的是「哪個 export 被用到」，而不是「物件的哪個屬性被讀取」。

#### 3. 避免全域註冊所有元件的 Vue plugin

很多元件庫會提供這種寫法：

```ts
export default {
  install(app) {
    app.component('AppButton', AppButton)
    app.component('AppDialog', AppDialog)
    // ...全部註冊
  }
}
```

只要應用執行 `app.use(MyUI)`，所有元件都被引用到了，**一個都刪不掉**。正確的做法是讓應用按需 import，或者交給 Nuxt 自動匯入處理：

- 用 **Nuxt Layer** 的 `components/` 目錄，Nuxt 只會為模板中**實際使用到**的元件產生 import。
- PrimeVue 本身也是這樣處理的。`@primevue/nuxt-module` 會按需自動匯入，而不是一次註冊所有元件。

#### 4. 頂層不要有副作用

```ts
// ❌ 模組一被載入就會執行，打包工具不敢刪
const theme = createTheme(config)
window.__MY_UI__ = true

// ✅ 包進函式，用到時才執行
export function useTheme() { ... }
```

如果某個頂層呼叫確實是純函式（沒有副作用），可以加上 `/* @__PURE__ */` 註解，告訴打包工具這個呼叫可以安全刪除：

```ts
export const defaultTheme = /* @__PURE__ */ createTheme(config)
```

#### 5. 不要動態存取命名空間

```ts
import * as Icons from '@my/icons'
const icon = Icons[props.name]   // ❌ 打包工具不知道會用到哪個，只能全部保留
```

### barrel file（`index.ts` 統一匯出）有影響嗎？

在 **production** 環境，只要做到上面的 `sideEffects` 宣告，barrel file 不會影響 tree shaking 的結果。

但在 **開發** 環境，Vite 不做打包，瀏覽器會直接請求每一個模組。從 `@my/ui` 匯入一個按鈕，就可能觸發 barrel file 裡全部模組的請求。元件一多，dev server 的啟動和頁面載入都會明顯變慢。

如果遇到這個問題，可以改用子路徑匯出，讓使用方直接匯入單一元件：

```jsonc
"exports": {
  ".": "./src/index.ts",
  "./*": "./src/components/*.vue"
}
```

```ts
import AppButton from '@my/ui/AppButton'
```

### 如果套件必須預先 build

如果套件要發佈到 registry（例如某個應用要鎖舊版），就必須先用 Vite library mode 打包。這時候要注意：

```ts
// packages/ui/vite.config.ts
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'] },   // 只輸出 ESM
    cssCodeSplit: true,
    rollupOptions: {
      external: ['vue', 'primevue', /^primevue\//],    // peer 依賴不要打包進去
      output: { preserveModules: true },               // 保留每個檔案為獨立模組
    },
  },
})
```

其中最容易被忽略的是 **CSS**。Vite library mode 預設會把所有元件的樣式合併成一個 `style.css`。使用方只要載入這個檔案，就會拿到全部元件的樣式，**CSS 部分完全無法 tree shake**。`preserveModules` 加上 `cssCodeSplit` 可以讓樣式跟著各自的元件走。

CommonJS 格式（`require` / `module.exports`）是動態的，基本上無法 tree shake，所以只輸出 ESM 即可。

### 翻譯檔：要用的是 code splitting，不是 tree shaking

i18n 套件的情況有點不同。翻譯物件裡的 key 是在執行時用 `t('common.login')` 這種字串存取的，打包工具無法靜態分析出哪些 key 有被用到，所以**翻譯內容本身無法 tree shake**。

真正有效的做法是 **code splitting**：讓每個語系各自成為一個 chunk，使用者切換到哪個語系才下載哪個語系。`@nuxtjs/i18n` 的 lazy loading 就是在做這件事。在 `i18n/locales/zh-TW.ts` 裡轉出 `@my/i18n/zh-TW` 的寫法，每個語系本來就是獨立的動態 import，所以韓文使用者不會下載泰文的翻譯。

### Tailwind 的 CSS 是另一套機制

Tailwind 不是靠 tree shaking 刪除 CSS，而是**只為掃描到的 class 產生 CSS**。設定了 `@source "../../../packages/ui"` 之後，Tailwind 會掃描整個 ui 套件，所以就算某個元件沒被任何應用使用，它用到的 class 也會被產生出來。

通常這只會多出幾 KB，不值得特別處理。如果真的在意，可以把 `@source` 指得更精確一些。

### 怎麼驗證有沒有成功

Nuxt 內建分析指令：

```bash
cd apps/web
pnpm nuxi analyze
```

它會 build 一次，然後打開視覺化的 bundle 分析圖。你可以檢查：

- 沒有使用的元件有沒有出現在 bundle 裡
- 有沒有出現兩份 `vue` 或 `primevue`（代表 `peerDependencies` 或 `external` 設定有問題）
- 各語系是不是各自獨立的 chunk

一個簡單的測試方法是：在 `@my/ui` 裡建立一個刻意不被任何地方使用的元件，在裡面放一段獨特的字串，build 之後在 `.output` 目錄裡搜尋這段字串。如果搜尋不到，就代表 tree shaking 正常運作。