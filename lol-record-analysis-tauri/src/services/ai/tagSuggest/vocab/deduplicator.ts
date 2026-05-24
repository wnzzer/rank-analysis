/**
 * 反重复用过名字 LRU 缓存（按 puuid 分区，sessionStorage 持久）。
 *
 * 行为：
 * - 写入：把新批次追加到该 puuid 的批次列表末尾；如果超过 MAX_BATCHES 则丢弃最旧的批次
 * - 读取：把所有批次的名字拼平成 string[] 返回
 * - 清除：删除该 puuid 的 entry
 *
 * 持久性：sessionStorage（会话级；浏览器 tab 关闭即清，符合"短期反重复"语义）。
 */

export const DEDUP_KEY_PREFIX = 'ai_tag_suggest_used_names_'
export const MAX_BATCHES = 3

function storageKey(puuid: string): string {
  return `${DEDUP_KEY_PREFIX}${puuid}`
}

function readBatches(puuid: string): string[][] {
  try {
    const raw = sessionStorage.getItem(storageKey(puuid))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    if (!parsed.every(b => Array.isArray(b) && b.every(x => typeof x === 'string'))) {
      return []
    }
    return parsed as string[][]
  } catch {
    return []
  }
}

function writeBatches(puuid: string, batches: string[][]): void {
  try {
    sessionStorage.setItem(storageKey(puuid), JSON.stringify(batches))
  } catch {
    // sessionStorage may be disabled or full — silent failure is acceptable here
  }
}

/**
 * 读取该 puuid 最近 MAX_BATCHES 批次的所有名字（已拼平）。
 *
 * @param puuid 当前用户 puuid
 * @returns 名字数组，可能为空
 */
export function readRecentNames(puuid: string): string[] {
  const batches = readBatches(puuid)
  return batches.flat()
}

/**
 * 写入一批新名字。会自动丢弃最旧的批次保持 ≤ MAX_BATCHES。
 *
 * @param puuid 当前用户 puuid
 * @param names 新生成的名字数组（一次性写入一批）
 */
export function writeRecentNames(puuid: string, names: string[]): void {
  const batches = readBatches(puuid)
  batches.push(names)
  while (batches.length > MAX_BATCHES) {
    batches.shift()
  }
  writeBatches(puuid, batches)
}

/**
 * 清除该 puuid 的所有禁用名（Tags.vue 用户删除某条标签时可触发）。
 *
 * @param puuid 当前用户 puuid
 */
export function clearRecentNames(puuid: string): void {
  try {
    sessionStorage.removeItem(storageKey(puuid))
  } catch {
    // ignore
  }
}
