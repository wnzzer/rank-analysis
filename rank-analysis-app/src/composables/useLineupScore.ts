/**
 * 选人期「阵容强度分」取数 composable（D-P2 选人期 tab 的确定性事实来源）。
 *
 * 监听 subteams 里已锁定（pickState === 'locked'）的英雄集合，变化后防抖取 OP.GG
 * meta，用 lineupScore 纯函数聚合成双方强度分。强度分是给 AI 引用的确定性事实——
 * 取数失败保持上次分数，score 为 null 时下游（buildChampSelectPrompt）自动省略小节，
 * 绝不把错误数字喂给模型。
 */

import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import {
  computeLineupScore,
  computeMatchupHints,
  EMPTY_LINEUP_SCORE,
  playerLineupAdjustment,
  type LineupScore,
  type LineupScoreInput,
  type MatchupHeroInput
} from '@renderer/services/lineupScore'
import { getChampionMeta, type OpggMode } from '@renderer/services/opgg'
import {
  fetchBatchProfiles,
  type ProfileRequest
} from '@renderer/services/ai/shared/recentProfile.batch'
import type { SessionData } from '@renderer/types/domain/gaming'

export interface LineupScores {
  mine: LineupScore
  enemy: LineupScore
  /** 对位分析提示行（同分路玩家画像均值差 ≥2%，UI/AI 均可引用） */
  matchupHints: string[]
}

/** 画像加权输入 → 对位分析输入（OP.GG 英雄主分路配对；无画像按 0.5 中性计） */
function toMatchupHero(input: LineupScoreInput): MatchupHeroInput {
  const rate = input.profile ? playerLineupAdjustment(input.profile).playerRate : null
  return {
    position: input.meta?.position ?? '',
    rate
  }
}

export interface UseLineupScoreOptions {
  /** 锁定集合变化后的取数防抖（ms），默认 300 */
  debounceMs?: number
  /**
   * 是否拉取锁定玩家的近期画像（fetchBatchProfiles，LRU 缓存）做加权。
   * 默认 false（纯全局 meta 出分）；开启后分数按玩家近期表现平移。
   */
  includePlayerProfiles?: boolean
  /**
   * 进入即预取全部玩家（含未锁定）的画像，把选人期首次锁定后的请求峰值
   * 提前错峰。仅 includePlayerProfiles=true 时生效。默认 false。
   */
  prefetchProfiles?: boolean
}

interface LockEntry {
  championId: number
  /** 玩家 puuid（隐藏战绩/无有效 summoner 时为空串，跳过画像） */
  puuid: string
  /** 官方分配分路（敌方 LCU 恒为空 → UNKNOWN，不判补位） */
  position: string
}

interface LockSnapshot {
  mine: LockEntry[]
  enemy: LockEntry[]
}

function lockedPlayers(players: Array<{ championId: number; pickState?: string }>): LockEntry[] {
  return players
    .filter(p => p.championId > 0 && p.pickState === 'locked')
    .map(p => ({
      championId: p.championId,
      puuid: (p as { summoner?: { puuid?: string } }).summoner?.puuid ?? '',
      position: (p as { assignedPosition?: string }).assignedPosition ?? ''
    }))
}

function sameSnapshot(a: LockEntry[], b: LockEntry[]): boolean {
  if (a.length !== b.length) return false
  const key = (e: LockEntry) => `${e.championId}:${e.puuid}`
  const bSet = new Set(b.map(key))
  return a.every(e => bSet.has(key(e)))
}

