/**
 * 词库采样器。每次调用从所有类别里随机抽 30-50 个词，
 * 用作 Stage 2 prompt 的提示词池。
 *
 * 采样策略：跨类别平均分配 → 每类内随机洗牌 → 取前 quota →
 * 再合并打散一次输出。
 *
 * 可选 seed 用于测试确定性。
 */

export interface SampleOptions {
  /** 目标词数，默认 30-50 之间随机一个 */
  count?: number
  /** 确定性种子（测试用） */
  seed?: number
}

type VocabRecord = Readonly<Record<string, readonly string[]>>

/**
 * 32-bit mulberry32 PRNG。简洁、零依赖、可重放。
 */
function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function sampleVocab(vocab: VocabRecord, options: SampleOptions = {}): string[] {
  const seed = options.seed ?? Math.floor(Math.random() * 2147483647)
  const rng = mulberry32(seed)

  const requested = options.count ?? 30 + Math.floor(rng() * 21) // 30-50 inclusive

  const categories = Object.keys(vocab)
  const totalAvailable = categories.reduce((s, c) => s + vocab[c].length, 0)
  const targetCount = Math.min(requested, totalAvailable)

  // Allocate per category: roughly even, last category absorbs remainder
  const baseQuota = Math.floor(targetCount / categories.length)
  const remainder = targetCount - baseQuota * categories.length

  const picked: string[] = []
  categories.forEach((cat, idx) => {
    const quotaForThis = baseQuota + (idx < remainder ? 1 : 0)
    const pool = [...vocab[cat]]
    shuffleInPlace(pool, rng)
    picked.push(...pool.slice(0, Math.min(quotaForThis, pool.length)))
  })

  // Final shuffle so AI doesn't see category clustering
  shuffleInPlace(picked, rng)
  return picked
}
