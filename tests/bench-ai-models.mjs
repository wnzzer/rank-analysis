// 一次性基准测试：对比 qwen flash/turbo/plus/max 在 Stage1 归因 + Stage2 锐评上的
// 速度（TTFT / 总耗时）、可靠性（超时/报错）、Stage1 输出有效性（JSON / verdict 数 / evidence 数）。
// 真实 prompt = 直接复刻源码模板 + 一份贴近真实的 10 人排位 snapshot。
// 中文输出写到 out/*.txt（UTF-8），数值表打到 stdout。

import { writeFileSync, mkdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

const WORKER = 'https://ai.nuliyangguang.top'
const MODELS = ['qwen-flash', 'qwen-turbo', 'qwen-plus', 'qwen-max']
const RUNS = 2
const REQ_TIMEOUT_MS = 90000
const FIRST_TOKEN_TIMEOUT_MS = 30000
const OUT_DIR = new URL('./out/', import.meta.url)
mkdirSync(OUT_DIR, { recursive: true })

// ---------- 真实 snapshot（10 人排位，蓝队 100 胜 / 红队 200 负）----------
function rp({ mainPosition, isOffRole = false, offRoleSeverity = 'none', firstTime = false, currentLanePlayedRatio = 0.6 }) {
  return {
    positionDistribution: [{ pos: mainPosition, ratio: 0.6, games: 12 }],
    mainPosition,
    currentLanePlayedRatio,
    championDistribution: [{ championId: 64, name: '李青', games: 8, winRate: 0.5, avgKda: 3.1 }],
    currentChampionMastery: firstTime
      ? { gamesInRecent: 0, winRate: 0, avgKda: 0, isOnetrick: false, isFirstTimeInRecent: true }
      : { gamesInRecent: 5, winRate: 0.6, avgKda: 3.2, isOnetrick: false, isFirstTimeInRecent: false },
    recentWinRate: 0.55,
    recentKda: 3.0,
    streak: { kind: 'win', count: 2 },
    isOffRole,
    offRoleSeverity
  }
}

function P(id, teamId, win, pos, o) {
  return {
    participantId: id, teamId, name: `玩家${id}`, champion: o.champ, isMe: o.isMe ?? false, win,
    kda: o.kda, kills: o.k, deaths: o.d, assists: o.a, gold: o.gold, cs: o.cs,
    damage: o.dmg, taken: o.taken, heal: o.heal ?? 1500, turretDamage: o.turret ?? 1200,
    damageShare: o.dShare, damageTakenShare: o.tShare, goldShare: o.gShare, killParticipation: o.kp,
    perks: { primary: 8005, subStyle: 8200 }, augments: [],
    teamPosition: pos, lane: pos, role: pos === 'BOTTOM' ? 'CARRY' : pos === 'UTILITY' ? 'SUPPORT' : 'SOLO',
    summonerSpells: o.spells ?? ['闪现', '点燃'],
    dpm: o.dpm, gpm: o.gpm, csm: o.csm,
    items: o.items ?? [3153, 3006, 3031, 1038, 1037, 0], trinketId: 3340,
    wardScore: o.ward ?? 22, controlWardsPlaced: 1, visionWardsBought: 3,
    multiKills: { double: o.double ?? 0, triple: o.triple ?? 0, quadra: 0, penta: 0 },
    recentProfile: o.rp ?? null
  }
}

const players = [
  // 蓝队 100（胜）
  P(1, 100, true, 'TOP', { champ: '奥恩', kda: 3.5, k: 4, d: 4, a: 10, gold: 13800, cs: 210, dmg: 21000, taken: 32000, dShare: 18, tShare: 30, gShare: 21, kp: 58, dpm: 700, gpm: 460, csm: 7.0 }),
  P(2, 100, true, 'JUNGLE', { champ: '李青', kda: 5.0, k: 7, d: 3, a: 8, gold: 12500, cs: 150, dmg: 18000, taken: 24000, dShare: 15, tShare: 22, gShare: 19, kp: 75, dpm: 600, gpm: 416, csm: 5.0, rp: rp({ mainPosition: 'JUNGLE' }) }),
  P(3, 100, true, 'MIDDLE', { champ: '阿狸', kda: 6.0, k: 8, d: 2, a: 4, gold: 14200, cs: 240, dmg: 31000, taken: 14000, dShare: 26, tShare: 13, gShare: 22, kp: 60, dpm: 1033, gpm: 473, csm: 8.0, double: 1 }),
  P(4, 100, true, 'BOTTOM', { champ: '凯特琳', kda: 7.5, k: 12, d: 2, a: 3, gold: 16800, cs: 290, dmg: 38000, taken: 12000, dShare: 32, tShare: 11, gShare: 26, kp: 75, dpm: 1266, gpm: 560, csm: 9.6, double: 2, triple: 1, isMe: true }),
  P(5, 100, true, 'UTILITY', { champ: '璐璐', kda: 8.0, k: 1, d: 2, a: 15, gold: 9000, cs: 40, dmg: 9000, taken: 16000, dShare: 9, tShare: 15, gShare: 14, kp: 80, dpm: 300, gpm: 300, csm: 1.3, spells: ['闪现', '虚弱'], ward: 60 }),
  // 红队 200（负）
  P(6, 200, false, 'TOP', { champ: '杰斯', kda: 1.2, k: 3, d: 9, a: 4, gold: 10500, cs: 180, dmg: 14000, taken: 28000, dShare: 14, tShare: 28, gShare: 17, kp: 35, dpm: 466, gpm: 350, csm: 6.0, rp: rp({ mainPosition: 'MIDDLE', isOffRole: true, offRoleSeverity: 'severe', currentLanePlayedRatio: 0.1 }) }),
  P(7, 200, false, 'JUNGLE', { champ: '盲僧', kda: 2.0, k: 4, d: 6, a: 8, gold: 10800, cs: 140, dmg: 13000, taken: 21000, dShare: 13, tShare: 21, gShare: 18, kp: 50, dpm: 433, gpm: 360, csm: 4.6 }),
  P(8, 200, false, 'MIDDLE', { champ: '辛德拉', kda: 3.2, k: 6, d: 5, a: 4, gold: 12900, cs: 220, dmg: 29000, taken: 15000, dShare: 30, tShare: 15, gShare: 21, kp: 41, dpm: 966, gpm: 430, csm: 7.3 }),
  P(9, 200, false, 'BOTTOM', { champ: '韦鲁斯', kda: 0.9, k: 2, d: 8, a: 5, gold: 9800, cs: 200, dmg: 16000, taken: 14000, dShare: 16, tShare: 14, gShare: 16, kp: 30, dpm: 533, gpm: 326, csm: 6.6, rp: rp({ mainPosition: 'BOTTOM', firstTime: true }) }),
  P(10, 200, false, 'UTILITY', { champ: '锤石', kda: 2.5, k: 1, d: 7, a: 13, gold: 7600, cs: 30, dmg: 7000, taken: 18000, dShare: 7, tShare: 18, gShare: 12, kp: 47, dpm: 233, gpm: 253, csm: 1.0, spells: ['闪现', '点燃'], ward: 55 })
]

function team(teamId, win) {
  const tp = players.filter(p => p.teamId === teamId)
  const sum = (f) => tp.reduce((s, p) => s + f(p), 0)
  return {
    teamId, result: win ? '胜方' : '败方',
    totalKills: sum(p => p.kills), totalDeaths: sum(p => p.deaths), totalAssists: sum(p => p.assists),
    totalDamage: sum(p => p.damage), totalTaken: sum(p => p.taken), totalGold: sum(p => p.gold),
    players: tp
  }
}

const snapshot = {
  gameId: 7654321,
  queueName: '单双排位',
  queueId: 420,
  gameMode: 'CLASSIC',
  durationSeconds: 1920,
  modeContext: {
    kind: 'ranked',
    description: '召唤师峡谷 单双排位赛（queueId=420）。5v5 有明确路位与对线期，可评价 BP / 对线 / 装备 / 运营。',
    hasLanes: true,
    hasItemBuild: true,
    hasAugmentSystem: false,
    championAssignment: 'draft',
    isTeamMode: true
  },
  teams: [team(100, true), team(200, false)],
  players
}

// ---------- 复刻 stage1-attribution.ts 模板 ----------
function buildStage1Prompt(snap, addonRules) {
  const mc = snap.modeContext
  return `你是 LOL 单场归因分析师。基于下面这场比赛的快照 + 玩家近期摘要，
判断每个值得点名的玩家归类为：尽力 / 犯罪 / 被爆 / 被连累 / 缚地灵 / 正常，
并给出数据证据。

【模式上下文】
${mc.description}

hasLanes: ${mc.hasLanes}
hasItemBuild: ${mc.hasItemBuild}
hasAugmentSystem: ${mc.hasAugmentSystem}
championAssignment: ${mc.championAssignment}
isTeamMode: ${mc.isTeamMode}

【硬性规则】
- 只能基于 snapshot 实际存在的字段做结论，不要编造对线细节、团战时间点、装备效果。
- hasLanes=false 时禁止提到任何路位名称（含上/中/下/打野/辅助等位置概念）。
- championAssignment='random' 或 'random-with-bench' 时禁止提到"补位"、"英雄选择失误"、"BP劣势"。
- hasItemBuild=false 时禁止评价装备走向或出装顺序。
- snapshot.players[i].recentProfile=null 时禁止判断该玩家"是否补位"、"熟练度"。
- snapshot.players[i].recentProfile.isOffRole=true 时可采用申辩降级；反之不要瞎编"可能在补位"。

【TS 已算好的事实（直接消费，不要重新推断）】
- isOffRole: bool — 本局位置在近期占比 < 0.2
- offRoleSeverity: 'none' | 'mild' | 'severe' — < 0.2 severe / < 0.4 mild / 其它 none
- currentChampionMastery.isFirstTimeInRecent: bool — 近 20 场没玩过该英雄
- currentChampionMastery.isOnetrick: bool — 单一英雄占比 > 0.5
- mainPosition: TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY|UNCLEAR — 主玩位置（占比≥40%才认）
直接采用这些字段的值，不要重新计算。

【标签定义（量化标准）】
- 尽力：数据明显高于队内均值（伤害占比/经济占比/参团率中任意 2 项进入队内前 2）+ 该队伍胜
- 犯罪：数据明显低于队内均值（死亡数最多 + 参团 < 30% + KDA 队内倒数）+ 该队伍输
- 被爆：deaths 高 + damageShare 低 + goldShare 低，且无 isOffRole / first-time-champion 等申辩
- 被连累：个人数据合格但队伍输（damageShare ≥ 25% + KDA ≥ 团队均值，但 win=false）
- 缚地灵：killParticipation < 团队平均 - 15% + assists 低 + cs/damage 不低
- 正常：以上都不符合

【输出严格 JSON（无前后缀，无 markdown 代码块）】
{
  "winReason": "为什么胜方赢/败方输的核心因果链，2-3 句",
  "verdicts": [
    {
      "participantId": 1,
      "name": "玩家名",
      "label": "尽力" | "犯罪" | "被爆" | "被连累" | "缚地灵" | "正常",
      "evidenceMetrics": [
        { "metric": "kda", "value": 1.2, "teamRank": 5, "note": "队内倒数第一" }
      ],
      "mitigatingFactors": [
        { "factor": "off-role", "support": "isOffRole=true, mainPosition=JUNGLE, 本局打 TOP" }
      ],
      "finalCall": "一句话归因，必须引用 ≥2 个数字"
    }
  ]
}

evidenceMetrics 至少 3 条。可选指标：kda / kills / deaths / assists / damageShare /
damageTakenShare / goldShare / killParticipation / dpm / gpm / csm / multiKills.* /
wardScore / turretDamage。

mitigatingFactors 仅在 label 为负面（犯罪/被爆/缚地灵）时填，且必须基于 snapshot 数据：
- factor='off-role'              要求该玩家 recentProfile.isOffRole === true
- factor='first-time-champion'   要求 currentChampionMastery.isFirstTimeInRecent === true
- factor='team-collapse'         要求同队其他 ≥2 人 verdict.label === '犯罪'
- factor='targeted'              当前 snapshot 无 timeline 数据，暂禁用此 factor

【对哪些玩家出 verdict】
- 必出：双方队伍中击杀 TOP1 玩家 / 双方队伍中死亡 TOP1 玩家 / 当前用户（isMe=true）
- 可选追加：damageShare > 35% 或 < 12% / KDA 极端 / 多杀次数 ≥ triple
- 总数 4-7 个 verdict（去重后），按团队成绩相关性从高到低排序

【对局快照】
${JSON.stringify(snap, null, 2)}

【模式追加规则】
${addonRules}
`
}

const RANKED_ADDON = `
【启用：lane 对位分析】
- 对每个出 verdict 的玩家，在敌方队伍中找同 teamPosition 的对位玩家
- 比较 1v1 表现：金币差 / cs 差 / KDA 差 / damageShare 差
【position 描述用语】允许：上路 / 中路 / 下路 / 打野 / 辅助
`

// ---------- 复刻 stage2-critique.ts 模板（用固定 attribution，隔离模型变量）----------
const CANNED_ATTR = {
  winReason: '蓝队下路凯特琳滚雪球（12/2/3，伤害占比32%）+ 中路阿狸压制，红队下半区全面崩盘。',
  verdicts: [
    { participantId: 4, name: '玩家4', label: '尽力', evidenceMetrics: [{ metric: 'damageShare', value: 32, teamRank: 1, note: '队内第一' }, { metric: 'kda', value: 7.5, teamRank: 1 }, { metric: 'kills', value: 12, teamRank: 1 }], mitigatingFactors: [], finalCall: '凯特琳 12 杀 32% 伤害，碾压局核心。' },
    { participantId: 3, name: '玩家3', label: '尽力', evidenceMetrics: [{ metric: 'damageShare', value: 26, teamRank: 2 }, { metric: 'kda', value: 6.0, teamRank: 2 }, { metric: 'dpm', value: 1033, teamRank: 2 }], mitigatingFactors: [], finalCall: '阿狸 26% 伤害稳定输出。' },
    { participantId: 9, name: '玩家9', label: '犯罪', evidenceMetrics: [{ metric: 'kda', value: 0.9, teamRank: 5 }, { metric: 'killParticipation', value: 30, teamRank: 5 }, { metric: 'deaths', value: 8, teamRank: 1 }], mitigatingFactors: [{ factor: 'first-time-champion', support: 'isFirstTimeInRecent=true' }], finalCall: '韦鲁斯 0.9 KDA、参团 30%，下路直接打穿。' },
    { participantId: 6, name: '玩家6', label: '被爆', evidenceMetrics: [{ metric: 'deaths', value: 9, teamRank: 1 }, { metric: 'damageShare', value: 14, teamRank: 4 }, { metric: 'kda', value: 1.2, teamRank: 4 }], mitigatingFactors: [{ factor: 'off-role', support: 'isOffRole=true severe, mainPosition=MIDDLE 本局打TOP' }], finalCall: '杰斯 9 死、14% 伤害，但在补位上单。' },
    { participantId: 8, name: '玩家8', label: '被连累', evidenceMetrics: [{ metric: 'damageShare', value: 30, teamRank: 1 }, { metric: 'kda', value: 3.2, teamRank: 2 }, { metric: 'dpm', value: 966, teamRank: 2 }], mitigatingFactors: [], finalCall: '辛德拉 30% 伤害但队伍崩盘，被连累。' }
  ]
}

function buildStage2Prompt(attribution, snap, vocabSamples) {
  const vocabHint = vocabSamples.length > 0
    ? `【词库提示】（可采用、可创造新词）\n${vocabSamples.join('、')}`
    : `【词库提示】\n本次无固定词库，自由发挥，但保持网感与梗感。`
  return `你是 LOL 锐评写手。基于已经给出的归因 JSON，转写为锐评 markdown 给玩家看。

【输入：归因结果】
${JSON.stringify(attribution, null, 2)}

【模式上下文】
${snap.modeContext.description}

【输出严格按下面 markdown 模板，章节顺序与标题不可改】

## 一句话定论
{用一句锐评点明胜负 + 当局最显眼的人，要有梗感}

## 谁尽力了
- {名字}：{锐评一句} — {数字证据}

## 谁要背锅
- {名字}：{锐评一句} — {数字证据}

## 谁被打爆 / 被连累
- {名字 + 哪类}：{锐评一句} — {数字证据 + 申辩理由（如有）}

## 关键证据
- 3-5 条 bullet，每条带至少 1 个数字

【语气原则】
- 锐评感优先：有梗、戏谑、网感
- 不辱骂、不地域黑、不人身攻击
- 数字证据必须来自归因 JSON 的 evidenceMetrics 字段，不能编造新数字

${vocabHint}
`
}

const STAGE1_SYS = '你是 LOL 单场归因分析师。严格按照用户给定的 JSON schema 返回结果，不要返回 markdown / 解释 / 前后缀，只返回纯 JSON 对象。'
const STAGE2_SYS = '你是 LOL 锐评写手，按用户给定的 markdown 模板输出，不要返回 JSON / 解释 / 前后缀。'

// ---------- 流式请求 + 计时 ----------
async function streamOnce(model, systemPrompt, userPrompt) {
  const ctrl = new AbortController()
  const hardTimer = setTimeout(() => ctrl.abort(new Error('hard-timeout')), REQ_TIMEOUT_MS)
  let firstTokenTimer = setTimeout(() => ctrl.abort(new Error('first-token-timeout')), FIRST_TOKEN_TIMEOUT_MS)
  const t0 = performance.now()
  let ttft = null
  let content = ''
  try {
    const resp = await fetch(WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], stream: true }),
      signal: ctrl.signal
    })
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      clearTimeout(hardTimer); clearTimeout(firstTokenTimer)
      return { ok: false, error: `HTTP ${resp.status}: ${txt.slice(0, 120)}`, ttft: null, total: performance.now() - t0, content: '' }
    }
    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data: ')) continue
        const js = t.slice(6)
        if (js === '[DONE]') continue
        try {
          const d = JSON.parse(js)
          const c = d.choices?.[0]?.delta?.content || ''
          if (c) {
            if (ttft === null) { ttft = performance.now() - t0; clearTimeout(firstTokenTimer); firstTokenTimer = null }
            content += c
          }
        } catch { /* ignore */ }
      }
    }
    clearTimeout(hardTimer); if (firstTokenTimer) clearTimeout(firstTokenTimer)
    return { ok: true, ttft, total: performance.now() - t0, content }
  } catch (e) {
    clearTimeout(hardTimer); if (firstTokenTimer) clearTimeout(firstTokenTimer)
    return { ok: false, error: String(e?.message || e), ttft, total: performance.now() - t0, content }
  }
}

