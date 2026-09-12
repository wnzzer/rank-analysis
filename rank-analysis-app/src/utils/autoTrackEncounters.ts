/**
 * 备注遇见记录的被动追踪编排
 *
 * 从「我自己」战绩查询结果里的同场玩家映射（`RecentData.oneGamePlayersMap`）中，
 * 筛出已有备注的人，一次性合并进各自的遇见记录。是否「查询对象是我自己」、要不要
 * 排除自己这个 puuid，由调用方（`UserRecord.vue`）判断——本函数只负责「遍历 map →
 * 挑出命中备注的 puuid → 一次调用批量写入」这一步，拆成纯函数便于独立单测。
 *
 * 特意把所有命中的 puuid 收集成一个数组、只调一次 `recordEncountersBatch`，而不是
 * 逐个 puuid 各调一次——每次调用最终都会落盘（persist）+ 跨窗口广播，逐个调用会在
 * 瞬间打出多份并发的整表写入，底层 config 写入没有互斥，是真实的数据风险，不只是
 * 效率问题。
 *
 * @module utils/autoTrackEncounters
 */
import type { OneGamePlayer } from '@renderer/types/domain/analysis'
import type { PlayerNote } from '@renderer/types/domain/playerNote'

/**
 * @param oneGamePlayersMap - 后端 `RecentData.oneGamePlayersMap`（puuid → 该局记录列表），
 *   查询对象最近 20 场里的所有同场玩家；无数据时为 `null`/`undefined`
 * @param getNote - 判断某 puuid 是否已有备注（不含墓碑），通常是 `notesStore.getNote`
 * @param recordEncountersBatch - 实际写入方法，通常是 `notesStore.recordEncountersBatch`；
 *   失败会被本函数吞掉（不阻断战绩页渲染，也不需要调用方处理）
 */
export function autoTrackEncounters(
  oneGamePlayersMap: Record<string, OneGamePlayer[]> | null | undefined,
  getNote: (puuid: string) => PlayerNote | undefined,
  recordEncountersBatch: (
    entries: Array<{ puuid: string; games: OneGamePlayer[] }>
  ) => Promise<void>
): void {
  if (!oneGamePlayersMap) return
  const entries = Object.entries(oneGamePlayersMap)
    .filter(([puuid]) => getNote(puuid))
    .map(([puuid, games]) => ({ puuid, games }))
  if (entries.length === 0) return
  Promise.resolve(recordEncountersBatch(entries)).catch(() => {})
}
