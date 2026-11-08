// @vitest-environment jsdom
/**
 * 盲评页面：抽 12 局 ×{整局, 单人} = 24 对，BASE（默认 V0）vs BEST（默认 V1，可设 BEST=V2 或带 EVAL_TAG 的变体如 V1b），左右随机。
 * 输出与 app 一致的渲染 HTML（同一 renderAnalysisReport）。用法：BEST=V1 npm run eval:blind
 * 指定参照变体：BASE=V1pre BEST=S npm run eval:blind
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { extractNumbers } from '@renderer/services/ai/matchDetail/postprocess'
import type { TimelineCard } from '@renderer/services/ai/shared/timeline/types'

const DIR = path.resolve(__dirname)
const BEST = process.env.BEST ?? 'V1'
const BASE = process.env.BASE ?? 'V0'
/** 分层抽样：单双排 6、大乱斗 2、海斗 2、其他 2 */
const STRATA: Array<[(q: number) => boolean, number]> = [
  [q => q === 420, 6],
  [q => q === 450, 2],
  [q => q === 2400, 2],
  [q => ![420, 450, 2400].includes(q), 2]
]

/**
 * 确定性伪随机数生成器（固定种子，保证左右分配可复现）
 * @param seed - 种子
 * @returns 返回 [0,1) 随机数的函数
 */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** run.eval.ts 写出的结果行（仅本脚本用到的字段） */
interface Row {
  gameId: number
  queueId: number
  mode: 'overview' | 'player'
  run: number
  ok: boolean
  prompt: string
  output: string
  attribution?: { verdicts: Array<{ name: string; label: string }> }
  cards: Array<{ id: string; text: string }>
}

