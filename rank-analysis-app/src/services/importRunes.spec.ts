import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importRunePage, importSummonerSpells, type ImportRuneResult } from './importRunes'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

describe('importRunePage', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('转发 championId 并返回导入结果', async () => {
    const payload: ImportRuneResult = {
      pageId: 42,
      pageName: 'RA-64',
      created: true,
      championId: 64
    }
    invokeMock.mockResolvedValue(payload)
    await expect(importRunePage(64)).resolves.toEqual(payload)
    expect(invokeMock).toHaveBeenCalledWith('import_rune_page', { championId: 64 })
  })

  it('失败时抛出错误文案（供按钮展示，不吞错）', async () => {
    invokeMock.mockRejectedValue(new Error('本地没有该英雄的完整符文记录'))
    await expect(importRunePage(64)).rejects.toThrow('本地没有该英雄的完整符文记录')
  })
})

describe('importSummonerSpells', () => {
  it('转发调用并返回技能对', async () => {
    invokeMock.mockResolvedValue([4, 14])
    await expect(importSummonerSpells()).resolves.toEqual([4, 14])
    expect(invokeMock).toHaveBeenCalledWith('import_summoner_spells')
  })

  it('失败时抛出错误', async () => {
    invokeMock.mockRejectedValue(new Error('当前不在选人阶段'))
    await expect(importSummonerSpells()).rejects.toThrow('当前不在选人阶段')
  })
})
