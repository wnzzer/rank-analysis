# SGP 段位直查 + 国际服支持 — 设计

> 版本 v1.0 · 2026-08-15 · 学习 LeagueAkari SGP 架构后设计（codegraph 调研结论见 §1）
> 关联：`bots/superpowers/` 门禁（`npm run check` + 全量 vitest；Rust 由 CI win 兜底）

## 目录
1. 背景：Akari SGP 架构学习结论与本项目差距
2. 目标与非目标
3. 数据语义（leagues-ledge rankedStats 的正确读法）
4. 后端设计（主机表 / token / 端点 / 命令契约 / 错误 / 单测）
5. 前端设计（service / composable / 组件集成 / 降级）
6. 测试矩阵
7. 风险与回退
8. 验收标准
9. 任务卡与提交拆分
10. 变更记录

---

## 1. 背景：Akari SGP 架构学习结论与本项目差距

用 codegraph 完整调研 LeagueAkari 的 SGP（Service Gateway Proxy）链路（仓库 `D:\lolzhushou\LeagueAkari`），关键结论：

### 1.1 Akari 的 SGP 架构（已学习）

| 层面 | Akari 实现 | 位置 |
|---|---|---|
| 双 token | entitlements token（`/entitlements/v1/token` → accessToken）供 **match-history**；league-session token（`/lol-league-session/v1/league-session-token` → 裸字符串）供 **gsm / leagues-ledge / summoner-ledge** | `src/main/shards/league-client/lc-state/entitlements.ts`、`league-session.ts` |
| 服务器配置 | builtin 10 腾讯区（`TENCENT_*` → `*-sgp.lol.qq.com:21019`）+ 19 国际区（matchHistory → `*-red.pp.sgp.pvp.net`、common → `*-red.lol.sgp.pvp.net`），可远程覆盖 | `src/main/shards/akari-api/builtin.ts` |
| 路由 | 拦截器按 `x-akari-token-type` 选 baseURL：entitlements→matchHistory 主机、league-session→common 主机；`x-akari-sgp-server-id` 头显式指定目标服务器（跨区核心）；URL 占位符 `@akari:sgpServerSubId@` 替换为 regionPathParam（国际 PBE1/EUW1/JP1）或腾讯 rsoPlatformId | `src/main/shards/sgp/http-client-controller.ts` |
| 别名 | `getSgpServerId(region, rsoPlatformId)`：NA→NA1、BR→BR1、TR→TR1、LAN→LA1、LAS→LA2、OCE→OC1、EUW1→EUW、JP1→JP；腾讯 = `TENCENT_<rsoPlatformId>` | `src/shared/utils/sgp.ts` |
| 端点 | leagues-ledge `GET /leagues-ledge/v2/rankedStats/puuid/{puuid}`（league-session token，**注释「此 API 无法跨区」**，且 **Akari 定义了客户端但无任何消费者**） | `src/shared/http-api-axios-helper/sgp/leagues-ledge.ts` |
| 工程 | axios-retry 2 次、HTTP 代理开关、连接健康计数 | `sgp/http-client-controller.ts` |

### 1.2 本项目现状与差距

| 能力 | Akari | 本项目 | 本设计 |
|---|---|---|---|
| 跨区战绩 SUMMARY/DETAILS/深翻页/全量收集 | ✅ | ✅ 已交付 | 不动 |
| entitlements token 跨腾讯区通用 | ✅ | ✅ 已交付（2026-07 真机验证） | 不动 |
| league-session token | ✅ | ❌ | **新增** |
| leagues-ledge rankedStats（段位直查） | ⚠️ 定义了没消费者 | ❌ | **新增并把 UI 用起来（超越点）** |
| 国际服主机（19 区 + regionPathParam） | ✅ | ❌ 仅 8 腾讯区 | **补全** |
| sgp_get 重试 | ✅ 2 次 | ❌ 零重试 | **新增** |

**超越点**：Akari 有段位直查端点但从未接进 UI；本项目把它接进「跨区战绩详情页 10 人段位」与「跨区查询页玩家段位卡」——跨区场景目前段位全部为空（`usePlayerRecordData.ts:60-68` 跨区分支 rank 置默认、`useMatchPlayerRanks` 走 LCU 只能查当前区）。

---

## 2. 目标与非目标