// ---------- Stage1 有效性评估（轻量复刻 validator 关键检查）----------
const ALLOWED = new Set(['尽力', '犯罪', '被爆', '被连累', '缚地灵', '正常'])
function evalStage1(content) {
  let s = content.trim()
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
  if (fence) s = fence[1].trim()
  try {
    const o = JSON.parse(s)
    const v = Array.isArray(o.verdicts) ? o.verdicts : []
    const minEv = v.length ? Math.min(...v.map(x => (Array.isArray(x.evidenceMetrics) ? x.evidenceMetrics.length : 0))) : 0
    const badLabel = v.find(x => !ALLOWED.has(x.label))
    const shapeOk = typeof o.winReason === 'string' && v.length >= 4 && v.length <= 7 && minEv >= 3 && !badLabel
    return { json: true, verdicts: v.length, minEvidence: minEv, shapeOk }
  } catch {
    return { json: false, verdicts: 0, minEvidence: 0, shapeOk: false }
  }
}

// ---------- 跑 ----------
const stage1Prompt = buildStage1Prompt(snapshot, RANKED_ADDON)
const stage2Prompt = buildStage2Prompt(CANNED_ATTR, snapshot, [])
console.log(`stage1 prompt chars=${stage1Prompt.length}  stage2 prompt chars=${stage2Prompt.length}\n`)

