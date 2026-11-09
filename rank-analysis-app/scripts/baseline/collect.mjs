/**
 * 国服大盘基准试采集：BFS 爬 SGP SUMMARY 战绩，落盘到 scripts/baseline/raw/（已 gitignore）。
 *
 * 用法（需客户端已登录）：
 *   node scripts/baseline/collect.mjs [--max-games N] [--max-details N]
 *        [--target-queues 420,440] [--max-target-games N]
 * --target-queues 指定时：翻页停止条件只数目标队列的局数（--max-target-games），
 * --max-games 退化为总量安全上限；其它队列的局照常保留但不计入目标。
 * 爬取期间每翻一页穿插补拉至多 2 个目标队列的 DETAILS；达标后转入补拉阶段直到 --max-details。
 *
 * 礼貌性约束（跑在用户自己的账号上，被限流必须停手而不是硬顶）：
 *   - 全局 2 req/s，严格串行；
 *   - 429 / 5xx / 超时 / 网络错误：指数退避 30s→60s→…→10min，连续失败 5 次优雅停止（状态已保存）；
 *   - 401：重新获取 entitlements token 后重试（不计入失败）；token 另每 10 分钟刷新。
 *
 * 指定 --target-queues 时，BFS 只从目标队列的局扩散新玩家：雪球后期会被海斗（2400）玩家淹没，
 * 排位产出骤降（2026-11-07 首轮采集实测），只扩散排位玩家可维持排位局占比。
 * 绝不打印或落盘任何 token。
 */
import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { findCreds, lcuGet, sgpGet, SGP_HOST } from './lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RAW = path.join(HERE, 'raw')
const GAMES_FILE = path.join(RAW, 'games.jsonl')
const DETAILS_DIR = path.join(RAW, 'details')
const STATE_FILE = path.join(RAW, 'state.json')

const KEEP_QUEUES = new Set([420, 440, 450, 2400])
const MIN_DURATION = 300
const MAX_QUEUE = 50_000
const RATE_INTERVAL_MS = 500 // 2 req/s
const TIMEOUT_MS = 15_000
const BACKOFF_START_MS = 30_000
const BACKOFF_MAX_MS = 600_000
const MAX_CONSEC_FAIL = 5
const TOKEN_TTL_MS = 10 * 60_000
const SAVE_EVERY = 25
const PROGRESS_EVERY = 50

/**
 * 参与者字段映射：输出名 → SGP SUMMARY participant 上的候选字段名（match-v5 命名，取第一个存在的）。
 * 实测国服 SUMMARY 没有 summoner1Id/2Id，只有 spell1Id/spell2Id，故做回退。
 */
const FIELD_MAP = {
  participantId: ['participantId'],
  teamId: ['teamId'],
  puuid: ['puuid'],
  championId: ['championId'],
  win: ['win'],
  kills: ['kills'],
  deaths: ['deaths'],
  assists: ['assists'],
  totalDamageDealtToChampions: ['totalDamageDealtToChampions'],
  goldEarned: ['goldEarned'],
  totalMinionsKilled: ['totalMinionsKilled'],
  neutralMinionsKilled: ['neutralMinionsKilled'],
  visionScore: ['visionScore'],
  wardsPlaced: ['wardsPlaced'],
  wardsKilled: ['wardsKilled'],
  damageDealtToBuildings: ['damageDealtToBuildings'],
  damageDealtToObjectives: ['damageDealtToObjectives'],
  totalHeal: ['totalHeal'],
  totalDamageTaken: ['totalDamageTaken'],
  timeCCingOthers: ['timeCCingOthers'],
  teamPosition: ['teamPosition'],
  individualPosition: ['individualPosition'],
  summoner1Id: ['summoner1Id', 'spell1Id'],
  summoner2Id: ['summoner2Id', 'spell2Id'],
  // 海斗（2400）无常规分路，用名次/小队区分
  placement: ['placement'],
  playerSubteamId: ['playerSubteamId']
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)

