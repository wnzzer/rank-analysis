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

/** 造一个已识别玩家（带 puuid），可选携带近期数据 */
function player(puuid: string, recentKda?: number): SessionSummoner {
  const p = enemy(10, 'none')
  p.summoner = { puuid } as SessionSummoner['summoner']
  if (recentKda !== undefined) {
    p.userTag = {
      tag: [],
      recentData: { kda: recentKda, selectMode: 420, selectWins: 6, selectLosses: 4 }
    } as unknown as SessionSummoner['userTag']
  }
  return p
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

describe('full 合并防闪烁与数据完整性', () => {
  it('未计算的 userTag 中间包不得回退已计算的标签与近期数据（回归：选人期标签频闪）', () => {
    // 后端每轮 session 重建都会先推一个 userTag 为 default 的中间包
    // （is_loading=false、selectModeCn 为空串），选人期 LCU 每 1-2s 一轮,
    // 若照常合并,标签/近期数据面板会以同周期抹掉→恢复地频闪。
    const old = player('p1', 3.5)
    ;(old.userTag as { recentData: { selectModeCn: string } }).recentData.selectModeCn = '单双排'
    old.userTag.tag = [{ tagName: '三连败' }] as unknown as SessionSummoner['userTag']['tag']
    const current = [old]

    const incoming = player('p1')
    incoming.userTag = {
      tag: [],
      recentData: { kda: 0, selectMode: 0, selectModeCn: '' }
    } as unknown as SessionSummoner['userTag']

    syncPlayers(current, [incoming], 'full')

    expect(current[0]).toBe(old)
    expect((current[0].userTag.recentData as { kda: number }).kda).toBe(3.5)
    expect((current[0].userTag.recentData as { selectModeCn: string }).selectModeCn).toBe('单双排')
    expect(current[0].userTag.tag).toHaveLength(1)
  })

  it('首次加载时未计算 userTag 的包仍正常合并（渐进渲染不受守卫影响）', () => {
    // 旧值本身也是未计算形态（占位/首包）→ 守卫不拦,战绩等字段照常进
    const old = player('p1')
    old.userTag = {
      tag: [],
      recentData: { kda: 0, selectModeCn: '' }
    } as unknown as SessionSummoner['userTag']
    const current = [old]

    const incoming = player('p1', 2.2)
    ;(incoming.userTag as { recentData: { selectModeCn: string } }).recentData.selectModeCn =
      '单双排'

    syncPlayers(current, [incoming], 'full')

    expect((current[0].userTag.recentData as { kda: number }).kda).toBe(2.2)
  })

  it('仅 recentData 补算完成的包不能被签名跳过（回归：近期数据面板停在 0）', () => {
    const before = player('p1')
    const after = player('p1', 3.2)
    expect(playerSignature(before)).not.toBe(playerSignature(after))
    const current = [before]
    syncPlayers(current, [after], 'full')
    expect(current[0].userTag?.recentData?.kda).toBe(3.2)
  })

  it('同 puuid 更新应原位合并、保持对象身份（避免 PlayerCard 整卡重渲染）', () => {
    const before = player('p1')
    const current = [before]
    syncPlayers(current, [player('p1', 3.2)], 'full')
    expect(current[0]).toBe(before)
  })

  it('已加载玩家不被无身份加载占位回退（避免 内容→转圈→内容 闪烁）', () => {
    const loaded = player('p1', 3.2)
    const placeholder = enemy(0, '')
    placeholder.isLoading = true
    const current = [loaded]
    syncPlayers(current, [placeholder], 'full')
    expect(current[0]).toBe(loaded)
    expect(current[0].isLoading).toBeFalsy()
  })
})