const load = (v: string): Row[] =>
  fs
    .readFileSync(path.join(DIR, `results/${v}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
    .filter((r: Row) => r.ok && r.run === 1)

/** 按 app 的同一规则渲染（两模式都做数字接地、整局做章节重排、有卡片做引用过滤与角标；结果行无快照，不做张冠李戴过滤） */
function render(r: Row): string {
  const cards = r.cards.map(c => ({
    ...c,
    kind: 'death',
    subjects: [],
    minute: 0,
    numbers: [],
    weight: 0
  })) as TimelineCard[]
  return renderAnalysisReport(
    r.output,
    r.mode === 'overview' ? r.attribution?.verdicts : undefined,
    extractNumbers(r.prompt),
    cards.length ? cards : undefined
  )
}

describe('ai-eval blind', () => {
  it('writes blind.html', () => {
    const a = load(BASE)
    const b = load(BEST)
    const key = (r: Row) => `${r.gameId}:${r.mode}`
    const bMap = new Map(b.map(r => [key(r), r]))
    const rnd = mulberry32(20261107)
    const games = [...new Map(a.map(r => [r.gameId, r.queueId])).entries()].sort(
      (x, y) => x[0] - y[0]
    )
    const picked: number[] = []
    for (const [pred, n] of STRATA)
      picked.push(
        ...games
          .filter(([, q]) => pred(q))
          .slice(0, n)
          .map(([id]) => id)
      )

    // 对局标识（时间/模式/本人英雄/胜负/时长/gameId），两侧相同，不破坏盲评，方便用户回客户端核对
    const champions = new Map<number, string>(
      (
        JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures/champions.json'), 'utf8')) as Array<{
          value: number
          label: string
        }>
      ).map(c => [c.value, c.label])
    )
    const QUEUE_NAME: Record<number, string> = {
      420: '单双排',
      440: '灵活排位',
      450: '大乱斗',
      2400: '海克斯大乱斗'
    }
    const gameLabel = (gameId: number): string => {
      const file = path.join(DIR, `fixtures/games/${gameId}.json`)
      if (!fs.existsSync(file)) return `gameId ${gameId}`
      const g = JSON.parse(fs.readFileSync(file, 'utf8')).game
      const me = g.participants?.[0]
      const s = me?.stats ?? {}
      const when = new Date(g.gameCreation).toLocaleString('zh-CN', { hour12: false })
      const mins = `${Math.floor(g.gameDuration / 60)}分${String(g.gameDuration % 60).padStart(2, '0')}秒`
      return [
        when,
        QUEUE_NAME[g.queueId] ?? `队列 ${g.queueId}`,
        `${champions.get(me?.championId) ?? '未知英雄'} ${s.kills}/${s.deaths}/${s.assists}`,
        s.win ? '胜' : '负',
        mins,
        `gameId ${gameId}`
      ].join(' · ')
    }

    const pairs: Array<{
      pairId: string
      left: string
      right: string
      leftIs: string
      mode: string
      label: string
    }> = []
    for (const gameId of picked) {
      for (const mode of ['overview', 'player'] as const) {
        const ra = a.find(r => r.gameId === gameId && r.mode === mode)
        const rb = bMap.get(`${gameId}:${mode}`)
        if (!ra || !rb) continue
        const flip = rnd() < 0.5
        pairs.push({
          pairId: `${gameId}-${mode}`,
          left: render(flip ? rb : ra),
          right: render(flip ? ra : rb),
          leftIs: flip ? BEST : BASE,
          mode,
          label: gameLabel(gameId)
        })
      }
    }
    fs.writeFileSync(
      path.join(DIR, 'results/blind-key.json'),
      JSON.stringify(
        {
          base: BASE,
          best: BEST,
          pairs: pairs.map(p => ({ pairId: p.pairId, leftIs: p.leftIs }))
        },
        null,
        2
      )
    )

    const css = fs.readFileSync(path.resolve(DIR, '../../src/styles/ai-report.css'), 'utf8')
    const body = pairs
      .map(
        (p, i) => `
<section data-pair="${p.pairId}">
  <h2>第 ${i + 1} / ${pairs.length} 对 · ${p.mode === 'overview' ? '整局锐评' : '单人复盘'}</h2>
  <p class="game-label">${p.label}</p>
  <div class="cols"><div class="ai-report">${p.left}</div><div class="ai-report">${p.right}</div></div>
  <div class="vote">
    <label><input type="radio" name="c-${p.pairId}" value="L">左边更好用</label>
    <label><input type="radio" name="c-${p.pairId}" value="R">右边更好用</label>
    <label><input type="radio" name="c-${p.pairId}" value="T">差不多</label>
    <input class="useful" placeholder="最有用的一句（可选）"><input class="wrong" placeholder="写错的一句（可选）">
  </div>
</section>`
      )
      .join('\n')
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>复盘盲评</title>
<style>${css}
body{font-family:system-ui;margin:24px;background:#16181d;color:#ddd}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.cols>div{border:1px solid #333;padding:12px;border-radius:8px}
.game-label{margin:-6px 0 12px;color:#9ab;font-size:14px}
.vote{margin:12px 0 40px;display:flex;gap:12px;flex-wrap:wrap}.vote input[type=text],.vote input:not([type]){flex:1;min-width:240px}
button{position:fixed;right:24px;bottom:24px;padding:12px 20px}</style>
<body><h1>复盘盲评（${pairs.length} 对）</h1>${body}
<button onclick="exportResult()">导出结果</button>
<script>
function exportResult(){
  const out=[...document.querySelectorAll('section')].map(s=>({pairId:s.dataset.pair,
    choice:(s.querySelector('input[type=radio]:checked')||{}).value||null,
    useful:s.querySelector('.useful').value,wrong:s.querySelector('.wrong').value}));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));
  a.download='blind-result.json';a.click();
}
</script></body></html>`
    fs.writeFileSync(path.join(DIR, 'results/blind.html'), html)
    console.log(`blind.html：${pairs.length} 对（${BASE} vs ${BEST}）`)
  })
})
