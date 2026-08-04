import { invoke } from '@tauri-apps/api/core'
import type {
  ChampionCollection,
  ChampionDetail,
  ChampionLane,
  MatchupSnapshot,
  MatchupTier,
  OwnedChromaCollection
} from '@renderer/types/domain/championCollection'

export function getChampionCollection(): Promise<ChampionCollection> {
  return invoke<ChampionCollection>('get_champion_collection')
}

export function getOwnedChromas(): Promise<OwnedChromaCollection> {
  return invoke<OwnedChromaCollection>('get_owned_chromas')
}

/** 英雄详情来自应用内置的公共版本快照，不需要启动英雄联盟客户端。 */
export function getChampionDetail(championId: number): Promise<ChampionDetail> {
  return invoke<ChampionDetail>('get_champion_detail', { championId })
}

/**
 * 返回按版本、段位和分路切片的全球服对位快照。
 * 数据不可用时后端返回空 rows 与明确的 partial 标记，不在前端伪造统计值。
 */
export function getChampionMatchups(
  championId: number,
  tier: MatchupTier,
  lane: ChampionLane
): Promise<MatchupSnapshot> {
  return invoke<MatchupSnapshot>('get_champion_matchups', { championId, tier, lane })
}
