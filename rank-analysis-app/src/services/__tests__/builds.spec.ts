import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
import {
  getBuildStats,
  topItem,
  toBuildRecommendation,
  resolveBuildSource,
  PUGG_PREFER_SAMPLES
} from '../builds'
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
    const b = await getBuildStats('me-puuid', 86, 420, 'TOP')
    expect(invoke).toHaveBeenCalledWith('get_build_stats', {
      puuid: 'me-puuid',
      championId: 86,
      mode: 420,
      position: 'TOP'
    })
    expect(b?.samples).toBe(8)
  })

  it('getBuildStats 缺省 mode=0、position 空串（不限制模式与分路）', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(sampleBuild())
    await getBuildStats('me-puuid', 86)
    expect(invoke).toHaveBeenCalledWith('get_build_stats', {
      puuid: 'me-puuid',
      championId: 86,
      mode: 0,
      position: ''
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

  describe('C3 合并规则 resolveBuildSource', () => {
    it('PUGG 样本达到门槛 → 采用 PUGG（无视 OP.GG 有无）', () => {
      expect(resolveBuildSource(PUGG_PREFER_SAMPLES, false)).toBe('pugg')
      expect(resolveBuildSource(PUGG_PREFER_SAMPLES + 10, true)).toBe('pugg')
    })

    it('PUGG 样本不足但有 OP.GG → 采用 OP.GG', () => {
      expect(resolveBuildSource(PUGG_PREFER_SAMPLES - 1, true)).toBe('opgg')
      expect(resolveBuildSource(1, true)).toBe('opgg')
    })

    it('样本不足且无 OP.GG → 回退小样本 PUGG（标注防误导）', () => {
      expect(resolveBuildSource(1, false)).toBe('pugg')
      expect(resolveBuildSource(0, false)).toBeNull()
    })
  })

  describe('C3 合并输出 toBuildRecommendation', () => {
    it('null 输入返回 null（优雅降级）', () => {
      expect(toBuildRecommendation(null)).toBeNull()
    })

    it('输出 7 槽推荐 + 符文 + 技能 + 来源标注', () => {
      const b = toBuildRecommendation(sampleBuild(), '盖伦')
      expect(b?.source).toBe('pugg')
      expect(b?.samples).toBe(8)
      expect(b?.position).toBe('')
      expect(b?.items).toHaveLength(2) // 样本 items 只有两槽
      expect(b?.items[0]?.itemId).toBe(3020)
      expect(b?.runes.main?.id).toBe(8100)
      expect(b?.runes.sub?.id).toBe(8400)
      expect(b?.runes.keystone?.id).toBe(8112)
      expect(b?.spells[0]?.spellId).toBe(4)
      // 样本 <10 → 标注"样本偏少"，含英雄名与胜场数
      expect(b?.note).toContain('盖伦')
      expect(b?.note).toContain('8 场')
      expect(b?.note).toContain('样本偏少')
    })

    it('生效分路透传到推荐（含回退后的空串）', () => {
      const b = toBuildRecommendation({ ...sampleBuild(), position: 'TOP' })
      expect(b?.position).toBe('TOP')
      const degraded = toBuildRecommendation({ ...sampleBuild(), position: '' })
      expect(degraded?.position).toBe('')
    })

    it('样本达到门槛时来源为 pugg 且无"样本偏少"标注', () => {
      const build = { ...sampleBuild(), samples: PUGG_PREFER_SAMPLES + 2 }
      const b = toBuildRecommendation(build, '盖伦')
      expect(b?.source).toBe('pugg')
      expect(b?.note).not.toContain('样本偏少')
    })
  })
})
