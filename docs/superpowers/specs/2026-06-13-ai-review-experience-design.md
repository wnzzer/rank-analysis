# AI 复盘体验优化 — 设计文档

- 日期：2026-06-13
- 范围：战绩详情页「AI 复盘」（`MatchAIPanel.vue` + `useMatchAIAnalysis.ts` + `services/ai/matchDetail/**`）
- 状态：已与用户确认范围，待 spec review → 进入实现计划

## 1. 背景与问题

战绩详情的「AI 复盘」当前体验有三个独立痛点：

1. **经常加载不出来**（用户首要痛点）——表现为长时间转圈、最终失败或卡死。
2. **可读性差 / 没有主次**——结果是扁平 markdown，章节、名字、数字、正负判定全无视觉区分。
3. **慢**——点击到看到第一行字要等很久。

经代码走查 + 真实基准测试，三者的根因都被定位（见下）。

## 2. 根因诊断

### 2.1 模型选错（"加载不出来" + "慢" 的主因）

当前 Stage 1 归因（`attribution.ts:33`）与 Stage 2 锐评（`critique.ts:39`）**都用 `qwen-plus`**。基准测试（真实 33k 字符 Stage 1 prompt，4 模型各 2 轮）：

| 模型 | S1 归因总耗时 | S1 有效率 | S2 锐评总耗时 | S2 TTFT | 锐评质量 | 数字 grounding |
|------|----------|--------|----------|--------|--------|------|
| **qwen-flash** | **12.0s** | **2/2** ✓ | **6.0s** | 2.3s | 强 | ✓ 只用 JSON 数字 |
| qwen-turbo | 18.7s | 2/2 ✓ | 4.9s | 2.0s | 弱（套话） | ✓ |
| **qwen-plus（现用）** | **40.5s** | **1/2** ✗ | 17.0s | 2.7s | 最强梗 | ✗ 编造新数字 |
| qwen-max | 43.0s | 2/2 ✓ | 28.1s | 3.0s | 中上 | ✓ |

- qwen-plus Stage 1 要 **40–48s**，且**约半数概率吐非法 JSON**（一轮超长破坏结构）→ 触发重试 → 再等 40s 或彻底失败。
- 叠加"无超时、网络错误不重试"（见 2.2），即表现为"经常加载不出来"。
- qwen-flash：Stage 1 快 3.4×、2/2 有效、归因精准（mitigatingFactors 正确绑定 recentProfile）；Stage 2 快 2.8×、锐评感追平 plus 且不编数字。

> 基准脚本：`tests/bench-ai-models.mjs`（可复测）。样本 2 轮/模型，差距为 3× 量级，非噪声。

### 2.2 无超时 / 无网络重试（"加载不出来" 的放大器）

- `requestAIContentStream`（`stream.ts:33`）的 `tauriFetch` **无 timeout / AbortController**。Worker 或上游一卡 → 永久转圈。
- `index.ts:85` 的重试**仅在"拿到 rawJson 但校验失败"时触发**；Stage 1 网络失败没有 rawJson → 立刻 break → 整局判死，一次抖动即全盘失败。

### 2.3 渲染扁平（"可读性差"）

`MatchAIPanel.vue` 把流式 markdown 经 `markdown-it` 转 HTML 后 `v-html`，CSS 仅样式化 `h2/ul/li/p`。无章节着色、无 hero、无数字/名字高亮、正负判定同色。

### 2.4 「少拉数据」经核实为空操作（已排除）

`get_match_history_by_puuid`（`lcu/api/match_history.rs:110`）首次访问某 puuid 即拉 `0..49`（50 局）全量缓存，之后 `endIndex ≤ 49` 的请求只从内存缓存切片，不再打 LCU。故前端 profile 拉取窗口（20→10）对后端拉取成本零影响；前端 `recentProfile.batch.ts` 另有 10 分钟缓存。**结论：不做此项。**

## 3. 目标 / 非目标

**目标**
- 消除"加载不出来"：从根上换模型 + 加超时/看门狗/网络重试自愈。
- 提升可读性：章节着色 + hero + 数字/名字高亮，保留流式与锐评文风。
- 顺带提速：模型切换使干净流程从 ~57s → ~18s。

