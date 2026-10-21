// 一次性评测：对比不同模型在「单局复盘」Stage1 归因上的 一致性 / 事实性 / 有效率 / 速度。
// 与 bench-ai-models.mjs（只测速度）互补；prompt 与 validator 直接 import 源码，不复刻。
//
// 运行（在 rank-analysis-app 目录下）：
//   DASHSCOPE_API_KEY=sk-xxx npx vite-node ../tests/bench-ai-quality.ts
// 可选环境变量：MODELS=a,b,c  RUNS=5  CASES=stomp,aram  CONCURRENCY=6
// 原始输出写到 tests/out/quality/*.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import {
  buildAttributionUserPrompt,
  STAGE1_SYSTEM_PROMPT
} from '../rank-analysis-app/src/services/ai/matchDetail/attribution'
import { validateAttribution } from '../rank-analysis-app/src/services/ai/matchDetail/validator'
import { CASES, type Case, type Label, type Snap } from './ai-fixtures'

// 换其他 OpenAI 兼容服务商（火山方舟 / DeepSeek 官方 / 智谱…）：AI_BASE_URL + API_KEY，
// 关思考的参数各家不同，用 EXTRA_BODY 传 JSON（默认是百炼的 enable_thinking=false）
const URL_ = process.env.AI_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const KEY = process.env.API_KEY ?? process.env.DASHSCOPE_API_KEY ?? ''
const EXTRA_BODY = JSON.parse(process.env.EXTRA_BODY ?? '{"enable_thinking":false}')
const MODELS = (
  process.env.MODELS ??
  'qwen-flash,qwen3.8-flash,qwen3.7-flash,deepseek-v4.1-flash,deepseek-v4.1-flash-1017,ZHIPU/GLM-5.3-Flash,MiniMax-M2.5,kimi-k2.6'
).split(',')
const RUNS = Number(process.env.RUNS ?? 5)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 6)
const TIMEOUT_MS = 120_000
const OUT_DIR = new URL(`./out/${process.env.OUT ?? 'quality'}/`, import.meta.url)
mkdirSync(OUT_DIR, { recursive: true })

// ───────────────────────── 请求 ─────────────────────────

async function callModel(model: string, user: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const t0 = performance.now()
  let ttft: number | null = null
  let content = ''
  try {
    const resp = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: STAGE1_SYSTEM_PROMPT },
          { role: 'user', content: user }
        ],
        stream: true,
        // 混合思考模型默认开思考（实测 deepseek-v4.1 / qwen3.8 都是），线上要秒出，统一关掉
        ...EXTRA_BODY
      }),
      signal: ctrl.signal
    })
    if (!resp.ok) return { ok: false, err: `HTTP ${resp.status} ${(await resp.text()).slice(0, 160)}`, ttft, ms: performance.now() - t0, content }
    const reader = resp.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const js = t.slice(5).trim()
        if (js === '[DONE]') continue
        try {
          const c = JSON.parse(js).choices?.[0]?.delta?.content ?? ''
          if (c) {
            ttft ??= performance.now() - t0
            content += c
          }
        } catch {
          /* 心跳/非 JSON 行 */
        }
      }
    }
    return { ok: true, err: '', ttft, ms: performance.now() - t0, content }
  } catch (e) {
    return { ok: false, err: String((e as Error).message ?? e), ttft, ms: performance.now() - t0, content }
  } finally {
    clearTimeout(timer)
  }
}

// ───────────────────────── 打分 ─────────────────────────

const METRIC_FIELDS = new Set([
  'kda', 'kills', 'deaths', 'assists', 'damageShare', 'damageTakenShare', 'goldShare',
  'killParticipation', 'dpm', 'gpm', 'csm', 'wardScore', 'turretDamage', 'gold', 'cs', 'damage', 'taken'
])

function near(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(0.6, Math.abs(b) * 0.02)
}

/** 玩家身上所有可被引用的数字（含与对位的差值），用于核对 finalCall 里的数字 */
function knownNumbers(snap: Snap, pid: number): number[] {
  const p = snap.players.find(x => x.participantId === pid)!
  const own = [...METRIC_FIELDS].map(f => (p as any)[f]).filter((x): x is number => typeof x === 'number')
  const mk = Object.values(p.multiKills)
  const opp = snap.players.find(x => x.teamId !== p.teamId && x.teamPosition === p.teamPosition && p.teamPosition !== 'UNKNOWN')
  const diffs = opp ? ['gold', 'cs', 'kda', 'damageShare', 'kills', 'deaths'].flatMap(f => {
    const d = (p as any)[f] - (opp as any)[f]
    return [d, Math.abs(d), Math.abs(d) / 1000]
  }) : []
  const teamTotals = snap.teams.flatMap(t => [t.totalKills, t.totalDeaths, t.totalGold, t.totalDamage])
  const thousands = own.filter(x => x >= 1000).map(x => x / 1000)
  return [...own, ...mk, ...diffs, ...teamTotals, ...thousands, Math.round(snap.durationSeconds / 60)]
}

