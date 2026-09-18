# 英雄符文推荐 + 选人期应用 设计文档

日期：2026-09-15
分支：feat/rune-recommend

## 背景与目标

现有 5 个自动化任务（accept_match / start_match / pick_champion / ban_champion / bp_decision）全部服务排位 ban/pick，**大乱斗场景下全部闲置**。而大乱斗恰恰是「不知道该带什么符文」最强烈的场景——英雄随机，用户经常拿到八百年不玩的英雄。

本功能分四层：

1. **英雄详情数据层**：接入 OP.GG 英雄详情接口，拿到符文 / 出装 / 加点 / 召唤师技能，排位 + 大乱斗双模式，按需拉取并分片缓存。
2. **选人期展示**：锁定英雄后在 `Gaming.vue` 决策带下方展示推荐符文（只读）。
3. **一键应用**：把推荐符文写成客户端的**临时符文页**，不占页位、不碰用户已有符文页。
4. **自动应用**：新增 `apply_runes` 自动化任务，opt-in 开关，锁定后自动写入。

### 已确认的事实依据

OP.GG 详情接口实测（2026-09-15，均返回 200）：

| 请求 | 结果 |
|---|---|
| `GET /api/global/champions/ranked/{id}/{position}` | 21.5 KB，含 `runes` / `core_items` / `boots` / `starter_items` / `last_items` / `skills` / `summoner_spells` / `counters` / `trends` |
| `GET /api/global/champions/aram/{id}/none` | 18.2 KB，字段同上（无 `counters`） |
| `GET /api/global/champions/aram/{id}/{其他值}` | **422**，`{"message":"The position must be NONE"}` |
| `GET /api/global/champions/aram/{id}` | 404 |
| `?tier=` 参数 | **对 detail 有效且数据真实变化**：同一英雄 `all` 60.2 万场 / `gold_plus` 36.9 万场 / `master_plus` 1.8 万场，`win_rate` 与 `runes[].play` 同步变化。不传时默认值约等于 `emerald_plus` |

- `meta.version` 返回形如 `"16.18"`，可直接作 patch 缓存键；`meta.cached_at` 是 OP.GG 侧的生成时间。
- `runes[]` 是扁平的具体构筑，字段与 LCU 直接映射，**不需要转换表**：`primary_page_id` → `primaryStyleId`、`secondary_page_id` → `subStyleId`、`primary_rune_ids`(4) + `secondary_rune_ids`(2) + `stat_mod_ids`(3) 按序拼接 → `selectedPerkIds`(9)。
- `rune_pages[]` 与 `runes[]` 是同一份数据的两种组织（前者按 主系×副系 分组再嵌 builds）。**应用时用 `runes[]`**，本功能不消费 `rune_pages[]`。
- 符文系 id 与符文 id 已可本地解析成名字和图标：`constant/api.rs:4-5` 的 `perkstyles.json` / `perks.json` 在启动时由 `asset.rs:319 init_lcu_assets()` 载入，前端经 `useAssetUrl` 的 `perk` kind 取图标（注意 `getRuneUrl` 生成 `/rune/:id` 是死代码，后端会 404）。
- 可直接复用：`opgg_mode_for`（`automation.rs:562`，有分路=ranked / 无分路=aram）、`normalize_position`（`opgg/data.rs`）、`detect_my_position`（`rule_engine.rs:14`）、`sanitize_tier` + `VALID_TIERS`（`opgg/api.rs:14-35`）、配置键 `settings.opgg.tier`。
- `lcu/util/http.rs` 只有 GET / POST / PATCH 封装，**缺 PUT 和 DELETE**。
- `lcu_post`（`http.rs:211`）对非 2xx 会盲目刷新 auth 重试一次——用它做符文页 POST 会建出两页。
- automation 全部是 tokio ticker 轮询，`lcu/listener.rs` 的事件只分发到 phase 缓存（`listener.rs:150-153`）和前端，**没有事件直达自动化任务**。
- 项目既有态度：对 LCU 官方端点的写操作放开（前提是可见、可退让、不产生不可逆惩罚），见 `automation.rs:766-768`、`launcher.rs:263-267`。
- 静态数据分发管线已存在且可复用：`.github/workflows/patch-notes-data.yml`（6h cron → 生成 → commit 到 `data/` → 镜像 GitCode），消费端模板见 `cn_patch_notes.rs`（双源 jsDelivr → GitCode、TTL 6h、`SCHEMA_VERSION` 校验、网络失败旧快照续命）。

