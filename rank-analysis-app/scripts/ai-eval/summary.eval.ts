/**
 * 汇总 results/*.jsonl → results/summary.md（指标表 + 门槛判定）。
 * 用法：npm run eval:summary
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  bogusTagCount,
  citationErrors,
  renderedCitationErrors,
  scoreJargonCount,
  fabricatedNumberRate,
  labelAgreement,
  percentile,
  specificity,
  uncitedProcessSentences
} from './metrics'

const DIR = path.resolve(__dirname)

interface Row {
  variant: string
  gameId: number
  mode: string
  run: number
  ok: boolean
  stage?: string
  s1Ms?: number
  s1Retried?: boolean
  s2Ms?: number
  promptChars?: number
  prompt?: string
  output?: string
  attribution?: { winReason: string; verdicts: Array<{ participantId: number; label: string }> }
  cards?: Array<{ id: string; text: string }>
}

function load(v: string): Row[] {
  const p = path.join(DIR, `results/${v}.jsonl`)
  if (!fs.existsSync(p)) return []
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
}

/** 分母为 0 时返回 NaN（而不是 0），让门槛显示 n/a 而不是空判通过 */
const ratio = (num: number, den: number) => (den > 0 ? num / den : NaN)

function summarize(rows: Row[]) {
  const ok = rows.filter(r => r.ok && r.output)
  const sum = (f: (r: Row) => number) => ok.reduce((s, r) => s + f(r), 0)
  const fab = ok.map(r => fabricatedNumberRate(r.output!, r.prompt!))
  const cit = ok.map(r => citationErrors(r.output!, r.cards ?? []))
  const renderedCit = ok.map(r => renderedCitationErrors(r.output!, r.cards ?? []))
  const spec = ok.map(r => specificity(r.output!))
  const overview = rows.filter(r => r.mode === 'overview')
  const s1Fail = overview.filter(r => !r.ok && r.stage === 'attribution').length
  // Stage 1 成功的行；其中 ok:false 即 Stage 2 失败
  const s1Passed = rows.filter(r => r.stage !== 'attribution')
  const s2Fail = s1Passed.filter(r => !r.ok).length
  const runsByGame = new Map<number, Row[]>()
  for (const r of overview.filter(r => r.ok && r.attribution))
    runsByGame.set(r.gameId, [...(runsByGame.get(r.gameId) ?? []), r])
  const agreements = [...runsByGame.values()]
    .filter(rs => rs.length >= 2)
    .map(rs => labelAgreement(rs[0].attribution!.verdicts, rs[1].attribution!.verdicts))
  const withTl = overview.filter(r => r.ok && (r.cards?.length ?? 0) > 0)
  const latency = ok.map(r => (r.s1Ms ?? 0) + (r.s2Ms ?? 0))
  return {
    n: rows.length,
    okRows: ok.length,
    emptyOutputs: rows.filter(r => r.ok && !r.output).length,
    fabricatedRate: ratio(
      fab.reduce((s, f) => s + f.fabricated, 0),
      fab.reduce((s, f) => s + f.total, 0)
    ),
    // 诊断：模型原文的引用错误率（未经渲染端修复）
    rawCitationErrorRate: ratio(
      cit.reduce((s, c) => s + c.errors, 0),
      cit.reduce((s, c) => s + c.total, 0)
    ),
    // 门槛口径：用户实际看到的（normalize → repair → strip 之后）
    renderedCitationErrorRate: ratio(
      renderedCit.reduce((s, c) => s + c.errors, 0),
      renderedCit.reduce((s, c) => s + c.total, 0)
    ),
    uncitedProcessPerDoc: ratio(
      sum(r => uncitedProcessSentences(r.output!)),
      ok.length
    ),
    bogusTagsPerDoc: ratio(
      sum(r => bogusTagCount(r.output!)),
      ok.length
    ),
    scoreJargonPerDoc: ratio(
      sum(r => scoreJargonCount(r.output!)),
      ok.length
    ),
    distinctCardsPerDoc: ratio(
      spec.reduce((s, x) => s + x.distinctCards, 0),
      ok.length
    ),
    adviceCitedRatio: ratio(
      spec.reduce((s, x) => s + x.adviceCited, 0),
      spec.reduce((s, x) => s + x.adviceTotal, 0)
    ),
    stage1FailRate: ratio(s1Fail, overview.length),
    stage2FailRate: ratio(s2Fail, s1Passed.length),
    stage1RetryRate: ratio(overview.filter(r => r.s1Retried).length, overview.length),
    labelAgreement: ratio(
      agreements.reduce((s, a) => s + a, 0),
      agreements.length
    ),
    winReasonCitedRatio: ratio(
      withTl.filter(r => /\[(T|F)\d+\]/.test(r.attribution!.winReason)).length,
      withTl.length
    ),
    p50Ms: ok.length ? percentile(latency, 50) : NaN,
    p90Ms: ok.length ? percentile(latency, 90) : NaN,
    avgPromptChars: ratio(
      sum(r => r.promptChars ?? 0),
      ok.length
    )
  }
}

