/**
 * Live 事件桥单测：映射规则与去重。
 */
import { describe, expect, it, vi } from 'vitest'

import type { LiveEvent } from '@renderer/features/gaming/services/liveGame'
import { createLiveBridge, mapLiveEvents } from '../bridge'

function ev(partial: Partial<LiveEvent> & { eventName: string; eventTime: number }): LiveEvent {
  return {
    killerName: '',
    victimName: '',
    assisters: [],
    ...partial
  }
}

describe('mapLiveEvents', () => {
  it('我的击杀 / 我的阵亡分别映射，他人事件忽略', () => {
    const out = mapLiveEvents(
      [
        ev({ eventName: 'ChampionKill', eventTime: 1, killerName: 'me', victimName: 'foe' }),
        ev({ eventName: 'ChampionKill', eventTime: 2, killerName: 'foe', victimName: 'other' }),
        ev({ eventName: 'ChampionKill', eventTime: 3, killerName: 'foe', victimName: 'me' })
      ],
      'me'
    )
    expect(out.map(e => e.type)).toEqual(['kill', 'death'])
    expect(out[0].championName).toBe('foe')
  })

  it('Multikill 带连杀数；缺省按 2 兜底', () => {
    const out = mapLiveEvents(
      [
        ev({ eventName: 'Multikill', eventTime: 1, killerName: 'me', killStreak: 4 }),
        ev({ eventName: 'Multikill', eventTime: 2, killerName: 'me' })
      ],
      'me'
    )
    expect(out[0]).toMatchObject({ type: 'multikill', streak: 4 })
    expect(out[1]).toMatchObject({ type: 'multikill', streak: 2 })
  })

  it('Ace 只在本人参与时触发', () => {
    const involved = [ev({ eventName: 'Ace', eventTime: 1, killerName: 'mate', assisters: ['me'] })]
    expect(mapLiveEvents(involved, 'me').map(e => e.type)).toEqual(['ace'])

    const notInvolved = [ev({ eventName: 'Ace', eventTime: 2, killerName: 'mate' })]
    expect(mapLiveEvents(notInvolved, 'me')).toEqual([])
  })

  it('GameEnd 按结果映射胜负；缺失按失败（关怀优先）', () => {
    const out = mapLiveEvents(
      [
        ev({ eventName: 'GameEnd', eventTime: 1, killerName: '', result: 'Win' }),
        ev({ eventName: 'GameEnd', eventTime: 2 })
      ],
      'me'
    )
    expect(out.map(e => e.type)).toEqual(['victory', 'defeat'])
  })
})

describe('createLiveBridge 去重', () => {
  it('同一事件只喂一次 speaker', async () => {
    const same = [
      ev({ eventName: 'ChampionKill', eventTime: 9, killerName: 'me', victimName: 'x' })
    ]
    let snap = {
      gameTime: 0,
      players: [],
      events: same,
      gameData: { gameMode: 'ARAM', gameTime: 0 }
    }

    const onLine = vi.fn().mockResolvedValue(undefined)
    const bridge = createLiveBridge({
      getSnapshot: () => Promise.resolve(snap),
      getMe: () => Promise.resolve('me'),
      onLine,
      intervalMs: 999_999
    })

    await bridge.tick()
    await bridge.tick() // 同一窗口重复 tick：事件已 seen，不再说话
    expect(onLine).toHaveBeenCalledTimes(1)

    // 新事件到达再次触发（GameEnd 终局事件绕过全局冷却，必说话）
    snap = {
      gameTime: 1,
      players: [],
      events: [...same, ev({ eventName: 'GameEnd', eventTime: 10, killerName: '', result: 'Win' })],
      gameData: { gameMode: 'ARAM', gameTime: 1 }
    }
    await bridge.tick()
    expect(onLine).toHaveBeenCalledTimes(2)
  })

  it('拿不到身份时保持沉默', async () => {
    const onLine = vi.fn().mockResolvedValue(undefined)
    const bridge = createLiveBridge({
      getSnapshot: () =>
        Promise.resolve({
          gameTime: 0,
          players: [],
          events: [
            ev({ eventName: 'ChampionKill', eventTime: 1, killerName: 'a', victimName: 'b' })
          ],
          gameData: { gameMode: 'ARAM', gameTime: 0 }
        }),
      getMe: () => Promise.resolve(''),
      onLine
    })
    await bridge.tick()
    expect(onLine).not.toHaveBeenCalled()
  })
})
