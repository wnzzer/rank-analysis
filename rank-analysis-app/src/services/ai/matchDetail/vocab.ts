/**
 * matchDetail Stage 2 的锐评词库样本。
 *
 * 复用 tagSuggest 的词库与采样器：好标签（carry/抗压/古风/梗）+ 坏标签
 * （调侃自嘲/翻车/演员系/反讽）合并后跨类别均匀采样 30-50 词，注入
 * `buildCritiqueUserPrompt` 的【词库提示】（可采用、可创造新词）。
 *
 * 硬约束：过滤 `PERMANENT_BANNED_NAMES`（送葬人/carry王/演员王/送人头），
 * 与 tagSuggest 命名禁用口径一致。
 */

import { GOOD_VOCAB } from '../tagSuggest/vocab/good'
import { BAD_VOCAB } from '../tagSuggest/vocab/bad'
import { sampleVocab, type SampleOptions } from '../tagSuggest/vocab/sampler'
import { PERMANENT_BANNED_NAMES } from '../tagSuggest/validator'

type VocabRecord = Readonly<Record<string, readonly string[]>>

/** 好 + 坏词库合并。键名带来源前缀，避免两库同类别名（acerbic/classical/meta）互相覆盖 */
const CRITIQUE_VOCAB: VocabRecord = Object.fromEntries(
  (
    [
      ['good', GOOD_VOCAB],
      ['bad', BAD_VOCAB]
    ] as const
  ).flatMap(([prefix, record]) =>
    Object.entries(record).map(([cat, words]) => [`${prefix}:${cat}`, words])
  )
)

/**
 * 采样锐评词库样本。
 *
 * @param options - 透传采样器选项（count/seed，测试用确定性 seed）
 * @returns 已过滤禁用词、跨类别打散的词数组（默认 30-50 词）
 */
export function sampleCritiqueVocab(options: SampleOptions = {}): string[] {
  const banned = new Set(PERMANENT_BANNED_NAMES)
  const clean: Record<string, readonly string[]> = {}
  for (const [key, words] of Object.entries(CRITIQUE_VOCAB)) {
    const filtered = words.filter(w => !banned.has(w))
    if (filtered.length) clean[key] = filtered
  }
  return sampleVocab(clean, options)
}
