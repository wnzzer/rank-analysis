/**
 * AI 场景 → 模型名解析（远程可配）。
 *
 * 配置由 Rust `get_ai_config` 下发（仓库 `data/ai-config.json` 经 jsDelivr/GitCode 分发，
 * 内存 → 磁盘 → 网络三级缓存，永不失败）。换模型改 JSON 即可，不需要发版。
 * 场景未单独配置时用 `default`；IPC 本身失败（理论上不会）时回落调用方给的内置默认值。
 *
 * 用户在设置里选了 Claude 且区域检测通过时，改从 `claudeModels` 取（模型名以 `claude-` 开头，
 * stream.ts 据此路由到 Claude 中转）；区域不可用 / 检测失败一律静默回落 DashScope，绝不让 AI 不可用。
 *
 * ## 用户自己指定的模型
 *
 * 设置页「AI 模型」里每个值都能改，改过的存在配置键 `aiModels` 里（只存改过的）。取值顺序见
 * {@link pickModel}。内置服务下没改的值继续跟随远程推荐；自定义接入点下**不读远程配置、
 * 也不用代码里的内置值**——那些模型名只在阿里云上存在。
 */

import { invoke } from '@tauri-apps/api/core'
import { getConfigByIpc, putConfigByIpc } from '../ipc'
import { CONFIG_KEYS } from '../configKeys'

/** 内置 Claude 默认模型：远端 manifest 没有 claudeModels（或 IPC 失败）时用 */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

/**
 * 代码内置的默认模型：远程配置拉不到时的最后兜底，与 Rust `ai_config::DEFAULT_MODEL` 保持一致。
 * 放在这里而不是 stream.ts，是因为 stream.ts 要引用本文件（反过来会成环）。
 */
export const BUILTIN_DEFAULT_MODEL = 'deepseek-v4.1-flash-1017'

/** AI 服务提供方 */
export type AiProvider = 'dashscope' | 'claude' | 'custom'

/** 能由用户改模型的服务（Claude 走自建中转，模型由中转与远程配置决定，不在此列） */
export type ConfigurableProvider = 'dashscope' | 'custom'

/** Rust `check_claude_region` 的返回 */
export interface ClaudeRegion {
  /** ISO 国家码；检测失败为 null */
  country: string | null
  allowed: boolean
  /** 检测失败原因（中转不可达等） */
  error: string | null
}

/** 模型名是否属于 Claude（stream.ts 按此选 provider） */
export const isClaudeModel = (model: string) => model.startsWith('claude-')

/** AI 场景名（与 data/ai-config.json 的 models 键一一对应） */
export type AiScene =
  | 'matchAttribution'
  | 'matchCritique'
  | 'inGame'
  | 'champSelect'
  | 'matchSearch'
  | 'tagSuggest'
  | 'labelRebuttal'

/**
 * 设置页里可单独指定模型的功能。
 *
 * `fallback` / `sceneOnly` 与各功能调用 {@link resolveModel} 时传的参数一致
 * （由 modelConfig.spec.ts 里的一致性测试保证），设置页据此显示「实际会用哪个模型」。
 * `matchAttribution`（复盘 · 归因）已改为本地计算、不调模型，不在此列。
 */
export const AI_SCENES: readonly {
  key: AiScene
  label: string
  fallback: string
  sceneOnly?: boolean
}[] = [
  { key: 'matchCritique', label: '复盘 · 点评', fallback: BUILTIN_DEFAULT_MODEL },
  { key: 'inGame', label: '对局中分析', fallback: BUILTIN_DEFAULT_MODEL },
  { key: 'champSelect', label: '选人分析', fallback: BUILTIN_DEFAULT_MODEL },
  { key: 'matchSearch', label: '战绩搜索', fallback: BUILTIN_DEFAULT_MODEL },
  { key: 'tagSuggest', label: '标签建议', fallback: 'qwen-plus' },
  { key: 'labelRebuttal', label: '标注反驳', fallback: 'qwen4-max', sceneOnly: true }
]

/** 一种服务下用户改过的模型：`default` 是默认模型，其余键是按功能单独指定的 */
export type ModelOverrides = Partial<Record<AiScene | 'default', string>>

/** 配置键 `aiModels` 的形状：两种服务各存各的，切换服务不会清掉另一边的填写 */
export interface AiModels {
  dashscope?: ModelOverrides
  custom?: ModelOverrides
}

/**
 * 模型的来源：
 * - `scene`: 用户给这个功能单独指定的
 * - `default`: 跟随用户填的默认模型
 * - `recommended`: 内置推荐（远程配置 / 代码内置值），仅内置服务有
 */
