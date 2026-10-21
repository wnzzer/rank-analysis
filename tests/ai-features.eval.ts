// 一次性评测：对比模型在 整局总览 / 单人复盘 / 进对局整队分析 / 进对局单人分析 上的事实性与「理解」。
// 与 bench-ai-quality.ts（只测 Stage1 归因）互补。prompt 构建、validator、数字接地过滤全部 import 源码。
// Stage2 用同一模型自己的 Stage1 结果（贴近线上：两阶段同模型）。
//
// 运行（在 rank-analysis-app 目录下）：
//   DASHSCOPE_API_KEY=sk-xxx npx vitest run --config ../tests/vitest.eval.config.ts
// 可选：MODELS=a,b  RUNS=3  CONCURRENCY=3
// 原始输出：tests/out/features/<model>/*.md，汇总：tests/out/features/summary.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { CASES, type Case, type Snap } from './ai-fixtures'

const CHAMP: Record<number, string> = {
  266: '暗裔剑魔', 103: '阿狸', 64: '盲僧', 157: '疾风剑豪', 21: '赏金猎人', 412: '魂锁典狱长',
  86: '德玛西亚之力', 121: '虚空掠夺者', 7: '诡术妖姬', 222: '暴走萝莉', 89: '曙光女神',
  99: '光辉女郎', 1: '黑暗之女', 22: '寒冰射手', 54: '熔岩巨兽', 25: '堕落天使',
  555: '血港鬼影', 28: '寡妇制造者', 236: '圣枪游侠', 63: '复仇焰魂', 40: '风暴之怒'
}

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null), Channel: class {} }))
vi.mock('@renderer/services/ai/champion-names', () => ({
  getChampionName: (id: number) => CHAMP[id] ?? `英雄${id}`,
  loadChampionNames: async () => {}
}))
vi.mock('@renderer/services/ai/shared/noteBrief', () => ({ buildNoteBrief: () => undefined }))
vi.mock('@renderer/services/patchNotes', () => ({
  getChampionPatchNote: async (id: number) =>
    id === 222
      ? { champion: '暴走萝莉（10月15日更新）', direction: 'buff', lines: ['Q 枪炮交响曲：火箭形态攻击距离加成 100/125/150/175/200 → 125/150/175/200/225'] }
      : id === 7
        ? { champion: '诡术妖姬（10月15日更新）', direction: 'nerf', lines: ['W 魔影迷踪：伤害 75/115/155/195/235 → 70/105/140/175/210'] }
        : null
}))
vi.mock('@renderer/services/opgg', () => ({
  getChampionMeta: async (_m: string, id: number) =>
    ({
      222: { championId: 222, position: 'ADC', tier: 1, winRate: 0.532 },
      121: { championId: 121, position: 'JUNGLE', tier: 2, winRate: 0.515 },
      7: { championId: 7, position: 'MID', tier: 3, winRate: 0.496 },
      86: { championId: 86, position: 'TOP', tier: 2, winRate: 0.508 },
      89: { championId: 89, position: 'SUPPORT', tier: 3, winRate: 0.501 }
    })[id] ?? null,
  getLaneCounters: async () => ({}),
  findCounterHints: () => []
}))

const { buildAttributionUserPrompt, STAGE1_SYSTEM_PROMPT, parseAttribution } = await import(
  '@renderer/services/ai/matchDetail/attribution'
)
const { buildCritiqueUserPrompt, STAGE2_SYSTEM_PROMPT } = await import('@renderer/services/ai/matchDetail/critique')
const { extractNumbers, stripUngroundedSentences } = await import('@renderer/services/ai/matchDetail/postprocess')
const { buildEntityFacts, findMisattributions } = await import('@renderer/services/ai/matchDetail/misattribution')
const { buildTeamAnalysisPrompt, buildPlayerAnalysisPrompt } = await import('@renderer/services/ai/prompts/team')
const { DEFAULT_SYSTEM_PROMPT } = await import('@renderer/services/ai/stream')

