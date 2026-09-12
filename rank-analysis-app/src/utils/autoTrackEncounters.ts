/**
 * 备注遇见记录的被动追踪编排
 *
 * 从「我自己」战绩查询结果里的同场玩家映射（`RecentData.oneGamePlayersMap`）中，
 * 筛出已有备注的人，逐一合并新的遇见局。是否「查询对象是我自己」由调用方
 * （`UserRecord.vue`）判断——本函数只负责「遍历 map → 命中备注的才追加」这一步，
 * 拆成纯函数便于独立单测，不必在组件层做重量级挂载测试。
 *
 * @module utils/autoTrackEncounters
 */
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import type { PlayerNote } from '@renderer/types/domain/playerNote'

/**
 * @param oneGamePlayersMap - 后端 `RecentData.oneGamePlayersMap`（puuid → 该局记录列表），
 *   查询对象最近 20 场里的所有同场玩家；无数据时为 `null`/`undefined`
 * @param getNote - 判断某 puuid 是否已有备注（不含墓碑），通常是 `notesStore.getNote`
 * @param recordEncounters - 实际写入方法，通常是 `notesStore.recordEncounters`；
 *   失败会被本函数吞掉（不阻断战绩页渲染，也不需要调用方处理）
 */
export function autoTrackEncounters(
  oneGamePlayersMap: Record<string, OneGamePlayer[]> | null | undefined,
  getNote: (puuid: string) => PlayerNote | undefined,
  recordEncounters: (puuid: string, games: OneGamePlayer[]) => Promise<void>
): void {
  if (!oneGamePlayersMap) return
  for (const [puuid, games] of Object.entries(oneGamePlayersMap)) {
    if (getNote(puuid)) {
      Promise.resolve(recordEncounters(puuid, games)).catch(() => {})
    }
  }
}
