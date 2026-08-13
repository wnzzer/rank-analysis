/**
 * AI token 用量台账（D-P1）。
 *
 * 每次完整分析（Stage 1 + Stage 2）的 token 用量经 localStorage 持久化，
 * 设置页 General.vue 读取展示累计用量并估算成本。
 *
 * 仅作统计展示，任何读写异常都静默吞掉，绝不影响主流程。
 */

/** 单次分析的一条用量记录 */
export interface AiUsageEntry {
  /** 记录时间戳（ms） */
  time: number
  /** 对局 id */
  gameId: number
  /** overview=整局分析（含蓄队友向），player=单人深度分析 */
  mode: 'overview' | 'player'
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

const LEDGER_KEY = 'ai_usage_ledger'

/**
 * qwen-flash 单价（元 / 1K tokens），来源：DashScope 模型定价页
 * （https://help.aliyun.com/zh/model-studio/models#qwen-flash，2024-12 后按 token 计费）。
 * 输入 ¥0.0003/1K，输出 ¥0.0006/1K。
 */
export const QWEN_FLASH_PRICES = {
  inputYuanPer1K: 0.0003,
  outputYuanPer1K: 0.0006
} as const

/** 按 qwen-flash 单价估算一次记录的调用成本（元） */
export function estimateCost(
  entry: Pick<AiUsageEntry, 'promptTokens' | 'completionTokens'>
): number {
  return (
    (entry.promptTokens / 1000) * QWEN_FLASH_PRICES.inputYuanPer1K +
    (entry.completionTokens / 1000) * QWEN_FLASH_PRICES.outputYuanPer1K
  )
}

function readLedger(): AiUsageEntry[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 形状过滤：坏条目直接丢弃，防止污染统计
    return parsed.filter((e): e is AiUsageEntry => {
      if (typeof e !== 'object' || e === null) return false
      const entry = e as Record<string, unknown>
      return (
        typeof entry.time === 'number' &&
        typeof entry.gameId === 'number' &&
        (entry.mode === 'overview' || entry.mode === 'player') &&
        typeof entry.promptTokens === 'number' &&
        typeof entry.completionTokens === 'number' &&
        typeof entry.totalTokens === 'number'
      )
    })
  } catch {
    return []
  }
}

function writeLedger(entries: AiUsageEntry[]): void {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(entries))
  } catch {
    // storage 不可用（隐私模式等）时静默放弃统计
  }
}

/** 追加一条用量记录（只记 total > 0 的，纯缓存命中不产生消耗） */
export function recordAiUsage(entry: AiUsageEntry): void {
  if (!Number.isFinite(entry.totalTokens) || entry.totalTokens <= 0) return
  if (!Number.isFinite(entry.gameId)) return
  const entries = readLedger()
  entries.push(entry)
  // 只保留最近 500 条，防止无限增长
  if (entries.length > 500) {
    entries.splice(0, entries.length - 500)
  }
  writeLedger(entries)
}

/** 读取全部用量记录（按时间升序，同存储顺序） */
export function getAiUsageLog(): AiUsageEntry[] {
  return readLedger()
}

/** 清空用量记录（设置页按钮） */
export function clearAiUsageLog(): void {
  writeLedger([])
}

/** 汇总：总 tokens 与估算成本 */
export function sumAiUsage(log: AiUsageEntry[]): {
  totalTokens: number
  totalCostYuan: number
  promptTokens: number
  completionTokens: number
} {
  let promptTokens = 0
  let completionTokens = 0
  for (const entry of log) {
    promptTokens += entry.promptTokens
    completionTokens += entry.completionTokens
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    totalCostYuan: estimateCost({ promptTokens, completionTokens })
  }
}
