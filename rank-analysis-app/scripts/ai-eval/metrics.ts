/**
 * A/B 评测自动硬指标（纯函数）。定义见 spec §4。
 */
import {
  BOGUS_TAG,
  citationSegments,
  extractNumbers,
  isScoreJargon,
  normalizeCitations,
  repairCitations,
  stripInvalidCitations,
  TIME_TOKEN
} from '@renderer/services/ai/matchDetail/postprocess'

/** 统一口径：先规整 [ D25 ]/[d3] 并去掉发明的纯字母标记，再做匹配 */
const norm = normalizeCitations
const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g
const CITE = /\[([LDISVFT]\d+)\]/g
/**
 * 具体过程断言：时间点、阵亡地点、资源归属、被抓/越塔、具体区域。
 * 刻意不含泛化词「团战/开团/游走」——实测 V0 的「参团率 31%，团战别当隐身人」这类
 * 基于终局数字的泛化建议会被大量误判为过程描述。
 */
const PROCESS_RE =
  /(\d{1,2}:\d{2}|第\s*\d+\s*分钟|\d+\s*分钟(时|左右|前后)|死于|拿下?(小龙|大龙|先锋|虚空|男爵)|被抓|越塔|蹲草|龙坑|河道|野区|高地|塔下|对线(被压|压制))/

const sentences = (md: string) =>
  md
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#'))
    .flatMap(l => l.split(/(?<=[。!?;！？；])/))
    .map(s => s.trim())
    .filter(Boolean)

/**
 * 输出中不在 prompt 数字白名单里的数字（容差 0.05）。
 * @param output - 模型输出
 * @param prompt - 喂给模型的 prompt
 */
export function fabricatedNumberRate(
  output: string,
  prompt: string
): { fabricated: number; total: number } {
  const allowed = [...extractNumbers(prompt)]
  // 卡片引用 id（如 [D12]）不是数值主张，先剔除以免抬高分母；mm:ss 保留（时间是真实主张）
  const toks = norm(output).replace(CITE, '').match(NUMBER_TOKEN) ?? []
  const fabricated = toks.filter(t => {
    const n = Number.parseFloat(t.replace(/,/g, ''))
    return !allowed.some(a => Math.abs(a - n) <= 0.05)
  }).length
  return { fabricated, total: toks.length }
}

/**
 * 引用错误：卡片不存在，或引用句里的 mm:ss 不在被引卡片文本中。
 * @param output - 模型输出
 * @param cards - 可引用的卡片
 */
export function citationErrors(
  output: string,
  cards: Array<{ id: string; text: string }>
): { errors: number; total: number } {
  const byId = new Map(cards.map(c => [c.id, c.text]))
  let errors = 0
  let total = 0
  for (const s of sentences(norm(output))) {
    // 与渲染端 repairCitations 共用切段口径
    for (const { id, segment } of citationSegments(s)) {
      total++
      const text = byId.get(id)
      const times = segment.match(TIME_TOKEN) ?? []
      if (text === undefined || times.some(t => !text.includes(t))) errors++
    }
  }
  return { errors, total }
}

/**
 * 渲染后引用错误：先走与线上一致的 normalize → repair → strip，再按 citationErrors 口径统计。
 * 被 stripInvalidCitations 整句剔除的错误引用不再计入。
 * @param output - 模型输出
 * @param cards - 可引用的卡片
 */
export function renderedCitationErrors(
  output: string,
  cards: Array<{ id: string; text: string }>
): { errors: number; total: number } {
  const rendered = cards.length
    ? stripInvalidCitations(
        repairCitations(normalizeCitations(output), cards),
        new Set(cards.map(c => c.id))
      )
    : output
  return citationErrors(rendered, cards)
}

/**
 * 含过程描述但没有任何卡片引用的句子数。
 * @param output - 模型输出
 */
export function uncitedProcessSentences(output: string): number {
  return sentences(norm(output)).filter(s => PROCESS_RE.test(s) && !/\[[LDISVFT]\d+\]/.test(s))
    .length
}

/**
 * 具体度：不同卡片数、改进建议里带引用的条数/总条数。
 * @param output - 模型输出（markdown）
 */
export function specificity(output: string): {
  distinctCards: number
  adviceCited: number
  adviceTotal: number
} {
  output = norm(output)
  const distinctCards = new Set([...output.matchAll(CITE)].map(m => m[1])).size
  const advice = output.split('## 改进建议')[1]?.split('\n## ')[0] ?? ''
  const bullets = advice.split('\n').filter(l => /^\s*[-*]\s+/.test(l))
  return {
    distinctCards,
    adviceCited: bullets.filter(b => /\[[LDISVFT]\d+\]/.test(b)).length,
    adviceTotal: bullets.length
  }
}

/**
 * 发明的纯字母方括号标记数（如 [TS]），评测里按篇统计。
 * @param output - 模型输出（未规整的原文）
 */
export function bogusTagCount(output: string): number {
  return output.match(BOGUS_TAG)?.length ?? 0
}

/**
 * 含评分黑话（分数/分位/标准差/z 值）的句子数，按模型原文统计（未经渲染端剔除）。
 * @param output - 模型输出（未规整的原文）
 */
export function scoreJargonCount(output: string): number {
  return sentences(output).filter(isScoreJargon).length
}

/**
 * 两次运行的点名一致率：{participantId:label} 集合的 Jaccard。
 * @param a - 第一次运行的点名
 * @param b - 第二次运行的点名
 */
export function labelAgreement(
  a: Array<{ participantId: number; label: string }>,
  b: Array<{ participantId: number; label: string }>
): number {
  const sa = new Set(a.map(v => `${v.participantId}:${v.label}`))
  const sb = new Set(b.map(v => `${v.participantId}:${v.label}`))
  const inter = [...sa].filter(x => sb.has(x)).length
  const union = new Set([...sa, ...sb]).size
  return union === 0 ? 1 : inter / union
}

/**
 * 最近秩百分位。
 * @param xs - 样本
 * @param p - 百分位（0-100）
 */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}
