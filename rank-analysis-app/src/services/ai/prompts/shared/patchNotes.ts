/**
 * 【本版本英雄改动】prompt 区块构建（选人期与对局中分析共用）。
 * 数据源：services/patchNotes（国服公告优先，Wiki 兜底，失败/无改动 → null 降级）。
 */

import { getChampionName } from '../../champion-names'
import { getChampionPatchNote } from '@renderer/services/patchNotes'
import type { ChangeDirection } from '@renderer/services/patchNotes'

/** 改动方向 → 中文 */
export const DIRECTION_CN: Record<ChangeDirection, string> = {
  buff: '加强',
  nerf: '削弱',
  adjusted: '调整'
}

/** 单英雄改动条目上限——当前公告单英雄普遍 ≤6 条，超出截断防 prompt 膨胀 */
const PATCH_LINES_MAX = 8

/**
 * 构建【本版本英雄改动】区块内容（不含标题行）。
 * 只列有改动的英雄；双方均无改动时返回固定句，让模型明确"没有"而不是自行脑补。
 * @param entries - (敌我前缀, championId) 列表，顺序即输出顺序
 */
export async function buildPatchNotesBlock(
  entries: { side: string; championId: number }[]
): Promise<string> {
  const notes = await Promise.all(
    entries.map(async e => ({ ...e, note: await getChampionPatchNote(e.championId) }))
  )
  const lines = notes
    .filter(e => e.note)
    .map(e => {
      const note = e.note!
      const truncated = note.lines.length > PATCH_LINES_MAX
      const body = note.lines.slice(0, PATCH_LINES_MAX).join('；') + (truncated ? '…' : '')
      return `- ${e.side}${getChampionName(e.championId)}｜${DIRECTION_CN[note.direction]}：${body}`
    })
  return lines.length > 0 ? lines.join('\n') : '双方英雄本版本均无官方改动。'
}

/** 【本版本英雄改动】的标准标题行（与纪律区"机制引用唯一例外"措辞配套） */
export const PATCH_NOTES_SECTION_HEADER =
  '【本版本英雄改动】（数据源：国服更新公告；只列有改动的英雄，未列出=本版本无改动）'