export function useLineupScore(
  sessionData: SessionData,
  mode: MaybeRefOrGetter<OpggMode> = 'ranked',
  options: UseLineupScoreOptions = {}
): { scores: Ref<LineupScores>; loading: Ref<boolean> } {
  const debounceMs = options.debounceMs ?? 300
  const includePlayerProfiles = options.includePlayerProfiles ?? false
  const prefetchProfiles = options.prefetchProfiles ?? false
  const scores = ref<LineupScores>({
    mine: EMPTY_LINEUP_SCORE,
    enemy: EMPTY_LINEUP_SCORE,
    matchupHints: []
  })
  const loading = ref(false)

  let requestSeq = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSnapshot: LockSnapshot = { mine: [], enemy: [] }

  /**
   * 预取全部玩家画像（含未锁定）：选人期一进入就开始拉，避开首次锁定后的
   * 请求峰值。fire-and-forget——失败静默，锁定后 compute 仍会按需兜底。
   */
  async function prefetchAll(): Promise<void> {
    const subteams = sessionData.subteams ?? []
    const players = subteams.flatMap(s => s.players)
    try {
      await fetchBatchProfiles(
        players
          .filter(p => p.summoner?.puuid)
          .map(p => ({
            puuid: p.summoner.puuid,
            teamPosition: (p.assignedPosition && p.assignedPosition.length > 0
              ? p.assignedPosition
              : 'UNKNOWN') as ProfileRequest['teamPosition'],
            championId: p.championId || 0
          }))
      )
    } catch {
      // 预取失败不抛：锁定后的正常取数会重试
    }
  }

  if (includePlayerProfiles && prefetchProfiles) {
    void prefetchAll()
  }

  async function compute(snapshot: LockSnapshot): Promise<void> {
    const seq = ++requestSeq
    const modeValue = toValue(mode)
    loading.value = true
    try {
      // 画像加权（best-effort）：取数失败/无 puuid 的玩家保持纯 meta，绝不阻塞分数
      const profileMap = includePlayerProfiles
        ? await fetchBatchProfiles(
            [...snapshot.mine, ...snapshot.enemy]
              .filter(e => e.puuid.length > 0)
              .map(e => ({
                puuid: e.puuid,
                teamPosition: (e.position.length > 0
                  ? e.position
                  : 'UNKNOWN') as ProfileRequest['teamPosition'],
                championId: e.championId
              }))
          )
        : new Map()
      const fetchMeta = async (entry: LockEntry): Promise<LineupScoreInput> => {
        return {
          championId: entry.championId,
          meta: await getChampionMeta(modeValue, entry.championId),
          profile: profileMap.get(entry.puuid) ?? null
        }
      }
      const [mineInputs, enemyInputs] = await Promise.all([
        Promise.all(snapshot.mine.map(fetchMeta)),
        Promise.all(snapshot.enemy.map(fetchMeta))
      ])
      // 竞态防护：取数期间锁定集合又变了，丢弃本次结果，等 watch 下一次触发。
      if (seq !== requestSeq) return
      const matchupHints = computeMatchupHints(
        mineInputs.map(toMatchupHero),
        enemyInputs.map(toMatchupHero)
      )
      scores.value = {
        mine: computeLineupScore(mineInputs),
        enemy: computeLineupScore(enemyInputs),
        matchupHints
      }
    } catch {
      // 取数失败保持上次分数；score 为 null 时下游自动省略整小节。
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  // 注意：source 必须把「当前锁定集合」投影成新数组返回（快照语义）。
  // 若直接返回 sessionData.subteams 引用，prev 会与 current 共享同一份可变数组，
  // dedupe 拿 prev 与 current 比对时永远相等，watcher 只在同一个数组被整体替换时才触发，
  // 玩家级 mutation（championId/pickState 变化）就会漏检。
  // deep: true 让嵌套的 players 变更也能收集到依赖；快照数组本身不可变，dedupe 安全。
  watch(
    () => {
      const subteams = sessionData.subteams ?? []
      const myId = sessionData.mySubteamId ?? 0
      return {
        mine: lockedPlayers(subteams.find(s => s.subteamId === myId)?.players ?? []),
        enemy: lockedPlayers(subteams.filter(s => s.subteamId !== myId).flatMap(s => s.players)),
        mode: toValue(mode)
      }
    },
    (snapshot, prev) => {
      if (
        prev?.mode === snapshot.mode &&
        sameSnapshot(snapshot.mine, prev.mine) &&
        sameSnapshot(snapshot.enemy, prev.enemy)
      ) {
        return
      }
      lastSnapshot = { mine: snapshot.mine, enemy: snapshot.enemy }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void compute(lastSnapshot), debounceMs)
    },
    { immediate: true, deep: true }
  )

  return {
    scores,
    loading
  }
}
