/**
 * 战绩清单导出（纯本地）：CSV（基础/完整字段）与 JSON 全量两种格式。
 * 文本经 Rust 侧系统保存对话框落盘（webview 不持有裸路径）。
 */
import { invoke } from '@tauri-apps/api/core'
import type { Game } from '../types/domain/match'

export type ExportFormat = 'csv' | 'csv-full' | 'json'

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

const CSV_HEAD_BASE = [
  '对局时间',
  '模式',
  '英雄',
  '队伍',
  '结果',
  '击杀',
  '死亡',
  '助攻',
  'KDA',
  '时长',
  '对手英雄'
]
const CSV_HEAD_EXTRA = ['补刀', '经济', '视野']

/** 防御性读取 LCU/SGP 明细中可能存在、domain 未收录的对位字段 */
interface DetailParticipant {
  teamId: number
  championId: number
  teamPosition?: string
}

/** 找对位敌人：优先按 teamPosition 匹配；无对位信息时返回空串（不编造） */
function findOpponentChampion(game: Game, me: Game['participants'][number]): string {
  const pos = (me as DetailParticipant).teamPosition
  if (!pos || pos === 'UNKNOWN') return ''
  const enemies = game.participants.filter(p => p.teamId !== me.teamId) as DetailParticipant[]
  const opp = enemies.find(e => e.teamPosition === pos)
  return opp ? String(opp.championId) : ''
}

function gameRow(
  g: Game,
  champLabel: (championId: number) => string,
  extended: boolean
): Array<string | number> {
  const p = g.participants[0]
  const st = p.stats
  const kda = st.deaths === 0 ? 'Perfect' : ((st.kills + st.assists) / st.deaths).toFixed(2)
  const base = [
    g.gameCreationDate,
    g.queueName || g.gameMode,
    champLabel(p.championId),
    p.teamId === 100 ? '蓝' : p.teamId === 200 ? '红' : `#${p.teamId}`,
    st.win ? '胜' : '负',
    st.kills,
    st.deaths,
    st.assists,
    kda,
    formatDuration(g.gameDuration),
    findOpponentChampion(g, p)
  ]
  if (!extended) return base.slice(0, base.length - 1)
  return [...base, st.totalMinionsKilled ?? '', st.goldEarned ?? '', st.visionScore ?? '']
}
export function gamesToCsv(
  games: Game[],
  champLabel: (championId: number) => string,
  extended = false
): string {
  const head = extended ? [...CSV_HEAD_BASE, ...CSV_HEAD_EXTRA] : CSV_HEAD_BASE
  // BOM：让 Excel 按 UTF-8 打开中文不乱码；行尾 CRLF 兼容 Excel 换行
  return (
    '\uFEFF' +
    [head, ...games.map(g => gameRow(g, champLabel, extended))]
      .map(r => r.map(csvEscape).join(','))
      .join('\r\n')
  )
}

/** JSON 全量导出：完整 Game 结构 + 元信息，可 roundtrip 还原 */
export function gamesToJson(games: Game[]): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), count: games.length, games },
    null,
    2
  )
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  // 精确到秒：同分钟内连续导出不再生成同名文件
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export type ExportResult = { status: 'saved'; path: string } | { status: 'cancelled' }

export interface ExportOptions {
  format?: ExportFormat
  /** CSV 完整字段开关（json 恒为全量，忽略此项） */
  extended?: boolean
}

const FORMAT_KEY = 'record.exportFormat'
const FORMATS: ExportFormat[] = ['csv', 'csv-full', 'json']

/** 记住的导出格式（localStorage）；无记录或非法值时回退 csv */
export function loadExportFormat(): ExportFormat {
  try {
    const v = localStorage.getItem(FORMAT_KEY) as ExportFormat | null
    return v && FORMATS.includes(v) ? v : 'csv'
  } catch {
    return 'csv'
  }
}

export function saveExportFormat(format: ExportFormat): void {
  try {
    localStorage.setItem(FORMAT_KEY, format)
  } catch {
    /* 隐私模式写失败静默 */
  }
}

/** 弹保存对话框并写入；用户取消返回 cancelled */
export async function exportMatches(
  games: Game[],
  champLabel: (championId: number) => string,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const { format = 'csv', extended = false } = options
  const ext = format === 'json' ? 'json' : 'csv'
  const contents = format === 'json' ? gamesToJson(games) : gamesToCsv(games, champLabel, extended)
  const path = await invoke<string | null>('save_text_file', {
    fileName: `rank-analysis-matches-${stamp()}.${ext}`,
    contents
  })
  return path ? { status: 'saved', path } : { status: 'cancelled' }
}
