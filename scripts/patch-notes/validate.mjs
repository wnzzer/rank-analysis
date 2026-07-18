/**
 * 校验闸门：AI 输出必须全部通过硬校验才允许写入数据文件。
 * 白名单同时承担 中文名 → championId/alias 的富化，客户端因此免做名字映射。
 */

export const CHAMPION_SUMMARY_URL =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/champion-summary.json'

/** zh_cn 数据里 name=称号（黑暗之女）、description=中文名（安妮），白名单以后者为键 */
export function buildWhitelist(summary) {
  const map = new Map()
  for (const c of summary) {
    if (c.id > 0 && c.description) {
      map.set(c.description.trim(), { championId: c.id, alias: c.alias })
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
/** 原文性比对前压掉所有空白：GBK 页面的 &emsp;/&nbsp; 与 AI 输出的空格习惯不一致 */
const norm = s => s.replace(/\s+/g, '')

export function validateExtraction(extracted, whitelist, articleText) {
  const errors = []
  if (extracted?.isPatchNotes !== true) errors.push('isPatchNotes 不为 true')
  const champs = extracted?.champions
  if (!Array.isArray(champs) || champs.length < 1 || champs.length > 40) {
    errors.push(`champions 数量越界: ${Array.isArray(champs) ? champs.length : typeof champs}`)
    return { ok: false, errors, champions: [] }
  }
  const articleLines = articleText.split('\n').map(norm)
  const out = []
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
      c.lines.length > 30 ||
      c.lines.some(l => typeof l !== 'string' || !l.trim())
    ) {
      errors.push(`lines 非法: ${name}`)
      continue
    }
    // 防 AI 改写（包括跨行伪造）：每个英雄至少一条逐字命中原文单行（忽略空白）
    if (
      !c.lines.some(l => {
        const n = norm(l)
        return n && articleLines.some(al => al.includes(n))
      })
    ) {
      errors.push(`条目疑似改写（无一条命中原文）: ${name}`)
      continue
    }
    out.push({
      championId: hit.championId,
      alias: hit.alias,
      name,
      direction: c.direction,
      lines: c.lines.map(l => l.trim())
    })
  }
  return { ok: errors.length === 0, errors, champions: errors.length === 0 ? out : [] }
}
