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
import type {
  AttributionResult,
  Verdict,
  VerdictLabel,
  MitigatingFactorKind
} from './types'

export type ValidateOutcome =
  | { ok: true; value: AttributionResult }
  | { ok: false; error: string }

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

export function validateAttribution(
  rawJson: string,
  snapshot: MatchSnapshot
): ValidateOutcome {
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

  // ─── Layer 3: data-grounding ───
  const result = candidate as AttributionResult
  for (let i = 0; i < result.verdicts.length; i++) {
    const v = result.verdicts[i]
    if (v.mitigatingFactors.length === 0) continue

    // Mitigating factors only allowed on negative labels
    if (!NEGATIVE_LABELS.has(v.label)) {
      return {
        ok: false,
        error: `verdict[${i}] has mitigatingFactors but label='${v.label}' is not negative`
      }
    }

    const playerSnap = snapshot.players.find(
      (p: any) => p.participantId === v.participantId
    )
    if (!playerSnap) {
      return {
        ok: false,
        error: `verdict[${i}].participantId=${v.participantId} not found in snapshot`
      }
    }

    for (let j = 0; j < v.mitigatingFactors.length; j++) {
      const m = v.mitigatingFactors[j]
      if (!ALLOWED_MITIGATING.has(m.factor)) {
        return {
          ok: false,
          error: `verdict[${i}].mitigatingFactors[${j}].factor invalid: ${m.factor}`
        }
      }

      switch (m.factor) {
        case 'off-role': {
          const rp = (playerSnap as any).recentProfile
          if (!rp || rp.isOffRole !== true) {
            return {
              ok: false,
              error: `verdict[${i}] claims 'off-role' but snapshot recentProfile.isOffRole !== true`
            }
          }
          break
        }
        case 'first-time-champion': {
          const rp = (playerSnap as any).recentProfile
          const mastery = rp?.currentChampionMastery
          if (!mastery || mastery.isFirstTimeInRecent !== true) {
            return {
              ok: false,
              error: `verdict[${i}] claims 'first-time-champion' but isFirstTimeInRecent !== true`
            }
          }
          break
        }
        case 'team-collapse': {
          const sameTeamCriminals = result.verdicts.filter(
            other =>
              other.participantId !== v.participantId &&
              snapshot.players.find(
                (p: any) => p.participantId === other.participantId
              )?.teamId === (playerSnap as any).teamId &&
              other.label === '犯罪'
          )
          if (sameTeamCriminals.length < 2) {
            return {
              ok: false,
              error: `verdict[${i}] claims 'team-collapse' but only ${sameTeamCriminals.length} same-team criminals (need ≥2)`
            }
          }
          break
        }
        case 'targeted': {
          // Snapshot has no timeline data yet — this factor is always disallowed.
          return {
            ok: false,
            error: `verdict[${i}] uses 'targeted' factor which requires timeline data not in snapshot`
          }
        }
      }
    }
  }

  return { ok: true, value: result }
}

function stripFencedCodeBlock(raw: string): string {
  const trimmed = raw.trim()
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
  if (fenceMatch) return fenceMatch[1].trim()
  return trimmed
}
