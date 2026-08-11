# Rank Analysis 优化开发计划(对标 LeagueAkari)

> **本文档是后续一切开发的唯一权威参考。** 修改任何功能前先读本文档对应章节;
> 计划变更时同步更新本文档并 bump `计划版本`。
>
> - 计划版本: v1.2(2026-08-11)
> - 目标仓库: rank-analysis(Tauri 2 + Rust + Vue 3 + TS)
> - 对标仓库: LeagueAkari(Electron + Vue + TS,本机 `D:\lolzhushou\LeagueAkari`)
> - 两个仓库均已建立 codegraph 索引。**查代码一律用 codegraph**,不要 grep:
>   ```bash
>   cd rank-analysis && codegraph explore <符号名>   # 查调用链/源码
>   codegraph files --filter <目录>                    # 查结构
>   codegraph status                                   # 索引统计
>   ```

---

## 目录

1. [项目定位与目标](#1-项目定位与目标)
2. [现状诊断(codegraph 实测基线,勿凭记忆)](#2-现状诊断)
3. [方向总览与依赖关系](#3-方向总览与依赖关系)
4. [方向 A:战绩详情页性能优化(先做,阻塞 B)](#4-方向-a战绩详情页性能优化)
5. [方向 B:战绩页三段式 UI 重构(核心交付)](#5-方向-b战绩页三段式-ui-重构)
6. [方向 C:OP.GG 出装/符文推荐](#6-方向-copgg-出装符文推荐)
7. [方向 D:AI 功能增强](#7-方向-dai-功能增强)
8. [实施里程碑与验收标准](#8-实施里程碑与验收标准)
9. [技术决策记录(ADR)](#9-技术决策记录adr)
10. [风险清单](#10-风险清单)
11. [参考:Akari 对标文件索引](#11-参考akari-对标文件索引)

---

## 1. 项目定位与目标

**定位**:基于 LCU API 的国服英雄联盟工具,核心差异化 = 数据驱动 AI 复盘 + OP.GG 数据 + 战绩分析。
**对标差距**(用户与代码实测结论):
- 战绩页可扫性差、详情加载慢(Akari 秒开,我们 ~1-2s+)
- 无出装/符文/技能加点推荐(Akari 有独立 OP.GG 窗口)
- AI 只有赛后复盘(Akari 无 AI,这是我们的独有优势,要做大做深)

**目标(按优先级)**:
| 优先级 | 目标 | 对应方向 |
|---|---|---|
| P0 | 详情从"新窗口+重查"改为"就地展开",秒开 | A |
| P1 | 战绩页重构:三段式布局 + 表现趋势条 + 紧凑行卡 + 就地展开 10 人对比 | B |
| P2 | 出装/符文/往家推荐(自有数据聚合为主,OP.GG 扩展为辅) | C |
| P3 | AI:结构化输出 + 磁盘缓存 + 阶段化(选人/对局中/赛后) + 用户画像 | D |

**原则**:
1. 性能优先:一切数据先查缓存/内存,再走 IPC/网络(学 Akari 的"数据随列表带回来")
2. 布局为内容服务:一屏信息密度 > 卡片美学
3. 数据管道复用:不重复造 `ensure_*` 降级链,全部走既有模式(见 `opgg.rs` 样板)
4. 后端 Rust 承担聚合与缓存,前端只做渲染与交互

---

## 2. 现状诊断

> 基线数据来自 codegraph 索引(2026-08-11):rank-analysis 336 files / 4,216 nodes / 11,690 edges;Akari 1,262 files / 16,705 nodes / 45,518 edges。
> 以下结论均有对应代码依据,开发前可用 `codegraph explore` 复核。

### 2.1 详情页慢的根因(Akari 秒开 vs 我们慢)

| 环节 | rank-analysis(现状) | LeagueAkari(对标) |
|---|---|---|
| 打开方式 | `openMatchDetailWindow()` 新建 **WebviewWindow**(`detailWindow.ts:51`)+ localStorage 序列化整局 JSON 传递 | `MatchCard` `isExpanded` **就地展开**(`MatchCard.vue:35`),数据已在内存 |
| 段位 | `useMatchPlayerRanks`(useMatchPlayerRanks.ts:46)对 10 人逐个 `get_rank_by_puuid` → LCU rank API,首开无缓存必等 | 直接用 game 包内嵌 `highestAchievedSeasonTier`(`match-history.ts:59`)或 saved-player 缓存,零请求 |
| 图标资源 | `loadAssetsIfNeeded`(MatchDetailModal.vue:729)收集 10 人 item/spell/perk 走 IPC,100+ 请求(代码自己做了 `visibleTeamCount` 80ms 错峰 hack,见 :747-758) | 本地资源 provider(`akari-resource`)内存 Map 直取 |
| 额外 IPC | `get_my_summoner` 串在 onMounted | 无 |

**结论**:根因是"详情数据懒取",修复方案见方向 A。

### 2.2 战绩页布局差距

| 维度 | rank-analysis | LeagueAkari |
|---|---|---|
| 页面结构 | `UserRecord`(整屏大卡:头像/段位/好友宿敌/标签)+ `MatchHistory`(筛选下拉+大卡列表+翻页),上下堆叠 | `PlayerTab`:`PlayerTabHeader` 紧凑玩家条 → 双栏(`StickyBox` 左栏聚合 + `MatchHistoryList`)+ 顶部筛选/分页 |
| 卡片 | `RecordCard` 每局一张大 n-card,一屏 4-5 场 | `MatchCardOverview` 紧凑,一屏 10+ 场 |
| 详情 | 新窗口 | 卡内展开(KeepAlive) |
| 聚合数据 | 好友/宿敌分析(独有!) | 左栏个人聚合:英雄池(胜率 ring)/AkariScore/大师分 |
| 筛选 | 模式+英雄两个下拉 | 简单/组合谓词(**combinator-node 子树**)+ collectMode 批量收集 |
| 趋势可视化 | 无 | 无(两边都没有!) |

**结论**:Akari 布局可扫性优于我们,但它也没有趋势可视化、没有好友宿敌、没有 10 人同屏对比。方案 B 是在 Akari 布局之上叠加我们独有能力。

### 2.3 OP.GG 数据现状

- **已有**(数据管道完整):`OpggSnapshot{ champions: HashMap<i32, Vec<ChampionMeta>>, counters: HashMap<i32, Vec<LaneCounter>> }`(`opgg/data.rs:55`);三级降级链 内存→磁盘→HTTP(`opgg.rs` `ensure_snapshot_impl`);段位分段(gold_plus..all);补丁号;前后端共用词汇 `normalize_position`
- **缺失**:出装(Builds)、符文(Runes)、技能加点(Skills)、召唤师技能推荐——Akari 的 opgg 窗口(`OpggChampionRunes/Boots/Skills`)有,我们完全没有
- **已有消费者**:`ChampionIntelCard`(克制提示)、`PatchNoteBadge`、`useBpDecision`(ban/pick 决策)、`useOpggTier`(段位切换)

### 2.4 AI 现状

- 链路:前端 `services/ai/stream.ts` → `stream_ai_analysis`(Rust,`command/ai.rs`)→ DashScope(阿里,OpenAI 兼容)→ qwen-flash 默认;流式 Channel 回传
- 能力:整局复盘(overview)/单人复盘(player)(`useMatchAIAnalysis`)、对局中面板 AI(`useGamingAIAnalysis`)
- 缓存:sessionStorage(内存,关窗即失)
- 缺:磁盘缓存、结构化输出渲染、阶段化(选人期/对局中/赛后)、用户长期画像、provider 抽象、token 成本控制

---

## 3. 方向总览与依赖关系

```
D0/方向A 详情页秒开(性能地基)
   │
   ▼
D1/方向B 战绩页三段式重构(核心 UI 交付)
   │        ├── 依赖 A(展开层复用 A 的能力)
   │        └── 依赖 C 的数据层(展开层显示推荐装,可后接)
   ▼
D2/方向C PUGG 出装推荐(数据管道 + 消费 UI)
   ├── 依赖 B 的展开层(推荐装展示位)
   └── 独立可用:先在对局中 ChampionIntelCard 落地
   ▼
D3/方向D AI 增强(独立推进,可与 C 并行)
```

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| M0 | 方向 A 完成:详情就地展开,秒开 | 无 |
| M1 | 方向 B 完成:三段式战绩页(视觉大改) | M0 |
| M2 | 方向 C 完成:出装/符文推荐可用 | M1(展示位)或 M0(先行版) |
| M3 | 方向 D 分 P1-P4 渐次完成 | M0 |

---

## 4. 方向 A:战绩详情页性能优化

> 目标:点击战绩 → 内容出现 < 300ms(对标 Akari 秒开);去掉新窗口、去掉 10 人实时段位查询、去掉 100+ 资源请求串行。

### 4.1 架构决策

**决策 A1:放弃独立 `WebviewWindow`,改为当前页就地展开(抽屉/内嵌面板)。**
- 删:`detailWindow.ts`(或保留空壳函数)、`views/MatchDetail.vue` 路由
- 改:`MatchHistory.vue` 的 `openDetail()` → 置 `selectedGame` ref;`MatchDetailModal.vue` 改为抽屉(naive-ui `n-drawer`,宽度 ~min(1360px, 90vw))常驻,`visibleTeamCount` 错峰 hack 可删(资源不再阻塞,见 A3)
- 保留:`MatchDetailModal` 内部全部计算逻辑(对比条/占比/标签/AI 面板)不动,只改容器与加载路径

**决策 A2:移除 10 人实时段位查询。**
- `useMatchPlayerRanks`:取消 `getRankByPuuid` 逐人实时 invoke
- 段位数据源改为,按优先级:
  1. 战绩页列表请求里**附带**的段位(见 A4,后端一次抓全)
  2. 玩家标签聚合 `UserTag`(= 数据已在战绩页顶部)
  3. 兜底显示"暂无"(导航是显示 N/A 而不是空,见 MatchDetailModal.vue:568-571 现有降级)
- 说明:LCU 只能查"当前段位",`useMatchPlayerRanks.ts:96` 的 tooltip 文案保留

**决策 A3:资源加载去 IPC 饥饿。**
- `useRecordAssets` 保留(它已经是"父级批量 + rAF 调度"模式),但:
  - 战绩列表请求成功后**就**预加载该页全部 10 人资源(现在列表只收集 `participants[0]`,见 MatchHistory.vue:125)
  - 展开详情瞬间资源已在手;未命中再补 `preload`
- 图标走 CDN `assetPrefix`(已实现,http.ts),头像走 LCU CDN,避免本地 cache 服务

**决策 A4:后端一次 IPC 返回详情所需全部数据。**
- 新增 Rust command(建议 `get_match_detail(game_id)` 或扩展 `get_match_history_by_name` 返回结构,放 `command/match_history.rs` 或 `command/rank.rs`——开发时用 codegraph 找最短路径):
  - `MatchHistory`(整场即可,列表已带)
  - 10 人 `Rank`(复用 `rank.rs` 的 `get_rank_by_puuid` 逻辑,**在 Rust 侧并发 + 内存缓存**,`tokio::join!` 并发 10 个,单次 IPC 回传)
  - 聚合字段(胜率/近期标签)如已有则不重复
- 前端配套:`services/rank.ts` 的模块级缓存保留(Rust 侧也要有,防止反复 IPC)

### 4.2 任务卡

| # | 任务 | 涉及文件(现状) | 验收 |
|---|---|---|---|
| A1-1 | ✅ MatchDetailModal 改为抽屉容器 | `MatchDetailModal.vue`、`MatchHistory.vue`、`views/Record.vue` | 点击战绩原地弹出,无新窗口;路由/窗口代码删除后无死引用 |
| A1-2 | ✅ 删除窗口路径 | `detailWindow.ts`、`views/MatchDetail.vue`、`match.ts` 内引用 | `rg` 无 `match-detail` 残留(codegraph 复核) |
| A2-1 | ✅ Rust 侧批量段位 command | `src-tauri/src/command/rank.rs`、`lcu/api/rank.rs` | 单次 IPC 返回 10 人 rank;Rust 侧缓存命中不击穿 LCU |
| A2-2 | ✅ 前端切数据源 | `useMatchPlayerRanks.ts`、`services/rank.ts` | 展开详情 0 新增段位请求 |
| A3-1 | ✅ 列表页全量 10 人资源预载 | `MatchHistory.vue` `collectAssetIds` | 展开时图标无 loading 闪烁 |
| A4-1 | 详情聚合 command(如采用) | `command/*.rs` | 一次 invoke 全量数据 |
| A-测试 | ✅ 单元测试 | Rust:rank 批量并发/缓存;前端:渲染性能用 `useAppUpdate.spec.ts` 风格 | `npm run check` + `cargo test` 全绿 |

### 4.3 验收标准(M0)
1. 从点击战绩卡到"10 人表格可见" ≤ 300ms(本地 LCU 连接态,清空缓存后首开)
2. 打开详情全程 **0 次** 新的段位/资源 IPC 请求(断网也能显示全部已缓存数据)
3. 窗口/路由代码无残留,`codegraph` 索引同步后无孤儿符号

---

## 5. 方向 B:战绩页三段式 UI 重构

> 目标:一屏信息密度对标/超过 Akari;保留并强化独有能力(好友宿敌、AI、10 人对比、趋势条)。
> **这是本计划的核心交付,UI 视觉稿以本文件示意图为准。**

### 5.1 布局设计(最终稿)

```
┌────────────────────────────────────────────────────────────────────┐
│ ① 玩家条(60px 紧凑)                                                  │
│  [头像] 薇恩#666  [段位图标 钻IV]  单双55% | 灵活48%   近7日 4W2L   │
├───────────────┬────────────────────────────────────────────────────┤
│ ② 左栏 sticky │ ③ 筛选行: [模式▼][英雄▼][胜/负][近N场] [收集更多]   │
│ (可折叠窄条)  ├────────────────────────────────────────────────────┤
│ 数据总览       │ ④ 表现趋势条 ★新概念                                 │
│  KDA 3.1       │  ██████████░░░░▓▓▓▓▓▓▓▓░░░░░░░░░▓▓▓  ← 每格1场     │
│  场均 12/4/4   │   (格长=时长 色=胜负 暗格=死亡 绿点=MVP)             │
│  [英雄池]      ├────────────────────────────────────────────────────┤
│   薇恩 62% ★   │ ⑤ 战绩卡(紧凑行卡 ~44px)                            │
│   亚索 48%     │  ▍胜 15:32 薇恩 12/3/8  ┃┃┃ 43k 80%参团         ▼  │
│  [好友/宿敌]   │  ▍负 28:11 亚索 5/9/4  ┃┗┛ 21k 60%参团         ▼  │
│  [近30日趋势]  │  ▍胜 ...                                          │
│                ├────────────────────────────────────────────────────┤
│ (hover 卡⇒左栏 │ ⑥ 就地展开层(复用方向A): 10人对比表               │
│  联动高亮该英  │   [头像英雄 KDA段位][伤害/承伤/治疗对比条]          │
│  雄长期数据)   │   [出装7件+推荐对比][符文][技能][AI复盘按钮]        │
│               │   [加载更多] 滚动加载 / [上一页/下一页]             │
└───────────────┴────────────────────────────────────────────────────┘
```

### 5.2 各区实现说明

**① 玩家条**(替代现 `UserRecord` 顶部大卡)
- 新建 `components/record/PlayerBar.vue`;折叠与 `UserRecord` 合并重构:个人聚合内容(好友宿敌/标签/RecentData)全部移入左栏 ② `UserRecord.vue` 删除或改造为 `UserSidePanel.vue`
- 数据不变(路由 `name`/`region` 查询参数,`UserRecord.vue:206` 逻辑保留)

**② 左栏 sticky + hover 联动**
- naive-ui 无现成 sticky,用 `position: sticky`(参照 Akari `StickyBox` 的滚动探针思路,但简化实现;或引入 `@vueuse/core` `useElementVisibility` 控制折叠)
- **联动**:`MatchHistory` 每行卡 hover → emit `hover-champion(id)` → 左栏英雄池定位并展开该英雄近 30 场聚合(数据源:后端聚合 command,见 C 章 PUGG 数据层)
- 左栏默认展示:`RecentData`(KDA/场均/参团率/金伤占比)+ 好友宿敌(现有 `friendAndDispute` 数据,列表化)+ 标签

**③ 筛选行**
- 现筛选(英雄/模式)保留;加分页控件入行内
- **新筛选维度(低成本)**:胜负、时间范围(近3h/24h/7d/30d)——注意:LCU 列表接口不支持服务端过滤(现实现是前端过滤 `get_filter_match_history_by_name` 拉 0-49 再筛),**趋势条和筛选共用同一份过滤逻辑**,放 `components/record/matchFilters.ts` 纯函数(可单测)
- "收集更多"按钮 = 现 `nextPage` 语义,一次 10 场;趋势条滚到底自动接续(SGP 路径下 `collectMode` 批量收集可后置,不阻塞)

**④ 表现趋势条(★独有创新,两边都没有)**
- 新组件 `components/record/TrendBar.vue`:横向 flex,每场一个格
  - 宽 = `gameDuration 归一化`(10-60min → 4-24px),色 = 胜(绿)/负(红),内部暗格数 = deaths,顶部绿点 = `mvp` 字段非空
  - 点击格 = 定位到对应战绩卡(或直接展开详情)
  - 上限展示最近 50 场(对齐 `MAX_CACHE_END: i32 = 49` `match_history.rs:138`),更早的进"收集更多"
- hover tooltip:对局时间/英雄/KDA 一行预览

**⑤ 紧凑战绩卡(重写 `RecordCard.vue` 展示层)**
- 单行布局:`胜/负标记 | 时长 | 英雄头像+名称 | KDA | 物/伤/承 mini 条 | 参团率 | MVP 角标`;首件大件图标可显 3-4 个
- 展开箭头 = 触发就地展开(方向 A 的抽屉);卡片本体可再细分成 `RecordCardHeader` / 展开内容复用 `MatchDetailModal`
- 保留:斗魂名次/海克斯 augment 显示(`RecordCard.vue:258-297` 逻辑移入紧凑态)

**⑥ 展开层**:直接复用方向 A 的抽屉;在此之上叠加方向 C 的"出装对比"栏(位子预留)。

### 5.3 任务卡

| # | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| ✅ B1-1 | PlayerBar + 页面重构 | `views/Record.vue`、`UserRecord.vue`→`UserSidePanel.vue` | 首屏 0.8 屏内可见战绩列表 |
| ✅ B1-2 | 左栏 sticky + 折叠 | 新组件 `UserSidePanel.vue` | 长列表滚动左栏不丢;折叠为 48px 窄条 |
| ✅ B2-1 | 筛选纯函数化 | 新建 `matchFilters.ts` + spec | `npm run test` 新增用例覆盖 |
| ✅ B3-1 | TrendBar 组件 | 新建 `TrendBar.vue` + 数据装配 | 50 场趋势图可交互定位 |
| ✅ B4-1 | 紧凑行卡 | `RecordCard.vue` 重构 | 一屏 ≥12 场 |
| ✅ B5-1 | 联动 | MatchHistory hover → 左栏 | 交互流畅无卡顿 |
| B-测试 | 单元 + 手工 | — | check/test 全绿;分辨率 1366x768 与 2560x1440 均无溢出 |

### 5.4 验收标准(M1)
1. 首屏(1366x768):玩家条+筛选+趋势条+5-6 张战绩卡可见,无需滚动
2. 清空缓存后打开战绩页 → 10 场列表 ≤ 1s(参考现状基线,若低于此数则先查后端)
3. 左栏联动、趋势条点击定位、就地展开三项交互无卡顿帧

---

## 6. 方向 C:OP.GG 出装/符文推荐

> 目标:对战与战绩场景都能看到"这个英雄怎么出装/带什么符文"。**核心 = 自有战绩聚合(PUGG),外援 = OP.GG 扩展解析;双源合并、前端分层展示。**

### 6.1 数据层设计

**C1:自有统计聚合(PUGG,国服友好、无外部耦合)**
- 新增 Rust 模块 `src-tauri/src/pugg/`(或并入 `opgg/` 模块,开发时以最短路径定):
  - 输入:某召唤师历史对局(复用 `match_history.rs` 缓存窗口 50 场;按英雄+位置+模式分组)
  - 输出 `BuildStats`:`{ champion_id, position, mode, samples: u32, items: HashMap<slot, Vec<(item_id, count, win_count)>>, rune_main/rune_sub/stat_mods: 频率表, skill_order: Vec<(skill, level)> 频率, spell1/spell2 频率 }`
  - 过滤规则:胜场权重 2x,样本 < 5 场不输出(防小样本噪声)
- command:`get_build_stats(champion_id, position?, mode?)`;内部走 `moka` 缓存(同 `opgg_cache` 模式)

**C2:OP.GG 解析扩展(外服对照数据)**
- 扩展 `opgg/api.rs` 抓取维度:每英雄每位置 Top3 出装、Top1 符文树、加点顺序(OP.GG 页面结构化,需在 `api.rs` 加解析器;如目标站点改版频繁则仅保留 winrate/tier 维度,C2 降级为纯 PUGG)
- `OpggSnapshot` 结构扩展字段(serde default 兼容旧缓存,`data.rs:55` 模式)

**C3:合并与输出**
- 定义 `BuildRecommendation`(前端共享类型):`{ source: 'pugg'|'opgg'|'merged', items[], runes{primary,sub}, spells[], note }`
- 合并规则:同英雄同位置,PUGG 样本 ≥10 取 PUGG,否则 OP.GG;顶栏标注数据来源与样本数(防误导)

### 6.2 消费 UI(两处)

1. **对局中**(先行,独立于 M1 交付):`ChampionIntelCard` 增加"出装/符文"页签
   - 我的英雄:显示推荐装 + "对局内经济进度"(当前金币 vs 推荐核心件价格)
   - 敌方英雄:显示推荐装(克制预判)与对该英雄的 PUGG 死亡数据(输给他的局里对面怎么出的)
2. **战绩展开层**(M1 后接入):10 人对比表加"出装对比行":每人 7 件 vs 该英雄推荐 7 件,差异闪烁标注(黄色=换装,红色=乱出);符文/技能并排

**C4(进阶,AI 联动,放方向 D 之后)**:"出装诊断"——AI 解释"你第二件晚 4 分钟,推荐 X 时机 Y",用 PUGG 聚合 + prompt 生成。

### 6.3 任务卡

| # | 任务 | 涉及 | 验收 |
|---|---|---|---|
| C1-1 | PUGG 聚合模块 + command | `src-tauri/src/pugg/`(新)、`command/` | 50 场内样本≥5 可出 BuildStats;单测覆盖过滤规则 |
| C1-2 | 前端 service | `services/builds.ts`(新)+ spec | 调用封装、错误降级 null |
| C2-1 | OP.GG 解析扩展(尽力而为) | `opgg/api.rs`、`opgg/data.rs` | 解析失败不影响现有 winrate 管道 |
| C3-1 | BuildRecommendation 合并 | PUGG/opgg 之上 | 双源合并规则单测 |
| C-2-UI | ChampionIntelCard 页签 | `components/gaming/ChampionIntelCard.vue` | 对局中可见推荐装/符文 |
| C-3-UI | 展开层出装对比(依赖 M1) | `MatchDetailModal.vue` | 差异高亮 |
| C-测试 | 全部 | — | check/test 全绿 |

### 6.4 验收标准(M2)
1. 任意英雄(排位/大乱斗)对局中 ≤2 次点击看到推荐装+符文,数据来源与样本数可辨识
2. 无网络/无历史对战样本时优雅降级(不报错、显示"暂无推荐")
3. C1 聚合对单召唤师 50 场历史耗时 < 200ms(本地 LCU)

---

## 7. 方向 D:AI 功能增强

> 分 4 个阶段,每阶段独立可交付。**原则:AI 只做数据之上的"解释层",一切可确定计算的交给 Rust 规则/聚合,LLM 只出结论与文案。**

### D-P1 结构化输出 + 磁盘缓存(最大性价比,先做)
- **结构化输出**:`stream_ai_analysis` 已有 `response_format: json_object` 支持(`ai.rs` `build_request_body`)——强制所有复盘走 JSON mode,定义 `AIAnalysisReport` schema:
  ```ts
  interface AIAnalysisReport {
    verdict: 'win'|'loss'|'neutral'             // 这场谁决定胜负
    mvps: Array<{participantId, reason}>        // 拆好
    sunkCosts: Array<{participantId, reason}>   // 坑位
    ownScore: { rating: 1-10, metrics: string[] }
    improvements: Array<{title, evidence, suggestion}>
  }
  ```
  前端改为渲染结构化卡片(对照组:现在 markdown `renderedResult` v-html,`MatchAIPanel.vue:29-33`),不再 v-html 长文
- **磁盘缓存**:缓存从 sessionStorage(`stream.ts:99`)升级到 Rust 侧磁盘(按 `gameId + patch` 分片 + 时效),理由:① 关窗不丢;② 同局重复打开(打开详情/好友分享)零成本;③ AI 请求价格敏感,缓存即省钱
- 加 **token 用量统计**(`AiStreamEvent` 可扩展 `usage` 字段):设置页显示每次分析成本

### D-P2 阶段化 AI(核心差异化,对标点)
| 阶段 | 触发器 | 内容 |
|---|---|---|
| 选人期 | `ChampSelect` 事件(Gaming.vue `sessionData`) | 阵容强度分、克制关系提示(OP.GG counters + AI 综合)、ban/pick 建议(复用 `useBpDecision` 规则结果 + AI 润色) |
| 对局中 | LCU WebSocket 事件 | 装备对比诊断(接 C4)、经济/团战时间点预警、死亡模式提示(上海量代码:新 `useLiveAIAnalysis` composable,基于 `useGamingAIAnalysis` 的流式基础设施) |
| 赛后 | 对局结束 | 现有复盘 + D-P1 结构化 |

在 `Gaming.vue` 的 AI 面板(`showAITooltip`/`useGamingAIAnalysis`)之上扩展 tab 化(选人/对局/赛后),**保持"面板可随时打开看进度"的现有交互**(useGamingAIAnalysis 注释明示的诉求)。

### D-P3 用户画像(护城河)
- 后端:基于本人历史对局聚合长期指标(补刀曲线/死亡时机/参团率/视野)——**复用 `RecentData` 聚合计数字段**(already `RecentData`,analysis.ts:91),扩展"按分钟曲线"维度
- AI:周期性(每 N 场/每 patch)生成"成长报告":"近 30 场你 15 分钟补刀落后 12,80% 败局发生在首次小龙团前后"——LLM 解释 + `RecentData` 数据
- 落点:战绩页左栏"近 30 日趋势"卡(Akari 无此能力)

### D-P4 平台化
- provider 抽象:定义 `AiProvider` trait(Rust:`fn stream_chat(...)`),实现:DashScope(现有)、DeepSeek/OpenAI 兼容、Ollama 本地(隐私模式,数据不出机器)
- 设置页:provider + model + apiKey + 本地模型地址
- prompt 模板独立成文件(`prompts/` 下按场景),支持版本化与 i18n

### 任务卡摘要

| # | 任务 | 涉及 | 验收 |
|---|---|---|---|
| D1-1 | AIAnalysisReport schema + 渲染卡片化 | `services/ai/types.ts`、`MatchAIPanel.vue`、`AgentReport.vue`(新) | 复盘零 markdown 长文 |
| D1-2 | Rust 磁盘缓存 | `command/ai.rs` | 同局重开 0 消耗 |
| D1-3 | token 统计 | `ai.rs` + 设置页 | 可见成本 |
| D2-1 | 选人期 AI tab | `Gaming.vue`、`useBpDecision` | 对局开始前可用 |
| D2-2 | 对局中 AI(含 C4 出装诊断) | 新 `useLiveAIAnalysis` | 实时流式输出 |
| D3-1 | 长期画像聚合 | `RecentData` 扩展 + Rust 聚合 | 成长报告可生成 |
| D4-1 | AiProvider trait + Ollama | `command/ai.rs` 重构 | 本地模型可用 |
| D-测试 | schema 校验、缓存命中、provider 切换 | — | 全绿 |

---

## 8. 实施里程碑与验收标准

### 总验收清单(全部 M 达成后)

| # | 验收项 | 验证方法 |
|---|---|---|
| 1 | 详情秒开(≤300ms,0 新增段位/资源请求) | 本地 LCU + 清缓存,devtools Network/IPC Log |
| 2 | 战绩页三段式布局,首屏可扫 ≥12 场 | 人工目检 + 截图存档 |
| 3 | 表现趋势条正常渲染/交互 | 50 场账号用例 |
| 4 | 推荐装/符文可用(对战+战绩两处) | 人工 + 无网络降级用例 |
| 5 | AI 结构化复盘 + 磁盘缓存 + 三阶段可用 | 人工 + 单测 |
| 6 | 全部单测/ lint 通过 | `cd rank-analysis-app && npm run check && npm run test`;`cd src-tauri && cargo test` |

### 里程碑定义

| 里程碑 | 范围 | 预计工作量(相对) | 阻塞 |
|---|---|---|---|
| M0 | 方向 A 全量 | 1 | — |
| M1 | 方向 B 全量 | 3(最大,含 UI 打磨) | M0 |
| M2 | 方向 C 全量 | 1.5 | M0(M1 仅影响展示位) |
| M3 | 方向 D 全量 | 2.5(分 P1..P4 交付) | M0 |

**每里程碑完成即发一次 commit**(遵循仓库 Conventional Commits,见 CONTRIBUTING.md / CLAUDE.md 质量门禁:`npm run check` 全绿才可提交)。

---

## 9. 技术决策记录(ADR)

| ADR | 决策 | 理由 | 反方(保留) |
|---|---|---|---|
| A1 | 详情就地展开,弃独立窗口 | 性能根因;Akari 已验证 | 弹窗可多局对比查看(可通过展开层"固定多开"替代,后置) |
| A2 | 段位不再逐人实时查 | LCU rank 慢;数据随列表附带 | 段位非"打这局时"的局限仍在(tooltip 明示) |
| A4 | Rust 侧聚合一次 IPC | IPC 次数 = 延迟 | Rust 侧并发实现成本(用 `tokio::join!` 可控) |
| B2 | 左侧 sticky 自实现 | 依赖轻;复杂探针(如 Akari)暂不需要 | 后续若需悬浮/多列再评估库 |
| C1 | PUGG 优先于 OP.GG | 国服数据、零外部依赖、样本即玩家自己 | 小样本(<5 场)降级到 OP.GG |
| D-P1 | 强制 JSON 输出 + schema | 渲染确定性、可校验、防幻觉数字 | 文案自由度下降(可接受) |
| D-P2 | AI 阶段化走既有流式基建 | 复用 Channel/重试/看门狗 | 对局中触发频率需限流(prompt 节流 + 状态机) |

---

## 10. 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| LCU list 接口只返 50 场窗口(`MAX_CACHE_END`) | 趋势条/聚合样本上限 | 明示"仅近 50 场";SGP 路径延伸(collectMode 思路后置) |
| OP.GG 站改版破坏解析 | C2 失效 | 增益性功能,失败仅影响推荐来源标注;C1 PUGG 兜底 |
| 就地把 10 人对局表塞进 Drawer 的宽度不足 | B/A UI 挤 | 抽屉 min-width 1360 + 顺滑滚动(现有 MatchDetail.vue 版心 1360 经验复用) |
| AI 结构化输出偶发非法 JSON | D-P1 | 已有 json_object + 重试;前端解析失败回退 markdown 渲染 |
| 对局中 AI 触发过频烧 token | D-P2 | 状态机节流:同一对局同类型诊断最高 1 次/3min |
| 重构破坏既有用户习惯(翻页→滚动) | B | 保留"上一页/下一页"双模式入口 |
| codegraph 索引过期 | 全部 | 每次改动后 `codegraph sync`,开发生效快 |

---

## 11. 参考:Akari 对标文件索引

> 仅作思路参照,不照搬代码(双方技术栈不同)。

| 我们的需求 | Akari 参照文件 | 借鉴点 |
|---|---|---|
| 就地展开 | `renderer-shared/components/match-card/MatchCard.vue` | isExpanded + KeepAlive 模式 |
| 紧凑左栏 | `main-window/views/player-tabs/.../PlayerTab.vue` + `StickyBox` | 双栏布局、sticky 探针 |
| 英雄池聚合 | `champion-analysis/ChampionAnalysisContent.vue` + `PlayerInfoCardChampionUsage.vue` | 胜率 ring、AkariScore、hover 浮层 |
| 筛选 | `match-history-filters/combinator-*` | 谓词组合思想(我们只做简单版:胜负/时间/英雄/模式) |
| 出装符文 | `src-opgg-window/opgg/widgets/OpggChampionRunes.vue` / `OpggChampionBoots.vue` / `OpggChampionSkills.vue` | 展示形态(10 格装备格/符文树) |
| 收集模式 | `match-history-init-param-collect.ts` | SGP 分批收集(我们后置) |

---

## 附:文档维护约定

- 本文档路径: `rank-analysis/docs/OPTIMIZATION_PLAN.md`
- 每个方向完成时:更新对应章节"验收标准"为 ✅,并记录实际改动 diff 摘要
- 每个任务卡被完成时:将 `#` 前加 ✅
- 计划级变更(改目标/换架构):必须 bump 版本号并写"变更记录"
- 上下文丢失后恢复流程:读本文档 → `codegraph status` → 按里程碑顺序继续

**变更记录**
| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-08-11 | 初版:基于 codegraph 实测调研,含 A(性能)/B(UI)/C(出装)/D(AI) 四方向与里程碑 |
| v1.1 | 2026-08-11 | **M0 完成**:A1 抽屉化(删 detailWindow.ts/MatchDetail.vue/路由/窗口权限与全部 match-detail- 判断);A2 批量段位 get_ranks_by_puuids(Rust join_all 并发 + moka 30min 缓存,前端共用模块级缓存);A3 列表页全量 10 人资源预载 + 删 visibleTeamCount hack。Rust 门禁因本机无工具链改由 GitHub Actions 兜底 |
| v1.2 | 2026-08-11 | **M1 布局骨架完成**:B1-1 PlayerBar(60px)+ Record.vue 三段式重构 + 共享数据源 usePlayerRecordData(路由 name/region 加载,跨区降级);B1-2 UserSidePanel 左栏(好友宿敌空态收敛单行 + RankCard + RecentStatsTable + 跨区提示);B2-1 筛选纯函数化 matchFilters.ts(12 用例);B4-1 RecordCard 紧凑 44px 行卡(胜负/时长 mm:ss/英雄名/KDA/伤害承伤治疗 mini 条/参团率/装备 4 槽或海克斯/MVP 角标,删队列日期技能两队头像);B3-1 TrendBar 最近 50 场趋势格(时长归一宽度 + deaths 暗格 + MVP 绿点 + tooltip + 点击定位/展开);B5-1 英雄池联动(aggregateChampionPool 纯函数聚合 50 场 + 左栏 HeroPool 高亮/淡化 + RecordCard hover 事件链)。UserRecord.vue 已删除 |