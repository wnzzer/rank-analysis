/**
 * 对局详情展开区的共享数据面：容器 MatchDetailInline 一次性算出所有派生数据，
 * 通过 provide/inject 分发给各 tab 子组件（概览/数据对比/符文/事件/出装/时间线），
 * 避免每个 tab 各自重复请求与计算（段位、资源、AI 状态等只有一份）。
 */

import type { InjectionKey, Ref } from 'vue'
import type { Game, ParticipantStats } from '@renderer/types/domain/match'
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import type { SgpGameDetail } from '@renderer/services/sgp'
import type {
  useMatchDetailPlayers,
  DetailPlayer
} from '@renderer/composables/useMatchDetailPlayers'
import type { useMatchAIAnalysis } from '@renderer/composables/useMatchAIAnalysis'
import type { useMatchPlayerRanks } from '@renderer/composables/useMatchPlayerRanks'
import type { useRecordAssets } from '@renderer/composables/useRecordAssets'

export type DetailPlayersApi = ReturnType<typeof useMatchDetailPlayers>
export type MatchAIApi = ReturnType<typeof useMatchAIAnalysis>
export type MatchRanksApi = ReturnType<typeof useMatchPlayerRanks>
export type RecordAssetsApi = ReturnType<typeof useRecordAssets>

/** SGP 单局详情拉取状态（懒加载：事件/时间线 tab 首次进入时才触发） */
export type SgpDetailStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface MatchDetailContext {
  /** 当前对局（可为 null 的空态由容器统一处理，tab 内无需再判） */
  game: Readonly<Ref<Game | null>>
  /** 跨区查询目标大区 platformId（空 = 本区 LCU 数据源）；画像卡据此启用 SGP 战绩兜底 */
  region: Readonly<Ref<string>>
  /** 10 人玩家数据 + 派生的队伍分节（useMatchDetailPlayers 全量返回） */
  players: DetailPlayersApi
  /** 段位查询结果（puuid → 段位），tab 需要段位时直接读 */
  ranks: MatchRanksApi
  /** 装备/技能/符文/海克斯资源（由容器统一预加载） */
  assets: RecordAssetsApi
  /** AI 分析与弹窗状态（玩家行内 AI 按钮、AI 面板共用） */
  ai: MatchAIApi
  /** 当前是否海克斯/斗魂模式（影响符文列展示语义） */
  usesAugments: Readonly<Ref<boolean>>
  /** 主题是否为浅色（颜色类函数需要） */
  isDark: Readonly<Ref<boolean>>
  /** 复制玩家名等文本 */
  copy: (text: string) => void
  /** 由某玩家 + 当前对局拼出「遇见记录」 */
  buildEncounter: (player: DetailPlayer) => OneGamePlayer | undefined
  /** 装备/海克斯/符文 id 提取（容器预加载与各 tab 展示共用同一口径） */
  itemIds: (stats: ParticipantStats) => number[]
  playerAugmentIds: (stats: ParticipantStats) => number[]
  displayedPerkIds: (stats: ParticipantStats) => number[]
  /** SGP 单局详情（事件/时间线 tab 共用；未加载或失败为 null） */
  sgpDetail: Readonly<Ref<SgpGameDetail | null>>
  /** SGP 单局详情拉取状态 */
  sgpDetailStatus: Readonly<Ref<SgpDetailStatus>>
  /** 懒加载 DETAILS（幂等：加载中/已就绪时重复调用直接返回） */
  loadSgpDetail: () => Promise<void>
}

export const matchDetailContextKey: InjectionKey<MatchDetailContext> = Symbol('matchDetailContext')
