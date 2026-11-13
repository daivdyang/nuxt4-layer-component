import { computed, type Ref, type ComputedRef } from 'vue'
/**
 * 注意：
 * 主應用加載套件時可能會有問題，主要原因是套件的加載是在 .c12 的 node_modules 內，
 * 這種巢狀依賴，主應用的 vite 是不會去轉換的，那就會有問題。
 * 
 * 主應用的Vite 在 dev 模式下，會把 CommonJS 套件預先轉成 ESM（dependency pre-bundling）。
 * 問題本質上是 .c12 的巢狀依賴造成的。只要 layer 會帶自己的依賴，就容易遇到類似的狀況，換其他 CommonJS 套件也一樣。
 * 但這個巢狀路徑不在它正常掃描的範圍內，所以 dayjs 沒有被轉換，而是透過 /@fs/ 直接以原始檔案提供給瀏覽器
 * dayjs.min.js 是 UMD 格式，沒有 ESM 的 export default，所以 import dayjs from 'dayjs' 就會失敗了。
 * 
 * 解法：
 * 1. Dayjs 套件本身就附帶了 ESM 版本，放在 dayjs/esm 底下。直接 import 它，就不需要 Vite 做任何轉換。
 * 2. 不用 Git 遠端引用 layer，改用 Monorepo workspace的方式
 */
// 若這些註解import與下面的交換後，主應用就會報錯，
// 因為dayjs.min.js 是 UMD 格式，沒有 ESM 的 export default，所以 import dayjs from 'dayjs' 就會失敗報錯。
// import dayjs from 'dayjs' 
// import utc from 'dayjs/plugin/utc'
// import timezone from 'dayjs/plugin/timezone'
// import relativeTime from 'dayjs/plugin/relativeTime'
// import 'dayjs/locale/zh-tw'
// import 'dayjs/locale/ko'
// import 'dayjs/locale/th'
import dayjs from 'dayjs/esm'
import utc from 'dayjs/esm/plugin/utc'
import timezone from 'dayjs/esm/plugin/timezone'
import relativeTime from 'dayjs/esm/plugin/relativeTime'
import 'dayjs/esm/locale/zh-tw'
import 'dayjs/esm/locale/ko'
import 'dayjs/esm/locale/th'

// Dayjs 的 extend() 和 locale() 都是修改全域狀態。
// 如果每個元件各自 import 和設定，很容易出現某個元件忘了 extend，或是語系設定互相覆蓋的情況。把設定集中在一個地方
// extend 寫在模組頂層，整個應用只會執行一次。語系檔只 import 實際支援的3種，避免把 dayjs 全部上百個語系打包進來。

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(relativeTime)

// i18n 語系代碼 → dayjs 語系代碼，依你的 i18n 設定調整
const localeMap: Record<string, string> = {
  'zh-TW': 'zh-tw',
  ko: 'ko',
  th: 'th',
  en: 'en',
}

export function useDate(locale: Ref<'ko' | 'th' | 'en'> | ComputedRef<'ko' | 'th' | 'en'>) {
  const dayjsLocale = computed(() => localeMap[locale.value] ?? 'en')

  function format(date: dayjs.ConfigType, template = 'YYYY-MM-DD HH:mm') {
    return dayjs(date).locale(dayjsLocale.value).format(template) 
  }

  function fromNow(date: dayjs.ConfigType) {
    return dayjs(date).locale(dayjsLocale.value).fromNow() 
  }

  return { format, fromNow }
}