const URL_ = process.env.AI_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const KEY = process.env.API_KEY ?? process.env.DASHSCOPE_API_KEY ?? ''
const EXTRA_BODY = JSON.parse(process.env.EXTRA_BODY ?? '{"enable_thinking":false}')
const MODELS = (process.env.MODELS ?? 'qwen-flash,qwen3.8-flash,deepseek-v4.1-flash-1017').split(',')
const RUNS = Number(process.env.RUNS ?? 3)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3)
const OUT = new URL(`./out/${process.env.OUT ?? 'features'}/`, import.meta.url)

/**
 * Anthropic Messages API（原生 HTTP + SSE）：仅评测「质量上限」对照用。
 * Opus 5.5 思考恒开、不可关，用 effort 控制深度（ANTHROPIC_EFFORT，默认 low 贴近线上对速度的要求）。
 * 正文在 content_block_delta / text_delta 里；thinking 块默认不回传内容，不计入首字。
 */
async function callAnthropic(model: string, system: string, user: string) {
  const t0 = performance.now()
  let ttft: number | null = null
  let content = ''
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 180_000)
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: process.env.ANTHROPIC_EFFORT ?? 'low' },
        stream: true
      }),
      signal: ctrl.signal
    })
    if (!resp.ok) return { ok: false, err: `HTTP ${resp.status} ${(await resp.text()).slice(0, 160)}`, ms: performance.now() - t0, ttft, content }
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
        if (!line.startsWith('data:')) continue
        try {
          const ev = JSON.parse(line.slice(5).trim())
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            ttft ??= performance.now() - t0
            content += ev.delta.text
          } else if (ev.type === 'error') {
            return { ok: false, err: JSON.stringify(ev.error).slice(0, 160), ms: performance.now() - t0, ttft, content }
          }
        } catch {
          /* ping 等非 JSON 行 */
        }
      }
    }
    return { ok: true, err: '', ms: performance.now() - t0, ttft, content }
  } catch (e) {
    return { ok: false, err: String((e as Error).message ?? e), ms: performance.now() - t0, ttft, content }
  } finally {
    clearTimeout(timer)
  }
}

async function callModel(model: string, system: string, user: string, json = false) {
  if (model.startsWith('claude-')) return callAnthropic(model, system, user)
  const t0 = performance.now()
  let ttft: number | null = null
  let content = ''
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120_000)
  try {
    const resp = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        stream: true,
        // 线上 Stage1 走 jsonMode（ai.rs response_format），这里保持一致
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        ...EXTRA_BODY
      }),
      signal: ctrl.signal
    })
    if (!resp.ok) return { ok: false, err: `HTTP ${resp.status} ${(await resp.text()).slice(0, 160)}`, ms: performance.now() - t0, ttft, content }
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
    return { ok: true, err: '', ms: performance.now() - t0, ttft, content }
  } catch (e) {
    return { ok: false, err: String((e as Error).message ?? e), ms: performance.now() - t0, ttft, content }
  } finally {
    clearTimeout(timer)
  }
}

// ───────────────────────── 进对局造数据 ─────────────────────────

interface HistSpec { champ: number; lane: string; n: number; wins: number; k: number; d: number; a: number }
function history(specs: HistSpec[]) {
  const games: any[] = []
  for (const s of specs) {
    for (let i = 0; i < s.n; i++) {
      games.push({
        queueName: '单双排位',
        gameMode: 'CLASSIC',
        participants: [
          {
            championId: s.champ,
            timeline: { lane: s.lane },
            stats: {
              win: i < s.wins,
              kills: s.k + (i % 3) - 1,
              deaths: Math.max(0, s.d + (i % 2)),
              assists: s.a + (i % 4) - 1,
              totalDamageDealtToChampions: 18000 + i * 900,
              goldEarned: 11000 + i * 300
            }
          }
        ]
      })
    }
  }
  // 交错胜负，避免「前 N 场全胜」这种假象
  return games.map((g, i) => ({ g, k: (i * 7) % Math.max(1, games.length) + i / 1000 })).sort((x, y) => x.k - y.k).map(x => x.g)
}