export type ModelSource = 'scene' | 'default' | 'recommended'

/** 某功能实际会用的模型及其来源。`model` 为空串表示自定义接入点还没填默认模型 */
export interface ModelChoice {
  model: string
  source: ModelSource
}

interface AiConfig {
  schemaVersion: number
  models: Record<string, string>
  /** 选 Claude 时的场景 → 模型（可选，老 manifest 没有） */
  claudeModels?: Record<string, string>
}

/**
 * 每次都走 IPC，不在前端缓存：Rust 侧已有内存 + 磁盘 TTL 缓存（IPC 仅毫秒级），
 * 前端再缓存会让长时间挂着的客户端收不到远端切换。
 * 包一层 then：invoke 同步抛错（非 Tauri 环境 / mock）也走 catch 兜底，绝不阻断 AI 请求。
 */
function loadConfig(): Promise<AiConfig | null> {
  return Promise.resolve()
    .then(() => invoke<AiConfig>('get_ai_config'))
    .catch(err => {
      console.warn('get_ai_config failed, using built-in models:', err)
      return null
    })
}

/**
 * 检测当前网络能否用 Claude（判定在 Oracle 中转按出口 IP 做，Rust 侧缓存 10 分钟）
 * @param force - true 时跳过缓存重测（切了网络 / VPN 后）
 * @returns 区域判定；IPC 失败按不可用处理
 */
export function checkClaudeRegion(force = false): Promise<ClaudeRegion> {
  return Promise.resolve()
    .then(() => invoke<ClaudeRegion>('check_claude_region', { force }))
    .catch(err => ({ country: null, allowed: false, error: String(err) }))
}

/** 用户选的 provider；读不到 / 非法值按 DashScope（同 loadConfig 包一层 then，同步抛错也兜住） */
export function loadProvider(): Promise<AiProvider> {
  return Promise.resolve()
    .then(() => getConfigByIpc<string>(CONFIG_KEYS.aiProvider))
    .then(
      v => (v === 'claude' || v === 'custom' ? v : 'dashscope'),
      () => 'dashscope' as const
    )
}

const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** 把存储里读出来的东西规整成 `ModelOverrides`：只留非空字符串 */
function cleanOverrides(raw: unknown): ModelOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ModelOverrides = {}
  for (const [k, v] of Object.entries(raw)) {
    const model = pick(v)
    if (model) out[k as keyof ModelOverrides] = model
  }
  return out
}

/**
 * 读用户改过的模型。读不到 / 形状不对一律当作没改过，绝不阻断 AI 请求。
 * @returns 两种服务各自的覆盖（都已规整，缺的给空对象）
 */
export function loadAiModels(): Promise<Required<AiModels>> {
  return Promise.resolve()
    .then(() => getConfigByIpc<AiModels>(CONFIG_KEYS.aiModels))
    .catch(() => undefined)
    .then(raw => {
      const obj = raw && typeof raw === 'object' ? raw : {}
      return { dashscope: cleanOverrides(obj.dashscope), custom: cleanOverrides(obj.custom) }
    })
}

/**
 * 保存 / 清除一个模型覆盖
 * @param provider - 哪种服务
 * @param key - `default`（默认模型）或某个功能
 * @param model - 模型名；空串 / 空白表示清除（恢复跟随）
 * @returns 保存后的全部覆盖
 */
export async function saveModelOverride(
  provider: ConfigurableProvider,
  key: AiScene | 'default',
  model: string
): Promise<Required<AiModels>> {
  const models = await loadAiModels()
  const next = { ...models[provider] }
  const value = pick(model)
  if (value) next[key] = value
  else delete next[key]
  const all = { ...models, [provider]: next }
  await putConfigByIpc(CONFIG_KEYS.aiModels, all)
  return all
}

/**
 * 按取值顺序挑出某功能实际用的模型。纯函数——{@link resolveModel} 和设置页的显示都走它，
 * 保证界面上写的和实际发出去的是同一个。
 *
 * 内置（dashscope）：功能单独指定 > 用户改的默认模型 > 远程配置的该功能 >
 * 远程配置的 default（`sceneOnly` 时跳过）> `fallback`
 *
 * 自定义（custom）：功能单独指定 > 用户填的默认模型。都没有时 `model` 为空串
 * （接入点还没配完）——不读远程、不用 `fallback`，那些名字别家没有。
 *
 * @param provider - 哪种服务
 * @param scene - 功能
 * @param overrides - 该服务下用户改过的模型
 * @param remote - 远程配置的 `models`（内置服务才用）
 * @param fallback - 代码内置值
 * @param sceneOnly - 见 {@link resolveModel}
 */
