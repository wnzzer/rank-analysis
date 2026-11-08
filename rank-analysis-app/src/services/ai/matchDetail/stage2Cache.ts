/**
 * Stage 2 markdown 持久缓存（localStorage，有界 LRU）。
 *
 * 为什么不用 sessionStorage：sessionStorage 按 webview 隔离，每次重开同一局的详情窗都是新会话，
 * 打开复盘标签会再自动计费生成一次整局点评。localStorage 在同源窗口间共享、重启后仍在。
 *
 * 存储：每条一个键 `${STAGE2_CACHE_PREFIX}${逻辑 key}`，值为 JSON {v, t, markdown}
 * （v = 格式版本，t = 最近访问毫秒）。条目数超过 {@link STAGE2_CACHE_LIMIT} 时按 t 淘汰最旧。
 * 任何存储异常（不可用、配额满、坏条目）都降级为「无缓存」，绝不抛给调用方。
 */

/** 键前缀（带格式版本；改值结构时升版本，旧条目自然失效并在淘汰时清掉） */
export const STAGE2_CACHE_PREFIX = 'ai_match_detail_stage2:v1:'
/** 条目上限：每条几 KB，100 条远低于 localStorage 配额 */
export const STAGE2_CACHE_LIMIT = 100
/** 当前值格式版本 */
const VERSION = 1

interface Stage2Entry {
  v: typeof VERSION
  t: number
  markdown: string
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 解析条目；格式不符返回 null */
function parseEntry(raw: string | null): Stage2Entry | null {
  if (!raw) return null
  try {
    const e = JSON.parse(raw) as Partial<Stage2Entry> | null
    if (!e || e.v !== VERSION || typeof e.t !== 'number' || typeof e.markdown !== 'string')
      return null
    return e as Stage2Entry
  } catch {
    return null
  }
}

/**
 * 淘汰到最多 keep 条：坏条目先删，其余按最近访问时间从旧到新删
 * @param s - localStorage
 * @param keep - 保留条数上限
 */
function evict(s: Storage, keep: number): void {
  const entries: Array<{ key: string; t: number }> = []
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i)
    if (!key || !key.startsWith(STAGE2_CACHE_PREFIX)) continue
    const e = parseEntry(s.getItem(key))
    // 坏条目 t = -Infinity，排序后最先被删
    entries.push({ key, t: e ? e.t : -Infinity })
  }
  const broken = entries.filter(e => e.t === -Infinity)
  const valid = entries.filter(e => e.t !== -Infinity).sort((a, b) => a.t - b.t)
  const excess = Math.max(0, valid.length - keep)
  for (const e of [...broken, ...valid.slice(0, excess)]) s.removeItem(e.key)
}

/**
 * 读取缓存的 Stage 2 markdown，命中时刷新访问时间
 * @param key - 逻辑 key（gameId + 模式 kind + 单人 participantId + 时间线后缀）
 * @returns markdown；未命中/坏条目/存储不可用为 null
 */
export function readStage2Cache(key: string): string | null {
  const s = storage()
  if (!s) return null
  try {
    const entry = parseEntry(s.getItem(STAGE2_CACHE_PREFIX + key))
    if (!entry) return null
    try {
      s.setItem(STAGE2_CACHE_PREFIX + key, JSON.stringify({ ...entry, t: Date.now() }))
    } catch {
      // 刷新访问时间失败（配额满）不影响命中
    }
    return entry.markdown
  } catch {
    return null
  }
}

/**
 * 写入 Stage 2 markdown 并淘汰到上限；配额满时先淘汰一半旧条目重试一次，仍失败则放弃
 * @param key - 逻辑 key（同 {@link readStage2Cache}）
 * @param markdown - 模型输出全文
 */
export function writeStage2Cache(key: string, markdown: string): void {
  const s = storage()
  if (!s) return
  const value = JSON.stringify({ v: VERSION, t: Date.now(), markdown } satisfies Stage2Entry)
  try {
    try {
      s.setItem(STAGE2_CACHE_PREFIX + key, value)
    } catch {
      evict(s, Math.floor(STAGE2_CACHE_LIMIT / 2))
      s.setItem(STAGE2_CACHE_PREFIX + key, value)
    }
    evict(s, STAGE2_CACHE_LIMIT)
  } catch {
    // 存储不可用或仍然超配额：本次不缓存
  }
}
