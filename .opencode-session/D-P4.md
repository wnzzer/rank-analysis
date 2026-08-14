# D-P4 AI 平台化（多服务商抽象）— 交付记录

> 日期：2026-08-14 · 计划版本 v1.5 · spec `2026-08-11-akari-optimization-design.md` §7 方向 D
> CI 全绿：Quality Checks run `31768459674`（commit `c4865c9` 起，含「测试连接」增量）

## 交付内容

### Rust（`src-tauri/src/command/ai.rs`）
- `AiProviderKind` 枚举 + `parse`（未知/缺省回退 DashScope，兼容老客户端；`deepseek` 是 openai 兼容组别名）+ `as_str`
- `provider_endpoint`：dashscope 固定官方 URL；openai 用 base_url（否则默认 DeepSeek 官方端点）；ollama 拼 `/v1/chat/completions`（默认 `http://127.0.0.1:11434`，去尾斜杠）
- `provider_api_key`：dashscope 三层（override > DASHSCOPE_API_KEY env > 编译期 baked）；openai 两层（override > OPENAI_API_KEY env，**baked 由调用侧把关不传入**——职责在调用侧，函数如实使用传入值）；ollama 恒 None（免认证，不挂 Authorization 头）
- `provider_default_model`：qwen-flash / deepseek-chat / llama3.1
- `stream_ai_analysis`：请求头仅在有 key 时插 Authorization；`.post(&endpoint)`；错误信息按服务商提示环境变量名
- Rust 单测 +8（parse 归一、三类端点、三类密钥、默认模型）

### 前端
- `configKeys.ts`：+`aiProvider`('ai.provider') / `aiBaseUrl`('ai.baseUrl') / `aiModel`('ai.model') / `aiApiKey`('ai.apiKey')（dashscope 沿用历史键 `dashscopeApiKey`）
- `services/ai/stream.ts`：`getAiProviderConfig()` 按服务商归一（apiKey：dashscope 取 dashscopeApiKey / openai 取 aiApiKey / ollama 恒空）；`requestAIContentStream` 配置模型优先并透传 provider/baseUrl/apiKey
- `views/settings/General.vue`：「AI 服务商」选择 + 服务端地址（非 dashscope）+ AI 模型 + 双密钥输入框按服务商 v-if 互斥；沿用 Automation.vue 单向下拉约定（`:value` + 唯一 `@update:value` 写入路径，handler 先落 ref）
- 测试 +10：`stream.spec.ts` 8（getAiProviderConfig 归一 4 + 请求透传 3 + 回归）、`General.aiProvider.spec.ts` 4

## 决策记录（ADR）
1. **不用 Rust trait 抽象**：单命令 + 纯函数分派（parse/endpoint/key）即是抽象的全部职责面，trait 化的异步 stream_chat 无增量价值且难测——采纳 spec 目标（多 provider 可配置）而非机械实现 D4-1 字面
2. **baked 密钥只属 dashscope**：openai provider 不把编译期 Qwen key 送入第三方端点（语义错 + 误导排查），缺失时如实报错提示 OPENAI_API_KEY
3. **模型/端点兜底按服务商**：openai→deepseek-chat、ollama→llama3.1，杜绝"模型不存在"类误导；设置页可覆盖
4. **前端模型解析优先级**：设置页 aiModel > 调用方参数 > 各服务商默认
5. **key 双键共存**：不动历史 `dashscopeApiKey` 键（老用户已存值零迁移），openai 新增 `aiApiKey`

## 门禁
- 本地：vitest 979/979（+10）、coverage（lines 81.47/functions 72.08/branches 83.44/statements 81.47，全部高于阈值）、vue-tsc、prettier、eslint 0 errors（仅存量 any warnings annotations）
- CI（fork lnsjcr0873）：Frontend / Rust mac+win（rustfmt+clippy+tests）/ Security 全绿；`31766757770` success
- Rust 测试套 375 passed / 1 ignored（原 ignored 非本改动引入）

## CI 往返记录（rustfmt 历险，供后续参考）
1. `f8f1341`→ `31765667796`：长参数 match 头 + 长断言需拆行 → `2bcbcfa`
2. `31765735404` 后 `31765955792`：ollama 单行断言 68 字符仍要拆（rustfmt 对嵌套调用宏参数的四舍五入）→ `b71374c`
3. `31766287558`：**真实测试 bug**——openai baked 断言误写（函数尊重调用侧传入的 baked，职责在调用侧）→ `2c5bd68`
4. `31766540609`：baked 断言多行拆法丑 → 单行收敛 → `364085e`
5. `31766757770`：✅ 全绿
- 教训汇总：rustfmt 判定 mac/win 一致；判宽经验 = 单行 ≤100 含嵌套调用时反而收敛到一行、参数带嵌套调用的宏经常拆行；**不要猜，直接照 CI diff 抄**

## 变更文件
- `rank-analysis-app/src-tauri/src/command/ai.rs`（主战场）
- `rank-analysis-app/src/services/ai/stream.ts`、`src/services/configKeys.ts`
- `rank-analysis-app/src/views/settings/General.vue`
- `rank-analysis-app/src/services/ai/__tests__/stream.spec.ts`（+8）、`rank-analysis-app/src/views/settings/__tests__/General.aiProvider.spec.ts`（新建 +4）

## 追加交付（测试连接，commit `c3f4dd4` + `c4865c9`）
- Rust：解析路径抽共享 `resolve_ai_request`（stream 与自检同一套 provider 逻辑，不产生分叉）；新命令 `test_ai_provider_connection` 发最小**非流式**请求（`build_connection_test_body`：stream:false、无 stream_options），非 2xx 返回 `API error (status): body`，成功返回 `response_summary`（model + 归一化 totalTokens，缺省 0）；+3 Rust 单测
- 前端：General.vue 服务商行内「测试连接」按钮（loading 态互斥；提交**表单所见即所测**——含未保存的 provider/baseUrl/model/key，与真实请求同一解析路径）；成功 `连接成功：model · N tokens`，失败原样上屏
- 测试 +2（6/6）；本地 981/981 全绿；CI `31768459674` success（唯一往返：`provider_api_key(?)` 一行 rustfmt 拆行 `c4865c9`）

## 未做 / 后续
- **EXE 交付件**：需重触发 `Build EXE (No Sign)` 才含本改动（截至 README 提及的旧 EXE 只到 D2-2）
- 环境变量文档（OPENAI_API_KEY）可在设置 help 文案已覆盖，README 未补