function sp(o: {
  name: string; champ: number; pos: string; level?: number; tier?: string
  hist: HistSpec[]; recent?: Record<string, number | string> | null
  tags?: Array<{ tagName: string; tagDesc: string; good: boolean }>
  group?: string; meet?: Array<{ isMyTeam: boolean; win: boolean }>
}) {
  const games = history(o.hist)
  const wins = games.filter(g => g.participants[0].stats.win).length
  const avg = (f: (s: any) => number) => games.reduce((a, g) => a + f(g.participants[0].stats), 0) / Math.max(1, games.length)
  const recent =
    o.recent === null
      ? undefined
      : {
          selectModeCn: '单双排位',
          selectWins: wins,
          selectLosses: games.length - wins,
          kills: avg(s => s.kills),
          deaths: avg(s => s.deaths),
          assists: avg(s => s.assists),
          kda: avg(s => (s.kills + s.assists) / Math.max(1, s.deaths)),
          groupRate: 55,
          damageDealtToChampionsRate: 24,
          ...o.recent
        }
  return {
    championId: o.champ,
    assignedPosition: o.pos,
    summoner: { puuid: `puuid-${o.name}`, gameName: o.name, tagLine: '12345', summonerLevel: o.level ?? 180 },
    matchHistory: { games: { games } },
    userTag: { tag: o.tags ?? [], recentData: recent },
    rank: { queueMap: { RANKED_SOLO_5x5: { tierCn: o.tier ?? '翡翠II' } } },
    meetGames: (o.meet ?? []).map((m, i) => ({ index: i, gameId: i, isMyTeam: m.isMyTeam, win: m.win })),
    preGroupMarkers: { name: o.group ?? '', type: 'info' }
  }
}

interface GameCase {
  key: string
  desc: string
  session: any
  opggMode: 'ranked' | 'aram'
  /** 单人分析的目标 */
  target: any
  myNames: string[]
  enemyNames: string[]
  /** 输出里应当提到（理解到位）的点：label → 正则 */
  mustTeam: Record<string, RegExp>
  mustPlayer: Record<string, RegExp>
  forbidden: RegExp
}

