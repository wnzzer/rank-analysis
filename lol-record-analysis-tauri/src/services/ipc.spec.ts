/**
 * IPC 服务单元测试
 * @module services/ipc
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getImgBase64ByIpc,
  putConfigByIpc,
  getConfigByIpc,
  getGameModesByIpc,
  getAssetDetailsByIpc,
  type AssetDetail
} from './ipc'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'

describe('ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getImgBase64ByIpc', () => {
    /**
     * 测试：当调用时应使用正确的参数调用 invoke
     */
    it('should call invoke with correct parameters when fetching image', async () => {
      const mockBase64 = 'data:image/png;base64,iVBORw0KGgo='
      vi.mocked(invoke).mockResolvedValue(mockBase64)

      const result = await getImgBase64ByIpc('champion', 1)

      expect(invoke).toHaveBeenCalledWith('get_asset_base64', {
        typeString: 'champion',
        id: 1
      })
      expect(result).toBe(mockBase64)
    })

    /**
     * 测试：当传入不同类型时应正确处理
     */
    it('should handle different asset types correctly', async () => {
      vi.mocked(invoke).mockResolvedValue('base64data')

      await getImgBase64ByIpc('item', 3153)
      expect(invoke).toHaveBeenCalledWith('get_asset_base64', {
        typeString: 'item',
        id: 3153
      })

      await getImgBase64ByIpc('spell', 4)
      expect(invoke).toHaveBeenCalledWith('get_asset_base64', {
        typeString: 'spell',
        id: 4
      })
    })

    /**
     * 测试：当 invoke 抛出错误时应传播错误
     */
    it('should propagate error when invoke throws', async () => {
      const error = new Error('Network error')
      vi.mocked(invoke).mockRejectedValue(error)

      await expect(getImgBase64ByIpc('champion', 1)).rejects.toThrow('Network error')
    })
  })

  describe('putConfigByIpc', () => {
    /**
     * 测试：调用方传裸值，helper 内部包装成 { value: T } 写入
     */
    it('should wrap scalar value in { value } when writing config', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)

      await putConfigByIpc('theme', 'dark')

      expect(invoke).toHaveBeenCalledWith('put_config', {
        key: 'theme',
        value: { value: 'dark' }
      })
    })

    /**
     * 测试：复杂对象 value 也应被原样包装一层
     */
    it('should wrap complex object value in { value }', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)

      const complexValue = { name: 'Dark', primary: '#000000' }
      await putConfigByIpc('theme', complexValue)

      expect(invoke).toHaveBeenCalledWith('put_config', {
        key: 'theme',
        value: { value: complexValue }
      })
    })

    /**
     * 测试：布尔值也走相同包装路径
     */
    it('should wrap boolean value in { value }', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)

      await putConfigByIpc('autoUpdateSwitch', true)

      expect(invoke).toHaveBeenCalledWith('put_config', {
        key: 'autoUpdateSwitch',
        value: { value: true }
      })
    })

    /**
     * 测试：当 invoke 抛出错误时应传播错误
     */
    it('should propagate error when invoke throws', async () => {
      const error = new Error('Config write failed')
      vi.mocked(invoke).mockRejectedValue(error)

      await expect(putConfigByIpc('key', 'value')).rejects.toThrow('Config write failed')
    })
  })

  describe('getConfigByIpc', () => {
    /**
     * 测试：当调用时应返回配置值的 value 字段
     */
    it('should return config value when given key', async () => {
      vi.mocked(invoke).mockResolvedValue({ value: 'dark' })

      const result = await getConfigByIpc<string>('theme')

      expect(invoke).toHaveBeenCalledWith('get_config', { key: 'theme' })
      expect(result).toBe('dark')
    })

    /**
     * 测试：当配置值为数字时应正确返回
     */
    it('should return numeric config value correctly', async () => {
      vi.mocked(invoke).mockResolvedValue({ value: 42 })

      const result = await getConfigByIpc<number>('maxHistory')

      expect(result).toBe(42)
    })

    /**
     * 测试：当配置值为布尔时应正确返回
     */
    it('should return boolean config value correctly', async () => {
      vi.mocked(invoke).mockResolvedValue({ value: true })

      const result = await getConfigByIpc<boolean>('enabled')

      expect(result).toBe(true)
    })

    /**
     * 测试：当配置值为对象时应正确返回
     */
    it('should return object config value correctly', async () => {
      const themeObject = { name: 'Dark', primary: '#000000' }
      vi.mocked(invoke).mockResolvedValue({ value: themeObject })

      const result = await getConfigByIpc<typeof themeObject>('theme')

      expect(result).toEqual(themeObject)
    })

    /**
     * 测试：当配置值为数组时应正确返回
     */
    it('should return array config value correctly', async () => {
      const arrayValue = [1, 2, 3]
      vi.mocked(invoke).mockResolvedValue({ value: arrayValue })

      const result = await getConfigByIpc<number[]>('items')

      expect(result).toEqual(arrayValue)
    })

    /**
     * 测试：当配置值为 null 时应返回 null（包装本身存在，只是内部值是 null）
     */
    it('should return null when wrapped value is null', async () => {
      vi.mocked(invoke).mockResolvedValue({ value: null })

      const result = await getConfigByIpc<null>('empty')

      expect(result).toBeNull()
    })

    /**
     * 测试：键不存在 / 后端返回 null 时应返回 undefined
     */
    it('should return undefined when backend returns null (key absent)', async () => {
      vi.mocked(invoke).mockResolvedValue(null)

      const result = await getConfigByIpc<string>('missing')

      expect(result).toBeUndefined()
    })

    /**
     * 测试：老格式裸值（非 { value: T } 包装）应返回 undefined，让调用方走默认值
     *
     * 强切迁移后，老用户磁盘上残留的裸值 key（theme / matchHistoryCount /
     * selectMode）会被读为 undefined，用户在 UI 上重新设置一次即可恢复。
     */
    it('should return undefined when stored value is bare (legacy format)', async () => {
      vi.mocked(invoke).mockResolvedValue('dark')

      const result = await getConfigByIpc<string>('theme')

      expect(result).toBeUndefined()
    })

    /**
     * 测试：当 invoke 抛出错误时应传播错误
     */
    it('should propagate error when invoke throws', async () => {
      const error = new Error('Config read failed')
      vi.mocked(invoke).mockRejectedValue(error)

      await expect(getConfigByIpc('key')).rejects.toThrow('Config read failed')
    })
  })

  describe('getGameModesByIpc', () => {
    /**
     * 测试：当调用时应返回游戏模式列表
     */
    it('should return game modes list', async () => {
      const mockModes = [
        { label: '全部', value: 0 },
        { label: '排位赛', value: 420 },
        { label: '大乱斗', value: 450 }
      ]
      vi.mocked(invoke).mockResolvedValue(mockModes)

      const result = await getGameModesByIpc()

      expect(invoke).toHaveBeenCalledWith('get_game_modes')
      expect(result).toEqual(mockModes)
    })

    /**
     * 测试：当返回空数组时应正确处理
     */
    it('should handle empty game modes list', async () => {
      vi.mocked(invoke).mockResolvedValue([])

      const result = await getGameModesByIpc()

      expect(result).toEqual([])
    })

    /**
     * 测试：当 invoke 抛出错误时应传播错误
     */
    it('should propagate error when invoke throws', async () => {
      const error = new Error('Failed to fetch game modes')
      vi.mocked(invoke).mockRejectedValue(error)

      await expect(getGameModesByIpc()).rejects.toThrow('Failed to fetch game modes')
    })
  })

  describe('getAssetDetailsByIpc', () => {
    /**
     * 测试：当调用 item 类型时应使用正确的参数
     */
    it('should call invoke with correct parameters for item type', async () => {
      const mockDetails: AssetDetail[] = [
        { id: 3153, name: '破败王者之刃', description: '攻击特效' }
      ]
      vi.mocked(invoke).mockResolvedValue(mockDetails)

      const result = await getAssetDetailsByIpc('item', [3153])

      expect(invoke).toHaveBeenCalledWith('get_asset_details', {
        typeString: 'item',
        ids: [3153]
      })
      expect(result).toEqual(mockDetails)
    })

    /**
     * 测试：当调用 perk 类型时应使用正确的参数
     */
    it('should call invoke with correct parameters for perk type', async () => {
      const mockDetails: AssetDetail[] = [{ id: 8005, name: '强攻', description: '攻击英雄三次' }]
      vi.mocked(invoke).mockResolvedValue(mockDetails)

      const result = await getAssetDetailsByIpc('perk', [8005])

      expect(invoke).toHaveBeenCalledWith('get_asset_details', {
        typeString: 'perk',
        ids: [8005]
      })
      expect(result).toEqual(mockDetails)
    })

    /**
     * 测试：当传入多个ID时应正确处理
     */
    it('should handle multiple IDs correctly', async () => {
      const mockDetails: AssetDetail[] = [
        { id: 3153, name: '破败王者之刃', description: '攻击特效' },
        { id: 3078, name: '三相之力', description: '综合属性' }
      ]
      vi.mocked(invoke).mockResolvedValue(mockDetails)

      const result = await getAssetDetailsByIpc('item', [3153, 3078])

      expect(invoke).toHaveBeenCalledWith('get_asset_details', {
        typeString: 'item',
        ids: [3153, 3078]
      })
      expect(result).toHaveLength(2)
    })

    /**
     * 测试：当返回的数据包含 rarity 字段时应正确处理
     */
    it('should handle asset details with rarity field', async () => {
      const mockDetails: AssetDetail[] = [
        { id: 1, name: '物品1', description: '描述', rarity: 'legendary' }
      ]
      vi.mocked(invoke).mockResolvedValue(mockDetails)

      const result = await getAssetDetailsByIpc('item', [1])

      expect(result[0].rarity).toBe('legendary')
    })

    /**
     * 测试：当 invoke 抛出错误时应传播错误
     */
    it('should propagate error when invoke throws', async () => {
      const error = new Error('Failed to fetch asset details')
      vi.mocked(invoke).mockRejectedValue(error)

      await expect(getAssetDetailsByIpc('item', [1])).rejects.toThrow(
        'Failed to fetch asset details'
      )
    })
  })
})
