/**
 * 战绩清单导出 CSV（纯本地）：拼装 UTF-8 BOM + CRLF 的 CSV 文本，
 * 经 Rust 侧系统保存对话框落盘（webview 不持有裸路径）。
 */
import { invoke } from '@tauri-apps/api/core'
import type { Game } from '../types/domain/match'

/** CSV 字段转义：含引号/逗号/换行时包引号并双写内部引号 */
function csvEscape(value: string | number): string {
  const s = String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function gamesToCsv(games: Game[], champLabel: (championId: number) => string): string {
  const head = ['对局时间', '模式', '英雄', '结果', '击杀', '死亡', '助攻', 'KDA', '时长']
  const rows = games.map(g => {
    const p = g.participants[0]
    const st = p.stats
    const kda = st.deaths === 0 ? 'Perfect' : ((st.kills + st.assists) / st.deaths).toFixed(2)
    return [
      g.gameCreationDate,
      g.queueName || g.gameMode,
      champLabel(p.championId),
      st.win ? '胜' : '负',
      st.kills,
      st.deaths,
      st.assists,
      kda,
      formatDuration(g.gameDuration)
    ]
  })
  // BOM：让 Excel 按 UTF-8 打开中文不乱码；行尾 CRLF 兼容 Excel 换行
  return '\uFEFF' + [head, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n')
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export type ExportResult = { status: 'saved'; path: string } | { status: 'cancelled' }

/** 弹保存对话框并写入；用户取消返回 cancelled */
export async function exportMatchesCsv(
  games: Game[],
  champLabel: (championId: number) => string
): Promise<ExportResult> {
  const path = await invoke<string | null>('save_text_file', {
    fileName: `rank-analysis-matches-${stamp()}.csv`,
    contents: gamesToCsv(games, champLabel)
  })
  return path ? { status: 'saved', path } : { status: 'cancelled' }
}
