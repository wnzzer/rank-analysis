/**
 * 对局标注（谁最关键 / 谁最犯罪）：模型对比的纯函数 + Rust 命令封装。
 *
 * 对应 Rust `command/match_label.rs`；云端表见 `supabase/match_labels.sql`。
 * 「模型最关键」= 全场总分最高；「模型最犯罪」= 败方总分最低（与「犯罪只判败方」一致）。
 * 上传内容只含对局标识、所选玩家的位置与英雄、模型快照，不含 puuid / 召唤师名。
 */
import { invoke } from '@tauri-apps/api/core'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'

/** 同意分享的配置键：未设置 = 未决定（首次提交时询问） */
export const MATCH_LABEL_SHARE_KEY = 'matchLabelShare'

/**
 * 被选中的一名玩家
 * @property slot - participantId（1~10）
 * @property position - teamPosition，无分路为空串
 */
export interface MatchLabelPick {
  slot: number
  teamId: number
  championId: number
  position: string
}

/** 模型快照：10 人总分 / 标签与模型自己的选择 */
export interface MatchLabelModel {
  players: Array<MatchLabelPick & { total: number; label: string }>
  keySlot: number | null
  blameSlot: number | null
}

/**
 * 一局标注（与 Rust `MatchLabel` 一致，camelCase）
 * @property labelerSide - 标注人所在方；拿不到（如看别人的对局）为 null
 * @property uploaded / updatedAt - 本地字段，由后端维护
 */
export interface MatchLabel {
  gameId: number
  platform: string
  queueId: number
  keyPick: MatchLabelPick | null
  blamePick: MatchLabelPick | null
  labelerSide: 'win' | 'lose' | null
  model: MatchLabelModel | null
  modelVersion: string
  uploaded?: boolean
  updatedAt?: number
}

/** 保存结果：uploaded = 本次已上传；error = 上传失败原因（已存本地） */
export interface SaveMatchLabelResult {
  uploaded: boolean
  error: string | null
}

/** 玩家 → 上传用的选择（不含名字） */
export function toPick(p: PlayerView): MatchLabelPick {
  return { slot: p.participantId, teamId: p.teamId, championId: p.championId, position: p.position }
}

/**
 * 模型自己的选择：最关键 = 全场总分最高，最犯罪 = 败方总分最低；没有败方或没人时为 null。
 */
export function modelPicks(players: PlayerView[]): {
  keyPid: number | null
  blamePid: number | null
} {
  const best = players.reduce<PlayerView | null>(
    (acc, p) => (acc === null || p.total > acc.total ? p : acc),
    null
  )
  const worstLoser = players
    .filter(p => !p.win)
    .reduce<PlayerView | null>((acc, p) => (acc === null || p.total < acc.total ? p : acc), null)
  return { keyPid: best?.participantId ?? null, blamePid: worstLoser?.participantId ?? null }
}

/** 提交时的模型快照 */
export function buildModelSnapshot(players: PlayerView[]): MatchLabelModel {
  const { keyPid, blamePid } = modelPicks(players)
  return {
    players: players.map(p => ({
      ...toPick(p),
      total: Math.round(p.total * 100) / 100,
      label: p.label
    })),
    keySlot: keyPid,
    blameSlot: blamePid
  }
}

/** 某玩家在本队按总分从高到低 / 从低到高的名次（1 起） */
function teamRank(p: PlayerView, players: PlayerView[], fromBottom: boolean): number {
  const mates = players.filter(q => q.teamId === p.teamId)
  return mates.filter(q => (fromBottom ? q.total < p.total : q.total > p.total)).length + 1
}

/**
 * 「你 vs 模型」的一行对比文案。
 * @param kind - key = 最关键，blame = 最犯罪
 * @param minePid - 玩家选的 participantId
 * @returns agree：与模型一致 true、不一致 false、模型没有结论 null
 */
export function compareText(
  kind: 'key' | 'blame',
  minePid: number,
  players: PlayerView[]
): { agree: boolean | null; text: string } {
  const picks = modelPicks(players)
  const modelPid = kind === 'key' ? picks.keyPid : picks.blamePid
  const mine = players.find(p => p.participantId === minePid)
  const model = players.find(p => p.participantId === modelPid)
  if (!mine || !model) return { agree: null, text: '模型结论未就绪' }
  if (mine.participantId === model.participantId)
    return { agree: true, text: `模型也选了${model.champion}` }
  const side = mine.win ? '胜方' : '败方'
  const rank =
    kind === 'key'
      ? `排${side}第 ${teamRank(mine, players, false)}`
      : `排${side}倒数第 ${teamRank(mine, players, true)}`
  return { agree: false, text: `模型选的是${model.champion}（${mine.champion}${rank}）` }
}

/**
 * 保存标注（本地），share 为 true 时同时匿名上传。
 * @throws 本地写入失败或两项都没选时抛出（由调用方提示）
 */
export async function saveMatchLabel(
  label: MatchLabel,
  share: boolean
): Promise<SaveMatchLabelResult> {
  return invoke<SaveMatchLabelResult>('save_match_label', { label, share })
}

/** 读取某局的本地标注；失败按未标注处理 */
export async function getMatchLabel(gameId: number): Promise<MatchLabel | null> {
  try {
    return await invoke<MatchLabel | null>('get_match_label', { gameId })
  } catch (error) {
    console.warn('[matchLabel] getMatchLabel failed:', error)
    return null
  }
}

/** 补传未上传的标注（仅在同意分享时调用）；失败返回 0 */
export async function retryMatchLabelUploads(): Promise<number> {
  try {
    return await invoke<number>('retry_match_label_uploads')
  } catch (error) {
    console.warn('[matchLabel] retry failed:', error)
    return 0
  }
}
