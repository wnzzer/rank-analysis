/**
 * 标签分布诊断（校准权重/犯罪线时用）：用入库 baseline/thresholds 给 420 语料打分，
 * 分有/无时间线统计各标签占比、败方下路（BOTTOM）与败方 KDA≥3 的标签分布。
 * 运行：npm run baseline:dist；可选环境变量 DIST_OUT=路径 额外写出 JSON。
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Baseline } from '../../src/services/ai/shared/scoring/baseline'
import { scorePlayers } from '../../src/services/ai/shared/scoring/scorePlayers'
import type { Thresholds } from '../../src/services/ai/shared/scoring/thresholds'
import { DATA_DIR, loadCorpus, RAW_DIR } from './pipeline'

describe('label distribution', () => {
  it('label distribution', () => {
    const baseline = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'baseline.json'), 'utf8')
    ) as Baseline
    const thresholds = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'thresholds.json'), 'utf8')
    ) as Thresholds
    const corpus = loadCorpus(RAW_DIR).filter(c => c.game.queueId === 420)
    const res: Record<string, unknown> = {}
    for (const mode of ['notl', 'tl']) {
      const all: Record<string, number> = {}
      const loseBottom: Record<string, number> = {}
      const loseKda3: Record<string, number> = {}
      let n = 0
      let nLB = 0
      let nK = 0
      let games = 0
      for (const c of corpus) {
        const inputs = mode === 'tl' ? c.tl : c.end
        if (!inputs) continue
        games++
        const scores = scorePlayers(
          inputs,
          { queueId: 420, hasLanes: true },
          { baseline, thresholds }
        )
        scores.forEach((s, i) => {
          const inp = inputs[i]
          const part = c.game.participants.find(p => p.participantId === inp.participantId)!
          const kda = (part.kills + part.assists) / Math.max(1, part.deaths)
          n++
          all[s.label] = (all[s.label] ?? 0) + 1
          if (!inp.win && inp.position === 'BOTTOM') {
            nLB++
            loseBottom[s.label] = (loseBottom[s.label] ?? 0) + 1
          }
          if (!inp.win && kda >= 3) {
            nK++
            loseKda3[s.label] = (loseKda3[s.label] ?? 0) + 1
          }
        })
      }
      res[mode] = { games, n, all, nLB, loseBottom, nK, loseKda3 }
    }
    if (process.env.DIST_OUT) fs.writeFileSync(process.env.DIST_OUT, JSON.stringify(res, null, 1))
    console.log(JSON.stringify(res))
  })
})
