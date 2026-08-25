/**
 * exportMatches 纯函数测试：BOM/转义/字段映射/时长格式化。
 */
import { describe, it, expect } from 'vitest'
import { gamesToCsv } from '../exportMatches'
import type { Game } from '../../types/domain/match'

function makeGame(overrides: Partial<Game> = {}): Game {
  const base = {
    mvp: '',
    gameId: 1,
    gameCreationDate: '2026-08-25T12:00:00+08:00',
    gameDuration: 1530, // 25:30
    gameMode: 'CLASSIC',
    gameType: 'MATCHED_GAME',
    mapId: 11,
    queueId: 420,
    queueName: '单双排',
    platformId: 'HN1',
    participants: [
      {
        win: true,
        participantId: 1,
        teamId: 100,
        championId: 157,
        spell1Id: 4,
        spell2Id: 12,
        stats: {
          win: true,
          kills: 8,
          deaths: 2,
          assists: 6,
          item0: 0,
          item1: 0,
          item2: 0,
          item3: 0,
          item4: 0,
          item5: 0,
          item6: 0,
          perk0: 0,
          perkPrimaryStyle: 0,
          perkSubStyle: 0,
          playerAugment1: 0,
          playerAugment2: 0
        }
      }
    ] as Game['participants']
  }
  return { ...base, ...overrides } as Game
}

const label = (id: number) => (id === 157 ? '亚索' : `英雄${id}`)

describe('gamesToCsv', () => {
  it('以 UTF-8 BOM 开头且使用 CRLF 行尾', () => {
    const csv = gamesToCsv([makeGame()], label)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('\r\n')
  })

  it('首行为表头，数据行按列映射', () => {
    const lines = gamesToCsv([makeGame()], label)
      .replace(/^\uFEFF/, '')
      .split('\r\n')
    expect(lines[0]).toBe('对局时间,模式,英雄,结果,击杀,死亡,助攻,KDA,时长')
    expect(lines[1]).toContain('2026-08-25T12:00:00+08:00,单双排,亚索,胜,8,2,6,7.00,25:30')
  })

  it('零死亡 KDA 记为 Perfect', () => {
    const g = makeGame()
    ;(g.participants[0].stats as { deaths: number }).deaths = 0
    const csv = gamesToCsv([g], label)
    expect(csv).toContain(',Perfect,')
  })

  it('含逗号的字段被引号包裹并双写内部引号', () => {
    const g = makeGame({ queueName: '排位,单双排"测试"' })
    const line = gamesToCsv([g], label).split('\r\n')[1]
    expect(line).toContain('"排位,单双排""测试"""')
  })

  it('英雄名回退为 英雄{id}', () => {
    const csv = gamesToCsv([makeGame({} as Partial<Game>)], label)
    expect(csv).toContain('亚索')
    const unknown = makeGame()
    ;(unknown.participants[0] as { championId: number } as { championId: number }).championId = 9999
    expect(gamesToCsv([unknown], label)).toContain('英雄9999')
  })
})
