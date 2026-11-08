/**
 * 赛后复盘 A/B 评测语料采集。
 *
 * 用法（需客户端已登录）：
 *   node scripts/ai-eval/capture.mjs --auto          # 按配额自动挑 30 局
 *   node scripts/ai-eval/capture.mjs --ids 1,2,3     # 指定 gameId
 *   node scripts/ai-eval/capture.mjs --anon          # 额外导出匿名 Rust 单测 fixture
 * 凭据：优先环境变量 LCU_PORT / LCU_TOKEN；否则从 WeGame 的 LeagueClientUx 日志里抠
 * （国服客户端提权启动，读不到命令行，lockfile 可能陈旧）。
 */
import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCreds, lcuGet, sgpGet, SGP_HOST } from '../baseline/lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'fixtures')
const RUST_FIXTURE = path.join(HERE, '../../src-tauri/tests/fixtures/sgp_details_sample.json')
/** 配额：单双排胜/负、大乱斗、海斗、其他（匹配/灵活等） */
const QUOTA = { rankedWin: 8, rankedLoss: 7, aram: 5, kiwi: 5, other: 5 }

function bucketOf(queueId, win) {
  if (queueId === 420) return win ? 'rankedWin' : 'rankedLoss'
  if (queueId === 450) return 'aram'
  if (queueId === 2400) return 'kiwi'
  return 'other'
}

async function main() {
  const args = process.argv.slice(2)
  const creds = findCreds()
  const me = await lcuGet(creds, '/lol-summoner/v1/current-summoner')
  // 冷 puuid 的首个请求区间会钉死 LCU 缓存大小，必须是 0-49
  const mh = await lcuGet(
    creds,
    `/lol-match-history/v1/products/lol/${me.puuid}/matches?begIndex=0&endIndex=49`
  )
  const platformId = mh.platformId || mh.games?.games?.[0]?.platformId
  const host = SGP_HOST[platformId]
  if (!host) throw new Error(`未知大区 ${platformId}`)
  const token = (await lcuGet(creds, '/entitlements/v1/token')).accessToken

  let ids = []
  const idsArg = args.indexOf('--ids')
  if (idsArg >= 0) ids = args[idsArg + 1].split(',').map(Number)
  if (args.includes('--auto')) {
    const left = { ...QUOTA }
    for (const start of [0, 100]) {
      const page = await sgpGet(
        host,
        `match-history-query/v1/products/lol/player/${me.puuid}/SUMMARY?startIndex=${start}&count=100`,
        token
      )
      for (const g of page.games ?? []) {
        const j = g.json
        if ((j.gameDuration ?? 0) < 300) continue
        const mine = (j.participants ?? []).find(p => p.puuid === me.puuid)
        const b = bucketOf(j.queueId, !!mine?.win)
        if (left[b] > 0) {
          left[b]--
          ids.push(j.gameId)
        }
      }
    }
    console.log('配额剩余（>0 表示该类不足）：', left)
  }
  if (ids.length === 0) throw new Error('没有要采集的对局：传 --auto 或 --ids')

  fs.mkdirSync(path.join(OUT, 'games'), { recursive: true })
  const index = []
  let sameOrder = 0
  let total = 0
  let hasDamageReceived = 0
  for (const id of ids) {
    const detail = await lcuGet(creds, `/lol-match-history/v1/games/${id}`)
    const details = await sgpGet(
      host,
      `match-history-query/v1/products/lol/${platformId}_${id}/DETAILS`,
      token
    )
    const idx = detail.participantIdentities.findIndex(x => x.player?.puuid === me.puuid)
    if (idx < 0) {
      console.warn(`跳过 ${id}：对局里找不到本人`)
      continue
    }
    const game = {
      ...detail,
      participants: [detail.participants[idx]],
      participantIdentities: [detail.participantIdentities[idx]],
      gameDetail: detail
    }
    fs.writeFileSync(
      path.join(OUT, 'games', `${id}.json`),
      JSON.stringify({ platformId, game, details })
    )
    index.push({
      gameId: id,
      queueId: detail.queueId,
      win: !!detail.participants[idx].stats.win,
      durationSec: detail.gameDuration
    })
    // 核对假设 1：DETAILS participantId 与 LCU 身份顺序是否一致
    for (const p of details.json.participants ?? []) {
      total++
      if (detail.participantIdentities[p.participantId - 1]?.player?.puuid === p.puuid) sameOrder++
    }
    // 核对假设 2：击杀事件带 victimDamageReceived
    const kill = details.json.frames.flatMap(f => f.events).find(e => e.type === 'CHAMPION_KILL')
    if (kill?.victimDamageReceived) hasDamageReceived++
    console.log(`✓ ${id} queue=${detail.queueId}`)
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2))

  const champs = await lcuGet(creds, '/lol-game-data/assets/v1/champion-summary.json')
  fs.writeFileSync(
    path.join(OUT, 'champions.json'),
    JSON.stringify(champs.filter(c => c.id > 0).map(c => ({ value: c.id, label: c.name })))
  )
  const items = await lcuGet(creds, '/lol-game-data/assets/v1/items.json')
  fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify(items))
  // 核对假设 3：物品字段
  const sample = items.find(i => i.id === 3031) ?? items[0]
  console.log('物品样例字段：', {
    id: sample.id,
    name: sample.name,
    priceTotal: sample.priceTotal,
    to: sample.to,
    categories: sample.categories
  })
  console.log(`参与者顺序一致：${sameOrder}/${total}`)
  console.log(`击杀事件含 victimDamageReceived：${hasDamageReceived}/${index.length}`)

  if (args.includes('--anon')) {
    const first = index.find(g => g.queueId === 420) ?? index[0]
    const src = JSON.parse(fs.readFileSync(path.join(OUT, 'games', `${first.gameId}.json`), 'utf8'))
    const d = anonymizeDetails(src.details)
    d.json.frames = d.json.frames.slice(0, 8)
    fs.mkdirSync(path.dirname(RUST_FIXTURE), { recursive: true })
    fs.writeFileSync(RUST_FIXTURE, JSON.stringify(d))
    console.log(`匿名 fixture → ${RUST_FIXTURE}（gameId ${first.gameId}，前 8 帧）`)
  }
}

