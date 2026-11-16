/**
 * fakeData.ts — 給 VirtualScroll 測試用的假資料產生器（無任何相依套件）
 *
 * - 可重現：同一個 seed 每次產生完全相同的資料，方便重現捲動 bug
 * - 動態高度：訊息長短差異大、四種語系混合、部分附圖，專門用來測量測與錨定
 * - 固定高度：下注紀錄，每列欄位固定
 * - 數據變更：提供 append / prepend / remove / rewrite 與模擬分頁 API
 */

/* ------------------------------------------------------------------ */
/* 型別                                                                */
/* ------------------------------------------------------------------ */

export type Lang = 'zh-TW' | 'ko' | 'th' | 'en'

export type GameKey =
  | 'baccarat'
  | 'roulette'
  | 'blackjack'
  | 'sicbo'
  | 'slots'
  | 'football'
  | 'basketball'

export interface MessageUser {
  name: string
  color: string
}

export interface MessageImage {
  width: number
  height: number
  url: string
}

export interface ChatMessage {
  id: string
  seq: number
  lang: Lang
  user: MessageUser
  text: string
  image: MessageImage | null
  /** ISO 8601 */
  createdAt: string
}

interface BetBase {
  id: string
  seq: number
  game: GameKey
  amount: number
  odds: number
  /** ISO 8601 */
  createdAt: string
}

/** 以 status 區分的聯合型別：收窄 status 後 payout 型別會自動確定 */
export type BetRecord = BetBase &
  (
    | { status: 'win'; payout: number }
    | { status: 'lose'; payout: 0 }
    | { status: 'pending'; payout: null }
  )

export type BetStatus = BetRecord['status']

export interface FakeDataOptions {
  /** 亂數種子，預設 42 */
  seed?: number
  /** 要混入的語系，預設四種全開 */
  langs?: Lang[]
  /** 附圖比例，預設 0.15 */
  imageRatio?: number
  /** 極端內容比例，預設 0.05 */
  edgeCaseRatio?: number
  /** 最新一筆的時間戳記（ms），預設 Date.now() */
  startTime?: number
}

export interface FetchPageOptions {
  pageSize?: number
  /** 資料總數，超過即 hasMore = false */
  total?: number
  /** 模擬網路延遲（ms） */
  delay?: number
  /** 失敗機率，用來測錯誤處理 */
  failRate?: number
}

export interface PageResult<T> {
  items: T[]
  page: number
  hasMore: boolean
}

/* ------------------------------------------------------------------ */
/* 可設定種子的亂數（mulberry32）                                        */
/* ------------------------------------------------------------------ */

export interface Random {
  next(): number
  int(min: number, max: number): number
  float(min: number, max: number, digits?: number): number
  pick<T>(arr: readonly T[]): T
  chance(p: number): boolean
  /** 依權重挑選：weighted([['a', 6], ['b', 3], ['c', 1]]) */
  weighted<T>(entries: readonly (readonly [T, number])[]): T
}

export function createRandom(seed = 1): Random {
  let s = seed >>> 0

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number => Math.floor(next() * (max - min + 1)) + min

  const float = (min: number, max: number, digits = 2): number =>
    Number((next() * (max - min) + min).toFixed(digits))

  const pick = <T>(arr: readonly T[]): T => arr[int(0, arr.length - 1)] as T

  const chance = (p: number): boolean => next() < p

  const weighted = <T>(entries: readonly (readonly [T, number])[]): T => {
    const total = entries.reduce((sum, [, w]) => sum + w, 0)
    let roll = next() * total
    for (const [value, w] of entries) {
      if ((roll -= w) < 0) return value
    }
    return (entries[entries.length - 1] as readonly [T, number])[0]
  }

  return { next, int, float, pick, chance, weighted }
}

/* ------------------------------------------------------------------ */
/* 素材                                                                */
/* ------------------------------------------------------------------ */

