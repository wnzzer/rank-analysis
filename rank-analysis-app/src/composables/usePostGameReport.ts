/**
 * 赛后战报的状态：排位结束进入结算页时，取刚结束那局的对局数据与本局 LP 变化，
 * 供对局页展示「本局战报」（胜负、LP、隐藏分 + 标注卡）。
 *
 * - 只对单双排 / 灵活组排（420 / 440）生效。
 * - 状态放在模块级：切页、对局页重挂载都不丢；回到大厅后仍保留，下一局进选人时清空。
 * - 不持久化：重启 app 后不再显示（该局仍可在复盘页标注）。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ref, shallowRef, watch, type Ref } from 'vue'
import type { Game } from '@renderer/types/domain/match'
import {
  getHiddenMmr,
  HIDDEN_MMR_UPDATED_EVENT,
  type HiddenMmr,
  type RankedQueueType
} from '@renderer/services/hiddenMmr'

/** 出战报的队列 → 隐藏分队列 */
export const REPORT_QUEUES: Readonly<Record<number, RankedQueueType>> = {
  420: 'RANKED_SOLO_5x5',
  440: 'RANKED_FLEX_SR'
}

/** 结算后客户端要几秒才能查到对局详情：每 3 秒重试，最多 1 分钟 */
export const POLL_INTERVAL_MS = 3000
export const POLL_ATTEMPTS = 20

/**
 * 一局战报
 * @property lpDelta - 本局 LP 变化（隐藏分功能记下的那条）；没记到为 null
 * @property mmr - 隐藏分估算；拿不到为 null
 */
export interface PostGameReport {
  game: Game
  lpDelta: number | null
  mmr: HiddenMmr | null
}

const report = shallowRef<PostGameReport | null>(null)
/** 玩家点了「跳过」：本局不再显示 */
const dismissed = ref(false)
/** 正在取数据（显示骨架） */
const loading = ref(false)
/** 正在加载 / 已加载的 gameId，防同局重复触发（PreEndOfGame 与 EndOfGame 都会来） */
let currentGameId = 0
let token = 0
/** 自己的 puuid 取值函数：在用到时再读（刚启动时可能还没拿到，不能在加载开始时就定死） */
let myPuuid: () => string = () => ''

/**
 * 取自己的 puuid：优先用页面已有的；页面刚加载、连接状态还没推过来时直接问后端。
 * 拿不到返回空串（战报照常显示，只是「我」的视角与 LP 缺失）。
 */
async function resolvePuuid(): Promise<string> {
  const known = myPuuid()
  if (known) return known
  try {
    return (await invoke<{ puuid: string }>('get_my_summoner')).puuid ?? ''
  } catch {
    return ''
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * 把 get_game_by_id 的整局数据改成「以我为视角」的形状：复盘 / 详情窗口约定
 * `participantIdentities[0]` 是当前玩家（战绩列表的局就是这样），而整局详情按 1~10 排，
 * 不改的话「我」会变成 1 号位。完整 10 人放进 gameDetail，名字 / 位置映射不受影响。
 * @param puuid - 自己的 puuid；找不到自己时原样返回
 */
export function asMyGame(game: Game, puuid: string): Game {
  const all = game.gameDetail?.participantIdentities?.length
    ? game.gameDetail.participantIdentities
    : game.participantIdentities
  if (!puuid || game.participantIdentities?.[0]?.player?.puuid === puuid) return game
  const mine = all?.find(i => i.player?.puuid === puuid)
  if (!mine) return game
  return {
    ...game,
    gameDetail: {
      ...game.gameDetail,
      participants: game.gameDetail?.participants?.length
        ? game.gameDetail.participants
        : game.participants,
      participantIdentities: all
    },
    participantIdentities: [mine]
  }
}

/** 按固定间隔重试，直到拿到非空结果或次数用完 */
async function poll<T>(fn: () => Promise<T>, isStale: () => boolean): Promise<T | null> {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    if (isStale()) return null
    try {
      return await fn()
    } catch {
      // 结算刚开始时端点常常还没就绪，下一轮再试
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return null
}

/** 取本局 LP 变化与隐藏分（隐藏分记录可能比对局数据晚到，事件到达时会再调一次） */
async function refreshLp(known?: string): Promise<void> {
  const puuid = known || (await resolvePuuid())
  const r = report.value
  const queue = r ? REPORT_QUEUES[r.game.queueId] : undefined
  if (!r || !queue || !puuid) return
  const mmr = await getHiddenMmr(puuid, queue)
  const recent = mmr?.status === 'ready' ? mmr.recent : []
  const lpDelta = recent.find(x => x.gameId === r.game.gameId)?.delta ?? null
  if (report.value?.game.gameId === r.game.gameId) report.value = { ...r, lpDelta, mmr }
}

async function load(): Promise<void> {
  const t = ++token
  const stale = () => t !== token
  loading.value = true
  try {
    const ended = await poll(
      () => invoke<{ gameId: number; queueType: string }>('get_ended_game'),
      stale
    )
    if (!ended || stale() || ended.gameId === report.value?.game.gameId) return
    currentGameId = ended.gameId
    const game = await poll(() => invoke<Game>('get_game_by_id', { gameId: ended.gameId }), stale)
    if (!game || stale()) return
    const puuid = await resolvePuuid()
    if (stale()) return
    report.value = { game: asMyGame(game, puuid), lpDelta: null, mmr: null }
    dismissed.value = false
    await refreshLp(puuid)
  } finally {
    if (!stale()) loading.value = false
  }
}

let unlisten: (() => void) | null = null

/**
 * 跟随对局阶段维护战报。
 * @param phase - 会话阶段（sessionData.phase）
 * @param queueId - 会话队列
 * @param puuid - 自己的 puuid（取隐藏分）
 */
export function usePostGameReport(
  phase: () => string,
  queueId: () => number,
  puuid: () => string
): {
  report: Ref<PostGameReport | null>
  loading: Ref<boolean>
  dismissed: Ref<boolean>
  dismiss: () => void
} {
  myPuuid = puuid
  watch(
    phase,
    p => {
      if (p === 'ChampSelect') {
        // 新一局：清掉上一局的战报
        token++
        report.value = null
        dismissed.value = false
        loading.value = false
        currentGameId = 0
        return
      }
      if ((p === 'PreEndOfGame' || p === 'EndOfGame') && REPORT_QUEUES[queueId()]) {
        // 已在加载，或这一局的战报已经有了（PreEndOfGame 与 EndOfGame 会各触发一次）
        if (loading.value) return
        if (report.value && report.value.game.gameId === currentGameId) return
        void load()
      }
    },
    { immediate: true }
  )

  // 刚启动时 puuid 可能还没拿到：拿到后补齐「我」的视角与 LP / 隐藏分
  watch(puuid, id => {
    const r = report.value
    if (!id || !r) return
    const fixed = asMyGame(r.game, id)
    if (fixed !== r.game) report.value = { ...r, game: fixed }
    void refreshLp(id)
  })

  if (!unlisten) {
    listen(HIDDEN_MMR_UPDATED_EVENT, () => void refreshLp())
      .then(fn => (unlisten = fn))
      .catch(() => {
        // 非 Tauri 环境（单测）没有事件系统
      })
  }

  return { report, loading, dismissed, dismiss: () => (dismissed.value = true) }
}

/** 单测用：重置模块级状态 */
export function __resetPostGameReport(): void {
  token++
  report.value = null
  dismissed.value = false
  loading.value = false
  currentGameId = 0
}