interface Score {
  parsed: boolean
  valid: boolean
  validErr: string
  labels: Record<number, Label>
  coverageMiss: number // 必出玩家（双方击杀/死亡 TOP1 + isMe）漏了几个
  wrongEvidence: number // evidenceMetrics 数值与快照对不上
  evidenceTotal: number
  badNumbersInCall: number // finalCall 里出现快照里没有的数字
  labelRuleBreak: number // 标签违反量化硬条件（validator 会降级的那类）
  ungroundedFactor: number // 缓解因子没有数据支撑
  forbiddenHit: number
  expectHit: number
  expectTotal: number
}

function score(c: Case, raw: string): Score {
  const s: Score = {
    parsed: false, valid: false, validErr: '', labels: {}, coverageMiss: 0, wrongEvidence: 0,
    evidenceTotal: 0, badNumbersInCall: 0, labelRuleBreak: 0, ungroundedFactor: 0, forbiddenHit: 0,
    expectHit: 0, expectTotal: Object.keys(c.expect).length
  }
  // validator 会原地改写（降级/摘因子），先 deep copy 一份测模型原始质量
  const v = validateAttribution(raw, structuredClone(c.snap) as any)
  s.valid = v.ok
  if (!v.ok) s.validErr = v.error
  let o: any
  try {
    o = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
    s.parsed = true
  } catch {
    return s
  }
  const verdicts: any[] = Array.isArray(o.verdicts) ? o.verdicts : []
  const snap = c.snap
  const byId = (id: number) => snap.players.find(p => p.participantId === id)

  const must = new Set<number>()
  for (const t of snap.teams) {
    must.add([...t.players].sort((a, b) => b.kills - a.kills)[0].participantId)
    must.add([...t.players].sort((a, b) => b.deaths - a.deaths)[0].participantId)
  }
  must.add(snap.players.find(p => p.isMe)!.participantId)
  const got = new Set(verdicts.map(x => x.participantId))
  s.coverageMiss = [...must].filter(id => !got.has(id)).length

  const texts: string[] = [String(o.winReason ?? '')]
  for (const vd of verdicts) {
    const p = byId(vd.participantId)
    if (!p) {
      s.wrongEvidence++
      continue
    }
    s.labels[p.participantId] = vd.label
    texts.push(String(vd.finalCall ?? ''))
    for (const m of vd.evidenceMetrics ?? []) {
      texts.push(String(m.note ?? ''))
      const val = typeof m.value === 'string' ? Number(m.value.replace(/[%,\s]/g, '')) : m.value
      let truth: unknown
      if (METRIC_FIELDS.has(m.metric)) truth = (p as any)[m.metric]
      else if (/^multiKills\.(double|triple|quadra|penta)$/.test(m.metric)) truth = (p.multiKills as any)[m.metric.split('.')[1]]
      else continue // 对位差值等派生指标不核对
      s.evidenceTotal++
      if (typeof truth !== 'number' || typeof val !== 'number' || !near(val, truth)) s.wrongEvidence++
    }
    const known = knownNumbers(snap, p.participantId)
    for (const n of String(vd.finalCall ?? '').match(/\d+(?:\.\d+)?/g) ?? []) {
      const x = Number(n)
      if (x <= 1 && Number.isInteger(x)) continue // "1 次""0 杀"之类的口语
      if (!known.some(k => near(x, k))) s.badNumbersInCall++
    }
    // 标签硬条件
    const team = snap.players.filter(x => x.teamId === p.teamId)
    const avgKp = team.reduce((a, x) => a + x.killParticipation, 0) / team.length
    if (vd.label === '尽力' && !p.win) s.labelRuleBreak++
    if ((vd.label === '犯罪' || vd.label === '被连累') && p.win) s.labelRuleBreak++
    if (vd.label === '缚地灵' && p.killParticipation >= avgKp - 15) s.labelRuleBreak++
    for (const f of vd.mitigatingFactors ?? []) {
      texts.push(String(f.support ?? ''))
      const rp: any = p.recentProfile
      const ok =
        (f.factor === 'off-role' && rp?.isOffRole === true) ||
        (f.factor === 'first-time-champion' && rp?.currentChampionMastery?.isFirstTimeInRecent === true) ||
        f.factor === 'team-collapse'
      if (!ok) s.ungroundedFactor++
    }
    // recentProfile=null 却谈补位/熟练度
    if (!p.recentProfile && /补位|熟练|绝活|首次|第一次|不熟/.test(String(vd.finalCall))) s.ungroundedFactor++
  }
  if (c.forbidden) s.forbiddenHit = texts.filter(t => c.forbidden!.test(t)).length
  for (const [pid, ok] of Object.entries(c.expect)) {
    const l = s.labels[Number(pid)]
    if (l && ok.includes(l)) s.expectHit++
  }
  return s
}