### 待真机验证（阻塞第 3 层及之后的实施）

以下是 LCU 侧的**推定**，mac 无法验证，必须在装有客户端的机器上确认后再写实现——沿用 `automation.rs:728-732`（`BAN_HOVER_ENABLED = false`）那套「未验证先关掉」的做法。

| # | 待验证 | 影响 | 真机结论（2026-09-15，国服客户端，大厅外，页位 2/2 已满） |
|---|---|---|---|
| V1 | `POST /lol-perks/v1/pages` 传 `isTemporary: true` 是否被接受，还是被静默忽略建成持久页 | 决定整个隔离策略。不成立则退回「固定复用一个持久页 + 按 puuid 存 pageId」的备选方案 | ✅ 被接受，返回页 `isTemporary: true` |
| V2 | 临时页是否**不计入页位上限**（对比建页前后 `/lol-perks/v1/inventory` 的 `ownedPageCount`） | 这是临时页方案的最大收益点 | ✅ 不计入：`ownedPageCount` / `customPageCount` 前后均为 2，且 `canAddCustomPage: false` 时照样建成 |
| V3 | 临时页的生命周期：对局结束清除 / 客户端重启清除 / 被下一个临时页顶掉 | 决定换人（swap）时是覆盖还是新增 | ⚠️ **不会被顶掉**：连建两个临时页两个都在。据此换人改为**原地改写自己建的那一页**（见 `apply_rune_page`）。**对局结束也不清**：用户一局排位里客户端「推荐符文」建的官方临时页（`维克托「奥术先驱 - 冥火之触」`、`recommendationChampionId: 112`），到 EndOfGame 仍在且仍是当前页；回大厅 / 重启客户端是否清除仍待补测 |
| V4 | 建页后是否需要额外 `PUT /lol-perks/v1/currentpage` 才选中，还是 POST body 带 `current: true` 即可 | 决定写入是一步还是两步 | ✅ 一步：POST 后新页自动成为当前页（body `current: false` 也一样，且 POST 响应体里 `current` 仍显示 false）；`PUT /lol-perks/v1/pages/{id}` 改写同样自动选中并保留 `isTemporary` |
| V5 | 排位选人期是否存在符文页写入锁定窗口 | 决定触发时机能否放到 FINALIZATION | ⏳ 待排位选人期实测；实现上同一幂等键失败最多重试 3 次，不刷屏 |

附带发现：**删掉当前页后客户端处于「无当前页」**（`currentpage` 为空），必须另行 PUT 选回——产品代码任何分支都不 DELETE，这条再次佐证。

**验证方法**（比凭空推字段可靠）：进选人期，用客户端自带的「推荐符文」点一次，让官方自己建一个临时页，然后 `GET /lol-perks/v1/pages` 照抄它的字段形状。脚本 `scripts/lcu-probe/perks-probe.mjs`（`dump` / `diff` / `try-temp [--twice] [--update]` / `watch`）；实施中对本文的其余偏离（OP.GG position 命名、大乱斗 tier、mode 判定等）见 `docs/superpowers/plans/2026-09-15-rune-recommend.md`「与 spec 的偏离」。

## 非目标

