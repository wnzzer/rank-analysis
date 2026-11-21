# AI 接入点与模型设置 设计

日期：2026-11-21
状态：已口头批准（全部透明化、一个接入点 + 默认模型 + 按功能覆盖、未改项跟随远程、下拉 + 测试连接）

## 目标

现在「AI 模型」是二选一的提供方（DeepSeek / Claude），每个功能实际用哪个模型写死在代码和远程配置里，
用户看不到也改不了；卡片写着 DeepSeek，实际标签建议用 qwen-plus、标注反驳用 qwen4-max。

改成全部透明、可自定义：接入点地址、密钥、默认模型、每个功能用的模型都显示出来，都能改。
内置的那套只是一个预填好的预设。

### 不做的事

- 不支持多个接入点混用（每个功能指定不同服务商）。
- 不把 Claude 那一路纳入「自定义」：它走自建中转、协议不同、有地区限制，保留为特殊预设。
  想自己接 Claude 的用户通过提供 OpenAI 兼容接口的中转服务接入。
- 不为其他服务商单独适配提示词。

## 界面

AI 设置从「常规」搬出，新增设置页「AI 模型」（`views/settings/Ai.vue`）。

### ① 选择服务

三张卡片，配置键 `aiProvider`：

| 卡片 | 值 | 说明 |
|---|---|---|
| 内置（阿里云百炼） | `dashscope`（沿用） | 默认，开箱即用 |
| Claude Opus | `claude`（沿用） | 与现状一致 |
| 自定义 | `custom`（新） | 用户的 OpenAI 兼容接入点 |

### ② 接入点信息（内置 / 自定义时显示）

| 项 | 内置 | 自定义 |
|---|---|---|
| 接入点地址 | 显示阿里云地址，只读 | 可填，必填 |
| 密钥 | 「使用内置密钥」，可改填自己的阿里云密钥（现有 `dashscopeApiKey`） | 必填（新键 `aiCustomApiKey`） |
| 默认模型 | 显示推荐值并标「内置推荐」，可改 | 下拉选择或手动输入，必填 |
| 测试连接 | 有 | 有 |

页面底部一句提示：「提示词是针对内置推荐的模型调的，换用其他模型时回复质量可能下降。」

### ③ 按功能指定模型（默认收起）

七个功能各一行：

| 场景键 | 显示名 |
|---|---|
| `matchAttribution` | 复盘 · 归因 |
| `matchCritique` | 复盘 · 点评 |
| `inGame` | 对局中分析 |
| `champSelect` | 选人分析 |
| `matchSearch` | 战绩搜索 |
| `tagSuggest` | 标签建议 |
| `labelRebuttal` | 标注反驳 |

- 没改过：灰字显示实际会用的模型与来源——「内置推荐：qwen4-max」或「跟随默认：xxx」。
- 改过：显示用户填的值，旁边「恢复」。

### ④ 其他

「AI 分析携带玩家备注」（`aiUseNotes`）、「复盘使用对局时间线」从常规页搬到本页，
前者说明改为「开启后你的玩家备注会随分析请求发送给上面选择的 AI 服务」。

## 配置

只保存用户实际改过的值。

| 键 | 类型 | 含义 |
|---|---|---|
| `aiProvider` | `'dashscope' \| 'claude' \| 'custom'` | 现有键，新增一个取值 |
| `dashscopeApiKey` | string | 现有：内置服务下用户自己的阿里云密钥 |
| `aiCustomBaseUrl` | string | 自定义接入点地址（到 `/v1` 为止，不含 `/chat/completions`） |
| `aiCustomApiKey` | string | 自定义接入点密钥 |
| `aiModels` | `{ dashscope?: Overrides, custom?: Overrides }` | 两种服务各自的模型覆盖 |

`Overrides = { default?: string } & Partial<Record<AiScene, string>>`。

按服务分开存，所以切换服务不清空另一边的填写。

**密钥只存本机**：`aiCustomApiKey` 加入云同步黑名单（与 `dashscopeApiKey` 同样处理；
导出到文件的完整备份里保留，与现状一致）。`aiCustomBaseUrl`、`aiModels`、`aiProvider` 可以同步。

## 模型的取值

`resolveModel(scene, fallback, opts)` 的顺序改为：

**内置（dashscope）**
1. `aiModels.dashscope[scene]`（用户给这个功能指定的）
2. `aiModels.dashscope.default`（用户改过的默认模型）
3. 远程配置 `models[scene]`
4. 远程配置 `models.default`（`sceneOnly` 时跳过）
5. `fallback`（代码里的内置值）

**自定义（custom）**
1. `aiModels.custom[scene]`
2. `aiModels.custom.default`

自定义下**不读远程配置、不用代码里的内置值**：那些模型名只在阿里云上存在。
`aiModels.custom.default` 为空时自定义服务视为未配置完成，AI 功能报「请先在设置里填写默认模型」。

**Claude**：与现状一致，不受本设计影响。地区不可用时回落到内置（dashscope）的取值顺序。

设置页显示「实际会用的模型与来源」用同一个函数算，避免界面和实际行为不一致：
新增 `explainModel(scene)` 返回 `{ model, source: 'scene' | 'default' | 'recommended' }`。

## 后端

### 请求

