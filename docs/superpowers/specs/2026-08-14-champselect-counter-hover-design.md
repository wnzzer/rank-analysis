# 选人阶段对位悬浮弹窗 + 敌方阵容最优英雄推荐 — 设计

> 版本 v1.1 · 2026-08-14 · 依赖 `2026-08-11-akari-optimization-design.md`（M2/M3 已交付的 OP.GG 管道与 BP 引擎）
> 关联：`bots/superpowers/` 门禁（`npm run check` + 全量 vitest；Rust 由 CI win+mac 兜底）

## 目录
1. 背景与现状盘点
2. 目标与非目标
3. 数据语义（新 API 的正确读法）
4. 后端设计（命令契约 / 评分算法 / 边界 / 错误 / 单测）
5. 前端设计（service / composable / 组件 / 集成点 / 缓存防抖）
6. UI 细则（弹窗结构 / 排序交互 / 文案 / 来源标注 / 空态降级）
7. 测试矩阵
8. 风险与回退
9. 验收标准
10. 任务卡与提交拆分
11. 变更记录

---

## 1. 背景与现状盘点（v1.1 结论：Akari API 直连，v1.0「零新增请求」作废）

要交付的两件事：
- **P1 对位弹窗**：选人阶段悬浮任意英雄头像 → 显示该英雄的全量对位胜率列表（可排序可滚动）
- **P2 阵容推荐**：根据敌方**当前已锁定**阵容，计算我方最优可选英雄（排序 + 理由）

**v1.1 数据层推翻 v1.0 的「零新增网络请求」设计**：v1.0 假设 OP.GG 详情端点已死、只能用快照 top-3 反查；实际破案后发现 LeagueAkari 使用的内部 API 完全可用，且返回**每英雄每位置全量对位列表**（非 top-3），段位/区域/版本/位置全部可筛。详见变更记录。

现状（均为已交付且 CI 全绿的能力，本次**复用不重建**）：

