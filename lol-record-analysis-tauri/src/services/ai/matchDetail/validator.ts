/**
 * Stage 1 attribution 输出校验器。
 *
 * 三层校验：
 * 1. JSON parseable（兼容 ```json fenced 包装）
 * 2. Shape: verdicts 4-7 / evidenceMetrics ≥ 3 / label in enum
 * 3. Data-grounding: 每条 mitigatingFactor 必须与 snapshot 实际数据吻合
 *
 * 返回类型与 shared/twoStage.ts 的 ParseOutcome 兼容。
 */

import type { MatchSnapshot } from '../shared/snapshot'
import type { AttributionResult, Verdict, VerdictLabel, MitigatingFactorKind } from './types'

export type ValidateOutcome = { ok: true; value: AttributionResult } | { ok: false; error: string }

const ALLOWED_LABELS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>([
  '尽力',
  '犯罪',
  '被爆',
  '被连累',
  '缚地灵',
  '正常'
])

const ALLOWED_MITIGATING: ReadonlySet<MitigatingFactorKind> = new Set<MitigatingFactorKind>([
  'off-role',
  'first-time-champion',
  'team-collapse',
  'targeted'
])

const NEGATIVE_LABELS: ReadonlySet<VerdictLabel> = new Set<VerdictLabel>([
  '犯罪',
  '被爆',
  '缚地灵',
  '被连累'
])

export function validateAttribution(rawJson: string, snapshot: MatchSnapshot): ValidateOutcome {
  // ─── Layer 1: parse JSON (strip fenced wrappers) ───
  const stripped = stripFencedCodeBlock(rawJson)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${(err as Error).message}` }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'parsed value is not an object' }
  }

  const candidate = parsed as Partial<AttributionResult>
  if (typeof candidate.winReason !== 'string') {
    return { ok: false, error: 'winReason must be a string' }
  }
  if (!Array.isArray(candidate.verdicts)) {
    return { ok: false, error: 'verdicts must be an array' }
  }

  // ─── Layer 2: shape ───
  if (candidate.verdicts.length < 4 || candidate.verdicts.length > 7) {
    return {
      ok: false,
      error: `verdicts length ${candidate.verdicts.length} out of bounds [4, 7]`
    }
  }

  for (let i = 0; i < candidate.verdicts.length; i++) {
    const v = candidate.verdicts[i] as Partial<Verdict>
    if (typeof v?.participantId !== 'number') {
      return { ok: false, error: `verdict[${i}].participantId must be a number` }
    }
    if (typeof v.name !== 'string') {
      return { ok: false, error: `verdict[${i}].name must be a string` }
    }
    if (!v.label || !ALLOWED_LABELS.has(v.label as VerdictLabel)) {
      return { ok: false, error: `verdict[${i}].label invalid: ${String(v.label)}` }
    }
    if (typeof v.finalCall !== 'string') {
      return { ok: false, error: `verdict[${i}].finalCall must be a string` }
    }
    if (!Array.isArray(v.evidenceMetrics)) {
      return { ok: false, error: `verdict[${i}].evidenceMetrics must be an array` }
    }
    if (v.evidenceMetrics.length < 3) {
      return {
        ok: false,
        error: `verdict[${i}].evidenceMetrics length ${v.evidenceMetrics.length} < 3`
      }
    }
    for (let j = 0; j < v.evidenceMetrics.length; j++) {
      const m = v.evidenceMetrics[j]
      if (!m || typeof m.metric !== 'string' || typeof m.value !== 'number') {
        return {
          ok: false,
          error: `verdict[${i}].evidenceMetrics[${j}] must have {metric:string, value:number}`
        }
      }
    }
    if (!Array.isArray(v.mitigatingFactors)) {
      return {
        ok: false,
        error: `verdict[${i}].mitigatingFactors must be an array (use [] when empty)`
      }
    }
  }

  // ─── Layer 3: data-grounding（清洗，不再硬毙） ───
  // 缓解因子只是负面 verdict 上的解释性标注。模型若给出与 snapshot 对不上的因子，
  // 摘掉该因子即可：既不把未证实的说法放给用户，也不因一个小标注就废掉整份多 verdict
  // 分析（历史上 stage1 最常见的失败正是这层硬毙）。JSON / 结构仍严格校验。
  const result = candidate as AttributionResult
  for (const v of result.verdicts) {
    if (v.mitigatingFactors.length === 0) continue

    // 因子只在负面 label 上有意义；非负面一律摘除。
    if (!NEGATIVE_LABELS.has(v.label)) {
      v.mitigatingFactors = []
      continue
    }

    const playerSnap = snapshot.players.find((p: any) => p.participantId === v.participantId)
    if (!playerSnap) {
      // 找不到对应玩家，无从 grounding，摘除全部因子但保留 verdict。
      v.mitigatingFactors = []
      continue
    }

    v.mitigatingFactors = v.mitigatingFactors.filter(m =>
      isFactorGrounded(m.factor, v, playerSnap, result, snapshot)
    )
  }

  return { ok: true, value: result }
}

/**
 * 判断单个缓解因子是否被 snapshot 数据支撑。未在白名单、或证据对不上的一律返回
 * false（调用方据此摘除）。`targeted` 因 snapshot 暂无 timeline，恒不成立。
 */
function isFactorGrounded(
  factor: MitigatingFactorKind,
  v: Verdict,
  playerSnap: any,
  result: AttributionResult,
  snapshot: MatchSnapshot
): boolean {
  if (!ALLOWED_MITIGATING.has(factor)) return false
  switch (factor) {
    case 'off-role':
      return playerSnap.recentProfile?.isOffRole === true
    case 'first-time-champion':
      return playerSnap.recentProfile?.currentChampionMastery?.isFirstTimeInRecent === true
    case 'team-collapse': {
      const sameTeamCriminals = result.verdicts.filter(
        other =>
          other.participantId !== v.participantId &&
          snapshot.players.find((p: any) => p.participantId === other.participantId)?.teamId ===
            playerSnap.teamId &&
          other.label === '犯罪'
      )
      return sameTeamCriminals.length >= 2
    }
    case 'targeted':
      // snapshot 暂无 timeline 数据，无法证实 → 摘除。
      return false
    default:
      return false
  }
}

function stripFencedCodeBlock(raw: string): string {
  const trimmed = raw.trim()
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
  if (fenceMatch) return fenceMatch[1].trim()
  return trimmed
}
