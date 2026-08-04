import type { ChampionStats, ChampionStatValue } from '@renderer/types/domain/championCollection'

/**
 * League applies champion growth non-linearly: early levels receive less than one
 * full growth unit while level 18 reaches 17 growth units. Keeping the formula here
 * makes the UI calculation independently testable and reusable.
 */
export function levelGrowthCurve(championLevel: number): number {
  const clampedLevel = Math.min(18, Math.max(1, championLevel))
  const offset = clampedLevel - 1
  return offset * (0.7025 + 0.0175 * offset)
}

export function statAtLevel(stat: ChampionStatValue, championLevel: number): number {
  return stat.base + stat.growth * levelGrowthCurve(championLevel)
}

export function attackSpeedAtLevel(
  attackSpeed: ChampionStats['attackSpeed'],
  championLevel: number
): number {
  return (
    attackSpeed.base +
    attackSpeed.ratio * ((attackSpeed.growth / 100) * levelGrowthCurve(championLevel))
  )
}
