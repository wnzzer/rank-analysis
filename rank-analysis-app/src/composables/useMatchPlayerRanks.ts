/**
 * 战绩详情页玩家段位：按 puuid 批量取段位、按本局队列选段位、格式化为展示用文案
 *
 * 段位只能查到玩家的"当前"段位——LCU 没有"打这局时的段位"这个数据，翻旧对局时
 * 显示的是这人今天的段位。这是平台限制，UI 侧靠 tooltip 文案说明，不做数据层伪装。
 *
 * 跨区（`region` 非空）时走 SGP `leagues-ledge` rankedStats 直查（LCU 段位端点
 * 只能查当前登录区）；同区仍走 LCU 批量端点（本地更快）。
 */

import { computed, ref, watch, type MaybeRefOrGetter, toValue } from 'vue'
import { getRanksByPuuids } from '@renderer/features/record/services/rank'
import { getSgpRanksByPuuids } from '@renderer/features/record/services/sgp'
import {
  hasRealTier,
  formatTierText,
  formatCompactTierText,
  pickQueueInfoByQueueId
} from '@renderer/utils/rank'
import { tierImage } from '@renderer/utils/tier-image'
import type { Rank } from '@renderer/types/domain/player'

export interface MatchPlayerTier {
  /** 段位图标 URL */
  imgUrl: string
  /** 短文案，如「钻石 IV」，用于紧凑的玩家行；大师及以上不带胜点数字（见 formatCompactTierText），避免撑破固定宽度槽位 */
  shortText: string
  /** hover 提示文案：注明这是"当前段位"而非本局对局时的段位 */
  tooltipText: string
}

/** 详情页取段位只需要 puuid，避免与 DetailPlayer 强耦合 */
export interface RankLookupPlayer {
  puuid: string
}

/**
 * 批量取一局玩家的段位，返回 puuid → 展示数据的响应式映射。
 * @param players - 详情页玩家列表（或其 getter/ref）
 * @param queueId - 本局队列 ID（`Game.queueId`），决定展示单双排还是灵活段位
 * @param region - 目标大区 platformId（跨区/SGP 查询时传，如 `HN10`；空 = 当前区走 LCU）
 * @returns `tiersByPuuid`：puuid → {@link MatchPlayerTier}；无数据/未定级/请求失败/尚未加载完成时值为 `null`
 */
export function useMatchPlayerRanks(
  players: MaybeRefOrGetter<RankLookupPlayer[]>,
  queueId: MaybeRefOrGetter<number | undefined>,
  region: MaybeRefOrGetter<string | undefined> = ''
) {
  /** puuid → 原始 Rank；null 表示已请求但失败或本就没有该玩家的数据 */
  const ranksByPuuid = ref<Record<string, Rank | null>>({})

  async function loadRanks(puuids: string[]) {
    // 已经取过（无论成功/失败）的 puuid 不重复发起——服务层本身也有缓存/去重，
    // 这里只是省一趟 await；真正防抖/防重的活交给 services/rank.ts
    const targets = [...new Set(puuids.filter(Boolean))].filter(p => !(p in ranksByPuuid.value))
    if (targets.length === 0) return

    // 一次 IPC 拿整批（Rust 侧并发 + 30min 缓存），单人失败返回 null 不拖垮整批。
    // 整批失败时不写 ranksByPuuid——下次打开详情还能重试。
    try {
      const targetRegion = toValue(region)
      const results = targetRegion
        ? await getSgpRanksByPuuids(targetRegion, targets)
        : await getRanksByPuuids(targets)
      const next = { ...ranksByPuuid.value }
      for (const puuid of targets) {
        // 整体失败时 results 缺该 key → 跳过，不标记"已请求"，保留下次重试机会
        if (puuid in results) next[puuid] = results[puuid]
      }
      ranksByPuuid.value = next
    } catch (error) {
      console.warn('[useMatchPlayerRanks] batch rank lookup failed:', error)
    }
  }

  watch(
    () =>
      toValue(players)
        .map(p => p.puuid)
        .join(',') +
      '|' +
      (toValue(region) ?? ''),
    () => {
      void loadRanks(toValue(players).map(p => p.puuid))
    },
    { immediate: true }
  )

  const tiersByPuuid = computed<Record<string, MatchPlayerTier | null>>(() => {
    const qid = toValue(queueId) ?? 0
    const out: Record<string, MatchPlayerTier | null> = {}
    for (const player of toValue(players)) {
      if (!player.puuid) continue
      const rank = ranksByPuuid.value[player.puuid]
      if (!rank) {
        out[player.puuid] = null
        continue
      }
      const q = pickQueueInfoByQueueId(rank, qid)
      if (!hasRealTier(q)) {
        out[player.puuid] = null
        continue
      }
      out[player.puuid] = {
        imgUrl: tierImage(q.tier),
        shortText: formatCompactTierText(q),
        tooltipText: `${q.queueTypeCn}当前段位：${formatTierText(q)}（非本局当时段位，LCU 仅能查询玩家当前段位）`
      }
    }
    return out
  })

  return { tiersByPuuid }
}