- **不做英雄排行榜页**（榜单 + 筛选 + 详情抽屉）。它复用本功能的数据层，但交互独立，另开 spec。
- **不做出装写入**。`PUT /lol-item-sets/v1/item-sets/{summonerId}/sets` 是全量覆盖语义，写错会清空用户手工配置的全部出装方案，风险等级高于符文，另开 spec。本功能只**展示**出装，不写入。
- **不做符文页管理**：不增、不删、不改用户自己的任何持久符文页。
- **不自己计算胜率数据**。DAU 约 52，单英雄单位置想统计显著需要数千场，自有样本两年也攒不出来。
- **在 V1 验证通过前，不实现任何持久符文页写入路径**。
- **不做 CI 预拉镜像**。本期 detail 一律客户端直拉，量化理由见「数据获取策略」；只实现让源可远程切换的 manifest，镜像本身留作后备。
- 不做 AI 参与的符文解释。

## 交互设计

### 选人期推荐栏 `BuildRecommendBar`

挂在 `Gaming.vue:171` 的 `gaming-intel-banner` 内、`BpDecisionBar` 下方。单行布局：

```
[主系图标][基石图标] 精密 · 致命节奏   [核心装×3 图标]   32.3% 出场 · 46.4% 胜率 · 2.4万场     [应用符文]
```

- 符文块：主系图标 + 基石图标 + 文案「{主系名} · {基石名}」，hover 出完整 9 个符文的 tooltip（复用 `useRecordAssets` + `AssetTooltipContent`）。
- 出装块：核心三件套图标（只读，本期不可应用）。
- 依据文案：该套符文的 `pick_rate` / 胜率 / 样本量。**永远显示样本量**，与项目一贯的可验证风格一致。
- 右侧按钮随 `settings.auto.applyRunesSwitch` 变形：

| 开关 | 按钮 | 行为 |
|---|---|---|
| 关（默认） | `应用符文` | 手动点击才写入。等价于现有的隐式 Advisory 语义——决策带照常显示、只是不执行 |
| 开 | `已应用` / `自动应用中…` | 锁定后自动写入，按钮退化为状态指示 |

开关位置：`Automation.vue` 的「基本设置」卡片，与自动接受 / 自动开始匹配同组。

### 触发与重算

- **触发条件**：我的 `display_champion_id`（`champion_select.rs:80`）> 0 且 mode/position 已确定。不需要 BP 那套阶段门 + 扣快照年龄的实时计算（`evaluate.rs:36-55`）——符文没有倒计时压力，锁定到进游戏之间任何时候写都来得及。
- **换人（swap/trade）必须重算**：锁定后仍可交换英雄，`championId` 会变。前端已有 `isChampionSwap`（`championIntel.ts:126-128`）判定先例。
- **不能用「本局只执行一次」标记**，也不能照搬 BP 那套「每 tick 无脑重试靠状态收敛」（`automation.rs:823-824`）——BP 的 PATCH 幂等，符文写入不幂等，每写一次客户端都有一次可见的页面切换。改用幂等键比较，见后端设计。

### 边态

- **数据拉取中**：推荐栏显示骨架条，不显示按钮。
- **OP.GG 拉取失败且无缓存**：整条栏不渲染（不占位、不报错）。沿用 `services/opgg.ts` 「网络型失败吞掉返回 null」的既有惯例。
- **命中 stale 缓存**（patch 已变但新数据拉不到）：正常渲染 + 文案追加「· 版本 {缓存的 patch}」提示数据非当前版本。
- **样本量不足**：该套构筑 `play < 200` 时不作为自动应用候选；若 `runes[]` 中全部构筑都低于阈值，展示但禁用应用按钮，文案「样本不足，仅供参考」。阈值取 200 的依据：实测 `master_plus` 这种最窄分段下头部构筑仍有 1527 场，200 能滤掉长尾又不误伤冷门英雄。
- **符文页写入失败**：按钮变「应用失败」+ 可重试，toast 显示原因。**页位满且无法建临时页时，明确提示「符文页已满，请手动删除一页后重试」，绝不自作主张删用户的页**。
- **未连接客户端**：推荐栏不存在（选人期才渲染），无需处理。

## 后端设计

### 数据获取策略：客户端直拉 + 远程可切换源

**detail 数据由客户端直接向 OP.GG 拉取，不做 CI 预拉镜像。** 与现有 list 接口（`opgg/api.rs`）的行为一致。

理由是量化的，不是"先简单做"：

