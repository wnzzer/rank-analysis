/**
 * Stage 2（整局锐评 / 单人复盘）共用的输出用语规则。
 *
 * 材料里的归因 JSON、玩家快照行是给模型读的结构化字段，模型会把键名与取值原样抄进
 * 给玩家看的正文（评测复现：「kdaDiff -6.62」「finalCall 判定」），所以要求一律翻成中文说法。
 * 评分模型的分数/分位禁令在 scoredAttribution.PLAIN_SCORE_RULES，这里只管字段名。
 */
export const STAGE2_PLAIN_LANGUAGE_RULE = `【输出用语（面向玩家，违反即废稿）】
- 正文禁止出现任何英文字段名：damageShare、damageTakenShare、goldShare、killParticipation、teamRank、evidenceMetrics、mitigatingFactors、recentProfile、finalCall、label 等一律不许写。
- 必须转成中文说法：damageShare → 伤害占比，goldShare → 经济占比，killParticipation → 参团率，damageTakenShare → 承伤占比；对位差写成「比对位少 7000 金币」「补刀比对位多 90」。
- 材料里的推理过程（字段对不上、ID 与名字不符等）不要写进正文。`
