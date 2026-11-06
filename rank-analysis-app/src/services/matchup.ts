/** 对位只读命令与资源访问适配；不沿用旧 top3 克制列表作为完整推荐。 */
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { InjectionKey } from 'vue'
import { getChampionMeta } from './opgg'
import { getChampionAlias, getChampionName, loadChampionNames } from './ai/champion-names'
import { useAssetUrl } from '@renderer/composables/useAssetUrl'
import type {
  MatchupApi,
  MatchupDetail,
  MatchupList,
  MatchupPosition
} from '@renderer/types/matchup'

/** 演示/测试可覆盖访问接口，正式路径默认使用 Tauri。 */
export const MATCHUP_API: InjectionKey<MatchupApi> = Symbol('matchup-api')
/** 中文分路选择项，值与 OP.GG endpoint 一致。 */
export const MATCHUP_POSITIONS: ReadonlyArray<{ value: MatchupPosition; label: string }> = [
  { value: 'top', label: '上路' },
  { value: 'jungle', label: '打野' },
  { value: 'mid', label: '中路' },
  { value: 'adc', label: '下路' },
  { value: 'support', label: '辅助' }
]

/** 统一 LCU/OP.GG 分路命名。
 * @param value 来源分路；未知或空值不猜测。
 * @returns 五分路之一或 null。
 */
export function normalizeMatchupPosition(value?: string | null): MatchupPosition | null {
  const aliases: Record<string, MatchupPosition> = {
    top: 'top',
    jungle: 'jungle',
    mid: 'mid',
    middle: 'mid',
    adc: 'adc',
    bottom: 'adc',
    support: 'support',
    utility: 'support'
  }
  return aliases[value?.toLowerCase() ?? ''] ?? null
}

/** 正式访问器，统计只走 Rust OP.GG 模块，头像走项目资产协议。 */
export const matchupApi: MatchupApi = {
  getList: query => invoke<MatchupList>('get_matchup_list', { query }),
  getDetail: (query, candidateId) =>
    invoke<MatchupDetail>('get_matchup_detail', { query, candidateId }),
  getPosition: async enemyId =>
    normalizeMatchupPosition((await getChampionMeta('ranked', enemyId))?.position),
  loadNames: loadChampionNames,
  name: getChampionName,
  icon: id => useAssetUrl().getChampionUrl(id),
  openSource: url => openUrl(url),
  sourceUrl: (id, position, tier) => {
    const alias = getChampionAlias(id)
    return alias
      ? `https://op.gg/lol/champions/${alias.toLowerCase()}/counters/${position}?tier=${tier}`
      : null
  }
}