| | 客户端直拉 | CI 预拉镜像 |
|---|---|---|
| 对 OP.GG 的请求量 | DAU ~52 × 每天 2–4 局 × 每局 1 个英雄，同 patch 内命中缓存不再请求 → **全网 150–250 次/天**，分散在数十个 IP | `(170 × 2.5 分路 + 170 大乱斗) × 6 段位 ≈ **3570 次/版本**，单次突发，全部来自一个 Actions IP |
| tier 维度 | 精确按需，用户选哪档拉哪档 | 必须预生成 6 档，但每个用户只用 1 档，6 倍浪费 |
| 数据新鲜度 | 实时 | 滞后一个 CI 周期 |
| 基建成本 | 0 | 流水线 + 仓库体积 |

预拉产生的流量是全体用户实际流量的约 18 倍，且是单 IP 突发——为"减轻对方压力"而预拉，结果是压力增加一个数量级。**在 DAU 上到四位数之前，预拉都是错误的选择。**

#### 但源必须可远程切换

直拉解决不了一个已知问题：便携版约 30% 收不到更新、37% 活跃用户卡在 1.8.x（见 memory `project_dau_plateau_diagnosis`）。**任何硬编码在客户端里的外部 API 契约都是负债**——OP.GG 改字段名或封 UA，这批用户永久失效，且无法通过发版挽救。

故新增 `src-tauri/src/opgg/source.rs`，结构直接对齐 `cn_patch_notes.rs:26-32`：

```rust
pub const SOURCE_SCHEMA_VERSION: u32 = 1;
pub const SOURCE_TTL_SECS: i64 = 6 * 60 * 60;

/// 分发源，按序尝试：jsDelivr CDN（国内可达）→ GitCode raw（仓库镜像）
const SOURCES: [&str; 2] = [
    "https://cdn.jsdelivr.net/gh/wnzzer/rank-analysis@main/data/builds-source.json",
    "https://gitcode.com/wnzzer/rank-analysis/raw/main/data/builds-source.json",
];

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BuildsSource {
    pub schema_version: u32,
    /// direct = 直连 OP.GG；mirror = 走 mirror_base；disabled = 全局关闭本功能
    pub strategy: String,
    /// 占位符：{mode} {champion_id} {position} {tier}
    pub url_template: String,
    pub mirror_base: Option<String>,
}
```

仓库内产物 `data/builds-source.json` 首版内容：

```json
{
  "schemaVersion": 1,
  "strategy": "direct",
  "urlTemplate": "https://lol-api-champion.op.gg/api/global/champions/{mode}/{champion_id}/{position}?tier={tier}",
  "mirrorBase": null
}
```

行为约定：

- 启动后首次需要 detail 时拉取一次，内存 + 磁盘缓存 TTL 6h，沿用 `cn_patch_notes.rs` 的三级 `get_or_fetch` 模板。
- **两源都不可达 → 用编译期硬编码的同内容默认值**，绝不因为 manifest 拉不到而让功能失效。
- `schema_version` 不等于 `SOURCE_SCHEMA_VERSION` → 忽略远端，用硬编码默认值（老客户端遇到新 schema 时安全降级）。
- `strategy == "disabled"` → `get_champion_build` 直接返回 `Ok(None)`，前端不渲染推荐栏。**这是一个对全体客户端生效的 kill switch**，包括收不到更新的老版本。

改一个 JSON 推一次即可让 1.8.x 的用户恢复或停用，无需发版。成本约 30 行 + 一个 JSON 文件，而 `patch-notes-data.yml`（6h cron → 生成 → commit → 镜像 GitCode）已经把分发基建建好，加一个产物是零边际成本。

#### CI 镜像留作后备，不在本期实施

只有当 `strategy` 确需切到 `mirror` 时才建。届时形态要变：**按 `(mode, tier)` 打 12 个大文件，而非 3570 个小文件**——客户端一个 patch 只下 1 次（gzip 后约 200 KB），比直拉还省。注意仓库体积：12 文件 × ~1 MB/版本，两周一更即约 300 MB/年的 git 历史，`patch-notes-data.yml` 那种直接 commit 进仓的做法扛不住，需改推 Release assets 或只镜像默认档 `emerald_plus`。

### 新模块 `opgg/detail.rs`

#### 命名纠正

OP.GG 把符文**系**命名成 `primary_page_id` / `secondary_page_id`，这与「符文页」是两个完全无关的概念（前者是 8000 精密 / 8100 主宰 / 8200 巫术 / 8300 启迪 / 8400 坚决，后者是用户符文页的句柄）。**我们的结构一律改名为 `primary_style_id` / `sub_style_id`**，与 LCU 字段对齐，避免混淆。

#### 类型（snake_case，前端同构 `src/types/championBuild.ts`）

```rust
pub const BUILD_SCHEMA_VERSION: u32 = 1;

