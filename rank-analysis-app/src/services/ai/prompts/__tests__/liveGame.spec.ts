/**
 * buildLiveGamePrompt 单测：任务三件事 + 确定性事实块 + 纪律硬规则 + 数据不足降级。
 */

import { describe, expect, it } from 'vitest'
import { buildLiveGamePrompt } from '../liveGame'
import type { LiveGameSnapshot, LivePlayer } from '@renderer/features/gaming/services/liveGame'

function player(name: string, over: Partial<LivePlayer> = {}): LivePlayer {
  return {
    championName: 'Ahri',
    position: 'MIDDLE',
    team: 'ORDER',
    isDead: false,
    summonerName: name,
    level: 13,
    items: [],
    scores: { assists: 4, creepScore: 178, deaths: 1, kills: 6, wardScore: 12 },
    gold: { total: 11050 },
    ...over
  }
}

function snapshot(players: LivePlayer[]): LiveGameSnapshot {
  return {
    gameTime: 623.5,
    players,
    events: [
      {
        eventName: 'ChampionKill',
        eventTime: 300,
        killerName: 'enemy1',
        victimName: 'MidLaner',
        dragonType: null,
        towerName: null,
        assisters: []
      }
    ],
    gameData: { gameMode: 'CLASSIC', gameTime: 623.5 }
  }
}

describe('buildLiveGamePrompt', () => {
  it('包含三件事任务与确定性事实块与纪律行', () => {
    const prompt = buildLiveGamePrompt(snapshot([player('MidLaner')]), {
      myGameName: 'MidLaner',
      recommendedItems: [{ itemId: 3157, count: 10, winCount: 6 }]
    })
    expect(prompt).toContain('出装对比诊断')
    expect(prompt).toContain('经济与团战预警')
    expect(prompt).toContain('死亡模式提示')
    expect(prompt).toContain('【对局实时数据（确定性计算，只可引用）】')
    expect(prompt).toContain('禁止改写数字')
    expect(prompt).toContain('禁止自创装备/经济/击杀数据')
    expect(prompt).toContain('【对局实时数据】是确定性计算的事实')
  })

  it('快照不含我方时降级为「数据不足」并禁止编造', () => {
    const prompt = buildLiveGamePrompt(snapshot([player('someoneElse')]), {
      myGameName: 'MidLaner'
    })
    expect(prompt).toContain('当前没有可用的实时数据')
    expect(prompt).toContain('不要编造')
    expect(prompt).not.toContain('【对局实时数据（确定性计算')
  })
})