function parseArgs(argv) {
  const get = (name, def) => {
    const i = argv.indexOf(name)
    return i >= 0 ? Number(argv[i + 1]) : def
  }
  const i = argv.indexOf('--target-queues')
  const targetQueues = new Set(
    i >= 0 ? argv[i + 1].split(',').map(Number).filter(Boolean) : [420, 440]
  )
  const targetOrder = i >= 0 ? [...targetQueues] : [420, 440]
  return {
    maxGames: get('--max-games', 2000),
    maxDetails: get('--max-details', 300),
    targetQueues,
    targetOrder,
    // 未指定 --target-queues 时保持旧行为：以总局数为准
    maxTargetGames: i >= 0 ? get('--max-target-games', Infinity) : null
  }
}

/** 把 SUMMARY 的 participant 按 FIELD_MAP 精简 */
function slimParticipant(p) {
  const out = {}
  for (const [k, cands] of Object.entries(FIELD_MAP)) {
    for (const c of cands) {
      if (p[c] !== undefined) {
        out[k] = p[c]
        break
      }
    }
  }
  return out
}

/** 目录大小（字节） */
function dirSize(dir) {
  let n = 0
  if (!fs.existsSync(dir)) return 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size
  }
  return n
}

async function main() {
  const { maxGames, maxDetails, targetQueues, targetOrder, maxTargetGames } = parseArgs(
    process.argv.slice(2)
  )
  fs.mkdirSync(DETAILS_DIR, { recursive: true })

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

  let token = (await lcuGet(creds, '/entitlements/v1/token')).accessToken
  let tokenAt = Date.now()
  const refreshToken = async () => {
    token = (await lcuGet(creds, '/entitlements/v1/token')).accessToken
    tokenAt = Date.now()
  }

  // ---- 状态（games.jsonl 是 gameId 的权威来源，崩溃后以它为准） ----
  const state = {
    visited: [],
    queue: [me.puuid],
    detailsDone: [],
    details440Pool: [], // 已保留但未取 DETAILS 的 440 局，420 不够时兜底
    kept420: 0,
    requests: 0,
    n429: 0,
    n5xx: 0,
    nTimeout: 0,
    n401: 0,
    nOther: 0,
    elapsedMs: 0
  }
  if (fs.existsSync(STATE_FILE)) {
    Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')))
    log(`恢复状态：visited=${state.visited.length} queue=${state.queue.length}`)
  }
  const visited = new Set(state.visited)
  const queue = state.queue
  let head = 0 // queue[head..] 为待访问；保存时截掉已消费部分
  const inQueue = new Set(queue)
  const detailsDone = new Set(state.detailsDone)
  state.skipped ??= [] // DETAILS 返回 4xx（如 404）的 gameId，不再重试
  const skipped = new Set(state.skipped)
  const keptRefs = [] // 已保留的目标队列局，DETAILS 穿插/补拉用
  const seenGames = new Set()
  const perQueue = {}
  const champs = new Set()
  const champsPerQueue = {}
  let gamesKept = 0
  let positionPresent = 0
  let positionTotal = 0

  function tally(g) {
    gamesKept++
    perQueue[g.queueId] = (perQueue[g.queueId] ?? 0) + 1
    champsPerQueue[g.queueId] ??= new Set()
    for (const p of g.participants) {
      champs.add(p.championId)
      champsPerQueue[g.queueId].add(p.championId)
      positionTotal++
      if (p.teamPosition) positionPresent++
    }
  }
  if (fs.existsSync(GAMES_FILE)) {
    for (const line of fs.readFileSync(GAMES_FILE, 'utf8').split('\n')) {
      if (!line) continue
      const g = JSON.parse(line)
      seenGames.add(g.gameId)
      tally(g)
      if (targetQueues.has(g.queueId)) {
        keptRefs.push({ gameId: g.gameId, platformId: g.platformId, queueId: g.queueId })
      }
    }
  }

  const startAt = Date.now() - state.elapsedMs
  let stopReason = null

  const saveState = () => {
    state.visited = [...visited]
    state.queue = queue.slice(head)
    queue.splice(0, head)
    head = 0
    state.detailsDone = [...detailsDone]
    state.skipped = [...skipped]
    state.elapsedMs = Date.now() - startAt
    const tmp = STATE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, STATE_FILE)
  }
  process.on('SIGINT', () => {
    log('收到 SIGINT，保存状态后退出')
    saveState()
    process.exit(130)
  })

  // ---- 限速 + 退避 ----
  let lastReqAt = 0
  let consecFail = 0
  let backoff = BACKOFF_START_MS
  let lastSkipped = false // 最近一次 request 是否因 4xx 被跳过（而非失败停止）

  function progress() {
    const el = Math.round((Date.now() - startAt) / 1000)
    log(
      `req=${state.requests} games=${gamesKept} target=${targetCount()} ${JSON.stringify(perQueue)} details=${detailsDone.size} ` +
        `queue=${queue.length - head} visited=${visited.size} 429=${state.n429} 5xx=${state.n5xx} ` +
        `timeout=${state.nTimeout} elapsed=${el}s`
    )
  }

  /**
   * 带限速/退避的 SGP 请求。返回 JSON；404/400 返回 null；
   * 连续失败满 5 次则置 stopReason 并返回 null。
   */
  async function request(p) {
    for (;;) {
      if (stopReason) return null
      lastSkipped = false
      if (Date.now() - tokenAt > TOKEN_TTL_MS) await refreshToken()
      const wait = lastReqAt + RATE_INTERVAL_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastReqAt = Date.now()
      state.requests++
      if (state.requests % SAVE_EVERY === 0) saveState()
      if (state.requests % PROGRESS_EVERY === 0) progress()
      try {
        const r = await sgpGet(host, p, token, TIMEOUT_MS)
        consecFail = 0
        backoff = BACKOFF_START_MS
        return r
      } catch (e) {
        const s = e.status
        if (s === 401) {
          state.n401++
          log('HTTP 401，刷新 entitlements token 后重试')
          if (state.n401 > 20) {
            stopReason = '401 反复出现，停止'
            return null
          }
          await refreshToken()
          continue
        }
        if (s >= 400 && s < 500 && ![401, 403, 408, 429].includes(s)) {
          state.nOther++
          lastSkipped = true
          log(`HTTP ${s} 跳过 ${p.split('?')[0].slice(-48)}`)
          return null
        }
        let kind
        if (s === 429) {
          state.n429++
          kind = 'HTTP 429'
        } else if (s >= 500) {
          state.n5xx++
          kind = `HTTP ${s}`
        } else if (s) {
          state.nOther++ // 其它状态（如 403）保守按失败处理
          kind = `HTTP ${s}`
        } else {
          state.nTimeout++
          kind = e.name === 'TimeoutError' ? '超时' : '网络错误'
        }
        consecFail++
        if (consecFail >= MAX_CONSEC_FAIL) {
          stopReason = `连续失败 ${consecFail} 次（最后一次：${kind}），优雅停止`
          log(stopReason)
          return null
        }
        log(`${kind}，第 ${consecFail}/${MAX_CONSEC_FAIL} 次连续失败，退避 ${backoff / 1000}s`)
        saveState()
        await sleep(backoff)
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
      }
    }
  }

  async function fetchDetails(g) {
    const id = g.gameId
    if (detailsDone.has(id) || skipped.has(id)) return
    if (fs.existsSync(path.join(DETAILS_DIR, `${id}.json.gz`))) {
      detailsDone.add(id)
      return
    }
    const d = await request(`match-history-query/v1/products/lol/${g.platformId}_${id}/DETAILS`)
    if (!d) {
      if (lastSkipped) skipped.add(id) // 4xx：标记跳过，不计入连续失败
      return
    }
    fs.writeFileSync(path.join(DETAILS_DIR, `${id}.json.gz`), zlib.gzipSync(JSON.stringify(d)))
    detailsDone.add(id)
  }

  const targetCount = () => targetOrder.reduce((n, q) => n + (perQueue[q] ?? 0), 0)
  /** 爬取阶段是否已满足局数目标 */
  const gamesReached = () =>
    gamesKept >= maxGames || (maxTargetGames !== null && targetCount() >= maxTargetGames)
  const done = () => gamesReached() && detailsDone.size >= maxDetails

  // 待补拉 DETAILS 的指针：按 targetOrder 优先级，每个队列各自向前推进
  const cursors = Object.fromEntries(targetOrder.map(q => [q, 0]))
  /** 取下一个待拉的目标队列局（先 targetOrder 靠前的队列） */
  function nextPending() {
    for (const q of targetOrder) {
      while (cursors[q] < keptRefs.length) {
        const g = keptRefs[cursors[q]++]
        if (g.queueId === q && !detailsDone.has(g.gameId) && !skipped.has(g.gameId)) return g
      }
    }
    return null
  }
  /** 穿插补拉至多 n 个 DETAILS */
  async function interleaveDetails(n) {
    for (let i = 0; i < n && detailsDone.size < maxDetails && !stopReason; i++) {
      const g = nextPending()
      if (!g) return
      await fetchDetails(g)
      // 失败且未跳过（连续失败停止）时 stopReason 已置位，下次续跑会重新扫描
    }
  }

  log(
    `开始：platform=${platformId} maxGames=${maxGames} maxDetails=${maxDetails} ` +
      `targetQueues=${targetOrder} maxTargetGames=${maxTargetGames}；字段映射：` +
      JSON.stringify(FIELD_MAP)
  )

  while (!gamesReached() && head < queue.length && !stopReason) {
    const puuid = queue[head++]
    if (visited.has(puuid)) continue
    visited.add(puuid)
    const r = await request(
      `match-history-query/v1/products/lol/player/${puuid}/SUMMARY?startIndex=0&count=20`
    )
    if (stopReason) {
      // 这个玩家没访问成功：放回队首，下次续跑
      visited.delete(puuid)
      queue[--head] = puuid
      break
    }
    for (const g of r?.games ?? []) {
      const j = g.json
      if (!j || !KEEP_QUEUES.has(j.queueId) || (j.gameDuration ?? 0) < MIN_DURATION) continue
      if (seenGames.has(j.gameId) || !j.participants?.length) continue
      if (gamesReached()) break
      const rec = {
        gameId: j.gameId,
        platformId: j.platformId,
        queueId: j.queueId,
        gameDuration: j.gameDuration,
        gameCreation: j.gameCreation,
        gameVersion: j.gameVersion,
        participants: j.participants.map(slimParticipant)
      }
      fs.appendFileSync(GAMES_FILE, JSON.stringify(rec) + '\n')
      seenGames.add(rec.gameId)
      tally(rec)
      for (const p of rec.participants) {
        if (
          p.puuid &&
          !visited.has(p.puuid) &&
          !inQueue.has(p.puuid) &&
          queue.length - head < MAX_QUEUE
        ) {
          queue.push(p.puuid)
          inQueue.add(p.puuid)
        }
      }
      if (targetQueues.has(rec.queueId)) {
        keptRefs.push({ gameId: rec.gameId, platformId: rec.platformId, queueId: rec.queueId })
      }
    }
    // 每翻一页穿插补拉 DETAILS，让两项进度并行推进
    if (!stopReason) await interleaveDetails(2)
  }

  // 补拉阶段：局数已达上限（或队列耗尽）后不再翻页，从已保留的局里补 DETAILS（先 420 后 440）
  if (!stopReason && detailsDone.size < maxDetails) {
    log(
      `转入补拉 DETAILS：games=${gamesKept} details=${detailsDone.size}/${maxDetails} skipped=${skipped.size}`
    )
    await interleaveDetails(Infinity)
  }

  if (!stopReason) stopReason = done() ? '达到目标' : '队列耗尽'
  saveState()
  progress()

  // ---- 结束汇总 ----
  const elapsed = Math.round((Date.now() - startAt) / 1000)
  const champsByQueue = Object.fromEntries(
    Object.entries(champsPerQueue).map(([q, s]) => [q, s.size])
  )
  console.log('\n===== 结束汇总 =====')
  console.log('停止原因:', stopReason)
  console.log('对局总数:', gamesKept, '按队列:', perQueue)
  console.log('不同英雄数:', champs.size, '按队列:', champsByQueue)
  console.log('DETAILS:', detailsDone.size, '跳过:', skipped.size)
  console.log(
    `请求数: ${state.requests}（429=${state.n429} 5xx=${state.n5xx} 超时/网络=${state.nTimeout} 401=${state.n401} 其它4xx=${state.nOther}）`
  )
  console.log('限流观察:', state.n429 + state.n5xx + state.nTimeout > 0 ? '有' : '无')
  console.log(`teamPosition 覆盖: ${positionPresent}/${positionTotal}`)
  console.log(`已访问玩家: ${visited.size}，队列剩余: ${queue.length - head}`)
  console.log(`耗时: ${elapsed}s，raw/ 大小: ${(dirSize(RAW) / 1048576).toFixed(2)} MiB`)
  if (stopReason !== '达到目标' && stopReason !== '队列耗尽') process.exitCode = 2
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