pub struct ChampionBuild {
    pub schema_version: u32,
    pub champion_id: i32,
    pub position: String,        // top/jungle/middle/bottom/utility/none
    pub mode: String,            // "ranked" | "aram"
    pub tier: String,            // 取自 settings.opgg.tier
    pub patch: String,           // meta.version，如 "16.18"
    pub fetched_at: u64,
    pub play: i32,               // summary.average_stats.play
    pub win_rate: f64,
    pub runes: Vec<RuneBuild>,
    pub spells: Vec<IdsEntry>,
    pub starter_items: Vec<IdsEntry>,
    pub boots: Vec<IdsEntry>,
    pub core_items: Vec<IdsEntry>,
    pub last_items: Vec<IdsEntry>,
    pub skills: Vec<SkillBuild>,
}

pub struct RuneBuild {
    pub primary_style_id: i32,      // OP.GG primary_page_id
    pub sub_style_id: i32,          // OP.GG secondary_page_id
    pub primary_perk_ids: Vec<i32>, // 4 个
    pub sub_perk_ids: Vec<i32>,     // 2 个
    pub stat_mod_ids: Vec<i32>,     // 3 个
    pub play: i32,
    pub win: i32,
    pub pick_rate: f64,
}

pub struct IdsEntry {
    pub ids: Vec<i32>,
    pub play: i32,
    pub win: i32,
    pub pick_rate: f64,
}