| 能力 | 位置 | 与本功能的关系 |
|---|---|---|
| OP.GG 快照管道（winrate/tier/**每分路 top3 对线克制**） | `src-tauri/src/opgg/api.rs:150-252`（解析）、`data.rs:39-50`（`LaneCounter`）、`command/opgg.rs:191-276`（降级链 + 4 命令） | 保留现有克制 pill / 段位徽章展示，**不参与新弹窗** |
| OP.GG 快照缓存（内存无 TTL + 磁盘 12h + stale 降级 + `opggRevision` 段位广播） | `command/opgg.rs`、`state.rs:92,117`、`cache.rs:11-21`、前端 `services/opgg.ts:37-42,99-107` | 沿用同一模式新建对位缓存 ✓ |
| 前端克制 pill（双向 2 条："敌方怕我方/我方被克"） | `services/opgg.ts:191-250` `findCounterHints`、`ChampionIntelCard.vue:212-258`、AI prompt `champSelect.ts:157-182` | **与弹窗并存**（pill 常驻零操作，弹窗给详情） |
| BP 决策引擎（排除法：`worst_matchup` + 兜底避雷） | `bp_decision/evaluate.rs:140-226`、`types.rs:65-99` | 负向"避雷"已存在；**正向"择优"是新逻辑** |
| 选人会话语义（敌方已锁逐个可见；敌方 intent 恒 0；我方 intent 可见；ban 列表） | `lcu/api/champion_select.rs:12-79,205-250`、`command/session.rs:316-340`、前端 `Gaming.vue:180-207,294-313`、类型 `types/domain/gaming.ts:21-58` | P2 输入 ✓ |
| 全量英雄池 | `command/config.rs:116-138` `get_champion_options`（先例 `Automation.vue:313`；**Gaming.vue 尚无调用，需新增**） | 候选池 ✓ |

**v1.1 已验证的硬约束**（决定设计边界）：
1. **新 API 可用且数据量大**（实测 2026-08-14）：
   - `GET https://lol-api-champion.op.gg/api/{region}/champions/ranked/{championId}/{POSITION}?tier=&version=` → 200，`data.counters` 为**该英雄该位置的全量对位列表**（global/emerald_plus 潘森 TOP 50 条；含 `champion_id/play/win`，胜率 = win/play）
   - `GET .../{championId}/{POSITION}/synergies?tier=` → 200，`data[]` 为**协同搭档列表**（50 条，含 `synergy_champion_id/synergy_position/win_rate/play`）
   - `GET .../versions` → `{"data":["16.16","16.15"]}`
   - POSITION 枚举（大写）：`TOP|JUNGLE|MID|ADC|SUPPORT`（422 错误消息实测确认；**注意 MID/ADC 非 LCU 的 MIDDLE/BOTTOM**）
   - tier 枚举（实测 ibsg/emerald_plus 合法、`ibsgg` 422）：`ibsg|gold_plus|platinum_plus|emerald_plus|diamond_plus|master|master_plus|grandmaster|challenger|all`
   - region 枚举（19 个，实测 global/kr）：`global|na|euw|eune|kr|jp|br|lan|las|oce|ru|tr|sea|tw|vn|th|sg|me1|me2`（与 OP.GG 首页 region 导航一致）
   - **ibsg = 铁/青铜/银/金合并段**：青铜用户问题直接解决（kr/ibsg 有数据，样本 5 场起步）
2. **敌方悬停意向（`championPickIntent`）恒 0**（`champion_select.rs:66-67`）→ P2 只能基于**已锁定**敌方英雄计算，文案明示。
3. **敌方 `assignedPosition` 恒为空**（`bpRuleDraft.ts:8-10` 记载的已删逻辑教训）→ P1 弹窗敌方英雄按**主分路**取位置；P2 候选只按**我方自己的分路**过滤（自己的 `assignedPosition` 有效，`types/domain/gaming.ts:21-40`）。
4. **HTML 页面爬取路线放弃**（实测）：zh-cn/en 无参 SSR 页含数据，但带 region/tier 参数后数据变 CSR（HTML 无数据）、RSC 请求 500；Akari 端点 JSON 直出，**无需解析 HTML、无需爬 865 页**。
5. **现有 BP 自动化执行链路不动**：本功能是"解释层/辅助展示"，与 `bp_decision` 状态机零耦合，不做采纳、不写 intent、不进 automation。
6. **协同数据（synergies）V1.0 不展示**：数据层（Rust 命令）一次做齐，前端 UI 启用放 V1.1（见 §10）。

---

## 2. 目标与非目标

### 目标
- **G1**（P1）：选人期（ranked）悬浮任意英雄头像，≤150ms 出弹窗：该英雄对位胜率全列表，**表头可排序（胜率升/降、场次）、弹窗可滚动**；每行英雄头像+名字+胜率+局数；底部来源标注（OP.GG region · tier · 数据时间）
- **G2**（P2）：敌方 SubteamCard 顶部常驻"最优应对"条，实时按敌方已锁定阵容给**我方同分路**可选英雄 Top5（分数 + 每条理由：对谁有利/被谁克制/未知）；敌方锁定变化 1s 内刷新
- **G3**：离线 / 无快照 / aram / 非选人态 → 明确降级或隐藏，无空白无报错；数据全确定性计算，**零编造**

### 非目标
- ✗ 不爬 HTML、不解析 SSR/CSR 页面（Akari 端点已解决）
- ✗ 不做自动化执行 / 写 pick intent / 改 `bp_decision` 状态机 / 与 BpDecisionBar 融合
- ✗ 不做 AI 文案生成（理由一律确定性文本）
- ✗ 不做 PUGG 战绩对位矩阵（自有数据是另一个数据源，本次范围锁定 OP.GG）
- ✗ 不做 aram / 对局中 / 非选人界面入口
- ✗ 不做协同搭档展示（synergies UI 排 V1.1；数据层本次交付）

---

## 3. 数据语义（决定算法正确性的关键）

### 3.1 counters（对位，本次主数据）
新 API 每个 `data.counters[]` 条目 = `{champion_id, play, win}`，语义 = **"该英雄（请求位置）面对 champion_id 的对位"**，胜率 = `win/play`。

- 这是**全量列表**（global/emerald_plus 样本下 50 条），不是 top-3 → 弹窗直接展示全量，无需 v1.0 的反查补集
- 列表长度随样本量变化（kr/ibsg 只有 2-16 条；global/emerald_plus 50 条）→ **样本量即数据质量信号**，UI 明示来源参数，不承诺"所有英雄都有对位"
- 缺失 = 无数据：评分记 0，绝不外推 50%/编造（沿用 v1.0 纪律）

### 3.2 synergies（协同，V1.1 UI）
`data[]` 条目 = `{synergy_champion_id, synergy_position, win_rate, play, score_rank, ...}`，语义 = **"该英雄（请求位置）与 synergy_champion_id（synergy_position）同队的胜率"**。V1.0 只在 Rust 命令层产出并单测，前端不渲染。

### 3.3 位置命名
- API 用 OP.GG 命名：`TOP|JUNGLE|MID|ADC|SUPPORT`
- LCU/前端用 `TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY`（`data.rs` `normalize_position` 已有 OP.GG→LCU 反向映射，见 `api.rs:321-327` 测试）
- 前端传 LCU 命名，Rust 命令内做 `LCU → OP.GG` 映射（MIDDLE→MID、BOTTOM→ADC、UTILITY→SUPPORT），非法值 Err

---

## 4. 后端设计

### 4.0 新模块 `src-tauri/src/opgg/intel.rs`（与 `api.rs` 同构，互不干扰）

```rust
pub const VALID_REGIONS: [&str; 19] = ["global","na","euw","eune","kr","jp","br","lan","las","oce","ru","tr","sea","tw","vn","th","sg","me1","me2"];
pub const VALID_TIERS: [&str; 10] = ["ibsg","gold_plus","platinum_plus","emerald_plus","diamond_plus","master","master_plus","grandmaster","challenger","all"];
pub const VALID_POSITIONS: [&str; 5] = ["TOP","JUNGLE","MID","ADC","SUPPORT"];
pub const DEFAULT_TIER: &str = "emerald_plus";  // 样本最大
pub const DEFAULT_REGION: &str = "global";

pub struct CounterItem { champion_id: i32, play: i64, win: i64, win_rate: f64 }   // win_rate = win/play，play<=0 跳过
pub struct SynergyItem { champion_id: i32, synergy_position: String, win_rate: f64, play: i64 }
pub struct ChampionIntel { counters: Vec<CounterItem>, synergies: Vec<SynergyItem>, fetched_at: i64, stale: bool, tier: String, region: String }
```

- `lcu_to_opgg_position(lcu: &str) -> Result<&str, String>`：MIDDLE→MID、BOTTOM→ADC、UTILITY→SUPPORT、其余原样；非法 Err
- `fetch_champion_intel(region, champion_id, position, tier) -> Result<ChampionIntel, String>`：GET counters 端点 + GET synergies 端点（串行，复用 `api.rs` 的 `Client::builder().user_agent(...).timeout(20s)` 模式）；任一失败 Err（调用方降级）
- 请求 URL 用 `urlencoding` 不需要（参数全部白名单枚举），直接 `format!` 拼接
- **限速**：不设全局节流（弹窗按需、单英雄 2 请求）；磁盘缓存 TTL 12h（复用 `cache.rs::TTL_SECS`）→ 同 patch 内基本不重拉

### 4.1 磁盘缓存（`opgg/intel.rs` 内联，复用 `paths::cache_file`）

- 键：`opgg_intel_{region}_{tier}_{champion_id}_{position}.json`（白名单枚举 → 文件名安全）
- 结构：`{ fetched_at, tier, region, counters, synergies }`，TTL 判定与 stale 语义同 `cache.rs:14-16`
- 命中链（与 `ensure_snapshot_impl` 同构）：内存 moka（`state.rs` 新增 `opgg_intel_cache: Cache<String, Arc<ChampionIntel>>`）→ 磁盘 fresh → HTTP → 磁盘 stale 降级（标 stale）→ Err

### 4.2 命令（`command/opgg.rs` 扩展）

```rust
#[tauri::command]
pub async fn get_champion_intel(
    region: Option<String>,       // 默认 "global"
    champion_id: i32,
    position: String,             // LCU 命名（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY）
    tier: Option<String>,         // 默认 emerald_plus；非法值回退默认（同 api.rs sanitize_tier 语义）
    state: State<'_, AppState>,
) -> Result<ChampionIntel, String>
```

- `position` 非法 → Err（参数错误，与"数据缺失"区分）；champion_id ≤ 0 → Err
- tier 白名单外回退默认（**不 Err**，与 `api::sanitize_tier` 一致；`ibsg` 等新枚举并入）
- region 白名单外回退默认
- 网络失败且无任何缓存 → Err("OP.GG 对位数据拉取失败…")，前端降级文案
- 只读命令，不写 config、不触发快照更新

### 4.3 注册与单测
- `main.rs:144` `generate_handler!` 注册 `get_champion_intel`
- `intel.rs` 内 `#[cfg(test)]`：
  - `lcu_to_opgg_position` 全映射 + 非法值（≥6 例）
  - `parse_champion_intel`（含 fixtures：新造 `intel_sample.json`，含 counters 全量 + synergies）：win_rate 计算、play=0 跳过、缺字段容错、坏 JSON Err
  - `cache_key` 文件名正确性（region/tier 混合）
  - 降级链（复用 `command/opgg.rs` 测试模式：内存 fresh 不拉取 / 磁盘 fresh 回填内存 / HTTP 失败走 stale / 全无 Err）≥5 例
- 真实网络冒烟测试 `#[ignore]`（同 `api.rs:354-363` 先例）

---

## 5. 前端设计

### 5.1 `services/counterIntel.ts`（新增，薄封装）
- 类型镜像：`CounterItem` / `SynergyItem` / `ChampionIntel`
- `getChampionIntel(region, championId, position, tier)`：`invoke('get_champion_intel', { region, championId, position, tier })`，失败返回 `null`（既有 opgg.ts 降级约定）
- 纯函数 `positionToOpgg(lcu)`：TOP/JUNGLE 原样、MIDDLE→MID、BOTTOM→ADC、UTILITY→SUPPORT；`null` 未知（供敌方主分路推断时容忍）
- 纯函数 `lcuPositionOf(meta)`：从快照 meta 取主分路（LCU 命名）——敌方位置推断用
- 纯函数 `formatCounterLine`（胜率一位小数 + 局数文案）供组件复用
- **排序**：`sortCounters(items, key: 'winRate'|'play', dir: 'asc'|'desc')` 纯函数（不修改原数组），表头点击切换

### 5.2 `composables/useCounterIntel.ts`（新增）
- `intelFor(championId, position)`：150ms hover 防抖（`setTimeout` 进入即拉，交错的旧定时器清除）+ 模块级 `Map<championId, ChampionIntel>` 缓存 + `opggRevision` 变化清缓存（`opgg.ts:37-42`）；`position` 为空（敌方位置未知）→ 默认主分路由组件决定
- `bestPicks(enemyIds, candidateIds, myPosition)`：同样防抖 + 按 (enemyIds 序列化) 缓存最近结果；`candidateIds` 变化也触发重算
- 暴露 `isLoading` / `error` 状态位，组件统一渲染降级
- 复用 `useAssetUrl()`/`getChampionUrl` 拿头像（仓库既有，`composables/useAssetUrl.ts`）

### 5.3 集成点（改动最小化）
- **P1**：新建 `components/gaming/CounterHover.vue`（n-popover `trigger="hover"`，内容 = 可排序对位表 + 来源标注）；包裹点**已实测定位**：`ChampionIntelCard.vue:21`（`<img class="intel-avatar" :src="getChampionUrl(championId)">`）与 `PlayerCard.vue:52-58`（`.avatar-wrapper > n-image`，含 `level-badge`，wrapper 需保持原有 AV 结构）→ 两处头像外层包 `<CounterHover :champion-id :position>`，仅透传不做样式变更（scoped 样式不动）
  - 敌方英雄位置：取快照 meta 主分路（`useCounterIntel` 内部用 `lcuPositionOf`）；位置为空 → 弹窗仍展示（对位数据不分位置过滤，按主分路请求）
  - 风险预案：若两卡头像包裹影响内部布局（如 PlayerCard 的 `level-badge` 绝对定位），退化为 **仅敌方卡（ChampionIntelCard）**包裹 + 我方卡后续——**实现顺序先敌方后我方**，单测对两者解耦
- **P2**：新建 `components/gaming/BestPicksPanel.vue`，放在 Gaming.vue 敌方 SubteamCard 正上方一行（ranked && phase==='ChampSelect' 才渲染）：
  - 常驻条：`对敌方 [敌方已锁头像×n] 最优应对：` + Top3 头像
  - 点击展开 n-popover/展开层：完整 Top5 卡（头像/名字/分数 bar/每行理由"克制 X（胜率 57%，120 局）"），unknown 一次带过文案
  - 数据：`enemyIds = subteams[1].players.filter(championId>0)`（`p.championId>0` 即已锁定；敌方 intent 恒 0 且有无需区分 pickState），`candidateIds = buildCandidateIds(allIds, ...)`（`sessionData` 的 bans/锁定/intent），`myPosition = 自己 player.assignedPosition`（ranked 有效，`Gaming.vue:401` 已有取用先例）
  - Gaming.vue 新增：顶层 `invoke('get_champion_options')` 一次得 `allIds: number[]`（懒加载，与 `loadChampionNames` 各自独立无冲突），连同 `sessionData` 传入 BestPicksPanel
  - 刷新时机：`watch(sessionData)` 驱动（LCU `/lol-champ-select/v1/session` 事件已使 session 推新，`lcu/listener.rs:158-168`），天然 ≤1s；`opggRevision` 变化也让缓存失效重算
- **隐藏规则**：`phase !== 'ChampSelect'` 或 queueId 非排位（`queueIdToOpggMode('ranked')`，`opgg.ts:90-92`）→ 两个入口都不渲染；网络失败 → 渲染降级文案不崩溃

### 5.4 评分算法（P2，候选 C 对敌方已锁 E 集）
```
score(C) = Σ_E  contribution(C, E)
contribution(C, E) =
    E ∈ counters[C]                → wr(CvsE) - 0.5        // C 对 E 的对位胜率，越高越加
    C ∈ counters[E]（反查 E 的列表）→ (1 - wr(EvsC)) - 0.5  // 克制：反转胜率越高越加
    否则                            → 0                    // 未知，不编造
```
- **数据来源**：只需拉取敌方已锁英雄 E 的 intel（`counters[E]` 全量 50 条已含 E 对所有对手的数据）→ **请求数 = |已锁敌方| ≤ 5**，候选池再大也不增加请求
- 候选 C 自己的 `counters[C]` 若已在弹窗缓存中（Map 命中）则合并使用；否则以反查为准
- 排序：`score` 降序 → 同分按 `play` 总和降序 → 仍同按 `champion_id` 升序（稳定）
- **分路一致性**（§1 约束 3）：`my_position` 有值时，先筛候选为 `allIds` 中主分路 == my_position 的英雄（`get_champion_options` 无分路信息 → 用 `get_champion_meta` 主分路或直接按全量评分、UI 标注分路）——**简化决策：V1.0 不做分路过滤**（敌方分路不可知时按分路过滤候选反而误导；全量评分 + 每条理由给对位数据，用户自判），跨位标注 `position` 显示在卡片
- **边界**：`enemy_ids` 空 → 返回空（前端显示"敌方尚未锁定英雄"）；`candidate_ids` 空 → 空；全 unknown → score=0 稳定排序输出（**全部为 0 时前端显示"敌方当前阵容下无正面对位优势英雄"**）
- `summary`：每个有数据的 E 一条 evidence（关系+胜率+局数），unknown 一次带过（v1.0 §4.2 语义沿用）

---

## 6. UI 细则

**CounterHover 弹窗**（最大宽 360px，`n-popover`，内部 `n-scrollbar` max-height 400px）：
```
┌─ 潘森 · TOP ───────────── 翡翠+ · 16.16 ──×┐
│  胜率 ▼    │ 场次   │  英雄                │
│  54.2%     │ 3,120  │ [头像] 提莫          │
│  52.8%     │ 2,870  │ [头像] 兰博          │
│  51.9%     │ 2,401  │ [头像] 盖伦          │
│  ...（滚动区，按当前排序）                  │
├────────────────────────────────────────────┤
│ OP.GG global · emerald+ · 16.16 · 更新于 1 小时前 │
└────────────────────────────────────────────┘
```
- **排序交互**：表头「胜率」「场次」可点击，当前列显示箭头（▲/▼）；点击未排序列默认按该列降序；再点同列切换方向；胜率默认降序
- **胜率着色**：>52% 绿 / 48-52% 中性 / <48% 红（`win_rate` 基于 `win/play`，play≤0 行不出现）
- **来源标注**固定底栏：region · tier · patch（patch 从 `get_opgg_status` 或 intel 响应自带 version 取；**标注必须存在**，防误导）
- 数据可能过期（stale 时）：底栏追加「数据可能过期」
- loading：首次 150ms 内骨架；失败：`OP.GG 数据未就绪（需联网拉取或等待重试）`
- 空列表（该位置样本太少）：`该分路对位样本不足（OP.GG 暂无数据）`，不给空表格

**BestPicksPanel 推荐卡**：
```
[卡头像] 薇恩   (打野)  ████░░ 分数 +0.62
  克制 盲僧（胜率 58% · 210 局）
  被克 赵信（胜率 41% · 90 局）
  其余敌方对位无 OP.GG 数据
```
- 分数唯一排序依据；分数 ≤0 全部时顶部提示"敌方当前阵容下无正面对位优势英雄（以下为相对最不劣）"
- 文案纪律：百分比 = `win_rate*100` 保留 1 位小数 + `play` 局数；**不出现 AI 生成或推断句式**

---

## 7. 测试矩阵

| 层 | 用例 | 位置 |
|---|---|---|
| Rust | `lcu_to_opgg_position` 全映射+非法、`parse_champion_intel`（fixture 全量+synergies）、`cache_key`、降级链 5 例、真实网络 `#[ignore]` | `opgg/intel.rs` `#[cfg(test)]`，CI 兜底 |
| 前端纯函数 | `positionToOpgg`（6 例）、`sortCounters`（胜率/场次 × 升降，4 例，不改原数组）、`formatCounterLine`（2 例） | `services/counterIntel.spec.ts` |
| composable | 防抖（150ms 内重复触发只 1 次 invoke）、缓存命中 0 invoke、revision 失效重取、失败降级 | `useCounterIntel.spec.ts` |
| 组件 | CounterHover：列表渲染/排序交互（点击表头变化）/滚动区存在/空态文案/loading/来源标注/stale 标注/失败文案（mock invoke） | `components/gaming/__tests__/CounterHover.spec.ts` |
| 组件 | BestPicksPanel：Top5 排序渲染/理由行/unknown 一次带过/全 ≤0 提示/敌方未锁定空态/离线降级/非 ranked 不渲染 | `components/gaming/__tests__/BestPicksPanel.spec.ts` |
| 集成 | Gaming「敌方锁定第 n 人 → watch 重算触发 invoke；非选人阶段无渲染入口」 | `views/__tests__/Gaming.counterIntel.spec.ts` |

- 全量门禁：vitest 全绿 + prettier + vue-tsc + eslint 0 errors；Rust 由 push 后 CI（Quality Checks win+mac）验证

---

## 8. 风险与回退

| 风险 | 后果 | 缓解 |
|---|---|---|
| 新端点被封 / 限流（Akari 在持续用，概率低） | 弹窗/推荐无数据 | 磁盘缓存 TTL 12h + stale 降级；按需请求（每英雄 2 请求）远低于批量；真被封可回退 v1.0 快照反查方案（spec 文档保留 §3-4 供恢复） |
| 低样本位置/段位（kr/ibsg 2-16 条） | 列表短、覆盖不全 | 默认 global+emerald_plus（50 条）；UI 明示 region/tier；空列表给专门文案 |
| 敌方 intent 不可见 | 推荐滞后于"敌方正在考虑的英雄" | 文案"按敌方已锁定英雄计算"；行为与现状一致 |
| 弹窗/面板在慢机器上抖动 | UI 卡顿 | 150ms 防抖 + Map 缓存；单英雄 2 次 IPC |
| 网络不可用 | 两处空白 | Err → 降级文案；stale 缓存沿用并标注"数据可能过期" |
| 头像包裹改动破坏 PlayerCard/ChampionIntelCard 样式 | 视觉回归 | 先敌方后我方；wrapper 纯透传不写样式；组件单测守住 props 流 |
| aram / 非选人误渲染 | 无对位数据空弹窗 | 双入口 ranked+ChampSelect 才渲染（§5.3 隐藏规则） |
| 与 BpDecisionBar 并存分歧 | 自动化决策与推荐不一致 | 本功能只读不改状态机（非目标）；UI 无"采纳"入口 |
| 评分公式被质疑 | 用户信任下降 | 理由行显式给出每条胜率+局数，可复核；未知不编造纪律 |

---

## 9. 验收标准
1. 选人期悬浮敌方或我方任意已见英雄头像 ≤150ms 出弹窗；对位列表按胜率降序，表头点击可切换胜率/场次排序（升/降）；滚动区可用；来源标注存在
2. 敌方锁定变化（任一英雄上锁）→ 最优应对条 ≤1s 刷新且只发新请求（缓存命中不重发）
3. 全部候选分数 ≤0 时明确提示"无正面对位优势"；离线下两处显示降级文案，无空白无报错
4. 段位设置切换后，两处数据跟随 `opggRevision` 失效重取；青铜段位（tier=ibsg）有数据
5. 全量单测/门禁绿；Rust 单测经 CI 全绿后才合并
6. 手工验证清单（本地 LCU 真机，exe 打包后执行）：悬浮弹窗视觉与排序、阵容推荐逐人核对 API 数据一致（无编造）

## 10. 任务卡与提交拆分

| # | 任务 | 涉及 | 验收 |
|---|---|---|---|
| T1 | Rust：`opgg/intel.rs`（parse/fetch/缓存/降级链）+ `state.rs` 新缓存 + `get_champion_intel` 命令 + main.rs 注册 + 单测（fixture `intel_sample.json`） | `opgg/intel.rs`、`state.rs`、`command/opgg.rs`、`main.rs`、`opgg/fixtures/` | CI cargo test 全绿 |
| T2 | 前端 service/composable（防抖/缓存/revision/组装/排序纯函数）+ 纯函数单测 | `services/counterIntel.ts`、`composables/useCounterIntel.ts`、`+spec` | 单测绿 |
| T3 | CounterHover.vue + 敌方卡（ChampionIntelCard）头像包裹 + 单测 | `components/gaming/CounterHover.vue`、`ChampionIntelCard.vue`、`+spec` | 单测绿 |
| T4 | 我方卡包裹（PlayerCard）+ BestPicksPanel.vue + Gaming.vue 集成（隐藏规则/watch/get_champion_options）+ 单测 | `PlayerCard.vue`、`BestPicksPanel.vue`、`Gaming.vue`、`+spec` | 单测绿 |
| T5 | 全量门禁 + CI + spec 文档收尾（任务卡 ✅ + 变更记录 v1.1）+ 交付记录 `.opencode-session/champselect-counter.md` | — | CI 全绿 |
| T6（V1.1） | 协同搭档 UI：CounterHover 增「最佳搭档」节（synergies 数据已就绪）+ 单测 | `CounterHover.vue`、`+spec` | 单测绿 |

每任务独立 Conventional Commit（`feat(gaming): …`），T1/T5 间禁止合并；T1 依赖 CI（本机无 cargo）；T2–T4 每步过本地四件套（vitest 全量/prettier/vue-tsc/eslint 0 errors）。

## 11. 变更记录
| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-08-14 | 初版：基于 codegraph 现状盘点（OP.GG counters 管道已全链路可用，零新增网络请求；受 top-3 数据天残约束设计优势对位反推与"未知不编造"纪律） |
| v1.1 | 2026-08-14 | **数据层推翻重写**：破案 LeagueAkari 内部 API（`lol-api-champion.op.gg/api/{region}/champions/ranked/{id}/{POSITION}?tier=`），实测返回全量对位列表（50 条）+ synergies 50 条 + versions；段位含 `ibsg`（铁/青铜/银/金）直接解决青铜用户问题；HTML 爬取路线废弃（参数后数据 CSR、RSC 500）。后端改为新模块 `opgg/intel.rs`（按需单英雄 2 请求 + 磁盘缓存 12h + stale 降级），P2 评分只用敌方已锁 ≤5 英雄的 counters 反查。UI 增排序交互（胜率/场次 × 升降）+ 滚动区 + 来源标注。P2 不做分路过滤（敌方分路不可知，全量评分+跨位标注）。协同 synergies 数据层本次交付、UI 排 V1.1（T6）。 |
