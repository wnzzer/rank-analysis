/**
 * AI 标签建议的 Prompt 构造器。
 *
 * - SYSTEM_PROMPT: 系统消息，包含完整的 TagCondition schema、约束和输出格式要求。
 * - buildTagSuggestPrompt: 用户消息，将赢局/输局特征数组格式化为带标签的 JSON。
 */

import type { GameFeature } from './featureExtract'

export const SYSTEM_PROMPT = `你是英雄联盟数据分析助手。任务：分析用户近 N 场对局，找赢局和输局的共同模式，提取为可复用的玩家标签规则（TagConfig 结构）。

约束：
- 标签名 2-5 字，儒雅古风（参考"中路雕将"、"暮气沉沉"），避免俗套（如"carry王"、"演员"、"送人头"）
- good 标签 2-3 个，源自"赢局"共同点；bad 标签 2-3 个，源自"输局"共同点
- 单条规则在样本中必须 ≥3 局命中，避免过拟合
- desc 字段一句话说清楚命中条件（10-30 字）
- condition 严格符合 TagCondition schema，不允许多余字段
- 不要在输出外裹 markdown 代码块；直接返回 JSON

TagCondition schema（type 字段是 camelCase；Operator 是字符串符号）：

{ "type": "and", "conditions": [TagCondition...] }
{ "type": "or", "conditions": [TagCondition...] }
{ "type": "not", "condition": TagCondition }
{ "type": "history", "filters": [MatchFilter...], "refresh": MatchRefresh }
{ "type": "currentQueue", "ids": [int...] }
{ "type": "currentChampion", "ids": [int...] }

MatchFilter:
{ "type": "queue", "ids": [int...] }
{ "type": "champion", "ids": [int...] }
{ "type": "stat", "metric": "kills"|"deaths"|"assists"|"kda"|"damage"|"gold", "op": ">"|">="|"<"|"<="|"=="|"!=", "value": number }

MatchRefresh:
{ "type": "count", "op": Operator, "value": number }
{ "type": "average", "metric": string, "op": Operator, "value": number }
{ "type": "sum", "metric": string, "op": Operator, "value": number }
{ "type": "max"|"min", "metric": string, "op": Operator, "value": number }
{ "type": "streak", "min": int, "kind": "win"|"loss" }

输出严格 JSON（bad/good 同级，均为数组）：
{
  "good": [
    { "name": "...", "desc": "...", "condition": TagCondition },
    ...
  ],
  "bad": [
    { "name": "...", "desc": "...", "condition": TagCondition },
    ...
  ]
}

good / bad 示例对比（格式参考，非真实数据）：
good: { "name": "势如破竹", "desc": "近10场胜率≥70%且平均KDA≥4", "condition": { "type": "and", "conditions": [...] } }
bad: { "name": "暮气沉沉", "desc": "近10场负多胜少且场均死亡≥6", "condition": { "type": "and", "conditions": [...] } }`

/**
 * 构造用户消息：将赢局和输局特征数组序列化为带标题的 JSON 文本。
 *
 * @param wins   - 赢局特征数组（来自 featureExtract.splitWinsLosses）
 * @param losses - 输局特征数组
 * @returns 用户消息字符串，包含 "赢局 (N=X):" 和 "输局 (N=Y):" 两段
 */
export function buildTagSuggestPrompt(wins: GameFeature[], losses: GameFeature[]): string {
  return [
    `赢局 (N=${wins.length}):`,
    JSON.stringify(wins, null, 2),
    '',
    `输局 (N=${losses.length}):`,
    JSON.stringify(losses, null, 2),
  ].join('\n')
}
