/**
 * Rust 对局分析对拍 · TS 黄金输出生成（临时脚本，子项目 2 删除）。
 *
 * 读 PARITY_IN 下每个 `{ game, slim }` JSON（回归 fixture 或 dump_parity_corpus 导出，champions.json 除外），
 * 跑现有 TS：remapTimeline(slim, buildPuuidMap(game)) → buildMatchSnapshot(game, undefined, remapped)，
 * 写 PARITY_OUT/<文件名>.golden.json：
 *   { version, kind: 'lcu', name, input: { game, slim, championNames, spellNames, spellFallback }, expected: { snapshot, remappedTimeline } }
 * snapshot 只含 P1 子集：去掉 timeline（P2/P3）与 players[].recentProfile（不在子项目 1）。
 *
 * 用法（在 rank-analysis-app/ 下）：
 *   PARITY_IN=<输入目录> PARITY_OUT=<输出目录> \
 *     npx vitest run --config scripts/parity/vitest.parity.config.ts scripts/parity/golden.eval.ts
 *
 * 英雄名：PARITY_IN/champions.json（[{ value, label }]）存在时用它，否则合成「测试英雄<id>」。
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// vi.mock 提升到 import 之前执行，工厂里不能引用外层变量——在工厂内部读环境变量与文件。
// champion-names 动态 import('@tauri-apps/api/core')，vi.mock 同样能拦截。
vi.mock('@tauri-apps/api/core', async () => {
  const nodeFs = await import('node:fs')
  const nodePath = await import('node:path')
  if (!process.env.PARITY_IN) throw new Error('需设 PARITY_IN（输入目录）')
  const file = nodePath.resolve(process.env.PARITY_IN, 'champions.json')
  const list = nodeFs.existsSync(file)
    ? JSON.parse(nodeFs.readFileSync(file, 'utf8'))
    : Array.from({ length: 999 }, (_, i) => ({ value: i + 1, label: `测试英雄${i + 1}` }))
  return { invoke: async (cmd: string) => (cmd === 'get_champion_options' ? list : null) }
})

import { getChampionName, loadChampionNames } from '@renderer/services/ai/champion-names'
import { buildMatchSnapshot, type MatchSnapshot } from '@renderer/services/ai/shared/snapshot'
import { SPELL_FALLBACK_NAME, SPELL_NAMES } from '@renderer/services/ai/shared/summonerSpells'
import { buildPuuidMap, remapTimeline } from '@renderer/services/ai/shared/timeline/remap'
import type { SlimTimeline } from '@renderer/services/ai/shared/timeline/types'
import type { Game } from '@renderer/types/domain/match'

/** 黄金格式版本；改格式时同步改 Rust `match_analysis::parity::GOLDEN_VERSION` */
const GOLDEN_VERSION = 1
/** 不对拍的玩家字段：recentProfile 只在 AI 提示词路径传 profileMap 时有值 */
const OUT_OF_SCOPE_PLAYER_KEYS = new Set(['recentProfile'])

type SnapshotPlayer = MatchSnapshot['players'][number]

/** 去掉不在范围内的玩家字段 */
function playerSubset(p: SnapshotPlayer): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p).filter(([k]) => !OUT_OF_SCOPE_PLAYER_KEYS.has(k)))
}

/**
 * P1 对拍子集：顶层去掉 timeline，玩家去掉 recentProfile；经 JSON 往返（undefined 键消失、-0 变 0）
 * @param s - buildMatchSnapshot 的结果
 */
function p1Subset(s: MatchSnapshot): unknown {
  return JSON.parse(
    JSON.stringify({
      gameId: s.gameId,
      queueName: s.queueName,
      queueId: s.queueId,
      gameMode: s.gameMode,
      mapId: s.mapId,
      durationSeconds: s.durationSeconds,
      modeContext: s.modeContext,
      teams: s.teams.map(t => ({ ...t, players: t.players.map(playerSubset) })),
      players: s.players.map(playerSubset)
    })
  )
}

/** 快照参与者的英雄 ID（与 snapshot.ts#getParticipants 同口径） */
function championIds(game: Game): number[] {
  const ps = game.gameDetail?.participants?.length
    ? game.gameDetail.participants
    : game.participants
  return ps.map(p => p.championId)
}

/** 本局英雄名；落到 `英雄<id>` 占位的不写，让 Rust 走同一兜底 */
function championNames(game: Game): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of championIds(game)) {
    const name = getChampionName(id)
    if (name !== `英雄${id}`) out[String(id)] = name
  }
  return out
}

describe('parity golden', () => {
  it('writes one golden per input game', async () => {
    expect(process.env.PARITY_IN, '需设 PARITY_IN').toBeTruthy()
    expect(process.env.PARITY_OUT, '需设 PARITY_OUT').toBeTruthy()
    const inDir = path.resolve(process.env.PARITY_IN as string)
    const outDir = path.resolve(process.env.PARITY_OUT as string)
    await loadChampionNames()
    fs.mkdirSync(outDir, { recursive: true })

    const files = fs
      .readdirSync(inDir)
      .filter(f => f.endsWith('.json') && f !== 'champions.json' && !f.endsWith('.golden.json'))
      .sort()
    let written = 0
    const failed: string[] = []
    for (const file of files) {
      const name = file.replace(/\.json$/, '')
      try {
        const { game, slim } = JSON.parse(fs.readFileSync(path.join(inDir, file), 'utf8')) as {
          game: Game
          slim?: SlimTimeline | null
        }
        const remapped = slim ? remapTimeline(slim, buildPuuidMap(game)) : null
        const snapshot = buildMatchSnapshot(game, undefined, remapped)
        const golden = {
          version: GOLDEN_VERSION,
          kind: 'lcu',
          name,
          input: {
            game,
            slim: slim ?? null,
            championNames: championNames(game),
            spellNames: SPELL_NAMES,
            spellFallback: SPELL_FALLBACK_NAME
          },
          expected: { snapshot: p1Subset(snapshot), remappedTimeline: remapped }
        }
        fs.writeFileSync(path.join(outDir, `${name}.golden.json`), JSON.stringify(golden))
        written++
      } catch (err) {
        failed.push(`${file}: ${String(err)}`)
      }
    }
    console.log(
      `写出 ${written} 份黄金，失败 ${failed.length}${failed.length ? '：' + failed.join('；') : ''}`
    )
    expect(failed).toEqual([])
    expect(written).toBeGreaterThan(0)
  })
})
