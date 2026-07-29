/**
 * 校验闸门：AI 输出必须全部通过硬校验才允许写入数据文件。
 * 白名单同时承担 中文名 → championId/alias 的富化，客户端因此免做名字映射。
 */

export const CHAMPION_SUMMARY_URL =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/champion-summary.json'

/**
 * zh_cn 数据里 name=称号（黑暗之女）、description=中文名（安妮），白名单以后者为键。
 *
 * 同名冲突取最小 id：上游从某版起混进了 60000+ 的 Jade_* 模式变体
 * （60012 Jade_Alistar 与 12 Alistar 同名同称号），后写入会覆盖本体，
 * 让客户端拿到查不到的 championId。变体 id 恒为「本体 + 60000」，故取小者即本体。
 */
export function buildWhitelist(summary) {
  const map = new Map()
  for (const c of summary) {
    if (c.id > 0 && c.description) {
      const key = c.description.trim()
      const prev = map.get(key)
      if (!prev || c.id < prev.championId) map.set(key, { championId: c.id, alias: c.alias })
    }
  }
  return map
}

export async function fetchWhitelist(fetchFn = fetch) {
  const res = await fetchFn(CHAMPION_SUMMARY_URL)
  if (!res.ok) throw new Error(`champion-summary HTTP ${res.status}`)
  const summary = await res.json()
  const map = buildWhitelist(summary)
  if (map.size < 100) throw new Error(`白名单异常：仅 ${map.size} 个英雄`)
  return map
}

const DIRECTIONS = new Set(['buff', 'nerf', 'adjusted'])
/** 单个英雄的改动条目上限：实测大改英雄（如卑尔维斯 26.15）单期可达 49 条 */
const MAX_LINES = 60
/**
 * 原文性比对前压掉空白与冒号：
 * 空白——GBK 页面的 &emsp;/&nbsp; 与 AI 输出的空格习惯不一致；
 * 冒号——AI 拼接「小节标题 + 改动行」时会自行插入一个「：」。
 */
const norm = s => s.replace(/[\s：:]+/g, '')
/** AI 最多把几条相邻原文行并成一条：实测只见「标题 + 1 条改动」，留一档余量 */
const MAX_JOIN = 3

/**
 * 把 AI 的一条 lines 对回原文行。
 * AI 时而把小节标题与改动行并成一条（"基础属性\n移动速度：330 → 335"、
 * "R - 放逐之锋：额外攻击力收益：25% → 20%"），故允许匹配「连续若干行的拼接」，
 * 命中后返回这些原文行——产出因此始终是逐行的原文，与客户端的列表渲染一致。
 * @returns 命中的原文行数组；未命中返回 null
 */
function matchArticleLines(line, articleLines, normedLines) {
  const n = norm(line)
  if (!n) return null
  for (let i = 0; i < normedLines.length; i++) {
    let acc = ''
    for (let j = i; j < Math.min(i + MAX_JOIN, normedLines.length); j++) {
      acc += normedLines[j]
      if (acc === n) return articleLines.slice(i, j + 1)
      if (acc.length > n.length) break // 已超长，再往后拼只会更长
    }
  }
  return null
}

export function validateExtraction(extracted, whitelist, articleText) {
  const errors = []
  if (extracted?.isPatchNotes !== true) errors.push('isPatchNotes 不为 true')
  const champs = extracted?.champions
  if (!Array.isArray(champs) || champs.length < 1 || champs.length > 40) {
    errors.push(`champions 数量越界: ${Array.isArray(champs) ? champs.length : typeof champs}`)
    return { ok: false, errors, champions: [] }
  }
  const articleLines = articleText.split('\n').map(l => l.trim())
  const normedLines = articleLines.map(norm)
  const out = []
  /** 同一英雄被 AI 拆成多个条目时合并到首次出现的位置，避免客户端出现重复卡片 */
  const seen = new Map()
  for (const c of champs) {
    const name = (c?.name ?? '').trim()
    const hit = whitelist.get(name)
    if (!hit) {
      errors.push(`英雄名不在白名单: ${name || '(空)'}`)
      continue
    }
    if (!DIRECTIONS.has(c.direction)) {
      errors.push(`direction 非法: ${name} → ${c.direction}`)
      continue
    }
    if (
      !Array.isArray(c.lines) ||
      c.lines.length < 1 ||
      c.lines.some(l => typeof l !== 'string' || !l.trim())
    ) {
      errors.push(`lines 非法: ${name}`)
      continue
    }
    const lines = []
    // 防 AI 改写（包括跨行伪造）：每个英雄至少一条逐字命中原文
    let anyHit = false
    for (const raw of c.lines.flatMap(l => l.split('\n')).map(l => l.trim())) {
      if (!raw) continue
      const matched = matchArticleLines(raw, articleLines, normedLines)
      if (matched) {
        lines.push(...matched)
        anyHit = true
        continue
      }
      // 退化路径：AI 只摘了原文单行中的一段。保留原样，仍按老规则算命中，
      // 但跨行拼接的伪造条目对不上任何单行，命中不了。
      const n = norm(raw)
      if (n && normedLines.some(al => al.includes(n))) anyHit = true
      lines.push(raw)
    }
    if (lines.length > MAX_LINES) {
      errors.push(`lines 数量越界: ${name} → ${lines.length}`)
      continue
    }
    if (!anyHit) {
      errors.push(`条目疑似改写（无一条命中原文）: ${name}`)
      continue
    }
    const prev = seen.get(hit.championId)
    if (prev) {
      prev.lines.push(...lines)
      continue
    }
    const entry = {
      championId: hit.championId,
      alias: hit.alias,
      name,
      direction: c.direction,
      lines
    }
    seen.set(hit.championId, entry)
    out.push(entry)
  }
  return { ok: errors.length === 0, errors, champions: errors.length === 0 ? out : [] }
}