const rankedMy = [
  sp({ name: '北风', champ: 266, pos: 'TOP', hist: [{ champ: 103, lane: 'MIDDLE', n: 14, wins: 8, k: 7, d: 4, a: 6 }, { champ: 157, lane: 'MIDDLE', n: 4, wins: 2, k: 6, d: 5, a: 4 }] }),
  sp({ name: '夜行', champ: 64, pos: 'JUNGLE', hist: [{ champ: 64, lane: 'JUNGLE', n: 20, wins: 15, k: 8, d: 3, a: 9 }], tags: [{ tagName: '连胜', tagDesc: '近期 5 连胜', good: true }] }),
  sp({ name: '绝活哥', champ: 157, pos: 'MIDDLE', tier: '钻石IV', hist: [{ champ: 157, lane: 'MIDDLE', n: 18, wins: 12, k: 9, d: 5, a: 4 }, { champ: 103, lane: 'MIDDLE', n: 2, wins: 1, k: 5, d: 4, a: 6 }] }),
  sp({ name: '下水道', champ: 21, pos: 'BOTTOM', hist: [{ champ: 21, lane: 'BOTTOM', n: 12, wins: 3, k: 4, d: 7, a: 4 }, { champ: 22, lane: 'BOTTOM', n: 8, wins: 3, k: 3, d: 6, a: 5 }], tags: [{ tagName: '连败', tagDesc: '近期 4 连败', good: false }] }),
  sp({ name: '小号', champ: 412, pos: 'UTILITY', level: 32, hist: [{ champ: 412, lane: 'BOTTOM', n: 8, wins: 7, k: 2, d: 2, a: 16 }] })
]
const rankedEnemy = [
  sp({ name: '铁头', champ: 86, pos: 'TOP', hist: [{ champ: 86, lane: 'TOP', n: 20, wins: 10, k: 5, d: 5, a: 5 }] }),
  sp({ name: '螳螂哥', champ: 121, pos: 'JUNGLE', group: '敌方双排A', hist: [{ champ: 121, lane: 'JUNGLE', n: 16, wins: 11, k: 10, d: 4, a: 6 }, { champ: 64, lane: 'JUNGLE', n: 4, wins: 2, k: 6, d: 5, a: 7 }] }),
  sp({ name: '妖姬妹', champ: 7, pos: 'MIDDLE', group: '敌方双排A', hist: [{ champ: 7, lane: 'MIDDLE', n: 17, wins: 11, k: 9, d: 4, a: 5 }] }),
  sp({ name: '金克斯本斯', champ: 222, pos: 'BOTTOM', tier: '钻石II', hist: [{ champ: 222, lane: 'BOTTOM', n: 20, wins: 16, k: 11, d: 3, a: 6 }], meet: [{ isMyTeam: false, win: false }, { isMyTeam: false, win: false }, { isMyTeam: true, win: true }] }),
  sp({ name: '光头', champ: 89, pos: 'UTILITY', hist: [{ champ: 89, lane: 'BOTTOM', n: 20, wins: 9, k: 2, d: 6, a: 13 }] })
]
const aramMy = [
  sp({ name: '随缘', champ: 99, pos: '', hist: [{ champ: 99, lane: 'NONE', n: 10, wins: 6, k: 8, d: 7, a: 18 }] }),
  sp({ name: '乱斗王', champ: 1, pos: '', hist: [{ champ: 1, lane: 'NONE', n: 6, wins: 4, k: 10, d: 8, a: 15 }, { champ: 25, lane: 'NONE', n: 6, wins: 4, k: 7, d: 6, a: 20 }] }),
  sp({ name: '新来的', champ: 22, pos: '', level: 18, hist: [], recent: null }),
  sp({ name: '坦克侠', champ: 54, pos: '', hist: [{ champ: 54, lane: 'NONE', n: 12, wins: 5, k: 4, d: 9, a: 20 }] }),
  sp({ name: '摆烂', champ: 25, pos: '', hist: [{ champ: 25, lane: 'NONE', n: 12, wins: 3, k: 4, d: 11, a: 9 }], tags: [{ tagName: '挂机嫌疑', tagDesc: '近期 2 场参团率低于 20%', good: false }] })
]
const aramEnemy = [
  sp({ name: '血港', champ: 555, pos: '', hist: [{ champ: 555, lane: 'NONE', n: 10, wins: 7, k: 12, d: 6, a: 10 }] }),
  sp({ name: '寡妇', champ: 28, pos: '', hist: [{ champ: 28, lane: 'NONE', n: 10, wins: 5, k: 9, d: 7, a: 9 }] }),
  sp({ name: '圣枪', champ: 236, pos: '', hist: [{ champ: 236, lane: 'NONE', n: 10, wins: 6, k: 10, d: 7, a: 12 }] }),
  sp({ name: '火男', champ: 63, pos: '', hist: [{ champ: 63, lane: 'NONE', n: 10, wins: 4, k: 9, d: 8, a: 14 }] }),
  sp({ name: '风女', champ: 40, pos: '', hist: [{ champ: 40, lane: 'NONE', n: 10, wins: 6, k: 2, d: 5, a: 24 }] })
]

