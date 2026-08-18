/**
 * 「遇见过」玩家库查询（Rust `command::meet`）
 *
 * 会话流程（get_session_data）把每次遇到的对手逐场 upsert 进本机
 * meet.db（SQLite），本封装提供按 puuid 查询累计聚合 + 最近明细。
 */
import { invoke } from '@tauri-apps/api/core'
import type { MeetSummary } from '@renderer/types/domain/meet'

/**
 * 查询某玩家（puuid）的累计相遇聚合与最近明细。
 *
 * 库未就绪 / 该玩家无记录 / 查询失败均返回 null（不视为错误，
 * 调用方回退到本地备注里的 encounters 展示）。
 */
export async function queryMeetSummary(puuid: string): Promise<MeetSummary | null> {
  try {
    const summary = await invoke<MeetSummary>('query_meet_summary', { puuid })
    if (summary && summary.total > 0) return summary
    return null
  } catch (err) {
    console.error('[meet] queryMeetSummary failed:', err)
    return null
  }
}
