/**
 * @deprecated 请从 @renderer/utils/* 和 @renderer/composables/useGameModes 导入
 * 此文件仅作为向后兼容的 re-export barrel
 */

export {
  kdaColor,
  killsColor,
  deathsColor,
  assistsColor,
  groupRateColor,
  healColorAndTaken,
  otherColor,
  winRateColor
} from '@renderer/utils/colors'
export { dotFillCount, safeRelativePercent, formatCompactNumber } from '@renderer/utils/format'
export { winRate } from '@renderer/utils/rank'
export { searchSummoner } from '@renderer/utils/navigation'
export { modeOptions, initModeOptions } from '@renderer/composables/useGameModes'