const GAMES: GameCase[] = [
  {
    key: 'ingame-ranked',
    desc: '排位进对局：我方上单补位（近期全打中）、ADC 连败负面标签、辅助 32 级小号高胜率；敌方打野+中单双排、敌方金克斯 80% 胜率且本版本加强、遇见过 3 次',
    session: { typeCn: '单双排位', isMultiTeam: false, mySubteamId: 1, subteams: [{ subteamId: 1, players: rankedMy }, { subteamId: 2, players: rankedEnemy }] },
    opggMode: 'ranked',
    target: rankedMy[0],
    myNames: rankedMy.map(p => p.summoner.gameName),
    enemyNames: rankedEnemy.map(p => p.summoner.gameName),
    mustTeam: {
      上单补位: /补位|不是本命|非主.?位|主玩中/,
      敌方双排: /双排|预组队|开黑|组排/,
      ADC连败: /下水道[^。\n]{0,40}(连败|胜率|25%|30%)|连败/,
      敌ADC威胁: /金克斯本斯|暴走萝莉/,
      金克斯加强: /加强|攻击距离/
    },
    mustPlayer: { 补位: /补位|不是本命|非主.?位|主玩中/ },
    forbidden: /坦克|刺客|法师|射手|战士|大招|被动|连招/
  },
  {
    key: 'ingame-aram',
    desc: '大乱斗进对局：无分路；我方一人无近期数据（应说数据不足）；一人有挂机嫌疑负面标签',
    session: { typeCn: '极地大乱斗', isMultiTeam: false, mySubteamId: 1, subteams: [{ subteamId: 1, players: aramMy }, { subteamId: 2, players: aramEnemy }] },
    opggMode: 'aram',
    target: aramMy[2],
    myNames: aramMy.map(p => p.summoner.gameName),
    enemyNames: aramEnemy.map(p => p.summoner.gameName),
    mustTeam: { 挂机标签: /挂机|摆烂/, 数据不足: /数据不足|无数据|没有数据|样本/ },
    mustPlayer: { 数据不足: /数据不足|无数据|没有数据|样本/ },
    forbidden: /上单|中单|打野|辅助位|下路|上路|中路|对线|补位|坦克|刺客|法师|射手|大招|被动|连招/
  }
]

