/**
 * 一键导入（M3 战场五，quick win 先行）：把本机历史最流行的一套完整符文页
 * （或常用召唤师技能对）直接写进客户端。
 *
 * 纪律：数据源全本地（meet_db 收集的完整对局详情），失败如实返回错误文案
 * 供按钮展示，不静默吞错。
 */

import { invoke } from '@tauri-apps/api/core'

/** 导入符文页结果（与 Rust `ImportRuneResult` 对齐） */
export interface ImportRuneResult {
  pageId: number
  pageName: string
  /** true = 新建；false = 覆盖已有页 */
  created: boolean
  championId: number
}

/** 一键导入符文页：创建/覆盖 RA-{championId} 页并切为当前页 */
export async function importRunePage(championId: number): Promise<ImportRuneResult> {
  return await invoke<ImportRuneResult>('import_rune_page', { championId })
}

/** 一键导入召唤师技能（仅选人阶段可用）：写入我的选人动作 */
export async function importSummonerSpells(): Promise<[number, number]> {
  return await invoke<[number, number]>('import_summoner_spells')
}