pub struct SkillBuild {
    pub order: Vec<String>,   // 15 项，"Q"/"W"/"E"/"R"
    pub play: i32,
    pub win: i32,
    pub pick_rate: f64,
}
```

#### 裁剪策略（解析即裁剪，不缓存原始响应）

照 `asset.rs` 处理 26 MB cdragon 只存解析后 map 的先例。原始 21.5 KB 里大量是页面不渲染的长尾（`last_items` 30 条、`starter_items` 15 条、`trends` 全历史、`game_lengths`、`mythic_items`、`summary.positions` 的全部分路）。

按 `pick_rate` 降序保留：

| 字段 | 保留条数 |
|---|---|
| `runes` | 3 |
| `spells` | 2 |
| `starter_items` | 2 |
| `boots` | 3 |
| `core_items` | 5 |
| `last_items` | 6 |
| `skills` | 2 |

丢弃：`rune_pages`、`mythic_items`、`skill_masteries`、`skill_evolves`、`trends`、`game_lengths`、`counters`（克制关系已由 list 接口的 `getLaneCounters` 提供）、`summary.positions` 中非当前 position 的条目。

裁剪后约 2.5 KB，缩到原始的 1/8。

#### 请求构造

```
ranked: {BASE_URL}/ranked/{champion_id}/{position}?tier={tier}
aram:   {BASE_URL}/aram/{champion_id}/none?tier={tier}
```

URL **不硬编码**，由 `opgg/source.rs` 的 `url_template` 填充四个占位符得到（见「数据获取策略」）；上表是 manifest 默认值展开后的形态。position 对 aram **必须**是 `none`（其他值 422）。mode 判定复用 `opgg_mode_for`（`automation.rs:562`）。tier 经 `sanitize_tier`（`opgg/api.rs:28`）。UA 复用 `opgg/api.rs:11` 的常量。

#### 缓存布局

`paths.rs` 新增 `cache_subdir(name: &str) -> PathBuf`（现有 `cache_file()` 是 temp 平铺加前缀，几百个 detail 文件铺进去不合适）：

```
{temp}/rank-analysis-builds/{patch}/{mode}_{tier}/{champion_id}_{position}.json
```

- **patch 作为目录层级**：版本变化时 `remove_dir_all` 旧目录一把清干净，不用逐文件判 TTL。比 `patch_notes.rs` 的单文件单 patch 更适合多条目场景。
- **分文件而非单个大 map**：避免每拉一个英雄就全量重写几 MB（`config.rs:250` 那种全量重写在配置上无妨，这里是写放大），也让单文件损坏不污染全局。
- **patch 内不设 TTL**：版本内构筑分布变化极慢，patch 键足以表达失效。
- 当前 patch 从哪来：首次请求的响应 `meta.version`。启动时不预知，因此**目录清理是惰性的**——写入新 patch 目录后，异步清掉 `{temp}/rank-analysis-builds/` 下其他 patch 目录。
- 内存层 moka `max_capacity(120)`。**必须设 `max_capacity`**：`asset.rs:289` 的 `BINARY_CACHE` 设了 weigher 却没设 max_capacity 导致永不驱逐，注释里已承认，不要复制这个模式。

不进 `config.yaml`。`config.rs:408` 是黑名单制（注释原话「漏登记 = 被同步出去」），缓存进配置意味着几 MB 垃圾被推上 Supabase。

### 新命令 `get_champion_build`（`src-tauri/src/command/champion_build.rs`）

```rust
#[tauri::command]
pub async fn get_champion_build(
    champion_id: i32,
    position: Option<String>,   // None → 走 aram
) -> Result<Option<ChampionBuild>, String>
```

- `position` 为 `None` 或空串 → `mode = "aram"`, `position = "none"`；否则 `mode = "ranked"`，position 经 `normalize_position`。
- tier 读 `settings.opgg.tier`，经 `sanitize_tier` 兜底。
- 查找顺序：内存 → 磁盘（patch 目录匹配）→ HTTP → 写盘 + 写内存。
- 网络失败且有**其他 patch** 的缓存 → 返回该 stale 条目（`patch` 字段即为旧版本号，前端据此提示）。完全无缓存 → `Ok(None)`，前端不渲染。

注册于 `main.rs` 的 `invoke_handler`。

### LCU 写封装扩展（`lcu/util/http.rs`）

新增三个函数，与现有风格一致：

```rust
pub async fn lcu_put<T, D>(uri: &str, body: &D) -> Result<T, String>
pub async fn lcu_delete(uri: &str) -> Result<(), String>
pub async fn lcu_post_no_retry<T, D>(uri: &str, body: &D) -> Result<T, String>
```

- `lcu_put` / `lcu_delete` / `lcu_post_no_retry` 三者**均不做非 2xx 重试**，只在传输层错误（连接失败）时刷新 auth 重试一次。
- 理由：现有 `lcu_post`（`http.rs:211`）对非 2xx 盲重试一次，用在 `POST /lol-perks/v1/pages` 上会建出两个符文页。这是必须先修的地基。
- 沿用现有的并发信号量（`http.rs:20`），**不走 singleflight**（`http.rs:23` 那个 100ms 去重是为 GET 设计的，写操作不能被合并）。

### 新命令 `apply_rune_page`（`src-tauri/src/command/rune_page.rs`）

```rust
#[tauri::command]
pub async fn apply_rune_page(
    champion_id: i32,
    position: String,
    rune: RuneBuild,
) -> Result<ApplyRuneResult, String>

