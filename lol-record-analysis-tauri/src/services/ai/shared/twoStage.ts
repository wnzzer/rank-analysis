/**
 * 通用双阶段调用编排器。
 *
 * Stage 1：非流式（聚合完才校验 JSON），失败时支持重试 1 次。
 * Stage 2：流式（chunks 即时回调，但累积完才解析）。
 *
 * 失败状态用判别联合表达。
 */

import { requestAIContent, requestAIContentStream } from '../stream'

export interface ParseResult<T> {
  ok: true
  value: T
}
export interface ParseError {
  ok: false
  error: string
}
export type ParseOutcome<T> = ParseResult<T> | ParseError

export interface Stage1Config<Out> {
  systemPrompt: string
  userPrompt: string
  parse: (raw: string) => ParseOutcome<Out>
  cacheKey?: string
  retry?: number
}

export interface Stage2Config<In, Out> {
  buildSystemPrompt: (stage1Output: In) => string
  buildUserPrompt: (stage1Output: In) => string
  parse: (raw: string) => ParseOutcome<Out>
  cacheKey?: string
  retry?: number
  streamCallback?: (chunk: string) => void
}

export type TwoStageResult<S1, S2> =
  | { kind: 'ok'; stage1: S1; stage2: S2 }
  | { kind: 'stage1Error'; error: string }
  | { kind: 'stage1ParseError'; error: string; rawContent: string }
  | { kind: 'stage2Error'; error: string; stage1: S1 }
  | { kind: 'stage2ParseError'; error: string; stage1: S1; rawContent: string }

/**
 * 运行双阶段 AI 调用流程。
 *
 * Stage 1 失败（网络错误）：不重试，直接返回 stage1Error。
 * Stage 1 解析失败：重试 `stage1.retry`（默认 1）次后仍失败则返回 stage1ParseError。
 * Stage 2 失败（网络错误）：返回 stage2Error，附带 stage1 数据。
 * Stage 2 解析失败：返回 stage2ParseError，附带 stage1 数据，调用方可降级渲染。
 */
export async function runTwoStage<Stage1Out, Stage2Out>(opts: {
  stage1: Stage1Config<Stage1Out>
  stage2: Stage2Config<Stage1Out, Stage2Out>
}): Promise<TwoStageResult<Stage1Out, Stage2Out>> {
  const s1Retry = opts.stage1.retry ?? 1

  // ─── Stage 1 ───
  let stage1Out: Stage1Out | null = null
  let stage1Raw = ''
  let lastErr = 'unknown'
  for (let attempt = 0; attempt <= s1Retry; attempt++) {
    const resp = await requestAIContent(
      opts.stage1.userPrompt,
      opts.stage1.cacheKey ?? `twoStage_s1_${Date.now()}_${attempt}`,
      opts.stage1.systemPrompt
    )
    if (!resp) {
      // Defensive: treat missing response as transient — fall through to parse retry
      lastErr = 'AI request returned no response'
      continue
    }
    if (!resp.success) {
      lastErr = resp.error ?? 'AI request failed'
      // Don't retry on AI request failure (network errors); only retry on parse
      return { kind: 'stage1Error', error: lastErr }
    }
    stage1Raw = resp.content ?? ''
    const parsed = opts.stage1.parse(stage1Raw)
    if (parsed.ok) {
      stage1Out = parsed.value
      break
    }
    lastErr = parsed.error
    // continue to next attempt
  }
  if (stage1Out === null) {
    return { kind: 'stage1ParseError', error: lastErr, rawContent: stage1Raw }
  }

  const stage1Final: Stage1Out = stage1Out

  // ─── Stage 2 ───
  let stage2Raw = ''
  let stage2Err: string | null = null
  await new Promise<void>(resolve => {
    requestAIContentStream(
      opts.stage2.buildUserPrompt(stage1Final),
      {
        onChunk: chunk => {
          stage2Raw += chunk
          opts.stage2.streamCallback?.(chunk)
        },
        onDone: () => resolve(),
        onError: err => {
          stage2Err = err
          resolve()
        }
      },
      opts.stage2.buildSystemPrompt(stage1Final)
    )
  })

  if (stage2Err !== null) {
    return { kind: 'stage2Error', error: stage2Err, stage1: stage1Final }
  }

  // Stage 2 parse — by design we do NOT re-invoke the stream on parse failure
  // (re-invoking a 1500-token stream is expensive). Caller can render a fallback
  // template from stage1 data if stage2ParseError is returned.
  const parsed = opts.stage2.parse(stage2Raw)
  if (!parsed.ok) {
    return {
      kind: 'stage2ParseError',
      error: parsed.error,
      stage1: stage1Final,
      rawContent: stage2Raw
    }
  }

  return { kind: 'ok', stage1: stage1Final, stage2: parsed.value }
}
