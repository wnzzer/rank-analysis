import { describe, it, expect } from 'vitest'
import { syncPlayers, playerSignature } from './useSessionSync'
import type { SessionSummoner } from '@renderer/types/domain/gaming'

/** 造一个最小 SessionSummoner（选人期敌方形态：空 puuid 仅英雄） */
function enemy(championId: number, pickState: string): SessionSummoner {
  return {
    championId,
    championKey: `champion_${championId}`,
    summoner: { puuid: '' } as SessionSummoner['summoner'],
    matchHistory: {} as SessionSummoner['matchHistory'],
    userTag: {} as SessionSummoner['userTag'],
    rank: {} as SessionSummoner['rank'],
    meetGames: [],
    preGroupMarkers: { name: '', type: '' },
    pickState
  }
}

describe('选人期 pickState 合并', () => {
  it('basic 合并应更新同位置空 puuid 敌人的 pickState 与 championId', () => {
    const current = [enemy(0, 'none')]
    syncPlayers(current, [enemy(10, 'intent')], 'basic')
    expect(current[0].championId).toBe(10)
    expect(current[0].pickState).toBe('intent')
  })

  it('full 合并下仅 pickState 变化也应触发更新（签名包含 pickState）', () => {
    const a = enemy(10, 'intent')
    const b = enemy(10, 'locked')
    expect(playerSignature(a)).not.toBe(playerSignature(b))
    const current = [a]
    syncPlayers(current, [b], 'full')
    expect(current[0].pickState).toBe('locked')
  })
})