### 目标
- **G1**：跨区战绩详情页（region 非空时）10 人段位走 SGP rankedStats 直查，展示逻辑复用现有 `tiersByPuuid`（图标/短文案/tooltip），失败降级为 null（现状行为）
- **G2**：跨区查询页（`region` 路由参数非空）玩家条/左栏显示被查玩家真实段位（SGP rankedStats 单查 + 映射 Rank），替换现在的「默认空段位」
- **G3**：大区下拉覆盖国际服 19 区（含 PBE，regionPathParam=PBE1/EUW1/JP1），国服 token 打国际区失败时错误提示不崩溃
- **G4**：`sgp_get` 网络错误/5xx 自动重试 2 次（对齐 Akari axios-retry）

### 非目标
- ✗ 不做 gsm / summoner-ledge / challenges-client（无明确产品入口，留待后续）
- ✗ 不做选人页（Gaming.vue）段位改造——选人会话 10 人同区，LCU session 段位是权威实时数据，SGP 无增量
- ✗ 不做「对局当时段位」——SGP 与 LCU 一样只能给当前段位，tooltip 文案沿用现状说明
- ✗ 不做远端配置更新机制（国际区主机为静态表，Akari 也是 builtin 兜底）
- ✗ 不做 HTTP 代理开关（现有 `sgp_client` 无代理配置，保持）

---

## 3. 数据语义（leagues-ledge rankedStats 的正确读法）

端点：`GET /leagues-ledge/v2/rankedStats/puuid/{puuid}`（league-session token，common 主机）

响应结构（Akari `src/shared/types/sgp/ranked.ts`，LCU `lol-ranked` 同构）：

```jsonc
{
  "queues": [
    {
      "queueType": "RANKED_SOLO_5x5",
      "tier": "GOLD",            // 未定级缺失
      "rank": "II",              // 大师以上缺失
      "leaguePoints": 45,
      "wins": 12, "losses": 8,
      "provisionalGamesRemaining": 0,  // >0 = 定级赛
      "highestTier": "PLATINUM", "highestRank": "III"
    },
    { "queueType": "RANKED_FLEX_SR", ... }
  ],
  "highestPreviousSeasonEndTier": "PLATINUM",
  ...
}
```

**映射到本项目 `Rank`（`src-tauri/src/lcu/api/rank.rs`）**：

| Rank.QueueInfo 字段 | SGP 来源 | 备注 |
|---|---|---|
| queue_type / queue_type_cn | queueType + `enrich_cn_info()` | 复用既有中文映射 |
| tier / tier_cn | tier + `enrich_cn_info()` | 缺失 → 空串（前端 `hasRealTier` 判空显示「无段位」） |
| division | rank | 缺失 → "NA"（对齐 LCU 未定级惯例） |
| highest_tier / highest_division | highestTier / highestRank | 缺失 → 空串 |
| is_provisional | provisionalGamesRemaining > 0 | |
| league_points / wins / losses | 同名 | 缺失 → 0 |

**错误语义**：
- 404（玩家未定级或大区无记录）→ 返回空 Rank（映射后各队列 tier 为空串，前端自然显示「无段位」）
- 401（token 失效/环境不匹配，如国服 token 打国际区）→ Err，调用方降级为 null（现状行为）
- 其余非 2xx / 网络错误 → Err

**缓存**：30min TTL、max 500（对齐 `command/rank.rs` 的 `RANK_CACHE` 语义：段位一次会话内几乎不变）；key 带 platform_id 防串区（沿用 `SGP_SUMMARY_CACHE` 的教训）。

---

## 4. 后端设计

### 4.1 `constant/game.rs` — 主机表重构与补全

现有 `SGP_PLATFORM_TO_HOST`（matchHistory 主机）保留，新增：

