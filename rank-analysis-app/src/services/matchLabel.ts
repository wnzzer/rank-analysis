/**
 * 对局标注（谁最关键 / 谁最犯罪）：模型对比的纯函数 + Rust 命令封装。
 *
 * 对应 Rust `command/match_label.rs`；云端表见 `supabase/match_labels.sql`。
 * 「模型最关键」= 全场总分最高；「模型最犯罪」= 败方总分最低（与「犯罪只判败方」一致）。
 * 上传内容只含对局标识、所选玩家的位置与英雄、模型快照，不含 puuid / 召唤师名。
 */
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import type { PlayerView } from '@renderer/services/ai/review/buildReviewModel'
import { BASELINE } from '@renderer/services/ai/shared/scoring/data'

/** 同意分享的配置键：未设置 = 未决定（首次提交时询问） */
export const MATCH_LABEL_SHARE_KEY = 'matchLabelShare'

/** 可选说明的最大字数（与 Rust MAX_NOTE_CHARS、表上 check 约束一致） */
export const MATCH_LABEL_NOTE_MAX = 200

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

/** AI 回应的立场；unknown = 模型输出没通过校验，走了保底文案 */
export type RebuttalStance = 'concede' | 'partial' | 'hold' | 'unknown'

/** 玩家理由所属的类别（与 Rust REBUTTAL_CATEGORIES、表上 check 约束一致） */
export type RebuttalCategory =
  'absence' | 'targeted' | 'empty_stats' | 'attitude' | 'draft' | 'teamwork' | 'other'

/** 玩家看完回应后的态度 */
export type RebuttalVerdict = 'convinced' | 'unconvinced'

/**
 * AI 对玩家理由的一次回应（与 Rust `Rebuttal` 一致）
 * @property reply - 给玩家看的回复正文（只存本地，不上传）
 * @property verdict - 玩家的态度；没点为 null
 * @property model - 生成这条回应的模型名
 * @property basis - 回应针对的选择与说明的指纹：变了才重新调用
 */
export interface MatchLabelRebuttal {
  stance: RebuttalStance
  category: RebuttalCategory
  reply: string
  verdict: RebuttalVerdict | null
  model: string
  basis: string
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
  /** 可选说明（如「下路被克制」），最多 MATCH_LABEL_NOTE_MAX 字；没填为 null */
  note?: string | null
  model: MatchLabelModel | null
  modelVersion: string
  /** AI 对玩家理由的回应；没触发过为空（旧版本存下的标注也没有） */
  rebuttal?: MatchLabelRebuttal | null
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
 * 一句话的「你 vs 模型」对比，给空间很小的地方用（赛后弹卡）。
 * @param guess - 玩家选的 participantId；没选的项为 null
 * @param players - 本局 10 人
 * @returns 如「最关键 ✓ 与 AI 一致 · 最犯罪 AI 选了诺克萨斯之手」；两项都没选为 null
 */
export function compareSummary(
  guess: { keyPid: number | null; blamePid: number | null },
  players: PlayerView[]
): string | null {
  const picks = modelPicks(players)
  const part = (title: string, minePid: number | null, modelPid: number | null): string[] => {
    if (minePid === null) return []
    const model = players.find(p => p.participantId === modelPid)
    if (!model) return []
    return [minePid === modelPid ? `${title} ✓ 与 AI 一致` : `${title} AI 选了${model.champion}`]
  }
  const parts = [
    ...part('最关键', guess.keyPid, picks.keyPid),
    ...part('最犯罪', guess.blamePid, picks.blamePid)
  ]
  return parts.length ? parts.join(' · ') : null
}

/**
 * 模型版本号：基准构建时间 + 应用版本，随标注一起保存，便于之后按版本回看。
 * @returns 形如「基准构建时间@应用版本」；非 Tauri 环境（单测 / 浏览器预览）应用版本为 unknown
 */
export async function currentModelVersion(): Promise<string> {
  let app = 'unknown'
  try {
    app = await getVersion()
  } catch {
    // 非 Tauri 环境拿不到版本号
  }
  return `${BASELINE.meta.builtAt}@${app}`
}

/**
 * 组装一局标注所需的输入
 * @property players - 本局 10 人（复盘视图模型）
 * @property keyPid - 玩家选的最关键（participantId）；没选为 null
 * @property blamePid - 玩家选的最犯罪（participantId）；没选为 null
 * @property note - 可选说明；空白视为没填
 * @property modelVersion - 见 {@link currentModelVersion}
 * @property rebuttal - AI 对玩家理由的回应；没有为空
 */
export interface MatchLabelInput {
  players: PlayerView[]
  gameId: number
  platform: string
  queueId: number
  keyPid: number | null
  blamePid: number | null
  note?: string
  modelVersion: string
  rebuttal?: MatchLabelRebuttal | null
}

/**
 * 组装一局标注（纯函数；保存见 {@link saveMatchLabel}）。
 * @param input - 对局标识、玩家的选择与模型版本
 * @returns 可直接交给 saveMatchLabel 的标注
 */
export function buildMatchLabel(input: MatchLabelInput): MatchLabel {
  const byPid = (pid: number | null): PlayerView | undefined =>
    pid === null ? undefined : input.players.find(p => p.participantId === pid)
  const key = byPid(input.keyPid)
  const blame = byPid(input.blamePid)
  const me = input.players.find(p => p.isMe)
  return {
    gameId: input.gameId,
    platform: input.platform,
    queueId: input.queueId,
    keyPick: key ? toPick(key) : null,
    blamePick: blame ? toPick(blame) : null,
    labelerSide: me ? (me.win ? 'win' : 'lose') : null,
    note: input.note?.trim() || null,
    model: buildModelSnapshot(input.players),
    modelVersion: input.modelVersion,
    rebuttal: input.rebuttal ?? null
  }
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