/** 同一模型同一 case 多次运行：每个被点名玩家的众数标签占比的平均（1 = 每次都一样） */
function consistency(runs: Score[]): number {
  const ok = runs.filter(r => r.parsed)
  if (ok.length < 2) return NaN
  const ids = new Set(ok.flatMap(r => Object.keys(r.labels).map(Number)))
  const shares = [...ids].map(id => {
    const cnt = new Map<string, number>()
    for (const r of ok) {
      const l = r.labels[id] ?? '(未点名)'
      cnt.set(l, (cnt.get(l) ?? 0) + 1)
    }
    return Math.max(...cnt.values()) / ok.length
  })
  return shares.reduce((a, b) => a + b, 0) / shares.length
}

// ───────────────────────── 跑 ─────────────────────────

const caseFilter = process.env.CASES?.split(',')
const cases = CASES.filter(c => !caseFilter || caseFilter.includes(c.key))

if (process.argv.includes('--self-check')) {
  for (const c of cases) {
    const s = buildAttributionUserPrompt(c.snap as any)
    console.log(`${c.key}: prompt ${s.length} chars, mode=${c.snap.modeContext.kind}`)
  }
  process.exit(0)
}
if (!KEY) throw new Error('需要 DASHSCOPE_API_KEY')

type Job = { model: string; c: Case; run: number }
const jobs: Job[] = []
for (let run = 1; run <= RUNS; run++) for (const c of cases) for (const model of MODELS) jobs.push({ model, c, run })

const results: Array<Job & { r: Awaited<ReturnType<typeof callModel>>; s: Score }> = []
let next = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++]
      const r = await callModel(j.model, buildAttributionUserPrompt(j.c.snap as any))
      const s = r.ok ? score(j.c, r.content) : score(j.c, '')
      results.push({ ...j, r, s })
      writeFileSync(new URL(`${j.model.replace(/\//g, '_')}-${j.c.key}-r${j.run}.json`, OUT_DIR), r.content || `ERROR ${r.err}`)
      console.log(`[${results.length}/${jobs.length}] ${j.model} ${j.c.key} r${j.run} ${r.ok ? '' : 'ERR ' + r.err.slice(0, 80)} ${(r.ms / 1000).toFixed(1)}s valid=${s.valid}`)
    }
  })
)

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const pct = (x: number) => (Number.isNaN(x) ? '  -  ' : `${(x * 100).toFixed(0)}%`.padStart(5))
const num = (x: number) => (Number.isNaN(x) ? '  - ' : x.toFixed(2).padStart(5))

console.log('\n每个模型汇总（跨所有 case；错误数均为「每次输出平均」）')
console.log('model                  失败率  有效率  一致性  符合预期  证据错  数字幻觉  规则违反  无据因子  违禁词  漏点名  均耗时  首字')
const summary: any[] = []
for (const model of MODELS) {
  // 质量指标只统计成功返回的请求；超时/报错单列，避免限流把质量分拉低
  const all = results.filter(x => x.model === model)
  const rs = all.filter(x => x.r.ok)
  const perCase = cases.map(c => consistency(rs.filter(x => x.c.key === c.key).map(x => x.s)))
  const row = {
    model,
    fail: 1 - rs.length / Math.max(all.length, 1),
    valid: avg(rs.map(x => (x.s.valid ? 1 : 0))),
    consistency: avg(perCase.filter(x => !Number.isNaN(x))),
    expect: avg(rs.map(x => x.s.expectHit / x.s.expectTotal)),
    wrongEvidence: avg(rs.map(x => x.s.wrongEvidence)),
    badNumbers: avg(rs.map(x => x.s.badNumbersInCall)),
    ruleBreak: avg(rs.map(x => x.s.labelRuleBreak)),
    ungrounded: avg(rs.map(x => x.s.ungroundedFactor)),
    forbidden: avg(rs.map(x => x.s.forbiddenHit)),
    coverageMiss: avg(rs.map(x => x.s.coverageMiss)),
    ms: avg(rs.filter(x => x.r.ok).map(x => x.r.ms)),
    ttft: avg(rs.filter(x => x.r.ttft != null).map(x => x.r.ttft!)),
    perCase: Object.fromEntries(cases.map((c, i) => [c.key, perCase[i]]))
  }
  summary.push(row)
  console.log(
    `${model.padEnd(22)} ${pct(row.fail)}   ${pct(row.valid)}   ${pct(row.consistency)}   ${pct(row.expect)}    ${num(row.wrongEvidence)}  ${num(row.badNumbers)}    ${num(row.ruleBreak)}    ${num(row.ungrounded)}   ${num(row.forbidden)}  ${num(row.coverageMiss)}  ${(row.ms / 1000).toFixed(1).padStart(5)}s ${(row.ttft / 1000).toFixed(1).padStart(4)}s`
  )
}
writeFileSync(new URL('summary.json', OUT_DIR), JSON.stringify({ RUNS, cases: cases.map(c => c.key), summary }, null, 2))