// ───────────────────────── 打分 ─────────────────────────

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g
/** 输出里在 prompt 中找不到的数字个数（与线上 stripUngroundedSentences 同口径，容差 0.05） */
function ungrounded(out: string, prompt: string): string[] {
  const allowed = [...extractNumbers(prompt)]
  return (out.replace(/^#.*$/gm, '').match(NUMBER_TOKEN) ?? []).filter(tok => {
    const n = Number.parseFloat(tok.replace(/,/g, ''))
    return !allowed.some(a => Math.abs(a - n) <= 0.05)
  })
}
function sentences(md: string) {
  return md.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).flatMap(l => l.split(/(?<=[。!?;！？；])/)).filter(s => s.trim()).length
}
function missingHeadings(md: string, heads: string[]) {
  return heads.filter(h => !md.includes(h)).length
}
function section(md: string, head: string) {
  const i = md.indexOf(head)
  if (i < 0) return ''
  const rest = md.slice(i + head.length)
  const j = rest.search(/\n##\s/)
  return j < 0 ? rest : rest.slice(0, j)
}
/** 过程编造：材料无 timeline，这些描述必为编造 */
const PROCESS = /越塔|开团时|每次开团|游走|gank|被抓|抓了|对线(期)?被压|一直在?刷|第\s?\d+\s?分钟|小龙团|大龙团|偷龙|一级团/
/** 结构化字段名 / 英文取值漏进正文（给玩家看的文字里不该出现） */
const FIELD_LEAK = /roleBenchmark|vsLaneOpponent|[a-z]+Diff\b|damageShare|killParticipation|finalCall|\b(low|normal|high)\b/g
const ITEM = /装备|出装|神话|鞋子|符文|饮血|无尽|三相/

interface Rec {
  model: string; feature: string; key: string; run: number; ok: boolean; err: string; ms: number; ttft: number | null
  chars: number; missingHeads: number; ungrounded: string[]; strippedSentences: number; totalSentences: number
  sideErr: number; misattributed: number; fieldLeak: number; processFab: number; itemMention: number; forbiddenHit: number; mustHit: number; mustTotal: number; mustMissed: string[]
  extra?: Record<string, unknown>
}

function base(model: string, feature: string, key: string, run: number, r: Awaited<ReturnType<typeof callModel>>, prompt: string, heads: string[]): Rec {
  const md = r.content
  const allowed = extractNumbers(prompt)
  return {
    model, feature, key, run, ok: r.ok, err: r.err, ms: r.ms, ttft: r.ttft, chars: md.length,
    missingHeads: missingHeadings(md, heads), ungrounded: ungrounded(md, prompt),
    strippedSentences: sentences(md) - sentences(stripUngroundedSentences(md, allowed)), totalSentences: sentences(md),
    sideErr: 0, misattributed: 0, fieldLeak: (md.match(FIELD_LEAK) ?? []).length, processFab: (md.match(new RegExp(PROCESS, 'g')) ?? []).length, itemMention: 0, forbiddenHit: 0,
    mustHit: 0, mustTotal: 0, mustMissed: []
  }
}

function mentions(text: string, snap: Snap, win: boolean) {
  return snap.players.filter(p => p.win === win && (text.includes(p.champion) || new RegExp(`${p.name}(?!\\d)`).test(text))).map(p => p.champion)
}

const OVERVIEW_HEADS = ['## 一句话定论', '## 谁尽力了', '## 谁要背锅', '## 谁被打爆', '## 关键证据']
const PLAYER_HEADS = ['## 一句话定档', '## 数据面板解读', '## 对位对比', '## 责任归因', '## 改进建议']
const INGAME_HEADS = ['## 一句话判断', '## 优势点', '## 风险点', '## 重点盯防', '## 建议']
/** 单人复盘目标：当前用户 + 一个被点名的负面玩家 */
const PLAYER_TARGETS: Record<string, number[]> = { stomp: [4, 9], 'carry-lost': [3, 2], traps: [3, 7], aram: [2, 3] }

async function runMatchCase(model: string, c: Case, run: number, dir: URL): Promise<Rec[]> {
  const recs: Rec[] = []
  const s1prompt = buildAttributionUserPrompt(c.snap as any)
  let attr: any = null
  let s1: Awaited<ReturnType<typeof callModel>> | null = null
  for (let attempt = 0; attempt < 2 && !attr; attempt++) {
    s1 = await callModel(model, STAGE1_SYSTEM_PROMPT, s1prompt, true)
    if (!s1.ok) continue
    const parsed = parseAttribution(s1.content, structuredClone(c.snap) as any)
    if (parsed.ok) attr = parsed.value
  }
  writeFileSync(new URL(`${c.key}-r${run}-stage1.json`, dir), s1?.content || `ERROR ${s1?.err}`)
  recs.push({ ...base(model, 'stage1', c.key, run, s1!, s1prompt, []), ok: !!attr, err: attr ? '' : s1?.err || 'validate failed' })
  if (!attr) return recs

  // 整局总览
  const ovPrompt = buildCritiqueUserPrompt(attr, c.snap as any, {})
  const ov = await callModel(model, STAGE2_SYSTEM_PROMPT, ovPrompt)
  writeFileSync(new URL(`${c.key}-r${run}-overview.md`, dir), ov.content || `ERROR ${ov.err}`)
  const ovRec = base(model, 'overview', c.key, run, ov, ovPrompt, OVERVIEW_HEADS)
  // 胜负方放错章节：尽力 = 胜方专属；背锅 = 败方专属（validator 的标签硬条件）
  ovRec.sideErr = mentions(section(ov.content, '## 谁尽力了'), c.snap, false).length + mentions(section(ov.content, '## 谁要背锅'), c.snap, true).length
  ovRec.misattributed = findMisattributions(ov.content, { players: buildEntityFacts(c.snap as any) }).length
  ovRec.forbiddenHit = c.forbidden ? (ov.content.match(new RegExp(c.forbidden, 'g')) ?? []).length : 0
  recs.push(ovRec)

  // 单人复盘
  for (const pid of PLAYER_TARGETS[c.key]) {
    const prompt = buildCritiqueUserPrompt(attr, c.snap as any, { mode: 'player', participantId: pid })
    const r = await callModel(model, STAGE2_SYSTEM_PROMPT, prompt)
    writeFileSync(new URL(`${c.key}-r${run}-player${pid}.md`, dir), r.content || `ERROR ${r.err}`)
    const rec = base(model, 'player', `${c.key}-p${pid}`, run, r, prompt, PLAYER_HEADS)
    rec.itemMention = (r.content.match(new RegExp(ITEM, 'g')) ?? []).length
    rec.misattributed = findMisattributions(r.content, { players: buildEntityFacts(c.snap as any), subjectId: pid }).length
    rec.forbiddenHit = c.forbidden ? (r.content.match(new RegExp(c.forbidden, 'g')) ?? []).length : 0
    const p = c.snap.players.find(x => x.participantId === pid)!
    // 胜负写反：目标胜方却写「输」，或败方写「赢下/带飞赢」
    const blame = section(r.content, '## 责任归因') + section(r.content, '## 一句话定档')
    rec.sideErr = p.win ? (/(本局|这局|队伍)(惜?败|输)/.test(blame) ? 1 : 0) : /(带队|率队|帮队伍)?(赢下|取胜|拿下比赛)/.test(blame) ? 1 : 0
    const verdict = attr.verdicts.find((v: any) => v.participantId === pid)
    rec.extra = { label: verdict?.label ?? '(未点名)' }
    recs.push(rec)
  }
  return recs
}

async function runGameCase(model: string, g: GameCase, run: number, dir: URL): Promise<Rec[]> {
  const recs: Rec[] = []
  const tPrompt = await buildTeamAnalysisPrompt(g.session, { useNotes: false, opggMode: g.opggMode })
  const pPrompt = await buildPlayerAnalysisPrompt(g.target, { useNotes: false })
  for (const [feature, prompt, must] of [
    ['ingame-team', tPrompt, g.mustTeam],
    ['ingame-player', pPrompt, g.mustPlayer]
  ] as const) {
    const r = await callModel(model, DEFAULT_SYSTEM_PROMPT, prompt)
    writeFileSync(new URL(`${g.key}-r${run}-${feature}.md`, dir), r.content || `ERROR ${r.err}`)
    const rec = base(model, feature, g.key, run, r, prompt, INGAME_HEADS)
    rec.forbiddenHit = (r.content.match(new RegExp(g.forbidden, 'g')) ?? []).length
    rec.mustTotal = Object.keys(must).length
    for (const [label, re] of Object.entries(must)) {
      if (re.test(r.content)) rec.mustHit++
      else rec.mustMissed.push(label)
    }
    if (feature === 'ingame-team') {
      // 敌我前缀写反（RULE_SIDE_PREFIX）
      rec.sideErr =
        g.enemyNames.filter(n => new RegExp(`我方[^，。\\n]{0,4}${n}`).test(r.content)).length +
        g.myNames.filter(n => new RegExp(`敌方[^，。\\n]{0,4}${n}`).test(r.content)).length
    }
    recs.push(rec)
  }
  return recs
}

test('ai features eval', async () => {
  if (process.argv.includes('--self-check') || process.env.SELF_CHECK) {
    for (const g of GAMES) {
      const t = await buildTeamAnalysisPrompt(g.session, { useNotes: false, opggMode: g.opggMode })
      const p = await buildPlayerAnalysisPrompt(g.target, { useNotes: false })
      console.log(`${g.key}: team ${t.length} chars, player ${p.length} chars`)
      writeFileSync(new URL(`${g.key}-team-prompt.txt`, OUT), t)
    }
    return
  }
  if (!KEY && !MODELS.every(m => m.startsWith('claude-'))) throw new Error('需要 DASHSCOPE_API_KEY')
  type Job = () => Promise<Rec[]>
  const jobs: Array<{ label: string; job: Job }> = []
  for (const model of MODELS) {
    const dir = new URL(`${model.replace(/\//g, '_')}/`, OUT)
    mkdirSync(dir, { recursive: true })
    for (let run = 1; run <= RUNS; run++) {
      for (const c of CASES) jobs.push({ label: `${model} ${c.key} r${run}`, job: () => runMatchCase(model, c, run, dir) })
      if (!process.env.SKIP_GAMES) for (const g of GAMES) jobs.push({ label: `${model} ${g.key} r${run}`, job: () => runGameCase(model, g, run, dir) })
    }
  }
  // 按 run 交错各模型，避免某个模型集中撞上限流时段
  jobs.sort((a, b) => Number(a.label.match(/r(\d+)$/)![1]) - Number(b.label.match(/r(\d+)$/)![1]))
  const all: Rec[] = []
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const j = jobs[next++]
        const recs = await j.job()
        all.push(...recs)
        console.log(`[${++done}/${jobs.length}] ${j.label} ${recs.map(r => `${r.feature}:${r.ok ? (r.ms / 1000).toFixed(1) + 's' : 'ERR'}`).join(' ')}`)
      }
    })
  )

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
  const features = ['stage1', 'overview', 'player', 'ingame-team', 'ingame-player']
  const summary: any[] = []
  console.log('\nfeature        model                     失败  均耗时  首字   字数  缺章节  材料外数字  被剔句占比  胜负/敌我错  过程编造  提装备  违禁词  理解命中  字段泄漏  张冠李戴')
  for (const f of features) {
    for (const model of MODELS) {
      const rs = all.filter(r => r.model === model && r.feature === f)
      const ok = rs.filter(r => r.ok)
      const row = {
        feature: f, model, n: rs.length, fail: rs.length - ok.length,
        ms: avg(ok.map(r => r.ms)), ttft: avg(ok.filter(r => r.ttft != null).map(r => r.ttft!)), chars: avg(ok.map(r => r.chars)),
        missingHeads: avg(ok.map(r => r.missingHeads)), ungrounded: avg(ok.map(r => r.ungrounded.length)),
        strippedRatio: avg(ok.map(r => r.strippedSentences / Math.max(1, r.totalSentences))),
        sideErr: avg(ok.map(r => r.sideErr)), misattributed: avg(ok.map(r => r.misattributed)), fieldLeak: avg(ok.map(r => r.fieldLeak)), processFab: avg(ok.map(r => r.processFab)), itemMention: avg(ok.map(r => r.itemMention)),
        forbiddenHit: avg(ok.map(r => r.forbiddenHit)),
        must: ok.some(r => r.mustTotal) ? avg(ok.filter(r => r.mustTotal).map(r => r.mustHit / r.mustTotal)) : NaN,
        mustMissed: ok.flatMap(r => r.mustMissed)
      }
      summary.push(row)
      const f1 = (x: number) => (Number.isNaN(x) ? '   -' : x.toFixed(2).padStart(5))
      const pc = (x: number) => (Number.isNaN(x) ? '   -' : `${(x * 100).toFixed(0)}%`.padStart(5))
      console.log(
        `${f.padEnd(14)} ${model.padEnd(25)} ${String(row.fail).padStart(3)}  ${(row.ms / 1000).toFixed(1).padStart(5)}s ${(row.ttft / 1000).toFixed(1).padStart(4)}s ${row.chars.toFixed(0).padStart(5)}   ${f1(row.missingHeads)}    ${f1(row.ungrounded)}     ${pc(row.strippedRatio)}      ${f1(row.sideErr)}     ${f1(row.processFab)}   ${f1(row.itemMention)}  ${f1(row.forbiddenHit)}   ${pc(row.must)}   ${f1(row.fieldLeak)}   ${f1(row.misattributed)}`
      )
    }
  }
  writeFileSync(new URL('summary.json', OUT), JSON.stringify({ RUNS, summary, records: all }, null, 2))
})