const PHRASES: Readonly<Record<Lang, readonly string[]>> = {
  'zh-TW': [
    '今天手氣不錯',
    '剛剛那局真的太刺激了',
    '有人知道活動什麼時候結束嗎？',
    '提款大概要多久才會到帳',
    '恭喜中大獎！',
    '這個版本的介面比之前順很多',
  ],
  ko: [
    '오늘 운이 좋네요',
    '방금 그 판 진짜 짜릿했어요',
    '이벤트 언제 끝나는지 아시는 분?',
    '출금은 보통 얼마나 걸리나요',
    '대박 축하드려요!',
    '이번 업데이트 화면이 훨씬 부드러워졌네요',
  ],
  // 泰文詞與詞之間不留空白，最適合用來測試換行與高度量測
  th: [
    'วันนี้โชคดีมาก',
    'ตาเมื่อกี้ตื่นเต้นสุดๆ',
    'มีใครรู้ไหมว่ากิจกรรมจะจบเมื่อไหร่',
    'ถอนเงินปกติใช้เวลานานแค่ไหน',
    'ยินดีด้วยกับแจ็คพอต!',
    'อัปเดตนี้หน้าจอลื่นขึ้นเยอะเลย',
  ],
  en: [
    'Feeling lucky today',
    'That last round was intense',
    'Anyone know when the event ends?',
    'How long do withdrawals usually take?',
    'Congrats on the jackpot!',
    'The new update feels much smoother',
  ],
}

const ALL_LANGS: readonly Lang[] = ['zh-TW', 'ko', 'th', 'en']

const USERS = ['阿明', '小雨', '민준', '서연', 'สมชาย', 'นภา', 'Alex', 'Mia'] as const

const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#ec4899'] as const

// 極端內容：空字串、單一 emoji、不斷行的長字串、多行文字（需 white-space: pre-wrap）
const EDGE_CASES = [
  '',
  '👍',
  'https://example.com/promo/' + 'a1b2c3d4'.repeat(12),
  '第一行\n第二行\n第三行\n第四行',
] as const

// 遊戲以 i18n key 表示，顯示時再交給 $t()
const GAMES: readonly GameKey[] = [
  'baccarat',
  'roulette',
  'blackjack',
  'sicbo',
  'slots',
  'football',
  'basketball',
]

const IMAGE_HEIGHTS = [120, 180, 240, 320] as const

/* ------------------------------------------------------------------ */
/* 工廠                                                                */
/* ------------------------------------------------------------------ */