pub struct ApplyRuneResult {
    pub ok: bool,
    pub page_id: Option<i64>,
    pub reason: Option<String>,   // "page_limit_full" | "lcu_rejected" | ...
}
```

流程（V1 / V2 / V4 已真机验证通过）：

1. 拼页名：`{英雄中文名} · {位置中文名} (RA)`，位置为 `none` 时省略位置段。中文名走 `command/config.rs:116 get_champion_options` 的同源数据。
2. `GET /lol-perks/v1/pages` 找**自己建的页**（`isTemporary && name 以 " (RA)" 结尾`）：找到 → `PUT /lol-perks/v1/pages/{id}` 原地改写（V3：临时页不会互相顶掉，每次新建会越堆越多）；找不到 → `POST /lol-perks/v1/pages`（经 `lcu_post_no_retry`），body：
   ```json
   {
     "name": "亚索 · 中单 (RA)",
     "isTemporary": true,
     "primaryStyleId": 8000,
     "subStyleId": 8400,
     "selectedPerkIds": [8008, 9101, 9104, 8299, 8444, 8451, 5005, 5008, 5001],
     "current": true
   }
   ```
   `selectedPerkIds` = `primary_perk_ids`(4) ++ `sub_perk_ids`(2) ++ `stat_mod_ids`(3)，**顺序不可乱**。
3. ~~若 V4 验证结论是「需要两步」，追加 `PUT /lol-perks/v1/currentpage`~~——V4 实测一步即可，POST / PUT 都会自动选中。
4. 失败分类：HTTP 4xx 且 body 含页数上限语义 → `reason = "page_limit_full"`；其余 → `"lcu_rejected"`。**任何分支都不发起 DELETE**。

**本命令不删除任何符文页。** 临时页由客户端自行回收（V3 确认生命周期）。

### 新自动化任务 `apply_runes`（`automation.rs`）

与 `start_champion_select_automation`（`automation.rs:400`）完全同构：

```
任务 key:   "apply_runes"
开关 key:   settings.auto.applyRunesSwitch      // 布尔一律 xxxSwitch，符合现有命名规范
ticker:     2s + MissedTickBehavior::Skip       // 与 bp_decision 同档
```

- 每 tick 第一件事：`get_phase() != CHAMPSELECT` → 清空幂等键后 `continue`。
- 取 session → 用 puuid 在 `my_team` 中定位自己（口径对齐 `detect_my_position` `rule_engine.rs:14-17`）→ 取 `display_champion_id` 与 `assigned_position`。
- championId 为 0 → `continue`。
- 算幂等键，与上次相同 → `continue`；不同 → 调 `get_champion_build` → 取 `runes[0]`（`play >= 200` 的第一条）→ 调 `apply_rune_page` → 成功后更新幂等键。
- 失败只 `log::error!`，不中断 loop、不更新幂等键（下个 tick 自然重试）。与 `automation.rs:416-418` 的处理一致。

**幂等键**：

```rust
struct AppliedKey {
    champion_id: i32,
    position: String,
    mode: String,
    tier: String,
    perk_ids: Vec<i32>,   // 9 个，直接比内容
}
```

四元组 + 符文内容全等才跳过。换人 → `champion_id` 变；用户改段位 → `tier` 变；数据刷新出了不同构筑 → `perk_ids` 变。一条比较覆盖全部重写场景。存进程内 `static`，离开选人期时清空。

注册：`init_run_automation`（`automation.rs:916`）+ `register_on_change_callback`（`automation.rs:1015`）各加一条，与其余 4 个开关型任务写法一致。

## 前端设计

- `src/types/championBuild.ts`：与 Rust 同构类型（`ChampionBuild` / `RuneBuild` / `IdsEntry` / `SkillBuild` / `ApplyRuneResult`）。
- `src/services/championBuild.ts`：`fetchChampionBuild(championId, position)` / `applyRunePage(championId, position, rune)`，按域分文件的既有惯例（对齐 `services/opgg.ts`）。网络型失败吞掉返回 `null`。
- `src/composables/useChampionBuild.ts`：入参为 `sessionData` 的响应式引用，内部 watch 我方 championId + assignedPosition，变化时拉取。**必须复用 `useSessionSync.ts:57-80` 的 `playerSignature` 判定，不要对会话数据做深比较**。
- `src/components/gaming/BuildRecommendBar.vue`：单行布局 + 四态（loading / ok / 样本不足 / 失败），按钮随开关变形。
- `src/views/Gaming.vue`：在 `:171-175` 的 `BpDecisionBar` 之后挂载 `BuildRecommendBar`。
- `src/views/settings/Automation.vue`：「基本设置」卡片加一个开关（与 `:12` 自动接受、`:22` 自动开始匹配同组），读写走 `getConfigByIpc` / `putConfigByIpc`（`:312-325` / `:427-445`）。
- `src/services/configKeys.ts`：`CONFIG_KEYS` 加 `settings.auto.applyRunesSwitch`。

## 测试

Rust（各模块内 `#[cfg(test)]`）：