describe('ai-eval summary', () => {
  it('writes summary.md', () => {
    const resultsDir = path.join(DIR, 'results')
    const found = fs.existsSync(resultsDir)
      ? fs.readdirSync(resultsDir).filter(f => f.endsWith('.jsonl'))
      : []
    if (!found.length) throw new Error('results/ 下没有任何 *.jsonl，先跑 npm run eval:run')
    // 自动发现全部变体（含带 EVAL_TAG 的 V1b 等）：V0 排最前，其余按名字排序
    const variants = found
      .map(f => f.replace(/\.jsonl$/, ''))
      .sort((a, b) => (a === 'V0' ? -1 : b === 'V0' ? 1 : a.localeCompare(b)))
    const stats = Object.fromEntries(variants.map(v => [v, summarize(load(v))]))
    const keys = Object.keys(stats[variants[0]]) as Array<keyof ReturnType<typeof summarize>>
    const fmt = (x: number) =>
      Number.isFinite(x) ? (Math.abs(x) < 10 ? x.toFixed(3) : x.toFixed(0)) : '—'
    const lines = [
      `| 指标 | ${variants.join(' | ')} |`,
      `|---|${variants.map(() => '---').join('|')}|`,
      ...keys.map(k => `| ${k} | ${variants.map(v => fmt(stats[v][k])).join(' | ')} |`)
    ]
    const v0 = stats.V0
    /** 输入含 NaN（无成功样本）时判定为 n/a，而不是 ✅/❌ */
    const mark = (inputs: number[], pass: boolean) =>
      inputs.some(Number.isNaN) ? '⚠️ n/a（无成功样本）' : pass ? '✅' : '❌'
    const gates =
      !v0 || v0.okRows === 0
        ? ['⚠️ V0 无成功样本，无法判定门槛']
        : variants
            .filter(v => v !== 'V0')
            .map(v => {
              const s = stats[v]
              const checks: Array<[string, string]> = [
                [
                  '编造数字率不高于V0',
                  mark([s.fabricatedRate, v0.fabricatedRate], s.fabricatedRate <= v0.fabricatedRate)
                ],
                [
                  '引用错误率不高于2',
                  mark([s.renderedCitationErrorRate], s.renderedCitationErrorRate <= 0.02)
                ],
                [
                  '无引用过程句每篇不超过1',
                  mark([s.uncitedProcessPerDoc], s.uncitedProcessPerDoc <= 1)
                ],
                [
                  'Stage1失败率不高于V0',
                  mark([s.stage1FailRate, v0.stage1FailRate], s.stage1FailRate <= v0.stage1FailRate)
                ],
                [
                  'Stage2失败率不高于V0',
                  mark([s.stage2FailRate, v0.stage2FailRate], s.stage2FailRate <= v0.stage2FailRate)
                ],
                ['P50耗时增幅不超过50', mark([s.p50Ms, v0.p50Ms], s.p50Ms <= v0.p50Ms * 1.5)]
              ]
              return `### ${v}\n${checks.map(([k, m]) => `- ${m} ${k}`).join('\n')}`
            })
    const md = `# A/B 自动指标\n\n${lines.join('\n')}\n\n## 门槛\n\n${gates.join('\n\n')}\n`
    fs.writeFileSync(path.join(DIR, 'results/summary.md'), md)
    console.log(md)
  })
})