export function createFakeData({
  seed = 42,
  langs = [...ALL_LANGS],
  imageRatio = 0.15,
  edgeCaseRatio = 0.05,
  startTime = Date.now(),
}: FakeDataOptions = {}) {
  if (!langs.length) throw new Error('createFakeData: langs 不可為空陣列')

  const r = createRandom(seed)
  let msgSeq = 0
  let betSeq = 0
  let clock = startTime

  function nextTime(): string {
    clock -= r.int(5, 600) * 1000
    return new Date(clock).toISOString()
  }

  function makeText(lang: Lang): string {
    if (r.chance(edgeCaseRatio)) return r.pick(EDGE_CASES)
    // 60% 短、30% 中、10% 長，讓高度分布差異夠大
    const count = r.weighted<number>([
      [1, 6],
      [r.int(2, 4), 3],
      [r.int(6, 15), 1],
    ])
    const sep = lang === 'zh-TW' ? '，' : ' '
    return Array.from({ length: count }, () => r.pick(PHRASES[lang])).join(sep)
  }

  /** 單筆聊天訊息（動態高度） */
  function message(): ChatMessage {
    const seq = msgSeq++
    const lang = r.pick(langs)
    return {
      id: `msg-${seq}`,
      seq,
      lang,
      user: { name: r.pick(USERS), color: r.pick(COLORS) },
      text: makeText(lang),
      image: r.chance(imageRatio)
        ? {
            width: 320,
            height: r.pick(IMAGE_HEIGHTS),
            url: `https://picsum.photos/seed/${seq}/320/240`,
          }
        : null,
      createdAt: nextTime(),
    }
  }

  /** 單筆下注紀錄（固定高度） */
  function bet(): BetRecord {
    const seq = betSeq++
    const base: BetBase = {
      id: `bet-${seq}`,
      seq,
      game: r.pick(GAMES),
      amount: r.int(1, 500) * 10,
      odds: r.float(1.2, 5),
      createdAt: '',
    }
    const status = r.weighted<BetStatus>([
      ['win', 4],
      ['lose', 5],
      ['pending', 1],
    ])
    base.createdAt = nextTime()

    switch (status) {
      case 'win':
        return { ...base, status, payout: Math.round(base.amount * base.odds) }
      case 'lose':
        return { ...base, status, payout: 0 }
      case 'pending':
        return { ...base, status, payout: null }
    }
  }

  const messages = (count: number): ChatMessage[] => Array.from({ length: count }, message)
  const bets = (count: number): BetRecord[] => Array.from({ length: count }, bet)

  /* ---------------- 數據變更測試（皆為原地修改，模擬 push / splice） ---------------- */

  /** 尾端追加：測無限載入。未傳 make 時預設產生 ChatMessage */
  function append(list: ChatMessage[], count: number): ChatMessage[]
  function append<T>(list: T[], count: number, make: () => T): T[]
  function append<T>(list: T[], count: number, make?: () => T): T[] {
    const factory = make ?? (message as unknown as () => T)
    list.push(...Array.from({ length: count }, factory))
    return list
  }

  /** 頭部插入：測 key 快取不錯位與捲動位置 */
  function prepend(list: ChatMessage[], count: number): ChatMessage[]
  function prepend<T>(list: T[], count: number, make: () => T): T[]
  function prepend<T>(list: T[], count: number, make?: () => T): T[] {
    const factory = make ?? (message as unknown as () => T)
    list.unshift(...Array.from({ length: count }, factory))
    return list
  }

  /** 隨機刪除：測資料縮短時 scrollTop 是否正確夾回 */
  function removeRandom<T>(list: T[], count = 1): T[] {
    for (let i = 0; i < count && list.length; i++) {
      list.splice(r.int(0, list.length - 1), 1)
    }
    return list
  }

  /** 隨機改寫一筆訊息內容（key 不變、高度改變）：測 ResizeObserver 重新量測 */
  function rewriteRandom(list: ChatMessage[]): ChatMessage[] {
    if (!list.length) return list
    const i = r.int(0, list.length - 1)
    const old = list[i]
    if (!old) return list
    list.splice(i, 1, { ...old, text: makeText(old.lang) })
    return list
  }

  /* ---------------- 模擬分頁 API ---------------- */

  function fetchPage(
    page: number,
    opts?: FetchPageOptions & { kind?: 'messages' },
  ): Promise<PageResult<ChatMessage>>
  function fetchPage(
    page: number,
    opts: FetchPageOptions & { kind: 'bets' },
  ): Promise<PageResult<BetRecord>>
  function fetchPage(
    page: number,
    {
      pageSize = 50,
      total = 1000,
      delay = 600,
      failRate = 0,
      kind = 'messages',
    }: FetchPageOptions & { kind?: 'messages' | 'bets' } = {},
  ): Promise<PageResult<ChatMessage> | PageResult<BetRecord>> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (r.chance(failRate)) {
          reject(new Error('Network error (fake)'))
          return
        }
        const start = page * pageSize
        const size = Math.max(0, Math.min(pageSize, total - start))
        const hasMore = start + size < total
        if (kind === 'bets') resolve({ items: bets(size), page, hasMore })
        else resolve({ items: messages(size), page, hasMore })
      }, delay)
    })
  }

  return {
    message,
    bet,
    messages,
    bets,
    append,
    prepend,
    removeRandom,
    rewriteRandom,
    fetchPage,
  }
}

export type FakeData = ReturnType<typeof createFakeData>
