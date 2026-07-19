/**
 * Stage 2 — 锐评命名 prompt。
 *
 * 输入：Stage 1 的 ProfileSummary + 词库采样 + 该 puuid 最近用过的名字
 * 输出：每个 candidate 的 { id, name, desc }
 *
 * 关键设计：
 * - 完全不在 prompt 里嵌入 TagCondition schema（命名只关心 name + desc）
 * - 词库动态注入，永远不固化在 system prompt 里 → 避免 few-shot exemplar bias
 * - recentlyUsed 是 puuid 级 LRU，硬性强制 AI 换词
 */

import type { ProfileSummary } from '../types'

const PERMANENT_BANNED_LITERAL = '送葬人、carry王、演员王、送人头'

/**
 * 构造 Stage 2 system prompt。词库与禁用名采用动态注入，每次调用都是新的。
 *
 * @param profile         - Stage 1 输出的 ProfileSummary
 * @param vocabSample     - 词库采样器抽出的 30-50 个词（混合 good + bad）
 * @param recentlyUsed    - 该 puuid 近期已用过的名字（反重复）
 */
export function buildStage2SystemPrompt(
  profile: ProfileSummary,
  vocabSample: string[],
  recentlyUsed: string[]
): string {
  const vocabLine = vocabSample.length > 0 ? vocabSample.join('、') : '(无)'
  const recentlyUsedLine = recentlyUsed.length > 0 ? recentlyUsed.join('、') : '(无)'

  return `你是 LOL 锐评命名师。基于玩家风格摘要 + 候选信号 + 词库提示，为每个候选起一个 2-7 字的锐评标签。

【创作原则】
- 锐评感优先：要有梗、能让人会心一笑
- "不人身攻击"是唯一红线（无辱骂、无地域黑、无生理攻击）
- 好/坏标签命名情绪必须匹配：
  • 好标签：褒义、中性调侃、或带制胜反讽。允许 self-aware 戏谑但不能纯贬义
  • 坏标签：调侃或贬义。禁止刺客王这种纯褒义命名给"坏"分类
- desc 长度 10-30 字，且必须精确反映 candidate 的 metric / queueName / threshold / countMin
- desc 里出现的模式名严守 queueName（如 "大乱斗" 与 "海克斯乱斗" 是两个不同模式，不要混用）

【风格摘要】
${profile.styleSummary}

【词库提示】（可采用、可创造新词、但避免下列旧梗 / 禁用词）
${vocabLine}

【禁用词】
近期已用过：${recentlyUsedLine}
永久禁用（俗套）：${PERMANENT_BANNED_LITERAL}

【输出严格 JSON】
{
  "good": [
    { "id": "g1", "name": "...", "desc": "..." }
  ],
  "bad": [
    { "id": "b1", "name": "...", "desc": "..." }
  ],
  "skipped": []
}

【选择策略】
- 从 goodCandidates 中挑 3 个最有梗的命名，其余 candidate id 放入 skipped
- bad 同上
- 创意优先，不必每个 candidate 都命名
- 输出只放 JSON，不要外裹 markdown 代码块`
}

/**
 * 构造 Stage 2 user prompt，承载 candidate 列表（不重复 styleSummary）。
 */
export function buildStage2UserPrompt(profile: ProfileSummary): string {
  return JSON.stringify({
    goodCandidates: profile.goodCandidates,
    badCandidates: profile.badCandidates
  })
}
