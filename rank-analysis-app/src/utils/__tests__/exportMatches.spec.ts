/**
 * exportMatches 测试：CSV 基础/完整字段、BOM、转义、JSON roundtrip、对话框链路。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { gamesToCsv, gamesToJson, exportMatches } from '../exportMatches'
import type { Game } from '../../types/domain/match'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => 'C:\\export\\demo') }))

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
          playerAugment2: 0,
          totalMinionsKilled: 233,
          goldEarned: 15400,
          visionScore: 22
        }
      }
    ] as Game['participants']
  }
  return { ...base, ...overrides } as Game
}

const label = (id: number) => (id === 157 ? '亚索' : `英雄${id}`)

describe('gamesToCsv', () => {
  it('基础模式：BOM 开头 + CRLF + 表头与字段映射', () => {
    const lines = gamesToCsv([makeGame()], label)
      .replace(/^\uFEFF/, '')
      .split('\r\n')
    expect(lines[0]).toBe('对局时间,模式,英雄,结果,击杀,死亡,助攻,KDA,时长')
    expect(lines[1]).toContain('2026-08-25T12:00:00+08:00,单双排,亚索,胜,8,2,6,7.00,25:30')
    expect(lines[1]).not.toContain('233')
  })

  it('完整模式追加 补刀/经济/视野 三列', () => {
    const lines = gamesToCsv([makeGame()], label, true)
      .replace(/^\uFEFF/, '')
      .split('\r\n')
    expect(lines[0]).toBe('对局时间,模式,英雄,结果,击杀,死亡,助攻,KDA,时长,补刀,经济,视野')
    expect(lines[1]).toContain(',233,15400,22')
  })

  it('零死亡 KDA 记为 Perfect', () => {
    const g = makeGame()
    ;(g.participants[0].stats as { deaths: number }).deaths = 0
    expect(gamesToCsv([g], label)).toContain(',Perfect,')
  })

  it('含逗号的字段被引号包裹并双写内部引号', () => {
    const g = makeGame({ queueName: '排位,单双排"测试"' })
    const line = gamesToCsv([g], label).split('\r\n')[1]
    expect(line).toContain('"排位,单双排""测试"""')
  })
})

describe('gamesToJson', () => {
  it('roundtrip：元信息 + games 数组可还原', () => {
    const parsed = JSON.parse(gamesToJson([makeGame(), makeGame({ gameId: 2 })])) as {
      exportedAt: string
      count: number
      games: Array<{ gameId: number; participants: Array<{ stats: { kills: number } }> }>
    }
    expect(parsed.count).toBe(2)
    expect(parsed.exportedAt).toBeTruthy()
    expect(parsed.games.map(g => g.gameId)).toEqual([1, 2])
    expect(parsed.games[0].participants[0].stats.kills).toBe(8)
  })
})

describe('exportMatches 对话框链路', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear()
    vi.mocked(invoke).mockResolvedValue('C:\\export\\demo')
  })

  it('csv：contents 带 BOM、文件名 .csv', async () => {
    const r = await exportMatches([makeGame()], label)
    expect(r).toEqual({ status: 'saved', path: 'C:\\export\\demo' })
    const [, args] = vi.mocked(invoke).mock.calls[0] as [
      string,
      { fileName: string; contents: string }
    ]
    expect(args.fileName.endsWith('.csv')).toBe(true)
    expect(args.contents.charCodeAt(0)).toBe(0xfeff)
  })

  it('json：contents 可解析且文件名 .json', async () => {
    const r = await exportMatches([makeGame()], label, { format: 'json' })
    expect(r.status).toBe('saved')
    const [, args] = vi.mocked(invoke).mock.calls[0] as [
      string,
      { fileName: string; contents: string }
    ]
    expect(args.fileName.endsWith('.json')).toBe(true)
    expect(() => JSON.parse(args.contents)).not.toThrow()
  })

  it('用户取消对话框返回 cancelled', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null)
    const r = await exportMatches([makeGame()], label)
    expect(r).toEqual({ status: 'cancelled' })
  })

  it('文件名时间戳精确到秒——跨秒导出生成不同文件名', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-26T10:00:00'))
      const r1 = await exportMatches([makeGame()], label)
      vi.setSystemTime(new Date('2026-08-26T10:00:01'))
      const r2 = await exportMatches([makeGame()], label)
      expect(r1.status).toBe('saved')
      expect(r2.status).toBe('saved')
      const names = vi
        .mocked(invoke)
        .mock.calls.slice(-2)
        .map(([, a]) => (a as { fileName: string }).fileName)
      expect(names[0]).not.toBe(names[1])
      // 时间段位于 -10..-4：HHMMSS
      expect(names[0].slice(-10, -4)).toBe('100000')
      expect(names[1].slice(-10, -4)).toBe('100001')
    } finally {
      vi.useRealTimers()
    }
  })
})