/**
 * 把 SGP DETAILS 匿名化到可入库：puuid → puuid-<participantId>、match_id → ANON_1、
 * gameId → 1、真实时间戳（metadata.timestamp / 事件 realTimestamp）清零，
 * 并兜底替换任何含真实 gameId 数字的字符串/数值。不改原对象。
 * @param {any} details - 原始 DETAILS（{ metadata, json }）
 * @returns {any} 匿名副本
 */
export function anonymizeDetails(details) {
  const d = structuredClone(details)
  const realGameId = String(d.json.gameId)
  const anonPuuid = new Map()
  for (const p of d.json.participants) anonPuuid.set(p.puuid, `puuid-${p.participantId}`)
  ;(d.metadata.participants ?? []).forEach((puuid, i) => {
    if (!anonPuuid.has(puuid)) anonPuuid.set(puuid, `puuid-${i + 1}`)
  })
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, x] of Object.entries(v)) {
        if (k === 'realTimestamp') out[k] = 0
        else if (k === 'gameId' && typeof x === 'number') out[k] = 1
        else out[k] = walk(x)
      }
      return out
    }
    if (typeof v === 'string') {
      if (anonPuuid.has(v)) return anonPuuid.get(v)
      return v.includes(realGameId) ? v.split(realGameId).join('1') : v
    }
    if (typeof v === 'number' && String(v) === realGameId) return 1
    return v
  }
  const out = walk(d)
  if (out.metadata) {
    out.metadata.match_id = 'ANON_1'
    delete out.metadata.timestamp
  }
  return out
}

// 仅作为脚本直接运行时采集；被 import（复用 anonymizeDetails）时不连客户端
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(e)
    process.exit(1)
  })
}
