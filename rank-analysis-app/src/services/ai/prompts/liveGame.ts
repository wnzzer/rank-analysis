/**
 * 对局中 AI 诊断 prompt（D-P2 对局中 tab）。
 *
 * 与选人期同构：**AI 只做解释层**。实时数据块由 liveGameIntel 确定性生成
 * （经济差/出装匹配/团战/死亡记录），这里只负责任务与纪律框架。
 */

import { liveIntelText } from '@renderer/features/gaming/services/liveGameIntel'
import type { LiveGameSnapshot } from '@renderer/features/gaming/services/liveGame'
import type { ItemStat } from '@renderer/services/builds'

export interface LiveGamePromptExtras {
  /** 我方召唤师名（匹配 liveclientdata.summonerName） */
  myGameName: string
  /** 我的 PUGG 出装推荐（7 槽第一名）；null/未取到 = 无推荐数据 */
  recommendedItems?: (ItemStat | null)[] | null
}

/** 生成对局中实时诊断 prompt。纯函数，无异步依赖。 */
export function buildLiveGamePrompt(
  snapshot: LiveGameSnapshot,
  extras: LiveGamePromptExtras
): string {
  const intel = liveIntelText(snapshot, extras.myGameName, extras.recommendedItems ?? null)

  const sections: string[] = [
    '你是 LOL 对局中的实时诊断助手。基于给出的实时数据，做三件事：',
    '1. 出装对比诊断：我的出装是否偏离推荐，偏离是否合理（局势/对位），给出调整建议（只说装备类别，不编造装备名或数值）',
    '2. 经济与团战预警：从双方经济差判断当前主动权；标注我方即将/可能吃亏的团战窗口',
    '3. 死亡模式提示：结合我的死亡时间与击杀者，指出重复出现的死法（被谁抓/什么时机），并给一句可执行的规避建议'
  ]

  if (intel) {
    sections.push(intel)
  } else {
    sections.push(
      '【注意】当前没有可用的实时数据（快照未含我方召唤师），请直接说明数据不足，不要编造。'
    )
  }

  sections.push(
    '===== 分析纪律（硬规则，必须遵守）=====',
    '- 【对局实时数据】是确定性计算的事实：只能引用与解释，禁止改写数字、禁止自创装备/经济/击杀数据。',
    '- 没有数据的维度（如敌方出装）一律不分析，不猜测。',
    '- 输出控制在 150 字以内的速读诊断，分三行对应三件事。'
  )

  return sections.join('\n\n')
}
