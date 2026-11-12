import { computed, type Ref, type ComputedRef } from 'vue'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-tw'
import 'dayjs/locale/ko'
import 'dayjs/locale/th'

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