**非目标**
- 不改两段式归因→锐评架构、不改 prompt 内容、不改 Stage 1 输出 schema。
- 不做前端缓存持久化/预热（Rust 已两层缓存）。
- 不做 Stage 1 即时结构化预览（保持精简）。
- tagSuggest 的模型暂不动（留作后续单独评估）。

## 4. 设计

### 4.1 模型切换（最高优先级）

- `matchDetail/attribution.ts`：`STAGE1_MODEL` `qwen-plus` → `qwen-flash`，注释注明基准数据。
- `matchDetail/critique.ts`：`STAGE2_MODEL` `qwen-plus` → `qwen-flash`，注释注明基准数据。
- 兜底默认也一并切（补完 `dashscope-direct-key` 计划 Task 7）：前端 `stream.ts` 的
  `DEFAULT_MODEL`、Rust `command/ai.rs` 的 `DEFAULT_MODEL` → `qwen-flash`。
- `tagSuggest/index.ts` 的 `TAG_MODEL` 不在本次范围。

> 注：会话中途 `stream.ts` 已被 `dashscope-direct-key` 计划重构为经 Rust 命令
> `stream_ai_analysis` 直连 DashScope（不再走 Cloudflare Worker / 前端 fetch）。model
> 仍由前端经 `invoke` 透传进 Rust，故上述 stage 常量切换照常生效。

### 4.2 可靠性基线（在 Rust `command/ai.rs`）

因传输已下沉到 Rust（见 4.1 注），可靠性在 `stream_ai_analysis` 命令实现，常量集中便于调参：

- `REQUEST_TIMEOUT_SECS = 60`：reqwest 客户端总超时，由原来的 120s 收紧（flash 总耗时 ~12s，
  120s 等于让用户干等两分钟"假死"）。
- `FIRST_TOKEN_TIMEOUT_SECS = 20`：`tokio::time::timeout` 包住首个响应字节；超时判这次尝试失败。
- `MAX_ATTEMPTS = 2`，退避 `backoff_delay`（800ms / 2000ms）。

重试只在**流尚未开始**（还没向前端 emit 过 chunk）时进行，避免重复输出：

- 建连/超时错误、可重试状态码（`is_retryable_status`：429 / 5xx）、首字看门狗超时 → 退避后重试。
- 一旦取到首个响应字节即跳出重试循环，后续流中错误按既有 error 事件处理（不重试）。

纯决策函数 `is_retryable_status` / `backoff_delay` 走 TDD（cargo test）；send+watchdog+retry
编排为网络相关，靠人工/集成验证（与命令既有的 `extract_delta_content` 同策略）。前端
`stream.ts` / `index.ts` 无需为可靠性改动——终态仍由 Channel 的 done/error 事件驱动。

### 4.3 渲染层视觉强化

**新增纯函数模块 `services/ai/matchDetail/renderReport.ts`**，导出 `renderAnalysisReport(markdown: string): string`，内部两步，把现 `useMatchAIAnalysis.ts` 内联的 `markdown-it` 实例搬入：

1. **章节着色**：override `md.renderer.rules.heading_open`，读取下一 inline token 的 `content` → 匹配已知章节标题 → 给 `<h2>` 加 class。图标走 CSS `::before`，不注入 HTML。章节映射（标题文本 → class / 语义色）：

   | 标题 | class | 语义色 | 图标 |
   |------|-------|--------|------|
   | 一句话定论 | `ai-section--verdict` | 中性 hero | 🎯 |
   | 谁尽力了 | `ai-section--effort` | `--semantic-win` 绿 | 💪 |
   | 谁要背锅 | `ai-section--blame` | `--semantic-loss` 红 | ⚠ |
   | 谁被打爆 / 被连累 | `ai-section--crushed` | `--semantic-warn`（新增琥珀） | 🩹 |
   | 关键证据 | `ai-section--evidence` | `--text-secondary` 灰 | 🔍 |

   未知/流式未拼全的标题 → 中性默认 class（优雅降级）。这些标题在正式输出与 `critiqueTemplate.ts` 兜底里一致。

