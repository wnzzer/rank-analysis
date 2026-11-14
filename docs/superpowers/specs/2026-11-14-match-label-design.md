# 复盘页玩家标注「谁最关键 / 谁最犯罪」 设计

日期：2026-11-14
状态：已口头批准（交互 A、规则 A、上传 A、存储 A），表已建

## 目标

在复盘页让玩家标注本局「最关键」与「最犯罪」的玩家，匿名收集到云端，用作校准复盘评分的人工真值
（替代目前靠用户口头告知、手工记进 `scratchpad/annotations.jsonl` 的方式），并给玩家展示「你 vs 模型」的对比。

### 不做的事

- 不用标注修改本局显示的评分 / 标签 / AI 点评（标注只作数据，模型输出保持原样，避免「模型说的」与「人改的」混在一起）。
- 不做结算弹窗提醒（先只放复盘页，数据太少再加）。
- 不在客户端读取他人的标注、不做统计展示。

## 交互（复盘页底部卡片 `LabelCard`）

放在复盘页 AI 点评下方。两排 10 人头像（蓝左红右），分别是「👑 最关键」「💣 最犯罪」。

**规则**：两项都可从全部 10 人中任选（胜方可选为犯罪、败方可选为最关键）；两项各自可选可不选，至少选一项才能提交；
点头像选中，再点取消；提交后可「修改」，重新提交覆盖旧记录。

**状态**：

1. 未标注：提交前**不显示模型结论**，避免先入为主。
2. 首次提交：一次性同意询问——「分享你的判断，帮助改进评分？」说明只上传对局 ID、所选英雄与位置、当时的模型评分，
   不上传召唤师名与账号；按钮「分享」/「只保存在本地」。选择记进配置，设置页可改。
3. 已提交：逐项显示「你 vs 模型」——一致显示「模型也选了 X ✓」；不一致显示「模型选的是 Y（X 排败方倒数第 N）」；
   底部「已分享，谢谢 · 模型判断仅供参考」或「仅保存在本地」。
4. 上传失败：对比照常显示，提示「分享失败，已保存在本地，下次打开复盘时自动重试」。

**不显示卡片**：重开局（<5 分钟）、无评分的模式（复盘页本身不出分时）。

「模型选的最关键」= 复盘页已有评分（`PlayerScore.total`）里全场总分最高的玩家；
「模型选的最犯罪」= **败方**总分最低的玩家（与「犯罪只判败方」的标签规则一致）；都不重算；
名次（如「败方倒数第 3」）在该玩家所在队内按总分排。

## 数据

### 云端 `public.match_labels`（Supabase，已建，SQL：`supabase/match_labels.sql`）

| 字段 | 说明 |
|---|---|
| `owner_id` uuid | 设备匿名账号（默认 `auth.uid()`），与召唤师无关 |
| `game_id` bigint、`platform` text、`queue_id` int | 对局标识 |
| `key_pick` / `blame_pick` jsonb | `{slot, teamId, championId, position}`，可为 null，二者至少一个非空 |
| `labeler_side` text | `win` / `lose`：标注人所在方 |
| `model` jsonb | 当时 10 人 `{slot, teamId, championId, position, total, label}` + 模型选的 `keySlot` / `blameSlot`；未就绪为 null |
| `model_version` text | `<baseline.meta.builtAt>@<app 版本>` |
| `created_at` / `updated_at` | 触发器在 update 时刷新 `updated_at` |

主键 `(owner_id, game_id)`：同设备同局一条，改判 upsert 覆盖。
RLS：`authenticated`（含匿名账号）只能 insert / update / select 自己的行；无 delete；`anon` 无权限；
已 `revoke all` 后只 grant `select, insert, update`（Supabase 默认授予的 TRUNCATE 不受 RLS 约束，必须收回）。
2026-11-14 用两个匿名账号实测：自写 201、覆盖 200、互读为空、改他人行 0 行、冒名写 403、未登录 401、删除 403、两项皆空 400。

**不上传**：任何人的 puuid、召唤师名、账号信息。

### 本地 `match_labels.json`（`paths::data_file`，与隐藏分同目录）

每局一条：`gameId, platform, queueId, keyPick, blamePick, labelerSide, model, modelVersion, uploaded: bool, updatedAt`。
写入采用「临时文件 + rename」；读失败按空处理并 warn。最多保留最近 500 局。

### 同意开关

配置项 `matchLabelShare`：`null`（未决定，首次提交时询问）/ `true` / `false`。
改为 `true` 时，补传本地 `uploaded=false` 的条目。

## 模块

- 后端 `src-tauri/src/command/match_label.rs`：
  - `save_match_label(label)`：写本地；若同意分享则上传，返回 `{ uploaded }`。
  - `get_match_label(gameId)`：读本地，供复盘页恢复已标状态。
  - `retry_match_label_uploads()`：补传未上传条目（打开复盘页时、同意开关改为分享时调用）。
  - 匿名会话与 REST 请求复用 `cloud_sync.rs`：把其中 `ensure_session` 与带鉴权的 POST 抽成 `pub(crate)` 小函数共用，不复制。
- 前端：
  - `components/record/review/LabelCard.vue`：卡片与四种状态。
  - `services/matchLabel.ts`：invoke 封装 + 由 `PlayerScore[]` 生成 `model` 快照与模型选择（纯函数）。
  - 同意询问用 naive `n-modal`，样式沿用 `ErrorReportingConsentDialog` 的写法；设置页加开关。

## 错误处理

| 情形 | 处理 |
|---|---|
| 断网 / Supabase 不可达 | 先存本地，`uploaded=false`，卡片提示失败；下次打开该局复盘自动重试一次 |
| 匿名会话过期 / 账号丢失 | 复用云同步逻辑：先刷新，失败则重新匿名注册 |
| 玩家拒绝分享 | 只存本地，不上传 |
| 时间线未就绪、无模型快照 | 可提交；对比显示「模型结论未就绪」，上传 `model=null` |
| 改判 | 覆盖本地与云端同一主键行 |

## 测试

- Rust：本地读写 / 覆盖 / 损坏文件按空 / 截断 500；上传请求体不含 puuid 与召唤师名（按字段断言）；成功与失败后的 `uploaded` 标记；补传列表。
- 前端：卡片四种状态；至少选一项才可提交；选中 / 取消；提交前不显示模型结论；对比文案（一致 / 不一致 / 未就绪）；重开局不显示；
  `services/matchLabel.ts` 的快照与模型选择纯函数。
- 端到端：dev 里真实标一局，Supabase 控制台看到该行；改判后同一行被覆盖。
