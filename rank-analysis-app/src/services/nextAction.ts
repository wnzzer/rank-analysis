/**
 * 对局中下一动作建议（M5a 战场四 4a 基础版）。
 *
 * 后端 `get_next_actions` 命令基于 liveclientdata 快照 + PUGG 出装生成建议，
 * reason 全模板化，不调 LLM。
 */

import { invoke } from '@tauri-apps/api/core'

export interface NextAction {
  kind: string
  championId: number
  itemId: number
  reason: string
  urgency: string
  validUntil: number
}

export const NEXT_ACTION_LABELS: Record<string, string> = {
  buy_item: '出装建议',
  recall: '回城建议',
  objective: '资源提醒'
}

export const URGENCY_COLORS: Record<string, string> = {
  high: '#e65454',
  medium: '#e6a854',
  low: '#54a8e6'
}

export async function getNextActions(
  myChampionId: number,
  myGameName: string,
  myPuuid: string,
  queueId: number
): Promise<NextAction[]> {
  return invoke<NextAction[]>('get_next_actions', {
    myChampionId,
    myGameName,
    myPuuid,
    queueId
  })
}