`stream_ai_analysis` 的请求体新增可选 `baseUrl`。`provider` 为 `custom` 时必填。

- 目标地址 = `baseUrl` 去掉末尾 `/` 后拼 `/chat/completions`。
- **阿里云专有参数只发给阿里云**：`enable_thinking: false` 仅在目标主机是 `dashscope.aliyuncs.com` 时带。
  发给 OpenAI 官方等会因为不认识的参数直接 400。
- **`response_format` 被拒时重试一次**：非 2xx 且响应体提到 `response_format` 时，去掉该字段重发。
  只在流尚未开始时重试。
- 地址校验：必须 `https://`；主机为 `localhost` / `127.0.0.1` / `[::1]` 时允许 `http://`。不合法直接报错，不发请求。

### 新命令

| 命令 | 参数 | 返回 |
|---|---|---|
| `list_ai_models` | `baseUrl`, `apiKey?` | `string[]`（`GET {baseUrl}/models` 的 `data[].id`） |
| `test_ai_endpoint` | `baseUrl`, `apiKey?`, `model` | `{ ok: boolean, ms: number, error?: string }` |

- `apiKey` 省略时用内置密钥（仅当 `baseUrl` 是内置地址）。
- `list_ai_models` 做一层简单过滤，去掉名字含 `embedding` / `rerank` / `tts` / `asr` / `image` / `video` / `audio` / `ocr` 的。
  过滤是尽力而为，不保证干净。
- `test_ai_endpoint` 发一条最短的对话（`max_tokens: 1`），超时 15 秒，失败时原样返回服务商的错误文本（截到 300 字）。
- 两个命令都走后端，不受浏览器跨域限制。

### 前端调用

`requestAIContentStream` 按 `aiProvider` 取地址与密钥：

| 服务 | 地址 | 密钥 |
|---|---|---|
| dashscope | 不传（后端用内置地址） | `dashscopeApiKey` 或不传（后端用内置） |
| custom | `aiCustomBaseUrl` | `aiCustomApiKey` |
| claude | 现状 | 现状 |

## 模型列表与测试连接

- 进入页面、或地址 / 密钥改动后（防抖 800ms）拉一次模型列表；拉不到不报错，下拉框退化成纯输入框，
  下方提示「该接入点不提供模型列表，请手动填写模型名」。
- 「测试」按钮用当前填的地址、密钥、默认模型，显示「可用 · 1.2 秒」或红字错误。
- 「按功能指定模型」的每一行不单独做测试。

## 兼容性（已知限制）

- 只能实测阿里云。DeepSeek 官方、硅基流动、OpenRouter、本地 Ollama 等没有密钥无法验证；
  按 OpenAI 兼容协议实现，各家兼容程度不一。
- 战绩搜索、标签建议、标注反驳依赖 JSON 输出。不支持 `response_format` 的接入点靠提示词约束，
  这三个功能可能输出格式不对；各自已有的解析失败处理照常生效。
- 提示词针对内置推荐的模型调过，换模型后质量可能下降（2026-11-21 标注反驳的实测：
  同一提示词在 deepseek-v4.1-flash 上每次都出现反驳口吻，qwen4-max 0 次）。

## 迁移

无需数据迁移，更新后行为与现在一致：

| 现状 | 更新后 |
|---|---|
| `aiProvider` 未设或 `dashscope` | 内置；`aiModels` 为空，全部跟随远程推荐 |
| 填过 `dashscopeApiKey` | 内置，密钥沿用 |
| `aiProvider = claude` | 不变 |

## 模块

| 文件 | 职责 |
|---|---|
| `src-tauri/src/command/ai.rs` | `baseUrl`、参数按主机取舍、`response_format` 重试、地址校验 |
| `src-tauri/src/command/ai_endpoint.rs`（新） | `list_ai_models` / `test_ai_endpoint` |
| `src/services/ai/modelConfig.ts` | 新的取值顺序、`explainModel` |
| `src/services/ai/endpoint.ts`（新） | 读写接入点配置、调用两个新命令 |
| `src/services/ai/stream.ts` | 按服务取地址与密钥 |
| `src/views/settings/Ai.vue`（新） | 页面 |
| `src/views/settings/AiEndpointForm.vue`（新） | 地址 / 密钥 / 默认模型 / 测试 |
| `src/views/settings/AiSceneModels.vue`（新） | 按功能指定模型 |
| `src/views/settings/AiProviderPicker.vue` | 改为三张卡片 |
| `src/views/settings/General.vue` | 移走 AI 相关项 |

## 测试

- Rust：地址校验（https / 本机 http / 其他拒绝）、目标地址拼接、`enable_thinking` 只发给阿里云、
  `response_format` 被拒后的请求体、模型列表过滤、测试结果的错误截断。
- `modelConfig`：两种服务各自的取值顺序、自定义不读远程、`sceneOnly`、`explainModel` 的来源标注、
  Claude 地区不可用时回落。
- 页面：三种服务的显示、未改项显示来源、改动与恢复、切换服务后另一边的填写仍在、
  拉不到模型列表时的退化、测试成功与失败的显示。
- 真机：内置服务下全部功能回归；自定义服务用阿里云地址 + 自己的密钥走一遍（等价于换一家服务商的路径）。
