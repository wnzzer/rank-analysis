/**
 * 快照分路：SGP 单局 SUMMARY 的真实分路（经时间线 participants 按 puuid 对齐）覆盖 positionAssign 推断。
 * 回归：局 B（匿名 fixture regression-b）里旧排除法把影流之主(8，真实 MIDDLE)与
 * 奥术先驱(9，真实 BOTTOM)互换；合入 main 的选秀队列槽位推断后无时间线也已推对，
 * SGP 真值仍优先（见「真值与推断冲突」用例）。
 */
import { describe, it, expect } from 'vitest'
import type { Game } from '@renderer/types/domain/match'
import { buildMatchSnapshot } from '../snapshot'
import { buildPuuidMap, remapTimeline } from '../timeline/remap'
import type { SlimTimeline } from '../timeline'
import b from '../scoring/__tests__/fixtures/regression-b.json'

const fx = b as unknown as { game: Game; slim: SlimTimeline }
const TRUTH = [
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'UTILITY',
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'UTILITY'
]
const positions = (tl: SlimTimeline | null) =>
  buildMatchSnapshot(fx.game, undefined, tl ? remapTimeline(tl, buildPuuidMap(fx.game)) : null)
    .players.slice()
    .sort((x, y) => x.participantId - y.participantId)
    .map(p => p.teamPosition)

describe('snapshot positions', () => {
  it('无时间线：单双排按 participantId 槽位推断（不再把 8/9 互换）', () => {
    expect(positions(null)).toEqual(TRUTH)
  })

  it('有真实分路：全员按 SGP 覆盖', () => {
    expect(positions(fx.slim)).toEqual(TRUTH)
  })

  it('真实分路为空或非法值时不覆盖', () => {
    const blank: SlimTimeline = {
      ...fx.slim,
      participants: fx.slim.participants.map(p => ({
        ...p,
        teamPosition: p.participantId === 9 ? 'NONE' : ''
      }))
    }
    expect(positions(blank)).toEqual(positions(null))
  })

  it('真值与推断冲突时以 SGP 真值为准', () => {
    const swapped: SlimTimeline = {
      ...fx.slim,
      participants: fx.slim.participants.map(p => ({
        ...p,
        teamPosition:
          p.participantId === 8 ? 'BOTTOM' : p.participantId === 9 ? 'MIDDLE' : p.teamPosition
      }))
    }
    const pos = positions(swapped)
    expect([pos[7], pos[8]]).toEqual(['BOTTOM', 'MIDDLE'])
  })
})
