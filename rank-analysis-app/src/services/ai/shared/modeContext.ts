/**
 * 模式分类。把 queueId / gameMode 翻译为给 AI 用的模式语义描述符。
 *
 * 三档 + 兜底：
 * - ranked  : 召唤师峡谷有 BP 的模式
 * - augment : 强化系统模式（海克斯乱斗、斗魂竞技场）
 * - aram    : 随机英雄但无强化系统的模式
 * - unknown : 兜底走 aram 语义（最宽容）
 */

import type { ModeContext } from './types'

const RANKED_QUEUE_IDS = new Set([420, 440, 430, 480, 490, 700])
const ARAM_QUEUE_IDS = new Set([450, 900, 1300, 1900])
const AUGMENT_QUEUE_IDS = new Set([1700, 2400])

export function classifyMode(queueId: number, gameMode: string): ModeContext {
  if (gameMode === 'CHERRY' || queueId === 1700) {
    return buildAugmentContext(queueId, gameMode, /* isTeamMode */ true)
  }
  if (AUGMENT_QUEUE_IDS.has(queueId)) {
    return buildAugmentContext(queueId, gameMode, /* isTeamMode */ false)
  }
  if (RANKED_QUEUE_IDS.has(queueId)) {
    return buildRankedContext()
  }
  if (ARAM_QUEUE_IDS.has(queueId)) {
    return buildAramContext()
  }
  return { ...buildAramContext(), kind: 'aram' }
}

function buildRankedContext(): ModeContext {
  return {
    kind: 'ranked',
    description:
      '5v5 召唤师峡谷。玩家自选英雄，有 BP 阶段，分上中下打野辅助五个位置。' +
      '可基于位置、英雄熟练度、对线克制、装备走向分析。',
    hasLanes: true,
    hasItemBuild: true,
    hasAugmentSystem: false,
    championAssignment: 'pick',
    isTeamMode: false
  }
}

function buildAramContext(): ModeContext {
  return {
    kind: 'aram',
    description:
      '大乱斗类（单线、随机英雄）。玩家英雄是随机分配的，无打野，无传统路位。' +
      '禁止用"补位"或"英雄选择"评价。评价应侧重团战参与、伤害承伤、节奏感。',
    hasLanes: false,
    hasItemBuild: true,
    hasAugmentSystem: false,
    championAssignment: 'random-with-bench',
    isTeamMode: false
  }
}

function buildAugmentContext(queueId: number, gameMode: string, isTeamMode: boolean): ModeContext {
  const teamModeLine = isTeamMode ? '本模式为 2v2 配对（每队两人），评价应包含双人配合。' : ''
  return {
    kind: 'augment',
    description:
      `强化模式（queueId=${queueId}, gameMode=${gameMode}）。英雄随机分配，有强化系统。` +
      '评价应侧重强化构筑选择、套装搭配、与队友强化的协同。' +
      '禁止评价装备出装顺序或对线。' +
      teamModeLine,
    hasLanes: false,
    hasItemBuild: false,
    hasAugmentSystem: true,
    championAssignment: 'random',
    isTeamMode
  }
}
