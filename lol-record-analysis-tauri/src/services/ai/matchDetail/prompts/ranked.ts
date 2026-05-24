/**
 * Ranked（召唤师峡谷 BP）模式的追加规则。
 * 在 Stage 1 公共骨架之后注入，仅在 modeContext.kind === 'ranked' 时启用。
 */

export const kind = 'ranked' as const

export const rules = `
【启用：lane 对位分析】
- 对每个出 verdict 的玩家，在敌方队伍中找同 teamPosition 的对位玩家
- 比较 1v1 表现：金币差 / cs 差 / KDA 差 / damageShare 差
- evidenceMetrics 中至少有 1 条体现"对位"差异（如 metric='goldDiffVsLaneOpp' note='对位玩家 12k 金币，本人 8k'）
- 若该玩家 recentProfile.isOffRole === true：对位比较结果**降权**，必须在 mitigatingFactors 中明确 factor='off-role'

【启用：装备走向评价】
- snapshot.players[i].items 是 6 件主装备 itemId 数组
- 可评价：是否补出关键功能装（如 ADC 是否出第一件神话装、坦克是否出第一件防装）
- 不要编造装备数值或属性；只评价"出/没出"

【启用：英雄克制（保守表述）】
- snapshot 不含英雄属性表，禁止凭空声称"X 克制 Y"
- 仅在 recentProfile.currentChampionMastery.isFirstTimeInRecent === false 时
  允许采用通用 LOL 常识（如"短手对长手前期被压"），并用"通常情况下"软化表述
- 严禁说"BP 输了"如果 hasLanes=true 但没有英雄相性数据支撑

【position 描述用语】
- 允许使用：上路 / 中路 / 下路 / 打野 / 辅助
- 写 finalCall 时优先用中文位置名而非 TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY
`
