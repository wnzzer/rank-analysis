/**
 * 揭盲：BLIND_RESULT=<下载的 blind-result.json> npm run eval:unblind
 * 胜率 = (新版胜 + 0.5 × 差不多) / 已投票对数；≥65% 达标（spec §4 判定）。
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(__dirname)

describe('ai-eval unblind', () => {
  it('prints win rate', () => {
    const resultPath = process.env.BLIND_RESULT
    if (!resultPath) throw new Error('请设置 BLIND_RESULT=<blind-result.json 路径>')
    const key = JSON.parse(fs.readFileSync(path.join(DIR, 'results/blind-key.json'), 'utf8')) as {
      base?: string
      best: string
      pairs: Array<{ pairId: string; leftIs: string }>
    }
    // 旧版 key 没有 base 字段，默认参照为 V0
    const base = key.base ?? 'V0'
    const votes = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as Array<{
      pairId: string
      choice: 'L' | 'R' | 'T' | null
      useful: string
      wrong: string
    }>
    const leftIs = new Map(key.pairs.map(p => [p.pairId, p.leftIs]))
    let score = 0
    let voted = 0
    // 不在 blind-key 里的票（换过一轮盲评页 / 手改 JSON）无从揭盲，跳过并计数
    let unknown = 0
    const byMode: Record<string, { score: number; n: number }> = {}
    for (const v of votes) {
      if (!v.choice) continue
      if (!leftIs.has(v.pairId)) {
        unknown++
        continue
      }
      voted++
      const winner =
        v.choice === 'T'
          ? null
          : v.choice === 'L'
            ? leftIs.get(v.pairId)
            : leftIs.get(v.pairId) === base
              ? key.best
              : base
      const s = v.choice === 'T' ? 0.5 : winner === key.best ? 1 : 0
      score += s
      const mode = v.pairId.split('-')[1]
      byMode[mode] = { score: (byMode[mode]?.score ?? 0) + s, n: (byMode[mode]?.n ?? 0) + 1 }
    }
    const rate = voted ? score / voted : 0
    if (unknown) console.warn(`⚠ ${unknown} 票的 pairId 不在 blind-key.json 中，已跳过`)
    const lines = [
      `${key.best} 对 ${base} 盲评胜率：${(rate * 100).toFixed(1)}%（${voted} 对已投）→ ${rate >= 0.65 ? '✅ 达标' : '❌ 未达标'}`,
      ...(unknown ? [`（跳过 ${unknown} 票：pairId 不在 blind-key.json）`] : []),
      ...Object.entries(byMode).map(
        ([m, x]) => `- ${m}: ${((x.score / x.n) * 100).toFixed(1)}%（${x.n} 对）`
      ),
      '',
      '标注"写错的一句"：',
      ...votes.filter(v => v.wrong).map(v => `- ${v.pairId}: ${v.wrong}`)
    ]
    fs.writeFileSync(path.join(DIR, 'results/blind-summary.md'), lines.join('\n'))
    console.log(lines.join('\n'))
  })
})
