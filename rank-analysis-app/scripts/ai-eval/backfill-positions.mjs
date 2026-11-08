/**
 * 给 A/B 评测语料 fixtures/slim/*.json 补 participants[].teamPosition（SGP 真实分路）。
 * 来源：先查 scripts/baseline/raw/games.jsonl（采集到的 SUMMARY，按 puuid）；--live 时缺的局现场请求单局 SUMMARY。
 * 用法：
 *   node scripts/ai-eval/backfill-positions.mjs [--live]
 *   node scripts/ai-eval/backfill-positions.mjs --probe <gameId>   # 打印单局 SUMMARY 响应结构
 * 注意：不打印、不落盘 token。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { findCreds, lcuGet, sgpGet, SGP_HOST } from '../baseline/lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SLIM_DIR = path.join(HERE, 'fixtures/slim')
const GAMES_DIR = path.join(HERE, 'fixtures/games')
const CORPUS = path.resolve(HERE, '../baseline/raw/games.jsonl')

/** 单局 SUMMARY 的玩家数组（兼容 {json:{participants}} 与 {participants} 两种外壳） */
const summaryParticipants = res => res?.json?.participants ?? res?.participants ?? []

/** 语料里目标局的 puuid → teamPosition（逐行流式读，坏行跳过） */
async function fromCorpus(ids) {
  const out = new Map()
  if (!fs.existsSync(CORPUS)) return out
  const rl = readline.createInterface({ input: fs.createReadStream(CORPUS) })
  for await (const line of rl) {
    const m = line.match(/^\{"gameId":(\d+)/)
    if (!m || !ids.has(Number(m[1]))) continue
    try {
      const g = JSON.parse(line)
      out.set(g.gameId, new Map(g.participants.map(p => [p.puuid, p.teamPosition ?? ''])))
    } catch {
      // 半行/坏行
    }
  }
  return out
}

/** 现场拉单局 SUMMARY 的函数（token 只在内存里） */
async function liveSession() {
  const creds = findCreds()
  const token = (await lcuGet(creds, '/entitlements/v1/token')).accessToken
  return async (platformId, gameId) => {
    const host = SGP_HOST[platformId]
    if (!host) throw new Error(`未知大区 ${platformId}`)
    return sgpGet(
      host,
      `match-history-query/v1/products/lol/${platformId}_${gameId}/SUMMARY`,
      token
    )
  }
}

async function main() {
  const args = process.argv.slice(2)
  const probe = args.indexOf('--probe')
  if (probe >= 0) {
    const gameId = Number(args[probe + 1])
    const { game } = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, `${gameId}.json`), 'utf8'))
    const res = await (await liveSession())(game.platformId, gameId)
    console.log('顶层键:', Object.keys(res ?? {}))
    console.log('json 键:', Object.keys(res?.json ?? {}))
    console.log('participants[0] 键:', Object.keys(summaryParticipants(res)[0] ?? {}))
    console.log(
      'teamPosition:',
      summaryParticipants(res)
        .map(p => `${p.participantId}:${p.teamPosition}`)
        .join(' ')
    )
    return
  }
  const files = fs.readdirSync(SLIM_DIR).filter(f => f.endsWith('.json'))
  const corpus = await fromCorpus(new Set(files.map(f => Number(f.replace('.json', '')))))
  const live = args.includes('--live') ? await liveSession() : null
  for (const f of files) {
    const gameId = Number(f.replace('.json', ''))
    const slim = JSON.parse(fs.readFileSync(path.join(SLIM_DIR, f), 'utf8'))
    let byPuuid = corpus.get(gameId)
    let source = 'corpus'
    if (!byPuuid && live) {
      const { game } = JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8'))
      try {
        const res = await live(game.platformId, gameId)
        byPuuid = new Map(summaryParticipants(res).map(p => [p.puuid, p.teamPosition ?? '']))
        source = 'live'
      } catch (e) {
        console.warn(`✗ ${gameId} 现场拉取失败：${e.message}`)
      }
    }
    if (!byPuuid) {
      console.warn(`- ${gameId} 无分路来源，保持空（复盘退回推断）`)
      continue
    }
    slim.participants = slim.participants.map(p => ({
      ...p,
      teamPosition: byPuuid.get(p.puuid) ?? ''
    }))
    fs.writeFileSync(path.join(SLIM_DIR, f), JSON.stringify(slim))
    console.log(
      `✓ ${gameId}（${source}）${slim.participants.map(p => p.teamPosition || '?').join(',')}`
    )
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