```rust
/// platformId → SGP common 主机（段位等 league-session 系端点用）。
/// 腾讯区与 matchHistory 同主机（21019）；国际区 = `{region}-red.lol.sgp.pvp.net`。
pub static SGP_PLATFORM_TO_COMMON_HOST: phf::Map<&'static str, &'static str> = phf_map! {
    // 腾讯 8 区（与 matchHistory 相同主机）
    "HN1" => "hn1-k8s-sgp.lol.qq.com:21019",
    ... (HN10/NJ100/GZ100/CQ100/TJ100/TJ101/BGP2)
    // 国际区（common 主机）
    "TW2" => "tw2-red.lol.sgp.pvp.net",
    "SG2" => "sg2-red.lol.sgp.pvp.net",
    "PH2" => "ph2-red.lol.sgp.pvp.net",
    "VN2" => "vn2-red.lol.sgp.pvp.net",
    "PBE" => "pbe-red.lol.sgp.pvp.net",
    "EUW" => "euw-red.lol.sgp.pvp.net",
    "JP"  => "jp-red.lol.sgp.pvp.net",
    "RU"  => "ru-red.lol.sgp.pvp.net",
    "BR1" => "br-red.lol.sgp.pvp.net",
    "OC1" => "oce-red.lol.sgp.pvp.net",
    "TR1" => "tr-red.lol.sgp.pvp.net",
    "LA1" => "lan-red.lol.sgp.pvp.net",
    "LA2" => "las-red.lol.sgp.pvp.net",
    "NA1" => "na-red.lol.sgp.pvp.net",
    "TH2" => "th2-red.lol.sgp.pvp.net",
    "KR"  => "kr-red.lol.sgp.pvp.net",
};

/// regionPathParam：国际区个别区名的 SGP 子区参数与 platformId 不同
pub static SGP_REGION_PATH_PARAM: phf::Map<&'static str, &'static str> = phf_map! {
    "PBE" => "PBE1", "EUW" => "EUW1", "JP" => "JP1",
};

pub fn get_sgp_common_host(platform_id: &str) -> Option<&'static str> { ... }
```

- `SGP_PLATFORM_TO_HOST` 补国际区 **matchHistory 主机**（亚太 `apse1-red.pp.sgp.pvp.net`、美西 `usw2-red.pp.sgp.pvp.net`、欧中 `euc1-red.pp.sgp.pvp.net`、日韩 `apne1-red.pp.sgp.pvp.net`），国际区战绩查询随之下拉可用
- `SGP_SERVER_ID_TO_NAME` 补国际区中文名（台湾/新加坡/菲律宾/越南/PBE/欧服/日本/俄罗斯/巴西/大洋洲/土耳其/拉美北/拉美南/北美/泰国/韩国）
- **不做** `TENCENT_PBE` / `TENCENT_PREPBE`：腾讯体验服 platformId 与国际化 PBE 同为 `PBE` 无法用单一键区分，且体验服常年关闭（spec 记录为已知边界）

### 4.2 `lcu/api/sgp.rs` — token 与端点

```rust
/// league-session token（裸字符串响应）。供 leagues-ledge 等会话系端点。
pub async fn get_league_session_token() -> Result<String, String> {
    let t: String = lcu_get("lol-league-session/v1/league-session-token").await?;
    if t.trim().is_empty() { return Err(...) }
    Ok(t)
}

/// SGP rankedStats 响应（serde 全字段 default 容错，对齐 LCU lol-ranked 结构）
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpRankedStats {
    pub queues: Vec<SgpRankedQueue>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SgpRankedQueue {
    pub queue_type: Option<String>,
    pub tier: Option<String>,
    pub rank: Option<String>,
    pub league_points: Option<i32>,
    pub wins: Option<i32>,
    pub losses: Option<i32>,
    pub provisional_games_remaining: Option<i32>,
    pub highest_tier: Option<String>,
    pub highest_rank: Option<String>,
}

static SGP_RANKED_CACHE: LazyLock<Cache<String, SgpRankedStats>> =
    Cache::builder().max_capacity(500).time_to_live(Duration::from_secs(30 * 60)).build();
// key = `{platform_id}:{puuid}`

/// 按大区拉取玩家段位。common 主机 + league-session token。
/// 404（未定级/无记录）→ 空 SgpRankedStats（不报错）。
pub async fn fetch_ranked_stats(platform_id: &str, puuid: &str) -> Result<SgpRankedStats, String> { ... }

/// SGP rankedStats → 本项目 Rank（对齐 §3 映射表），随后 enrich_cn_info。
pub fn map_sgp_ranked_stats_to_rank(stats: &SgpRankedStats) -> Rank { ... }
```

### 4.3 `command/sgp.rs` — 命令契约

```rust
/// 跨区按「名字#TAG」查玩家段位（RC 解析 puuid → SGP rankedStats → Rank）。
#[tauri::command]
pub async fn get_sgp_rank_by_name(region: String, name: String) -> Result<Rank, String> { ... }

/// 批量按 puuid 查段位（详情页 10 人一次 IPC；语义对齐 get_ranks_by_puuids：
/// 单人失败返回 None 不拖垮整批）。
#[tauri::command]
pub async fn get_sgp_ranks_by_puuids(
    region: String, puuids: Vec<String>,
) -> HashMap<String, Option<Rank>> { ... }
```

