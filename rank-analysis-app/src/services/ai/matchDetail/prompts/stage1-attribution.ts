/**
 * Stage 1 公共 prompt 骨架。
 *
 * 输入：完整 MatchSnapshot（含 modeContext + recentProfile）
 * 输出：要求 AI 返回严格 JSON（AttributionResult 形状）
 *
 * 各模式 addon (ranked / aram / augment) 的追加规则通过参数注入到骨架末尾。
 */

import type { MatchSnapshot } from '../../shared/snapshot'

export function buildStage1Prompt(snapshot: MatchSnapshot, addonRules: string): string {
  const mc = snapshot.modeContext
  return `你是 LOL 单场归因分析师。基于下面这场比赛的快照 + 玩家近期摘要，
判断每个值得点名的玩家归类为：尽力 / 犯罪 / 被爆 / 被连累 / 缚地灵 / 正常，
并给出数据证据。

【模式上下文】
${mc.description}

hasLanes: ${mc.hasLanes}
hasItemBuild: ${mc.hasItemBuild}
hasAugmentSystem: ${mc.hasAugmentSystem}
championAssignment: ${mc.championAssignment}
isTeamMode: ${mc.isTeamMode}

【硬性规则】
- 只能基于 snapshot 实际存在的字段做结论，不要编造对线细节、团战时间点、装备效果。
- hasLanes=false 时禁止提到任何路位名称（含上/中/下/打野/辅助等位置概念）。
- championAssignment='random' 或 'random-with-bench' 时禁止提到"补位"、"英雄选择失误"、"BP劣势"。
- hasItemBuild=false 时禁止评价装备走向或出装顺序。
- snapshot.players[i].recentProfile=null 时禁止判断该玩家"是否补位"、"熟练度"。
- snapshot.players[i].recentProfile.isOffRole=true 时可采用申辩降级；反之不要瞎编"可能在补位"。
- teamPosition=UTILITY（辅助）的玩家：damageShare / goldShare 低**不构成负面证据**——辅助伤害低是本分。对其评价与定罪改用 killParticipation / assists / wardScore；下方"被爆/缚地灵"标准里的 damageShare/goldShare 条件对辅助同理替换。
- finalCall 及所有文字中提及某玩家的分路/位置时，必须以该玩家 snapshot 的 teamPosition 为准，禁止凭英雄或直觉推断。

【TS 已算好的事实（直接消费，不要重新推断）】
- isOffRole: bool — 本局位置在近期占比 < 0.2
- offRoleSeverity: 'none' | 'mild' | 'severe' — < 0.2 severe / < 0.4 mild / 其它 none
- currentChampionMastery.isFirstTimeInRecent: bool — 近 20 场没玩过该英雄
- currentChampionMastery.isOnetrick: bool — 单一英雄占比 > 0.5
- mainPosition: TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY|UNCLEAR — 主玩位置（占比≥40%才认）
直接采用这些字段的值，不要重新计算。

【使用者主观备注】
- recentProfile.note: 使用者对该玩家的主观历史印象（[色档] 文本），仅供参考，
  不作为事实依据，不得写入 evidenceMetrics。

【标签定义（量化标准）】
- 尽力：数据明显高于队内均值（伤害占比/经济占比/参团率中任意 2 项进入队内前 2）+ 该队伍胜
- 犯罪：数据明显低于队内均值（死亡数最多 + 参团 < 30% + KDA 队内倒数）+ 该队伍输
- 被爆：deaths 高 + damageShare 低 + goldShare 低，且无 isOffRole / first-time-champion 等申辩
- 被连累：个人数据合格但队伍输（damageShare ≥ 25% + KDA ≥ 团队均值，但 win=false）
- 缚地灵：killParticipation < 团队平均 - 15% + assists 低 + cs/damage 不低
- 正常：以上都不符合

【输出严格 JSON（无前后缀，无 markdown 代码块）】
{
  "winReason": "为什么胜方赢/败方输的核心因果链，2-3 句",
  "verdicts": [
    {
      "participantId": 1,
      "name": "玩家名",
      "label": "尽力" | "犯罪" | "被爆" | "被连累" | "缚地灵" | "正常",
      "evidenceMetrics": [
        { "metric": "kda", "value": 1.2, "teamRank": 5, "note": "队内倒数第一" }
      ],
      "mitigatingFactors": [
        { "factor": "off-role", "support": "isOffRole=true, mainPosition=JUNGLE, 本局打 TOP" }
      ],
      "finalCall": "一句话归因，必须引用 ≥2 个数字"
    }
  ]
}

evidenceMetrics 至少 3 条。可选指标：kda / kills / deaths / assists / damageShare /
damageTakenShare / goldShare / killParticipation / dpm / gpm / csm / multiKills.* /
wardScore / turretDamage。

mitigatingFactors 仅在 label 为负面（犯罪/被爆/缚地灵）时填，且必须基于 snapshot 数据：
- factor='off-role'              要求该玩家 recentProfile.isOffRole === true
- factor='first-time-champion'   要求 currentChampionMastery.isFirstTimeInRecent === true
- factor='team-collapse'         要求同队其他 ≥2 人 verdict.label === '犯罪'
- factor='targeted'              当前 snapshot 无 timeline 数据，暂禁用此 factor

【对哪些玩家出 verdict】
- 必出：双方队伍中击杀 TOP1 玩家 / 双方队伍中死亡 TOP1 玩家 / 当前用户（isMe=true）
- 可选追加：damageShare > 35% 或 < 12% / KDA 极端 / 多杀次数 ≥ triple
- 总数 4-7 个 verdict（去重后），按团队成绩相关性从高到低排序

【对局快照】
${JSON.stringify(snapshot)}

【模式追加规则】
${addonRules}
`
}
