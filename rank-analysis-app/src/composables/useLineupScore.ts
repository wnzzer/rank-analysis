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
  toLineupInputs,
  EMPTY_LINEUP_SCORE,
  type LineupScore,
  type LineupScoreInput
} from '@renderer/services/lineupScore'
import { getChampionMeta, type OpggMode } from '@renderer/services/opgg'
import type { SessionData } from '@renderer/types/domain/gaming'

export interface LineupScores {
  mine: LineupScore
  enemy: LineupScore
}

export interface UseLineupScoreOptions {
  /** 锁定集合变化后的取数防抖（ms），默认 300 */
  debounceMs?: number
}

interface LockSnapshot {
  mine: number[]
  enemy: number[]
}

function lockedIds(players: Array<{ championId: number; pickState?: string }>): number[] {
  return players.filter(p => p.championId > 0 && p.pickState === 'locked').map(p => p.championId)
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every(x => bSet.has(x))
}

export function useLineupScore(
  sessionData: SessionData,
  mode: MaybeRefOrGetter<OpggMode> = 'ranked',
  options: UseLineupScoreOptions = {}
): { scores: Ref<LineupScores>; loading: Ref<boolean> } {
  const debounceMs = options.debounceMs ?? 300
  const scores = ref<LineupScores>({ mine: EMPTY_LINEUP_SCORE, enemy: EMPTY_LINEUP_SCORE })
  const loading = ref(false)

  let requestSeq = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSnapshot: LockSnapshot = { mine: [], enemy: [] }

  async function compute(snapshot: LockSnapshot): Promise<void> {
    const seq = ++requestSeq
    const modeValue = toValue(mode)
    loading.value = true
    try {
      const fetchMeta = async (id: number): Promise<LineupScoreInput> => {
        return { championId: id, meta: await getChampionMeta(modeValue, id) }
      }
      const [mineInputs, enemyInputs] = await Promise.all([
        Promise.all(snapshot.mine.map(fetchMeta)),
        Promise.all(snapshot.enemy.map(fetchMeta))
      ])
      // 竞态防护：取数期间锁定集合又变了，丢弃本次结果，等 watch 下一次触发。
      if (seq !== requestSeq) return
      const metaById = (inputs: LineupScoreInput[]) =>
        new Map(inputs.map(i => [i.championId, i.meta]))
      scores.value = {
        mine: computeLineupScore(toLineupInputs(snapshot.mine, metaById(mineInputs))),
        enemy: computeLineupScore(toLineupInputs(snapshot.enemy, metaById(enemyInputs)))
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
        mine: lockedIds(subteams.find(s => s.subteamId === myId)?.players ?? []),
        enemy: lockedIds(subteams.filter(s => s.subteamId !== myId).flatMap(s => s.players)),
        mode: toValue(mode)
      }
    },
    (snapshot, prev) => {
      if (
        prev?.mode === snapshot.mode &&
        sameSet(snapshot.mine, prev.mine) &&
        sameSet(snapshot.enemy, prev.enemy)
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
