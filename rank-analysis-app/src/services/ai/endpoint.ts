/**
 * AI 接入点探测：拉模型列表、测试连接（设置页「AI 模型」用）。
 *
 * 都走 Rust 命令（`command/ai_endpoint.rs`）而不是前端直接 fetch：不受跨域限制，
 * 内置密钥也不必暴露给前端。地址 / 密钥留空时后端用内置的阿里云地址与内置密钥——
 * 但内置密钥只会发给内置地址，填了别的地址又没填密钥时请求不带密钥。
 */

import { invoke } from '@tauri-apps/api/core'

/** 内置服务的接入点地址（显示给用户看；与 Rust `ai::DASHSCOPE_BASE_URL` 保持一致） */
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

/** Rust `test_ai_endpoint` 的返回 */
export interface EndpointTest {
  ok: boolean
  /** 耗时（毫秒） */
  ms: number
  /** 失败原因（服务商的错误文本）；成功时为空 */
  error?: string | null
}

/** 一个接入点：地址与密钥。都留空表示内置服务 + 内置密钥 */
export interface Endpoint {
  baseUrl?: string
  apiKey?: string
}

const blankToUndefined = (s?: string) => s?.trim() || undefined

/**
 * 拉接入点的模型列表
 * @param endpoint - 接入点；留空为内置服务
 * @returns 对话模型的名字；接入点不提供列表 / 请求失败时返回 null（调用方退化成手动输入）
 */
export function listAiModels(endpoint: Endpoint = {}): Promise<string[] | null> {
  return Promise.resolve()
    .then(() =>
      invoke<string[]>('list_ai_models', {
        baseUrl: blankToUndefined(endpoint.baseUrl),
        apiKey: blankToUndefined(endpoint.apiKey)
      })
    )
    .then(
      list => (Array.isArray(list) ? list : null),
      () => null
    )
}

/**
 * 用给定的接入点与模型发一条最短的对话，看通不通
 * @param endpoint - 接入点；留空为内置服务
 * @param model - 要测的模型名
 * @returns 测试结果；IPC 本身失败也折算成 `ok: false`
 */
export function testAiEndpoint(endpoint: Endpoint, model: string): Promise<EndpointTest> {
  return Promise.resolve()
    .then(() =>
      invoke<EndpointTest>('test_ai_endpoint', {
        baseUrl: blankToUndefined(endpoint.baseUrl),
        apiKey: blankToUndefined(endpoint.apiKey),
        model
      })
    )
    .catch(err => ({ ok: false, ms: 0, error: String(err) }))
}

/**
 * 把耗时写成给人看的样子
 * @example formatElapsed(1234) // '1.2 秒'
 */
export function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)} 秒`
}
