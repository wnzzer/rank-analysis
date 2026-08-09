/**
 * 段位 → 段位图标资源映射
 */

import unranked from '@renderer/assets/imgs/tier/unranked.png'
import bronze from '@renderer/assets/imgs/tier/bronze.png'
import silver from '@renderer/assets/imgs/tier/silver.png'
import gold from '@renderer/assets/imgs/tier/gold.png'
import platinum from '@renderer/assets/imgs/tier/platinum.png'
import diamond from '@renderer/assets/imgs/tier/diamond.png'
import master from '@renderer/assets/imgs/tier/master.png'
import grandmaster from '@renderer/assets/imgs/tier/grandmaster.png'
import challenger from '@renderer/assets/imgs/tier/challenger.png'
import iron from '@renderer/assets/imgs/tier/iron.png'
import emerald from '@renderer/assets/imgs/tier/emerald.png'

const tierImages: Record<string, string> = {
  unranked,
  bronze,
  silver,
  gold,
  platinum,
  diamond,
  master,
  grandmaster,
  challenger,
  iron,
  emerald
}

export function tierImage(tier: string | undefined): string {
  const normalized = (tier || 'unranked').toLocaleLowerCase()
  return tierImages[normalized] || unranked
}
