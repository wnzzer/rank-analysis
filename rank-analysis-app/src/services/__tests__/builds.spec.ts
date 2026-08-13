import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import { getBuildStats, topItem } from '../builds'
import type { BuildStats, ItemStat } from '../builds'

function sampleBuild(): BuildStats {
  return {
    championId: 86,
    position: '',
    mode: 420,
    samples: 8,
    winCount: 5,
    items: [[{ itemId: 3020, count: 5, winCount: 4 }], [{ itemId: 3508, count: 8, winCount: 5 }]],
    runeMain: [{ id: 8100, count: 8, winCount: 5 }],
    runeSub: [{ id: 8400, count: 6, winCount: 4 }],
    keystone: [{ id: 8112, count: 8, winCount: 5 }],
    spells: [
      { spellId: 4, count: 8, winCount: 5 },
      { spellId: 7, count: 8, winCount: 5 }
    ]
  }
}

describe('builds service', () => {
  it('getBuildStats 透传 invoke 参数并返回聚合结果', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(sampleBuild())
    const b = await getBuildStats('me-puuid', 86, 420)
    expect(invoke).toHaveBeenCalledWith('get_build_stats', {
      puuid: 'me-puuid',
      championId: 86,
      mode: 420
    })
    expect(b?.samples).toBe(8)
  })

  it('getBuildStats 缺省 mode=0（不限制模式）', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(sampleBuild())
    await getBuildStats('me-puuid', 86)
    expect(invoke).toHaveBeenCalledWith('get_build_stats', {
      puuid: 'me-puuid',
      championId: 86,
      mode: 0
    })
  })

  it('getBuildStats 后端返回 null（样本不足）时原样透传', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null)
    expect(await getBuildStats('me-puuid', 86)).toBeNull()
  })

  it('getBuildStats 失败返回 null 不抛', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('net down')
    expect(await getBuildStats('me-puuid', 86)).toBeNull()
  })

  it('topItem 取槽位第一名，无数据返回 null', () => {
    // 后端已按胜场权重降序（server: wins*2+(count-wins)）
    const items: ItemStat[][] = [
      [
        { itemId: 3508, count: 8, winCount: 3 },
        { itemId: 3020, count: 5, winCount: 4 }
      ],
      []
    ]
    expect(topItem(items, 0)?.itemId).toBe(3508)
    expect(topItem(items, 1)).toBeNull()
    expect(topItem(items, 6)).toBeNull()
  })
})
