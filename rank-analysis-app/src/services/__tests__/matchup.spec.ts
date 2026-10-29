import { describe, expect, it, vi } from 'vitest'
import { matchupApi } from '../matchup'
import { openUrl } from '@tauri-apps/plugin-opener'

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => [{ value: 103, label: '阿狸', alias: 'Ahri' }])
}))

describe('对位来源链接', () => {
  it('已加载英雄英文标识时链接到对应英雄、分路与段位', async () => {
    await matchupApi.loadNames()
    expect(matchupApi.sourceUrl?.(103, 'mid', 'diamond_plus')).toBe(
      'https://op.gg/lol/champions/ahri/counters/mid?tier=diamond_plus'
    )
    expect(matchupApi.sourceUrl?.(99999, 'mid', 'diamond_plus')).toBeNull()
  })
  it('正式来源链接使用项目的系统浏览器打开能力', async () => {
    const url = 'https://op.gg/lol/champions/ahri/counters/mid?tier=diamond_plus'
    await matchupApi.openSource?.(url)
    expect(openUrl).toHaveBeenCalledWith(url)
  })
})