`get_sgp_regions`：`REGION_ORDER` 扩展为 腾讯 8 + 国际 16（TW2/SG2/PH2/VN2/PBE/EUW/JP/RU/BR1/OC1/TR1/LA1/LA2/NA1/TH2/KR），顺序：腾讯官方顺序在前、国际区按 Akari builtin 顺序在后。

### 4.4 `lcu/util/http.rs` — sgp_get 重试

```rust
/// 网络错误 / 5xx 重试 2 次（共 3 次尝试），指数退避 300ms/600ms；4xx 不重试。
/// 对齐 Akari axios-retry 语义（重试只覆盖「可能瞬时的失败」，业务错误原样返回）。
pub async fn sgp_get<T: DeserializeOwned>(host: &str, uri: &str, bearer: &str) -> Result<T, String>
```

实现：`for attempt in 0..=2 { ... match send().await { Err(e) if attempt < 2 => sleep(300ms * 2^attempt), Err(e) => return Err, Ok(resp) => { status 检查：5xx && attempt < 2 → 重试；其余返回 } } }`。

### 4.5 注册与单测

- `main.rs`：注册 `get_sgp_rank_by_name`、`get_sgp_ranks_by_puuids`
- 单测（`command/sgp.rs` + `lcu/api/sgp.rs` tests）：
  - `map_sgp_ranked_stats_to_rank`：完整队列（solo 金 II / flex 钻石 IV）、缺 tier（未定级）、缺 rank（大师）、provisional 判定、enrich_cn_info 中文
  - `get_sgp_regions`：国际区出现 + 顺序 + 中文名
  - `get_sgp_common_host`：腾讯/国际区映射、未知大区 None
  - `get_sgp_regions` 现有断言更新（BGP2 仍为最后一个腾讯区，国际区在其后）
  - 重试纯函数：`should_retry_sgp(status, attempt)` 抽纯函数便于单测

---

## 5. 前端设计

### 5.1 `services/sgp.ts` — 新增段位 API

```ts
/**
 * 跨区批量查段位：一次 IPC 拿整批（Rust 侧并发 + 30min 缓存）。
 * 单人失败返回 null 不拖垮整批；整批失败抛错由调用方降级。
 * 段位不跨场景复用 LCU 的 rankCache——后端已有 30min 缓存，这里不加前端缓存。
 */
export async function getSgpRanksByPuuids(
  region: string,
  puuids: string[]
): Promise<Record<string, Rank | null>>

/** 跨区单查（玩家条场景） */
export async function getSgpRankByPuuid(region: string, puuid: string): Promise<Rank | null>
```

### 5.2 `composables/useMatchPlayerRanks.ts` — region 参数

```ts
export function useMatchPlayerRanks(
  players: MaybeRefOrGetter<RankLookupPlayer[]>,
  queueId: MaybeRefOrGetter<number | undefined>,
  region?: MaybeRefOrGetter<string | undefined>
)
```

`region` 非空 → `getSgpRanksByPuuids(region, targets)`；空 → 现有 LCU 路径。失败降级语义不变（null）。

### 5.3 组件集成

- `MatchHistory.vue:100`：`<MatchDetailInline :game="game" :region="region" ...>`（region 已有 computed）
- `MatchDetailInline.vue`：`defineProps<{ game: Game | null; region?: string }>()`；`useMatchPlayerRanks(detailPlayers, queueId, () => props.region)`
- `usePlayerRecordData.ts` 跨区分支（`loadSummonerData` 内 `region.value` 分支）：
  1. 先 `resolve` 出 puuid —— 现有跨区查询没有 puuid 暴露。**新增后端命令 `get_sgp_puuid_by_name(region, name)`？** 不——RC 解析与 region 无关，直接复用 `sgp::resolve_puuid_by_riot_id`。但 `get_sgp_match_history_by_name` 内部已解析 puuid 而不返回。最小改动：`usePlayerRecordData` 跨区分支调用新命令 `get_sgp_rank_by_name(region, name)`（命令内解析 puuid → rankedStats → Rank），一步到位。✓
  2. `rank.value = sgpRank ?? defaultRank()`（失败保留默认空段位，现状降级）
  3. `solo5v5/flex/recentData/tags` 维持现状（SGP 无"近期胜率/标签"概念，注释已明示不支持跨区）
- **不接** Gaming.vue（见 §2 非目标）

---

