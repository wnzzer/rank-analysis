/**
 * A/B 运行器（评分版）：fixtures × {overview, player} × 变体 × RUNS，结果写 results/{variant}{EVAL_TAG}.jsonl。
 * 变体：S = 评分版 + 时间线；S0 = 评分版无时间线。归因骨架由 TS 生成（s1Ms 为其耗时），只调一次 Stage 2。
 * 用法：EVAL_VARIANTS=S npm run eval:run（可用 EVAL_LIMIT=3 缩小范围）。
 * 「现状」参照（两阶段旧管线）已在删 Stage 1 前采到 results/V1pre.jsonl。
 */
import { describe, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(__dirname)
// vi.mock 会被提升到 import 之前执行，工厂里不能引用外层变量——在工厂内部读文件。
// champion-names 是动态 import('@tauri-apps/api/core')，vi.mock 同样能拦截。
vi.mock('@tauri-apps/api/core', async () => {
  const nodeFs = await import('node:fs')
  const nodePath = await import('node:path')
  const list = JSON.parse(
    nodeFs.readFileSync(nodePath.resolve(__dirname, 'fixtures/champions.json'), 'utf8')
  )
  return { invoke: async (cmd: string) => (cmd === 'get_champion_options' ? list : null) }
})

import { loadChampionNames } from '@renderer/services/ai/champion-names'
import { buildMatchSnapshot } from '@renderer/services/ai/shared/snapshot'
import { buildPuuidMap, remapTimeline } from '@renderer/services/ai/shared/timeline/remap'
import { visibleCards, type SlimTimeline } from '@renderer/services/ai/shared/timeline'
import { buildScoredAttribution } from '@renderer/services/ai/matchDetail/scoredAttribution'
import {
  buildCritiqueUserPrompt,
  STAGE2_MODEL,
  STAGE2_SYSTEM_PROMPT
} from '@renderer/services/ai/matchDetail/critique'
import type { Game } from '@renderer/types/domain/match'
import { callModel, resolveEvalModel } from './worker'

const VARIANTS = (process.env.EVAL_VARIANTS ?? 'S').split(',')
const RUNS = Number(process.env.EVAL_RUNS ?? 2)
const LIMIT = Number(process.env.EVAL_LIMIT ?? 1000)
const TAG = process.env.EVAL_TAG ?? ''
const CONCURRENCY = 3
/** 与生产同口径解析的 Stage 2 模型（见 worker.resolveEvalModel） */
const MODEL = resolveEvalModel(STAGE2_MODEL)

interface Job {
  variant: string
  gameId: number
  run: number
}

async function runJob({ variant, gameId, run }: Job): Promise<object[]> {
  const { game } = JSON.parse(
    fs.readFileSync(path.join(DIR, `fixtures/games/${gameId}.json`), 'utf8')
  ) as { game: Game }
  const slim = JSON.parse(
    fs.readFileSync(path.join(DIR, `fixtures/slim/${gameId}.json`), 'utf8')
  ) as SlimTimeline
  const timeline = variant === 'S0' ? null : remapTimeline(slim, buildPuuidMap(game))
  const snapshot = buildMatchSnapshot(game, undefined, timeline)
  const me = snapshot.players.find(p => p.isMe)
  const t0 = Date.now()
  const attribution = buildScoredAttribution(snapshot)
  const s1Ms = Date.now() - t0
  const base = {
    variant: `${variant}${TAG}`,
    gameId,
    queueId: game.queueId,
    run,
    cardIds: snapshot.timeline?.cards.map(c => c.id) ?? []
  }
  const rows: object[] = []
  for (const mode of ['overview', 'player'] as const) {
    const prompt = buildCritiqueUserPrompt(attribution, snapshot, {
      mode,
      participantId: me?.participantId
    })
    const s2 = await callModel(MODEL, STAGE2_SYSTEM_PROMPT, prompt)
    rows.push({
      ...base,
      mode,
      model: MODEL,
      ok: s2.ok,
      error: s2.error,
      s1Ms,
      s1Retried: false,
      s2Ms: s2.ms,
      promptChars: prompt.length,
      attribution,
      prompt,
      output: s2.content,
      // 与 UI 同口径：只有模型在 prompt 里见过的卡片才算可引用
      cards: snapshot.timeline
        ? visibleCards(snapshot.timeline.cards, mode, me?.participantId, attribution.winReason).map(
            c => ({
              id: c.id,
              text: c.text
            })
          )
        : []
    })
  }
  return rows
}

describe('ai-eval run', () => {
  it('runs all variants', async () => {
    await loadChampionNames()
    const index = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures/index.json'), 'utf8')).slice(
      0,
      LIMIT
    ) as Array<{ gameId: number }>
    fs.mkdirSync(path.join(DIR, 'results'), { recursive: true })
    for (const v of VARIANTS) fs.writeFileSync(path.join(DIR, `results/${v}${TAG}.jsonl`), '')
    const jobs: Job[] = VARIANTS.flatMap(variant =>
      index.flatMap(g =>
        Array.from({ length: RUNS }, (_, r) => ({ variant, gameId: g.gameId, run: r + 1 }))
      )
    )
    let next = 0
    let done = 0
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < jobs.length) {
          const job = jobs[next++]
          const rows = await runJob(job)
          fs.appendFileSync(
            path.join(DIR, `results/${job.variant}${TAG}.jsonl`),
            rows.map(r => JSON.stringify(r)).join('\n') + '\n'
          )
          console.log(`[${++done}/${jobs.length}] ${job.variant}${TAG} ${job.gameId} r${job.run}`)
        }
      })
    )
  })
})