const rows = []
for (const model of MODELS) {
  for (let run = 1; run <= RUNS; run++) {
    const r1 = await streamOnce(model, STAGE1_SYS, stage1Prompt)
    const e1 = r1.ok ? evalStage1(r1.content) : { json: false, verdicts: 0, minEvidence: 0, shapeOk: false }
    writeFileSync(new URL(`./out/${model}-stage1-run${run}.txt`, import.meta.url), r1.content || `ERROR: ${r1.error}`)
    rows.push({ model, stage: 'S1', run, ok: r1.ok, err: r1.error || '', ttft: r1.ttft, total: r1.total, chars: r1.content.length, ...e1 })
    console.log(`[${model} S1 r${run}] ok=${r1.ok} ttft=${fmt(r1.ttft)} total=${fmt(r1.total)} chars=${r1.content.length} json=${e1.json} verdicts=${e1.verdicts} minEv=${e1.minEvidence} shapeOk=${e1.shapeOk} ${r1.error ? 'ERR=' + r1.error : ''}`)

    const r2 = await streamOnce(model, STAGE2_SYS, stage2Prompt)
    writeFileSync(new URL(`./out/${model}-stage2-run${run}.txt`, import.meta.url), r2.content || `ERROR: ${r2.error}`)
    rows.push({ model, stage: 'S2', run, ok: r2.ok, err: r2.error || '', ttft: r2.ttft, total: r2.total, chars: r2.content.length })
    console.log(`[${model} S2 r${run}] ok=${r2.ok} ttft=${fmt(r2.ttft)} total=${fmt(r2.total)} chars=${r2.content.length} ${r2.error ? 'ERR=' + r2.error : ''}`)
  }
}

function fmt(ms) { return ms === null || ms === undefined ? '   -  ' : (ms / 1000).toFixed(1) + 's' }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null }

console.log('\n================ 汇总（均值）================')
for (const model of MODELS) {
  for (const stage of ['S1', 'S2']) {
    const rs = rows.filter(r => r.model === model && r.stage === stage && r.ok)
    const fails = rows.filter(r => r.model === model && r.stage === stage && !r.ok).length
    const ttft = avg(rs.map(r => r.ttft).filter(x => x != null))
    const total = avg(rs.map(r => r.total))
    const extra = stage === 'S1' ? ` shapeOk=${rows.filter(r => r.model === model && r.stage === 'S1' && r.shapeOk).length}/${RUNS}` : ''
    console.log(`${model.padEnd(11)} ${stage}  ttft=${fmt(ttft)}  total=${fmt(total)}  fails=${fails}/${RUNS}${extra}`)
  }
}
console.log('\n中文输出见 tests/out/*.txt')
