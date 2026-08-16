/**
 * 「遇见过」库（meet.db）聚合模型：与某玩家的累计相遇统计
 *
 * 对应 Rust `meet_db::MeetSummary`（`command::meet::query_meet_summary` 返回值，
 * serde 输出 camelCase）。recent 明细直接复用 {@link OneGamePlayer}。
 */
import type { OneGamePlayer } from './analysis'

export interface MeetSummary {
  /** 累计相遇场次（同队 + 敌方） */
  total: number
  /** 同队场次 */
  myTeamMeets: number
  /** 敌方场次 */
  enemyMeets: number
  /** 同队且我方获胜场次 */
  myTeamWins: number
  /** 最近一次相遇的入库时间字符串（可直接展示） */
  lastSeenAt: string
  /** 最近明细（新 → 旧，上限 20 条） */
  recent: OneGamePlayer[]
}
