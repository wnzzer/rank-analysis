/**
 * ARAM（大乱斗类）模式的追加规则。
 * 英雄随机分配 / 无禁选阶段 / 单线 / 无打野，禁止所有路位语义。
 */

export const kind = 'aram' as const

export const rules = `
【关闭：lane 对位分析】
- 所有玩家不区分位置；hasLanes=false
- 不要在 verdict 中提到"对位"、"路上"、"打野节奏"等概念

【评价重点（必须）】
- killParticipation 高于队内平均 → 团战核心；低于队内平均 15%+ → 缚地灵候选
- damageTakenShare 高（≥ 25%）→ 抗压前排；低 + 死亡多 → 站位差
- damageShare 高（≥ 28%）→ 输出核心；低 + 队伍输 → 缚地灵或被爆
- multiKills（double/triple/quadra/penta）多 → 团战爆发能力强
- 死亡数：大乱斗死亡数普遍偏高，单纯 deaths > 8 不构成"犯罪"，必须配合参团/输出双低

【禁止评价】
- 个人对线 / 线权 / gank
- 选英雄阶段失误（英雄是随机分配的）
- 主玩位置（无路位概念）
- 装备走向"出错"的克制关系（大乱斗补给与回城受限，出装空间小）

【mitigatingFactors 规则】
- 在 ARAM 中 'off-role' / 'first-time-champion' 通常不适用，因为英雄是随机的
- 仅允许 'team-collapse' factor 生效

【finalCall 语气】
- 大乱斗讲究混战，finalCall 不要套用排位的"上路崩了"句式
- 优先用"团战 X 次没参 Y 次"、"前 3 个团里挂了 2 次"、"30 分钟伤害只占 8%"这类表述
`