- `opgg/source.rs`
  - 占位符填充：`{mode}` / `{champion_id}` / `{position}` / `{tier}` 四个全部替换，模板含未知占位符时原样保留不 panic
  - `schema_version` 不匹配 → 回落编译期默认值
  - 两源均不可达 → 回落编译期默认值（而非返回错误）
  - `strategy == "disabled"` → `get_champion_build` 返回 `Ok(None)`
  - `strategy == "mirror"` 但 `mirror_base` 为 `None` → 视为非法，回落默认值
- `opgg/detail.rs`
  - URL 构造：ranked 拼 position + tier；aram 强制 `none`；非法 position 经 `normalize_position` 归一
  - 裁剪：各字段按 `pick_rate` 降序截断到规定条数；字段数少于上限时不 panic
  - 解析：`primary_page_id` → `primary_style_id` 改名映射正确；`runes[]` 三段 id 数量为 4/2/3
  - 缓存：patch 变化时旧目录条目视为 stale；schema_version 不匹配视为 miss；tier 不匹配视为 miss
- `command/rune_page.rs`
  - `selectedPerkIds` 拼接顺序为 primary(4) → sub(2) → stat(3)，共 9 个
  - 页名拼接：position 为 `none` 时省略位置段
  - `page_limit_full` 的错误分类
- `automation.rs`
  - 幂等键比较：四元组任一变化或 `perk_ids` 内容变化 → 需要重写；全等 → 跳过
  - 离开选人期清空幂等键

前端（Vitest，同目录 `.spec.ts`）：

- `BuildRecommendBar.spec.ts`：四态渲染；开关关时显示「应用符文」按钮、开时显示状态指示；样本不足时按钮禁用；stale 缓存时显示版本提示
- `useChampionBuild.spec.ts`：championId 变化触发重拉；`playerSignature` 未变时不重拉；position 为空时按 aram 请求

## 实施拆分建议

1. **真机验证（阻塞第 4 步及之后）**。写一个独立脚本：读 lockfile → dump `/lol-perks/v1/pages`、`/lol-perks/v1/inventory`、`/lol-perks/v1/currentpage`；在选人期用客户端自带「推荐符文」点一次后再 dump 一遍做 diff。把 V1–V5 的结论回填进本文档的「待真机验证」表。
2. **数据层**：`opgg/source.rs` + 仓库产物 `data/builds-source.json` + `opgg/detail.rs` + `paths::cache_subdir` + `get_champion_build` + 测试。独立可交付。manifest 与 detail 是同一块代码，一起做，别拆——否则第一版会带着硬编码 URL 发出去，正是要避免的负债。
3. **前端只读展示**：类型 + service + composable + `BuildRecommendBar` + `Gaming.vue` 接线 + 测试。到这一步功能已有价值，且**不含任何写操作**。
4. **LCU 写地基**：`lcu_put` / `lcu_delete` / `lcu_post_no_retry`。**单开一个 PR**——写操作重试这个坑修不干净，后面全是脏数据，不要和功能混在一起。
5. **手动应用**：`apply_rune_page` + 按钮接线 + 测试。
6. **自动应用**：`apply_runes` 任务 + `settings.auto.applyRunesSwitch` + `Automation.vue` 开关 + 测试。

第 2、3 步不依赖任何未验证事实，可以与第 1 步并行。