2. **行内高亮**：渲染后用 `DOMParser` 解析，**只遍历文本节点**（不碰标签/属性，杜绝 XSS）：
   - 数字（`\d[\d,]*\.?\d*` + 可选单位 `k/万/%`）包成 `<span class="ai-num">`。
   - 每个 `<li>` 首个「：」前的名字段包成 `<strong class="ai-name">`（无冒号则跳过）。
   - 保留 `markdown-it` 的 `html:false`，raw HTML 仍被转义；DOM 走查仅改文本节点，不引入注入面。

**`MatchAIPanel.vue`**：`:deep` 扩展样式——章节左色条 + `::before` 图标、`ai-section--verdict` 相邻 `p` 做 hero 卡片（`h2.ai-section--verdict + p`）、按章节 class 给相邻 `ul li` 上左边框色、`.ai-num` 高亮 pill、`.ai-name` 加粗、blockquote（兜底提示）做 warning banner。

**`global.css`**：新增 `--semantic-warn`（暗/亮两套琥珀色，与既有 `--semantic-win/loss` 风格一致）。

**`useMatchAIAnalysis.ts`**：`renderedAiResult` 改调 `renderAnalysisReport(aiResult.value)`，移除内联 md 实例。

## 5. 数据流（不变）

```
点击 → ensureProfiles(Rust 已缓存) → Stage1 归因(qwen-flash, buffered, 带超时/重试)
     → Stage2 锐评(qwen-flash, streaming, 首字看门狗) → renderAnalysisReport → v-html
```

## 6. 错误处理

- Stage 1 重试耗尽 → `onError`，UI 维持现有失败态 + 「重新分析」按钮。
- Stage 2 重试耗尽（首字前）或流中断 → `critiqueTemplate.renderFallbackCritique` 兜底（其输出同 5 段标题，复用同一渲染）。
- `renderAnalysisReport` 对非法/部分 markdown 必须不抛异常（流式每 chunk 都会调用）。

## 7. 文件改动清单

| 文件 | 改动 |
|------|------|
| `services/ai/matchDetail/renderReport.ts` | 新增：渲染纯函数 |
| `services/ai/matchDetail/__tests__/renderReport.spec.ts` | 新增：单测（含 XSS）|
| `src-tauri/src/command/ai.rs` | 可靠性：超时 60s + 首字看门狗 + 首块前重试 + `is_retryable_status`/`backoff_delay`（含 cargo test）；`DEFAULT_MODEL` → qwen-flash |
| `services/ai/stream.ts` | `DEFAULT_MODEL` → qwen-flash |
| `services/ai/matchDetail/attribution.ts` | `STAGE1_MODEL` → qwen-flash |
| `services/ai/matchDetail/critique.ts` | `STAGE2_MODEL` → qwen-flash |
| `composables/useMatchAIAnalysis.ts` | 改用 `renderAnalysisReport`，移除内联 markdown-it |
| `components/record/MatchAIPanel.vue` | 扩 `:deep` 样式（章节着色 / hero / 数字名字高亮 / 兜底条）|
| `src/global.css` | 新增 `--semantic-warn`（暗/亮两套）|

## 8. 测试计划

- `renderReport.spec.ts`（vitest + jsdom）：
  - 已知标题 → 正确 section class；未知/部分标题 → 中性降级。
  - 数字被 `<span class="ai-num">` 包裹；`<li>` 名字段被 `<strong class="ai-name">` 包裹。
  - **XSS**：markdown 内 `<script>`/`<img onerror>` 在输出中仍被转义。
  - 部分 markdown（流式中途）不抛异常。
- `stream.ts`：超时触发 abort 并按重试次数重试（mock fetch）；首字看门狗在首 chunk 后不误杀。
- 回归：现有 `matchDetail/__tests__/*`、`MatchHistory.spec.ts` 全绿。
- 门禁：`npm run check` + `npm run test`。

## 9. 风险

- 模型切换基于 2 轮样本——差距为 3× 量级可放心，但上线后可留意 Stage 1 校验失败率（既有重试 + 兜底已覆盖回退）。
- `DOMParser` 在 Tauri webview 与 vitest(jsdom) 均可用；每 chunk 解析对短文本开销可忽略。
- `--semantic-warn` 需同时覆盖暗/亮主题，避免亮色主题对比度不足。
