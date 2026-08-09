/**
 * 游戏资源 URL 构建 Composable
 * 提供统一的游戏资源（英雄、装备、符文等）URL 构建方法
 */
import { assetPrefix } from '@renderer/services/http'

export function useAssetUrl() {
  /**
   * 获取英雄头像 URL
   * @param championId 英雄 ID
   * @returns 英雄头像 URL
   */
  const getChampionUrl = (championId: number | string): string => {
    return `${assetPrefix}/champion/${championId}`
  }

  /**
   * 获取召唤师头像 URL
   * @param profileIconId 头像图标 ID
   * @returns 召唤师头像 URL
   */
  const getProfileUrl = (profileIconId: number | string): string => {
    return `${assetPrefix}/profile/${profileIconId}`
  }

  /**
   * 获取装备图标 URL
   * @param itemId 装备 ID
   * @returns 装备图标 URL
   */
  const getItemUrl = (itemId: number | string): string => {
    return `${assetPrefix}/item/${itemId}`
  }

  /**
   * 获取召唤师技能图标 URL
   * @param spellId 技能 ID
   * @returns 召唤师技能图标 URL
   */
  const getSpellUrl = (spellId: number | string): string => {
    return `${assetPrefix}/spell/${spellId}`
  }

  /**
   * 获取符文图标 URL
   * @param runeId 符文 ID
   * @returns 符文图标 URL
   */
  const getRuneUrl = (runeId: number | string): string => {
    return `${assetPrefix}/rune/${runeId}`
  }

  /**
   * 获取段位图标 URL
   * @param tier 段位名称（如 challenger, master, diamond 等）
   * @returns 段位图标 URL
   */
  const getTierUrl = (tier: string): string => {
    return `${assetPrefix}/tier/${tier.toLowerCase()}`
  }

  return {
    assetPrefix,
    getChampionUrl,
    getProfileUrl,
    getItemUrl,
    getSpellUrl,
    getRuneUrl,
    getTierUrl
  }
}
