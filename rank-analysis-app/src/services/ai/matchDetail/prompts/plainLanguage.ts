/**
 * Stage 2（整局锐评 / 单人复盘）共用的输出用语规则。
 *
 * 材料里的 vsLaneOpponent / roleBenchmark 等是给模型读的结构化字段，模型会把键名与
 * 取值原样抄进给玩家看的正文（评测复现：「roleBenchmark 判定为 low」「kdaDiff -6.62」），
 * 所以要求一律翻成中文说法。
 */
export const STAGE2_PLAIN_LANGUAGE_RULE = `【输出用语（面向玩家，违反即废稿）】
- 正文禁止出现任何英文字段名或英文取值：roleBenchmark、vsLaneOpponent、goldDiff、csDiff、kdaDiff、killsDiff、deathsDiff、damageShareDiff、damageShare、killParticipation、finalCall、label、low / normal / high 等一律不许写。
- 必须转成中文说法：roleBenchmark 的 low →「低于该位置常见水平」，normal →「属于该位置正常水平」，high →「高于该位置常见水平」；goldDiff -7000 →「比对位少 7000 金币」，csDiff 90 →「补刀比对位多 90」；damageShare → 伤害占比，killParticipation → 参团率。
- 材料里的推理过程（字段对不上、ID 与名字不符等）不要写进正文。`
