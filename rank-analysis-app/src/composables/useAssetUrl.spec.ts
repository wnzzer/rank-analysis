/**
 * useAssetUrl composable 单元测试
 * @module composables/useAssetUrl
 */

import { describe, it, expect, vi } from 'vitest'
import { useAssetUrl } from './useAssetUrl'

// Mock http module
vi.mock('@renderer/services/http', () => ({
  assetPrefix: 'http://asset.localhost'
}))

describe('useAssetUrl', () => {
  describe('getChampionUrl', () => {
    /**
     * 测试：当传入数字ID时应返回正确的英雄URL
     */
    it('should return correct champion URL when given numeric ID', () => {
      const { getChampionUrl } = useAssetUrl()
      const result = getChampionUrl(1)
      expect(result).toBe('http://asset.localhost/champion/1')
    })

    /**
     * 测试：当传入字符串ID时应返回正确的英雄URL
     */
    it('should return correct champion URL when given string ID', () => {
      const { getChampionUrl } = useAssetUrl()
      const result = getChampionUrl('Aatrox')
      expect(result).toBe('http://asset.localhost/champion/Aatrox')
    })

    /**
     * 测试：当传入0时应返回正确的英雄URL
     */
    it('should return correct champion URL when given zero ID', () => {
      const { getChampionUrl } = useAssetUrl()
      const result = getChampionUrl(0)
      expect(result).toBe('http://asset.localhost/champion/0')
    })

    /**
     * 测试：当传入大数字时应返回正确的英雄URL
     */
    it('should return correct champion URL when given large ID', () => {
      const { getChampionUrl } = useAssetUrl()
      const result = getChampionUrl(999999)
      expect(result).toBe('http://asset.localhost/champion/999999')
    })
  })

  describe('getProfileUrl', () => {
    /**
     * 测试：当传入数字ID时应返回正确的头像URL
     */
    it('should return correct profile URL when given numeric ID', () => {
      const { getProfileUrl } = useAssetUrl()
      const result = getProfileUrl(1234)
      expect(result).toBe('http://asset.localhost/profile/1234')
    })

    /**
     * 测试：当传入字符串ID时应返回正确的头像URL
     */
    it('should return correct profile URL when given string ID', () => {
      const { getProfileUrl } = useAssetUrl()
      const result = getProfileUrl('icon_1234')
      expect(result).toBe('http://asset.localhost/profile/icon_1234')
    })
  })

  describe('getItemUrl', () => {
    /**
     * 测试：当传入数字ID时应返回正确的装备URL
     */
    it('should return correct item URL when given numeric ID', () => {
      const { getItemUrl } = useAssetUrl()
      const result = getItemUrl(3153)
      expect(result).toBe('http://asset.localhost/item/3153')
    })

    /**
     * 测试：当传入字符串ID时应返回正确的装备URL
     */
    it('should return correct item URL when given string ID', () => {
      const { getItemUrl } = useAssetUrl()
      const result = getItemUrl('blade_of_the_ruined_king')
      expect(result).toBe('http://asset.localhost/item/blade_of_the_ruined_king')
    })
  })

  describe('getSpellUrl', () => {
    /**
     * 测试：当传入数字ID时应返回正确的召唤师技能URL
     */
    it('should return correct spell URL when given numeric ID', () => {
      const { getSpellUrl } = useAssetUrl()
      const result = getSpellUrl(4)
      expect(result).toBe('http://asset.localhost/spell/4')
    })

    /**
     * 测试：当传入字符串ID时应返回正确的召唤师技能URL
     */
    it('should return correct spell URL when given string ID', () => {
      const { getSpellUrl } = useAssetUrl()
      const result = getSpellUrl('Flash')
      expect(result).toBe('http://asset.localhost/spell/Flash')
    })
  })

  describe('getRuneUrl', () => {
    /**
     * 测试：当传入数字ID时应返回正确的符文URL
     */
    it('should return correct rune URL when given numeric ID', () => {
      const { getRuneUrl } = useAssetUrl()
      const result = getRuneUrl(8005)
      expect(result).toBe('http://asset.localhost/rune/8005')
    })

    /**
     * 测试：当传入字符串ID时应返回正确的符文URL
     */
    it('should return correct rune URL when given string ID', () => {
      const { getRuneUrl } = useAssetUrl()
      const result = getRuneUrl('PressTheAttack')
      expect(result).toBe('http://asset.localhost/rune/PressTheAttack')
    })
  })

  describe('getTierUrl', () => {
    /**
     * 测试：当传入大写段位时应返回小写的段位URL
     */
    it('should return lowercase tier URL when given uppercase tier', () => {
      const { getTierUrl } = useAssetUrl()
      const result = getTierUrl('CHALLENGER')
      expect(result).toBe('http://asset.localhost/tier/challenger')
    })

    /**
     * 测试：当传入小写段位时应返回相同的段位URL
     */
    it('should return same tier URL when given lowercase tier', () => {
      const { getTierUrl } = useAssetUrl()
      const result = getTierUrl('diamond')
      expect(result).toBe('http://asset.localhost/tier/diamond')
    })

    /**
     * 测试：当传入混合大小写段位时应返回全小写的段位URL
     */
    it('should return lowercase tier URL when given mixed case tier', () => {
      const { getTierUrl } = useAssetUrl()
      const result = getTierUrl('Master')
      expect(result).toBe('http://asset.localhost/tier/master')
    })

    /**
     * 测试：当传入各种段位时应返回正确的URL
     */
    it('should return correct URL for all tier types', () => {
      const { getTierUrl } = useAssetUrl()
      const tiers = [
        'IRON',
        'BRONZE',
        'SILVER',
        'GOLD',
        'PLATINUM',
        'EMERALD',
        'DIAMOND',
        'MASTER',
        'GRANDMASTER',
        'CHALLENGER'
      ]

      tiers.forEach(tier => {
        const result = getTierUrl(tier)
        expect(result).toBe(`http://asset.localhost/tier/${tier.toLowerCase()}`)
      })
    })
  })

  describe('assetPrefix', () => {
    /**
     * 测试：应返回正确的资源前缀
     */
    it('should return correct asset prefix', () => {
      const { assetPrefix } = useAssetUrl()
      expect(assetPrefix).toBe('http://asset.localhost')
    })
  })
})