## 6. 测试矩阵

| 层 | 用例 | 验证 |
|---|---|---|
| Rust 单测 | map_sgp_ranked_stats_to_rank 全字段/缺字段/未定级/大师无分段 | 本地无 cargo → CI |
| Rust 单测 | get_sgp_regions 国际区/顺序/中文名 | CI |
| Rust 单测 | get_sgp_common_host / get_sgp_host 映射 | CI |
| Rust 单测 | should_retry_sgp 纯函数（4xx 不重试 / 5xx 重试 / 网络错误重试 / 上限） | CI |
| 前端 | useMatchPlayerRanks region 参数 → invoke get_sgp_ranks_by_puuids；region 空 → 原 LCU 路径 | vitest |
| 前端 | services/sgp getSgpRanksByPuuids invoke 契约 + 失败降级 | vitest |
| 前端 | usePlayerRecordData 跨区分支 → get_sgp_rank_by_name 填 rank | vitest |
| 前端 | MatchDetailInline region prop 透传（现有 MatchHistory.data.spec 保持绿） | vitest |
| 回归 | 全量 vitest + prettier/eslint/vue-tsc（`npm run check`） | 本地 |
| 集成 | CI quality-checks（Rust fmt/clippy/test + 前端） | push fork main |

---

## 7. 风险与回退

- **国际区可用性**：国服客户端 token（entitlements/league-session）打 Riot 国际区 SGP 主机大概率 401（环境不匹配）。回退：错误文案明示（现有 `SGP 非 2xx（401）` 错误链已覆盖），UI 显示空段位/空战绩不崩溃。国际区对海外/国际服客户端用户可用。
- **rankedStats 跨区**：Akari 注释「此 API 无法跨区」指国际区语义；腾讯区 token 跨区已验证（match-history），rankedStats 走腾讯区 common 主机由本设计直接支持，若个别区 404/401 按降级处理。
- **league-session token 获取失败**：LCU 未就绪时 `lcu_get` 报错 → Err → 前端 null（现状降级）。
- **腾讯体验服**：PBE platformId 键冲突，不收录（§4.1 已记录）。
- **回退**：全量代码在 `command/sgp.rs` + `lcu/api/sgp.rs` 增量，不动现有战绩链路；前端均为新增可选参数，region 为空时行为与现状逐字节一致。

---

## 8. 验收标准

- [ ] 跨区查询某玩家：玩家条/左栏显示真实段位（图标+文案），不再恒为「无」
- [ ] 跨区战绩详情页：10 人段位徽章有数据（SGP 可查时），同区详情行为与现状完全一致
- [ ] 大区下拉含国际服 16 区（中文名正确，顺序稳定）
- [ ] 未定级/失败场景：显示「无段位」或不渲染，无报错
- [ ] `npm run check` + 全量 vitest 绿；CI（quality-checks）绿
- [ ] 打包 EXE 交付 + SHA256

---

## 9. 任务卡与提交拆分

| 卡 | 内容 | 提交建议 |
|---|---|---|
| S1 | `constant/game.rs` 主机表补全（common 主机/国际区 matchHistory/regionPathParam/中文名）+ 单测 | `feat(sgp): 补全国际服主机映射与 common 主机表` |
| S2 | `lcu/util/http.rs` sgp_get 重试（抽 `should_retry_sgp` 纯函数 + 单测） | `feat(sgp): sgp_get 网络错误/5xx 自动重试` |
| S3 | `lcu/api/sgp.rs` league-session token + rankedStats 端点 + 映射 + 缓存 + 单测 | `feat(sgp): league-session token 与 rankedStats 段位直查` |
| S4 | `command/sgp.rs` 命令（单查/批量/regions 扩展）+ main.rs 注册 + 单测 | `feat(sgp): 跨区段位查询命令` |
| F1 | `services/sgp.ts` 段位 API + `useMatchPlayerRanks` region 参数 + 单测 | `feat(sgp): 跨区段位查询服务与详情页接入` |
| F2 | MatchDetailInline/MatchHistory region 透传 + `usePlayerRecordData` 跨区段位 + 单测 | `feat(sgp): 跨区查询页与详情页段位展示` |
| F3 | 回归 + 交付 | — |

（实际按一次 commit 提交亦可，拆分以 commit message 体现。）

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-08-15 | 初稿：基于 codegraph 对 LeagueAkari SGP 架构的完整调研（§1），确定「段位直查 + 国际服 + 重试」超越范围 |
