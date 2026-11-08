/**
 * 复盘组件测试用的真实视图模型：入库匿名回归局 B（单双排，本人 pid 9 红方下路，对位 pid 4）。
 * 变体：无时间线、大乱斗（无分路）、斗魂竞技场（无基准）。
 */
import type { Game } from '@renderer/types/domain/match'
import {
  reviewModelFromGame,
  type ReviewModel
} from '@renderer/services/ai/review/buildReviewModel'
import { buildPuuidMap, remapTimeline } from '@renderer/services/ai/shared/timeline/remap'
import type { SlimTimeline } from '@renderer/services/ai/shared/timeline/types'
import b from '@renderer/services/ai/shared/scoring/__tests__/fixtures/regression-b.json'

const fx = b as unknown as { game: Game; slim: SlimTimeline }

/** 回归局 B 的对局（可打补丁改队列/时长） */
export function gameB(patch: Partial<Game> = {}): Game {
  return { ...fx.game, ...patch }
}

/** 回归局 B 的视图模型 */
export function modelB(opts: { patch?: Partial<Game>; timeline?: boolean } = {}): ReviewModel {
  const g = gameB(opts.patch)
  const tl = opts.timeline === false ? null : remapTimeline(fx.slim, buildPuuidMap(g))
  return reviewModelFromGame(g, tl)
}
