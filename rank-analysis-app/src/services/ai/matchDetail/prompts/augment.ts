/**
 * Augment（海克斯乱斗 / 斗魂竞技场）模式的追加规则。
 * 英雄随机 / 无 lane / 无标准装备 / 有强化系统。
 */

export const kind = 'augment' as const

export const rules = `
【关闭：lane 对位分析】
- hasLanes=false；不要使用任何路位概念

【关闭：装备相关分析】
- hasItemBuild=false；snapshot.players[i].items 为 []
- 严禁评价装备相关的购买顺序、神话装选择、合成路径等

【评价重点（必须）】
- augments[] 数量与套装搭配：
  - augments[] 长度通常 = 6（强化系统的最大格数）；少于 6 表示局未打完或玩家未选满
  - 主流套路（如纯输出堆暴击、爆发刺杀、AOE 法系）的内部一致性
  - 与英雄随机分配的契合度（hands dealt 的英雄是否能吃到当前 augments 收益）
- 与队友 augments 的协同：
  - 同队多人都点高伤害 augments 但无前排/位移 → 阵容偏科
  - 队友点了控场/盾甲类 augments 而本人点了纯爆发 → 互补打分
- KDA、damageShare 与 augments 的契合度
- multiKills：augment 局节奏快，penta 一次性贡献度极高

【isTeamMode（斗魂竞技场 CHERRY）额外】
- isTeamMode=true 时本模式为 2v2 配对，每个 team 有 2 名玩家
- 评价应包含双人配合：
  - 同队 2 人的 augments 是否互补
  - 同队 2 人的伤害分布是否极端（一个 70% 一个 8% → 抱大腿迹象）
- snapshot.teams 在斗魂模式下有 4 个队伍（teamId 0/1/2/3 对应小队）
- finalCall 提到队伍名次（第几名）而非笼统的"输了赢了"

【禁止评价】
- 装备出装 / 装备克制
- 上中下打野/辅助 / 对线 / gank
- 选英雄阶段失误（英雄是随机分配的）
- 主玩位置（无路位概念）

【mitigatingFactors 规则】
- 'off-role' 不适用（无路位）
- 'first-time-champion' 不适用（英雄随机）
- 仅允许 'team-collapse' factor 生效
- 斗魂模式（isTeamMode=true）下 'team-collapse' 的判定改为：同 teamId 的另一人 verdict.label='犯罪'
`
