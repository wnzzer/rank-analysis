/**
 * 基准构建流水线（build / sanity / diagnose 共用）：读语料 → 基准库 → 分位数阈值。
 * 只在 node（vitest baseline 配置）里跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  cellKey,
  MIN_CELL_SAMPLES,
  positionKey,
  type Baseline
} from '../../src/services/ai/shared/scoring/baseline'
import {
  scorePlayers,
  type PlayerScore,
  type PlayerScoringInput
} from '../../src/services/ai/shared/scoring/scorePlayers'
import {
  deciles,
  thresholdKey,
  type ThresholdCell,
  type Thresholds
} from '../../src/services/ai/shared/scoring/thresholds'
import { SUB_SCORE_KEYS } from '../../src/services/ai/shared/scoring/weights'
import { addSample, finalizeCells, type Accumulator } from './aggregate'
import { LANED_QUEUES, parseGamesJsonl, toScoringInputs, type SummaryGame } from './corpus'
import { slimFromDetails, type RawDetailsJson } from './slim'
import type { SlimTimeline } from '../../src/services/ai/shared/timeline/types'

export const RAW_DIR = path.resolve(__dirname, 'raw')
export const DATA_DIR = path.resolve(__dirname, '../../src/data/baseline')
const NOTE = '雪球采样（从种子玩家 BFS），近似种子附近分段，非全服大盘；建议每个大版本重采'

/** 一局语料：终局口径输入 + （有 DETAILS 时）时间线口径输入 */
export interface CorpusGame {
  game: SummaryGame
  end: PlayerScoringInput[]
  tl: PlayerScoringInput[] | null
}

/** 读语料；DETAILS 损坏/写了一半的 gz 当作没有 */
export function loadCorpus(rawDir: string): CorpusGame[] {
  const games = parseGamesJsonl(fs.readFileSync(path.join(rawDir, 'games.jsonl'), 'utf8'))
  const detailsDir = path.join(rawDir, 'details')
  const have = new Set(fs.existsSync(detailsDir) ? fs.readdirSync(detailsDir) : [])
  return games.map(game => {
    const file = `${game.gameId}.json.gz`
    let slim: SlimTimeline | null = null
    if (have.has(file)) {
      try {
        const raw = JSON.parse(
          zlib.gunzipSync(fs.readFileSync(path.join(detailsDir, file))).toString('utf8')
        ) as { json: RawDetailsJson }
        slim = slimFromDetails(raw.json)
      } catch {
        slim = null
      }
    }
    return { game, end: toScoringInputs(game, null), tl: slim ? toScoringInputs(game, slim) : null }
  })
}

const uniq = (keys: string[]): string[] => [...new Set(keys)]

/** 构建基准库 */
export function buildBaseline(corpus: CorpusGame[], builtAt: string): Baseline {
  const acc: Accumulator = new Map()
  const perQueue: Record<string, number> = {}
  const versions = new Set<string>()
  let detailsGames = 0
  for (const c of corpus) {
    const q = c.game.queueId
    perQueue[q] = (perQueue[q] ?? 0) + 1
    versions.add(c.game.gameVersion.split('.').slice(0, 2).join('.'))
    if (c.tl) detailsGames++
    const hasLanes = LANED_QUEUES.has(q)
    for (const p of c.tl ?? c.end) {
      const pos = positionKey(p.position, hasLanes)
      addSample(
        acc,
        uniq([cellKey(q, pos, p.championId), cellKey(q, pos, '*'), cellKey(q, '*', '*')]),
        {
          ...p.end,
          ...(p.timeline ?? {})
        }
      )
    }
  }
  return {
    meta: {
      builtAt,
      versions: [...versions].sort(),
      sampleGames: corpus.length,
      detailsGames,
      perQueue,
      note: NOTE
    },
    cells: finalizeCells(acc, MIN_CELL_SAMPLES)
  }
}

const EMPTY_THRESHOLDS: Thresholds = { meta: { builtAt: '', sampleGames: 0 }, cells: {} }
const r4 = (x: number): number => Number(x.toFixed(4))

/**
 * 对语料逐局打分（用刚建好的基准），按「队列×位置×模式」收集总分与分项分。
 * @param mode - true = 时间线口径（只取有 DETAILS 的局）
 * @returns 每局 [输入, 打分] 对
 */
export function scoreCorpus(
  corpus: CorpusGame[],
  baseline: Baseline,
  mode: boolean
): Array<{ game: SummaryGame; inputs: PlayerScoringInput[]; scores: PlayerScore[] }> {
  const out: Array<{ game: SummaryGame; inputs: PlayerScoringInput[]; scores: PlayerScore[] }> = []
  for (const c of corpus) {
    const inputs = mode ? c.tl : c.end
    if (!inputs) continue
    const ctx = { queueId: c.game.queueId, hasLanes: LANED_QUEUES.has(c.game.queueId) }
    out.push({
      game: c.game,
      inputs,
      scores: scorePlayers(inputs, ctx, { baseline, thresholds: EMPTY_THRESHOLDS })
    })
  }
  return out
}

/** 构建分位数阈值 */
export function buildThresholds(
  corpus: CorpusGame[],
  baseline: Baseline,
  builtAt: string
): Thresholds {
  const buckets = new Map<string, { total: number[]; sub: Map<string, number[]> }>()
  for (const mode of [false, true]) {
    for (const { game, inputs, scores } of scoreCorpus(corpus, baseline, mode)) {
      const q = game.queueId
      const hasLanes = LANED_QUEUES.has(q)
      scores.forEach((s, i) => {
        const pos = positionKey(inputs[i].position, hasLanes)
        const keys = uniq([
          thresholdKey(q, pos, mode),
          thresholdKey(q, '*', mode),
          thresholdKey('*', '*', mode)
        ])
        for (const key of keys) {
          const b = buckets.get(key) ?? { total: [], sub: new Map<string, number[]>() }
          b.total.push(s.total)
          for (const k of SUB_SCORE_KEYS) {
            const v = s.sub[k]
            if (v === null) continue
            const list = b.sub.get(k) ?? []
            list.push(v)
            b.sub.set(k, list)
          }
          buckets.set(key, b)
        }
      })
    }
  }
  const cells: Record<string, ThresholdCell> = {}
  for (const [key, b] of buckets) {
    if (b.total.length < MIN_CELL_SAMPLES) continue
    const sub: ThresholdCell['sub'] = {}
    for (const [k, list] of b.sub) {
      if (list.length >= MIN_CELL_SAMPLES) sub[k] = deciles(list).map(r4)
    }
    cells[key] = { n: b.total.length, total: deciles(b.total).map(r4), sub }
  }
  return { meta: { builtAt, sampleGames: corpus.length }, cells }
}
