/**
 * 成长报告 prompt（D-P1 用户画像 / 战绩页左栏「近 20 场趋势」卡）。
 *
 * 与选人期/对局中同构：**AI 只做解释层**。趋势事实由 user_tag 后端确定性聚合
 * （KDA/胜率/参团率/补刀速率/视野/经济/伤害），分钟画像由前端从 SGP 帧流
 * 确定性提炼（15 分钟补刀/死亡集中段/参团节奏），这里只负责任务与纪律框架。
 */

import type { RecentData } from '@renderer/types/domain/analysis'
import type { MinuteCurveInsights } from '@renderer/components/record/minuteCurve'

/**
 * 趋势事实块：把后端聚合的确定性数字排版成 AI 可直接引用的行。
 * 每行前缀「· 」避免 AI 误当 markdown 标题重排。
 */
export function growthTrendText(recent: RecentData): string {
  const total = recent.selectWins + recent.selectLosses
  const winRate = total > 0 ? ((recent.selectWins / total) * 100).toFixed(1) : '0.0'
  const goldK = Math.round(recent.averageGold / 1000)

  const lines = [
    `· 窗口：近 ${recent.samples} 场（${recent.selectModeCn || '全部模式'}，样本场次 ${recent.samples}）`,
    `· 胜率：${recent.selectWins} 胜 ${recent.selectLosses} 负（${winRate}%）`,
    `· KDA：${recent.kills}/${recent.deaths}/${recent.assists}（kda=${recent.kda}）`,
    `· 参团率：${recent.groupRate}%（按团队击杀占比）`,
    `· 补刀速率：${recent.averageCsPerMin} CS/分钟（含野怪）`,
    `· 视野得分：${recent.averageVisionScore}`,
    `· 平均经济：${goldK}k 金币，金币占比 ${recent.goldRate}%`,
    `· 平均对英雄伤害：${Math.round(recent.averageDamageDealtToChampions)}，伤害占比 ${recent.damageDealtToChampionsRate}%`
  ]
  return lines.join('\n')
}

/**
 * 分时画像事实块（D-P3）：由 SGP 帧流确定性提炼的分钟维度特征。
 * 曲线未加载/解析失败时为 null，此块不输出（纪律区禁止编造）。
 */
export function growthCurveText(insights: MinuteCurveInsights): string {
  const spike =
    insights.deathSpikeMinutes.length > 0
      ? insights.deathSpikeMinutes.map(m => `${m} 分钟`).join('、')
      : '无明显集中段'
  const fightPeak =
    insights.fightPeakMinutes.length > 0
      ? insights.fightPeakMinutes.map(m => `${m} 分钟`).join('、')
      : '节奏平缓'
  return [
    `· 15 分钟累计补刀：${insights.csAt15}（25 分钟：${insights.csAt25}）`,
    `· 死亡时机：15 分钟前累计 ${insights.deathsBy15} 次，全场累计 ${insights.deathsTotal} 次，集中段 ${spike}`,
    `· 参团节奏：每分钟平均 ${insights.avgFightsPerMin} 个参团击杀，活跃段 ${fightPeak}`
  ].join('\n')
}

/** 生成成长报告 prompt。纯函数，无异步依赖。 */
export function buildGrowthReportPrompt(
  recent: RecentData,
  curveInsights?: MinuteCurveInsights | null
): string {
  const sections: string[] = [
    '你是 LOL 玩家成长教练。基于给出的近 20 场趋势事实，写一份简短的成长报告，分三部分：',
    '1. 状态一句话：当前最值得肯定的一个数据事实',
    '2. 最大问题：挑出最差/最需要改进的一项（必须引用数字，并说明为什么它更重要）',
    '3. 下一步：一条具体可执行、可衡量的训练建议'
  ]

  sections.push(growthTrendText(recent))

  if (curveInsights) {
    sections.push('===== 分时画像（近 10 场平均，SGP 帧流确定性提炼）=====')
    sections.push(growthCurveText(curveInsights))
  }

  sections.push(
    '===== 分析纪律（硬规则，必须遵守）=====',
    '- 【趋势事实】【分时画像】是确定性计算的结果：只能引用与解释，禁止改写数字、禁止自创数据。',
    '- 未提供的维度（如未加载分时画像时）一律不分析，不猜测分钟数据。',
    '- 输出控制在 150 字以内，三部分各一行，用「- 」列表。'
  )

  return sections.join('\n\n')
}
