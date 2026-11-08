/**
 * 合理性检查（spec §验证 1）：用入库基准给语料重打分，
 * - 每个「队列×位置×模式」胜方平均总分应显著高于败方（差 > 0.3，n ≥ 200 的格子不达标即失败）；
 * - 任一分项与胜负负相关 → 告警（回看指标定义），不判失败。
 * 结果写 raw/sanity.md（不入库）。用法：npm run baseline:check
 * 诊断：设环境变量 BASELINE_MIN_VERSION=16.14 只统计该版本及以后的局（结果写 raw/sanity-<ver>.md）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { positionKey, type Baseline } from '../../src/services/ai/shared/scoring/baseline'
import { SUB_SCORE_KEYS } from '../../src/services/ai/shared/scoring/weights'
import { pearson } from './aggregate'
import { LANED_QUEUES } from './corpus'
import { DATA_DIR, loadCorpus, RAW_DIR, scoreCorpus } from './pipeline'

const MIN_GAP = 0.3
const MIN_N = 200
/** 硬门槛只覆盖排位（单双排 420 / 灵活组排 440）：排位是核心产品口径，其他队列不阻断，仅告警 */
const GATED_QUEUES: ReadonlySet<number> = new Set([420, 440])
const MIN_VERSION = process.env.BASELINE_MIN_VERSION

/** 版本号 "16.14.123.456" 是否 ≥ 下限 "16.14"（逐段数值比较） */
function versionAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < b.length; i++) {
    const x = a[i] ?? 0
    if (x !== b[i]) return x > b[i]
  }
  return true
}

describe('baseline sanity', () => {
  it('winners outscore losers in every queue×position', () => {
    const baseline = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'baseline.json'), 'utf8')
    ) as Baseline
    const corpus = loadCorpus(RAW_DIR).filter(
      c => !MIN_VERSION || versionAtLeast(c.game.gameVersion, MIN_VERSION)
    )
    const rows: string[] = [
      '| 格子 | n | 胜方均分 | 败方均分 | 差 | 结论 |',
      '|---|---|---|---|---|---|'
    ]
    const warnings: string[] = []
    const failures: string[] = []
    for (const mode of [false, true]) {
      const cells = new Map<
        string,
        { win: number[]; total: number[]; sub: Map<string, number[][]> }
      >()
      for (const { game, inputs, scores } of scoreCorpus(corpus, baseline, mode)) {
        const hasLanes = LANED_QUEUES.has(game.queueId)
        scores.forEach((s, i) => {
          const key = `${game.queueId}|${positionKey(inputs[i].position, hasLanes)}|${mode ? 'tl' : 'notl'}`
          const c = cells.get(key) ?? { win: [], total: [], sub: new Map<string, number[][]>() }
          c.win.push(inputs[i].win ? 1 : 0)
          c.total.push(s.total)
          for (const k of SUB_SCORE_KEYS) {
            const v = s.sub[k]
            if (v === null) continue
            const pair = c.sub.get(k) ?? [[], []]
            pair[0].push(v)
            pair[1].push(inputs[i].win ? 1 : 0)
            c.sub.set(k, pair)
          }
          cells.set(key, c)
        })
      }
      for (const [key, c] of [...cells].sort((a, b) => a[0].localeCompare(b[0]))) {
        const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
        const w = mean(c.total.filter((_, i) => c.win[i] === 1))
        const l = mean(c.total.filter((_, i) => c.win[i] === 0))
        const gap = w - l
        const ok = gap > MIN_GAP
        const n = c.total.length
        const gated = GATED_QUEUES.has(Number(key.split('|')[0]))
        const verdict = ok
          ? 'PASS'
          : n < MIN_N
            ? '样本少'
            : gated
              ? 'FAIL'
              : '⚠️ 告警（非排位，不阻断）'
        rows.push(
          `| ${key} | ${n} | ${w.toFixed(2)} | ${l.toFixed(2)} | ${gap.toFixed(3)} | ${verdict} |`
        )
        if (!ok && n >= MIN_N && gated) failures.push(`${key} gap=${gap.toFixed(3)}`)
        for (const [k, [xs, ys]] of c.sub) {
          const r = pearson(xs, ys)
          if (r < 0)
            warnings.push(`- ${key} 分项 ${k} 与胜负负相关 r=${r.toFixed(3)}（回看指标定义）`)
        }
      }
    }
    const md = [
      '# 评分合理性检查',
      '',
      ...rows,
      '',
      '## 反向分项告警',
      ...(warnings.length ? warnings : ['（无）'])
    ].join('\n')
    fs.writeFileSync(path.join(RAW_DIR, MIN_VERSION ? `sanity-${MIN_VERSION}.md` : 'sanity.md'), md)
    console.log(md)
    expect(failures).toEqual([])
  })
})