export function pickModel(
  provider: ConfigurableProvider,
  scene: AiScene,
  overrides: ModelOverrides,
  remote: Record<string, unknown> | undefined,
  fallback: string,
  sceneOnly = false
): ModelChoice {
  const own = pick(overrides[scene])
  if (own) return { model: own, source: 'scene' }
  const userDefault = pick(overrides.default)
  if (userDefault) return { model: userDefault, source: 'default' }
  if (provider === 'custom') return { model: '', source: 'default' }
  const recommended =
    pick(remote?.[scene]) ?? (sceneOnly ? undefined : pick(remote?.default)) ?? fallback
  return { model: recommended, source: 'recommended' }
}

/** 设置页一次性要用的东西：远程推荐 + 用户改过的值 */
export interface ModelSettings {
  /** 远程配置的 `models`；拉不到为 undefined */
  remote: Record<string, unknown> | undefined
  /** 用户改过的模型 */
  models: Required<AiModels>
  /** 内置服务的推荐默认模型（远程 default > 代码内置） */
  recommendedDefault: string
}

/** 读设置页显示模型所需的全部数据 */
export async function loadModelSettings(): Promise<ModelSettings> {
  const [config, models] = await Promise.all([loadConfig(), loadAiModels()])
  const remote = config?.models
  return { remote, models, recommendedDefault: pick(remote?.default) ?? BUILTIN_DEFAULT_MODEL }
}

/**
 * 某功能在某种服务下实际会用的模型与来源（设置页显示用）
 * @param scene - {@link AI_SCENES} 里的一项
 * @param provider - 哪种服务
 * @param settings - {@link loadModelSettings} 的结果
 */
export function explainModel(
  scene: (typeof AI_SCENES)[number],
  provider: ConfigurableProvider,
  settings: ModelSettings
): ModelChoice {
  return pickModel(
    provider,
    scene.key,
    settings.models[provider],
    settings.remote,
    scene.fallback,
    scene.sceneOnly
  )
}

/**
 * 预热到 Claude 中转的连接（仅用户选了 Claude 时）：打开含 AI 入口的页面就先把连接建好，
 * 留在 Rust 共享连接池里，用户点「AI 分析」时省掉到美东的握手。
 * fire-and-forget，任何失败都静默——只是优化。
 */
export function prewarmAi(): void {
  loadProvider()
    .then(p => (p === 'claude' ? invoke('prewarm_claude_relay') : undefined))
    .catch(() => {})
}

/**
 * 解析某场景应使用的模型名
 * @param scene - AI 场景
 * @param fallback - IPC 失败时的内置默认模型
 * @param opts.sceneOnly - true 时跳过远程的 default：场景配置 > fallback。
 *   给「专门挑过模型」的场景用——远程配置里还没有这个场景的条目时（比如新场景随版本发布，
 *   而配置文件在 main 上尚未更新），应当用代码里挑好的那个，而不是掉回全局默认模型。
 * @returns 选 Claude 且区域可用：claudeModels 场景 > claudeModels.default > 内置 Claude 默认；
 *          选自定义接入点：见 {@link pickModel}，没填默认模型时返回空串（stream.ts 会报「请先填写」）；
 *          否则（内置，或 Claude 地区不可用）：见 {@link pickModel} 的内置顺序
 * @example
 * ```ts
 * const model = await resolveModel('inGame', DEFAULT_MODEL)
 * ```
 */
export async function resolveModel(
  scene: AiScene,
  fallback: string,
  opts: { sceneOnly?: boolean } = {}
): Promise<string> {
  const [config, provider, models] = await Promise.all([
    loadConfig(),
    loadProvider(),
    loadAiModels()
  ])
  if (provider === 'claude' && (await checkClaudeRegion()).allowed) {
    const claude = config?.claudeModels
    const model = pick(claude?.[scene]) ?? pick(claude?.default)
    // 防远端把非 claude 模型写进 claudeModels：那样会被路由到 DashScope，用户以为在用 Claude
    return model && isClaudeModel(model) ? model : DEFAULT_CLAUDE_MODEL
  }
  const target: ConfigurableProvider = provider === 'custom' ? 'custom' : 'dashscope'
  return pickModel(target, scene, models[target], config?.models, fallback, opts.sceneOnly).model
}
