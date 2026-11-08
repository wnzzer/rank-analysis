import fs from 'node:fs'
import path from 'node:path'

/** 评测用 LLM 流式调用，返回全文与耗时。两种模式：设了 DASHSCOPE_API_KEY 则直连 DashScope，否则走 worker（同 tests/bench-ai-models.mjs） */
const WORKER = 'https://ai.nuliyangguang.top'
const DASHSCOPE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const REQ_TIMEOUT_MS = 120000

/**
 * 评测用 Stage 2 模型：与生产同一解析规则——data/ai-config.json 的 models.matchCritique →
 * models.default → 内置兜底（critique.STAGE2_MODEL）。EVAL_MODEL 环境变量可强制覆盖（如 qwen-flash 对照）。
 * @param fallback - 配置缺失/读不到时的内置默认
 * @returns 模型名
 */
export function resolveEvalModel(fallback: string): string {
  if (process.env.EVAL_MODEL) return process.env.EVAL_MODEL
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../data/ai-config.json'), 'utf8')
    ) as { models?: Record<string, string> }
    return cfg.models?.matchCritique || cfg.models?.default || fallback
  } catch {
    return fallback
  }
}

/** 一次模型调用的结果 */
export interface CallResult {
  ok: boolean
  content: string
  ms: number
  error?: string
}

/**
 * 调用 worker 的流式聊天接口并拼出全文。
 * @param model - 模型名
 * @param system - system prompt
 * @param user - user prompt
 * @param jsonMode - 是否带 response_format=json_object（与 app Stage 1 一致）
 * @returns 调用结果，失败时 ok=false 并带 error
 */
export async function callModel(
  model: string,
  system: string,
  user: string,
  jsonMode = false
): Promise<CallResult> {
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), REQ_TIMEOUT_MS)
  try {
    const key = process.env.DASHSCOPE_API_KEY
    const resp = await fetch(key ? DASHSCOPE : WORKER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        stream: true,
        // 与 app（command/ai.rs build_request_body）一致：混合思考模型（deepseek-v4.1 等）关思考
        enable_thinking: false,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: ctrl.signal
    })
    if (!resp.ok || !resp.body)
      return { ok: false, content: '', ms: Date.now() - t0, error: `HTTP ${resp.status}` }
    const reader = resp.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let content = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data: ') || t === 'data: [DONE]') continue
        try {
          content += JSON.parse(t.slice(6)).choices?.[0]?.delta?.content ?? ''
        } catch {
          // 非 JSON 心跳行
        }
      }
    }
    return { ok: true, content, ms: Date.now() - t0 }
  } catch (e) {
    return {
      ok: false,
      content: '',
      ms: Date.now() - t0,
      error: String((e as Error)?.message ?? e)
    }
  } finally {
    clearTimeout(timer)
  }
}
