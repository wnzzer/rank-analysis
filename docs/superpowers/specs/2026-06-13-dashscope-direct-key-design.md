# DashScope 直连 + 打包密钥（移除 Cloudflare Worker）

- 日期：2026-06-13
- 状态：已设计，待实现
- 关联：替换前端经 Cloudflare Worker (`https://ai.nuliyangguang.top`) 的 AI 代理

## 背景与目标

当前 AI 链路：前端 `services/ai/stream.ts` 用 `tauriFetch`（plugin-http，走 Rust reqwest，绕开
CORS）POST 到自建 Cloudflare Worker，Worker 持有 DashScope 密钥、加 `Authorization` 头转发到
DashScope（OpenAI 兼容端点），把 SSE 流回来。请求/响应已是 OpenAI 兼容形态
（`{model, messages, stream:true}` → `choices[].delta.content`）。

目标：**砍掉 Cloudflare Worker，客户端直连 DashScope**。密钥放 Rust 层——
**测试用运行时环境变量、线上编译期注入打包**，明文密钥永不进源码 / git。

### 已知并接受的风险

打进二进制的共享密钥可被用户从二进制 / 抓包中提取并盗刷账单。混淆 / 打包无法消除此风险
（客户端运行时总要解出明文发请求）。项目主已知情并接受，兜底是「密钥被滥用 → 吊销 + 轮换」。
保留「用户可填自己的 key 覆盖」作为分流成本与密钥被封时的退路。

> 密钥放 Rust 而非前端 JS：前端 JS bundle 是明文，比二进制更易提取；且「环境变量 / 编译期注入」
> 本就是 Rust 概念，前端运行时读不到。

## 架构（方案 A：流全走 Rust 命令）

```
前端 stream.ts.requestAIContentStream
  → invoke('stream_ai_analysis', { request, onEvent: Channel })
    → command/ai.rs: 解析密钥 → POST DashScope(兼容端点) → 流式 SSE
    → Channel 事件 chunk/done/error 回传 → 映射到现有 StreamCallbacks
```

密钥全程留在 Rust，不进 JS。`requestAIContent`（sessionStorage 缓存包装）与所有 stage 调用方
（attribution / critique / tagSuggest 等）**不动**——它们都经 `requestAIContentStream` 这一个入口。

## 组件与改动

### 1. Rust `command/ai.rs`（改造已注册的 `stream_ai_analysis`）

**请求结构 `AiStreamRequest`**
- 保留 `prompt: String`、`system_prompt: Option<String>`
- 新增 `model: Option<String>`（前端按 stage 传，如 `qwen-plus`）
- 新增 `api_key: Option<String>`（用户覆盖口子）
- 删除 `account_id`、删除原必填 `api_token`

**密钥解析（纯函数，可单测）**
```rust
fn resolve_api_key(
    override_key: Option<&str>,
    runtime_env: Option<&str>,
    baked: Option<&str>,
) -> Result<String, String>
```
优先级：`override_key`(非空) → `runtime_env`(非空) → `baked`(非空) → `Err("未配置 DashScope 密钥")`。
空白串视同未配置（`trim().is_empty()`）。

薄封装 `fn api_key(override_key: Option<&str>) -> Result<String, String>`：
- `runtime_env` = `std::env::var("DASHSCOPE_API_KEY").ok()`（测试 / 开发）
- `baked` = `option_env!("DASHSCOPE_API_KEY")`（编译期注入；CI 发布构建时设此环境变量）

**端点与请求**
- 常量 `DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"`
- 常量 `DEFAULT_MODEL = "qwen-plus"`（兜底；前端通常显式传 model）
- 头：`Authorization: Bearer <resolved>`、`Content-Type: application/json`
- 体：`{ "model": model, "messages": [system, user], "stream": true }`

**SSE 解析（提取为纯函数，可单测）**
```rust
fn extract_delta_content(json_line: &str) -> Option<String>
```
只认 `choices[0].delta.content`；`data: [DONE]` 与坏 JSON 返回 `None`。删掉 Cloudflare 专用的
顶层 `response` 字段分支。

**日志 / 安全**
- 不打印密钥、不打印 prompt / system_prompt 正文（含玩家数据）。
- 错误事件可含 DashScope 返回的状态码 + 错误体；错误体不应含密钥（DashScope 不回显），可直接透传。

### 2. 前端 `services/ai/stream.ts`

- `requestAIContentStream`：用 `Channel<AiStreamEvent>` + `invoke('stream_ai_analysis', …)` 替换
  `tauriFetch(AI_WORKER_URL)`。Channel 的 `onmessage` 按 `event` 分发到 `callbacks.onChunk/onDone/onError`。
- 删除 `AI_WORKER_URL` 常量、手写 SSE 解析 `emitSseLine`、reader/decoder 逻辑。
- 透传 `model`；从配置读用户覆盖 key（见 §3），非空时作为 `api_key` 传入。
- 提取一个纯映射函数 `mapStreamEvent(event, callbacks)` 便于 vitest。
- `requestAIContent`、`DEFAULT_SYSTEM_PROMPT`、各 stage 模型常量保持不变。

事件去重：`onDone` 只由 Rust 的 `done` 事件触发；忽略 `invoke` Promise 的 resolve（命令返回
仅表示流结束）。`invoke` reject（命令整体失败，如未配置密钥）映射到 `onError`。

### 3. 设置项（覆盖口子）

- 在 `services/configKeys.ts` 登记配置键 `dashscopeApiKey`（字符串，默认空）。
- 在 `views/settings/General.vue` 加一个可选文本输入：「自定义 DashScope API Key（留空用内置）」，
  经现有 `putConfigByIpc` 持久化。
- `stream.ts` 启动请求前读该配置；空 → 不传 `api_key`（后端走 env / 打包）。

### 4. 收尾（非纯代码）

- CI 发布工作流（`.github/workflows/*`）注入 `DASHSCOPE_API_KEY` 构建 secret，使 `option_env!`
  在 release 构建生效。开发 / 测试不设此编译期变量，仅设运行时环境变量。
- 清理 Cloudflare 残留：`AI_WORKER_URL`、`command/ai.rs` 中 Cloudflare Workers AI 的旧 URL /
  `account_id` 字段。Worker 本身（外部仓库）的下线由项目主自行处理。

## 测试

**Rust（TDD）**
- `resolve_api_key`：覆盖 > env > baked > 报错；空白串视同未配置；各优先级边界。
- `extract_delta_content`：正常 chunk 提取、`[DONE]`、坏 JSON、缺字段。

**前端（vitest）**
- `mapStreamEvent`：chunk → onChunk(data)，done → onDone，error → onError(data)。

**发布前人工验证**
- 用轮换后的新 key（设进运行时环境变量，不写文件）跑一轮 `qwen-turbo` vs `qwen-plus` 延迟 + 质量
  对比，确认默认模型；各 stage 模型沿用已调好的选择。

## 非目标

- 不改各 stage 已调优的模型选型逻辑（仅设兜底默认）。
- 不改 `requestAIContent` 的 sessionStorage 缓存行为。
- 不实现密钥混淆 / 加固（无意义，已述）。
- 不接管 Worker 外部仓库的下线。
