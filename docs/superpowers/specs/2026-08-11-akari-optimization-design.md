# Rank Analysis 优化开发计划(对标 LeagueAkari)

> **本文档是后续一切开发的唯一权威参考。** 修改任何功能前先读本文档对应章节;
> 计划变更时同步更新本文档并 bump `计划版本`。
>
> - 计划版本: v1.7(2026-08-17)
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
8. [方向 E:详情页 6 tab 追平(核心交付)](#8-方向-e详情页-6-tab-追平核心交付)
9. [方向 F:SGP 数据源升级(详情页地基)](#9-方向-fsgp-数据源升级详情页地基)
10. [实施里程碑与验收标准](#10-实施里程碑与验收标准)
11. [技术决策记录(ADR)](#11-技术决策记录adr)
12. [风险清单](#12-风险清单)
13. [参考:Akari 对标文件索引](#13-参考akari-对标文件索引)

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

| 里程碑 | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| M0 | 方向 A 完成:详情就地展开,秒开 | 无 | ✅(v1.1) |
| M1 | 方向 B 完成:三段式战绩页(视觉大改) | M0 | ✅(v1.2/v1.2.1) |
| M2 | 方向 C 完成:出装/符文推荐可用 | M1(展示位)或 M0(先行版) | ✅(2026-08-13 降级纯 PUGG,§6.5) |
| M3 | 方向 D 分 P1-P4 渐次完成 | M0 | ✅(v1.6/v1.6.1/v1.6.3) |
| M4 | 方向 E 完成:详情页 6 tab 追平 | M0;高级数据依赖 M5 | ✅(v1.4) |
| M5 | 方向 F 完成:SGP 数据源升级(详情页地基) | M0(M4 的 SGP 增强部分) | ✅(v1.5) |

---

## 4. 方向 A:战绩详情页性能优化

> 目标:点击战绩 → 内容出现 < 300ms(对标 Akari 秒开);去掉新窗口、去掉 10 人实时段位查询、去掉 100+ 资源请求串行。
>
> **完成记录(2026-08-11):A1 抽屉化 + A2 批量段位 + A3 全量预载已落地(v1.1)**;A4-1「详情聚合 command」为可选项未实施(A2 批量段位已覆盖段位部分)。

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
>
> **完成记录(2026-08-11):布局骨架 v1.2、数据流收敛 + 测试 v1.2.1 已落地**;§5.5 提出的响应式(窄窗左栏抽屉/浮动分页)、「近期对手」栏、回到顶部 FAB 等改进项未排期,留待后续。

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
- "收集更多"按钮 = 现 `nextPage` 语义,一次 10 场;趋势条滚到底自动接续 ✅ collectMode 已落地:跨区「收集全部」一键无限深翻页(`services/sgp.ts` `collectSgpHistoryAll`,gameId 去重/上限 500/可取消续收),趋势条/英雄池样本解除 50 场窗口(2026-08-14)

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
| ✅ B-测试 | 单元 + 手工 | — | 单元部分✅:全量 816 tests 绿;分辨率/性能手工验收等 exe |

### 5.4 验收标准(M1)
1. 首屏(1366x768):玩家条+筛选+趋势条+5-6 张战绩卡可见,无需滚动
2. 清空缓存后打开战绩页 → 10 场列表 ≤ 1s(参考现状基线,若低于此数则先查后端)
3. 左栏联动、趋势条点击定位、就地展开三项交互无卡顿帧

### 5.5 对标结论:当前 UI vs Akari 界面与 UX/UI 差距分析(2026-08-12)

> 依据:双方代码对照阅读(rank-analysis-app 战绩页 ↔ LeagueAkari `player-tab` 相关组件)。
> 结论先行:当前页信息密度是优势;差距集中在"视觉扫读效率、行卡分层、响应式"三项,建议按下方优先级推进。

#### 5.5.1 当前 UI 布局示意图(rank-analysis-app)

```
┌────────────────────────────────────────────────────────────────┐
│ PlayerBar (60px) [logo] 搜索/导航 [主页│战绩│排行] [设置]         │
├──────────────┬─────────────────────────────────────────────────┤
│ aside 320px  │ content (max-width 1280px)                      │
│ (sticky,独立滚动) │                                             │
│ ┌ 数据总览 ────────┐ │ ┌ 筛选行 ──────────────────────────────┐ │
│ │ 段位图标+段位/胜点 │ │ │ [模式▾][英雄▾][胜负▾][时间▾] [收集更多][复位] │
│ │ 胜率% │ KDA      │ │ └─────────────────────────────────────┘ │
│ └─────────────────┘ │ ┌ TrendBar(50场趋势条)────────────────┐ │
│ ┌ 英雄池 ────────────┐ │ │ ▁▃▅▃▅▇▅▃▅▇▅▃▅▃▅▇▅▇▅▃▅▃▅▇▅▃▅▇▃▅▃▅ │ │
│ │ 近30天: 亚索38场61% │ │ └─────────────────────────────────────┘ │
│ │ 卡莎25场52% …      │ │ ┌ 战绩列表 10条/页 ──────────────────┐ │
│ └───────────────────┘ │ │ [✓] 15:32 亚索 12/3/8              │ │
│                      │ │ KDA ████ 伤│承│治 参团68% 装备x4 [MVP]│ │
│                      │ │ ─ 44px 行 × 10 ─                    │ │
│                      │ └─────────────────────────────────────┘ │
│                      │                 [◀ 1 2 3 ▶] 分页        │
└──────────────────────┴─────────────────────────────────────────┘
```

#### 5.5.2 Akari 界面布局示意图(LeagueAkari player-tab)

```
┌────────────────────────────────────────────────────────────────┐
│ 整体 NScrollbar 滚动  max-w 764px → @1064px 扩展,  @container   │
│ ┌ PlayerTabHeader (h-28≈112px) ──────────────────────────────┐ │
│ │ [头像64px+等级角标] 游戏名#tag(可复制,超长缩字号)  RankedPane │ │
│ │  姓名 + 标签                                     [段位/胜点] │ │
│ │                                                   [编辑][刷新]│ │
│ └────────────────────────────────────────────────────────────┘ │
│ 网格: grid-cols-1 → @1064px: grid-cols-[300px_minmax(0,1fr)]   │
│ ┌ 左栏 StickyBox(300px) ───────┐ ┌ 主列表 MatchHistoryList ──┐ │
│ │ 浮动分页 MatchHistoryPagination│ │ [筛选栏]                  │ │
│ │ 标签块 NormalTagBlock         │ │ ┌ MatchCard 收起116px ───┐ │ │
│ │ 综合 SummaryPane              │ │ │ [头像44px+胜败描边]     │ │ │
│ │ 熟练度 ChampionMasteryPane    │ │ │  技能+符文 [KDA][伤]    │ │ │
│ │ 近期队友/对手(敌我两栏)         │ │ │ 装备 ▸可展开: 双方队伍表/  │ │
│ │ 挑战/遭遇对局                  │ │ │ 时间线/回放下载/观战    │ │ │
│ └──────────────────────────────┘ │ └────────────────────────┘ │
│                                  │ 视口物化+回收(116px占位)   │ │
│ @<1064px 紧凑: 左栏→NDrawer 抽屉 + 顶部sticky浮动分页           │ │
│                                                              │ │
│ [采集进度条] [回放预览Modal] [回到顶部FAB]                     │
└────────────────────────────────────────────────────────────────┘
```

#### 5.5.3 差距分析与改进建议

| # | 维度 | 我们 | Akari | 差距 | 建议(优先级) |
|---|---|---|---|---|---|
| 1 | 行卡信息架构 | 44px 单行扁平,一屏全量 | 收起 116px 概览 + 展开详情(队伍表/时间线/回放) | 信息过载、无层次 | 行卡保留头像+KDA+参团;伤承治/装备折叠进展开详情(P1) |
| 2 | 英雄视觉化 | 文字英雄名 | 44px 圆头像 + 胜败描边色 + 位置角标 + Top1 皇冠 | 扫读慢 | 行首换英雄头像,描边色即胜负(P1) |
| 3 | 技能/符文 | 无 | 收起态即展示召唤师技能+符文 | 缺失 | 展开详情补齐(低优先) |
| 4 | 响应式 | 固定 1280/320px,无紧凑断点 | @container 764/1064 双断点 + 左栏抽屉 + 浮动分页 | 1366×768 首屏验收风险(5.4-1) | 窄窗左栏收抽屉 + 顶部 sticky 浮动分页(P1) |
| 5 | 页头身份区 | PlayerBar + 侧栏总览承载身份 | 112px header:头像/ID/段位/刷新/编辑标签 | 身份与操作入口弱 | 段位+胜点+胜率上提页头右侧(P2) |
| 6 | 左栏丰富度 | 数据总览 + 英雄池 | 总览+熟练度+近期队友/对手+挑战+遭遇对局 | 弱 | 补"近期对手"一栏(P2) |
| 7 | 交互便捷 | 底部翻页 | 回到顶部 FAB、采集进度条、浮动分页 | 弱 | 加回到顶部 FAB(P3) |
| 8 | 数据形态 | 独有:TrendBar 50 场趋势 + 四维筛选 + 英雄池联动 | 分页+收集模式 | 无(优势项) | 保持并强化,作为差异化卖点 |

---

## 6. 方向 C:OP.GG 出装/符文推荐

> 目标:对战与战绩场景都能看到"这个英雄怎么出装/带什么符文"。**核心 = 自有战绩聚合(PUGG),外援 = OP.GG 扩展解析;双源合并、前端分层展示。**
>
> **实施状态(2026-08-13 更新):C1/C3/C-2-UI/C-3-UI 已完成;C2-1 实测后按既定策略降级为纯 PUGG**(详见 6.5)。

### 6.1 数据层设计

**C1:自有统计聚合(PUGG,国服友好、无外部耦合)**
- 新增 Rust 模块 `src-tauri/src/pugg/`(或并入 `opgg/` 模块,开发时以最短路径定):
  - 输入:某召唤师历史对局(复用 `match_history.rs` 缓存窗口 50 场;按英雄+位置+模式分组)
  - 输出 `BuildStats`:`{ champion_id, position, mode, samples: u32, items: HashMap<slot, Vec<(item_id, count, win_count)>>, rune_main/rune_sub/stat_mods: 频率表, skill_order: Vec<(skill, level)> 频率, spell1/spell2 频率 }`
  - 过滤规则:胜场权重 2x,样本 < 5 场不输出(防小样本噪声)
- command:`get_build_stats(champion_id, position?, mode?)`;内部走 `moka` 缓存(同 `opgg_cache` 模式)
  - **落地修正**:LCU 战绩摘要无 lane/stat_mods/skill_order 字段(仅 SGP DETAILS 有,逐局拉取代价高),`BuildStats.position` 恒空串、`stat_mods`/`skill_order` 不输出,按「最短路径」原则留给后续增强;command 输入为 `(puuid, champion_id, mode)`——PUGG 是「自有战绩」,必须先有 puuid 才知道统计谁。

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

### 6.5 C2-1 实测结论:OP.GG 详情 API 已不可用,C2 降级为纯 PUGG(2026-08-13)

设计文档本就在 C2 声明「如目标站点改版频繁则仅保留 winrate/tier 维度」。本次联调实测:

| 探测路径 | 结果 |
|---|---|
| `lol-api-champion.op.gg/api/global/champions/{id}` / `/{id}/ranked` / `/{id}/aram` | 404/422(列表 API 存活,详情路径全无) |
| `lol-api-champion.op.gg/api/global/champions/ranked?name=X` | 200(仅此路径存活) |
| `lol-web-api.op.gg/api/v1.0/internal/bypass/champions/{id}/ranked`(旧版详情) | 超时(端点已下线) |
| `www.op.gg/champions/{id}/` | 308 永久重定向(改版迁移) |

**结论**:OP.GG 每英雄 Top3 出装/Top1 符文树/加点顺序的抓取不可行(站点已改版,无稳定 JSON 端点)。按 C2 既定降级策略,方向 C = 纯 PUGG + 双源合并规则(前端 `services/builds.ts` 预留 `'opgg'` 分支与 `resolveBuildSource` 裁决函数,OP.GG 恢复后零改动接回)。出装/符文推荐完全基于自有战绩,国服友好且无外部耦合——这也正是方向 C 的核心定位。

### 6.3 任务卡

| # | 任务 | 涉及 | 验收 |
|---|---|---|---|
| C1-1 | PUGG 聚合模块 + command | `src-tauri/src/pugg/`(新)、`command/` | ✅ 50 场内样本≥5 可出 BuildStats;单测覆盖过滤规则(`pugg/aggregate.rs` + command `get_build_stats`) |
| C1-2 | 前端 service | `services/builds.ts`(新)+ spec | ✅ 调用封装、错误降级 null(11 单测) |
| C2-1 | OP.GG 解析扩展(尽力而为) | `opgg/api.rs`、`opgg/data.rs` | ✅ 实测详情 API 已下线,按既定策略降级纯 PUGG,现有 winrate 管道零影响(见 6.5) |
| C3-1 | BuildRecommendation 合并 | PUGG/opgg 之上 | ✅ 双源合并规则单测(`resolveBuildSource`/`toBuildRecommendation`,样本≥10 优先 PUGG;OP.GG 分支预留) |
| C-2-UI | ChampionIntelCard 页签 | `components/gaming/ChampionIntelCard.vue` | ✅ 对局中可见推荐装/符文(出装 7 槽 + 基石/主系 + 召唤师技能 + 来源样本标注) |
| C-3-UI | 展开层出装对比(依赖 M1) | `MatchDetailStatsTab.vue`、`tabs/detailsTable.ts` | ✅ 数据对比 tab 顶部「出装 vs 推荐」行:10 人各 7 件 vs 该英雄推荐 7 件(PUGG 按英雄懒加载,`diffBuild` 逐槽判定:黄=换装/红=乱出闪烁,悬停显示推荐/实际/符文/技能并排);纯函数单测 8 例 |
| C-测试 | 全部 | — | ✅ check/test 全绿(863/863) |

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
| D1-1 | ✅ AIAnalysisReport schema + 渲染卡片化 | `services/ai/types.ts`、`MatchAIPanel.vue`、`AgentReport.vue`(新) | 复盘零 markdown 长文 |
| D1-2 | ✅ Rust 磁盘缓存 | `command/ai.rs` | 同局重开 0 消耗 |
| D1-3 | ✅ token 统计 | `ai.rs` + 设置页 | 可见成本 |
| D2-1 | ✅ 选人期 AI tab | `Gaming.vue`、`useBpDecision` | 对局开始前可用 |
| D2-2 | ✅ 对局中 AI(含 C4 出装诊断) | 新 `useLiveAIAnalysis` | 实时流式输出 |
| D3-1 | ✅ 长期画像聚合 | `RecentData` 扩展 + Rust 聚合 | 成长报告可生成 |
| D3-2 | ✅ 分时曲线（按分钟画像） | `minuteCurve.ts` + `useMinuteCurve` + `GrowthTrendCard.vue` | 近 10 场补刀/死亡/参团分钟曲线可看 |
| D4-1 | ✅ AiProvider trait + Ollama | `command/ai.rs` 重构 | 本地模型可用 |
| D-测试 | ✅ schema 校验、缓存命中、provider 切换 | — | 全绿 |

> 方向 D 完成记录(2026-08-14):D-P1 结构化+磁盘缓存(D1-1..D1-3)、D-P2 阶段化 AI(D2-1/D2-2)、D-P3 画像(D3-1)、D-P4 平台化(D4-1 + 设置页「测试连接」自检)。Rust 门禁由 CI 兜底(Quality Checks win+mac 双矩阵)。详见 `.opencode-session/D-P4.md`

---

## 8. 方向 E:详情页 6 tab 追平(核心交付)

> 目标:详情页信息密度与维度对标 Akari 的 6 tab(Summary/Details/Runes/Events/Builds/Timeline)。
> **优先级排序与依赖:本方向的「高级数据」全部依赖方向 F(SGP DETAILS);LCU 能给的先做,降级方案同步落地。**
>
> **完成记录(2026-08-12):全部落地(v1.4)**。事件/时间线 tab 数据源直接走 SGP DETAILS(方向 F 已闭环);LCU 无 timeline 端点(风险项验证,已确认,见 §12 与 v1.4 变更记录)。

### E0 总体结构

现有 `MatchDetailInline.vue` 的单页长滚动(队伍分节 → 对比表 → AI)改为 **tab 容器 + KeepAlive 保活**(对照 `MatchCardDetails.vue:69-76`):

```
┌─ 详情展开层 ──────────────────────────────────────────────┐
│ [概览] [数据对比] [符文] [事件] [出装] [时间线]  [AI按钮] [收起] │
├──────────────────────────────────────────────────────────┤
│ 各 tab 独立组件(KeepAlive),数据懒加载(切到才拉)              │
└──────────────────────────────────────────────────────────┘
```

- 概览 tab = 现有队伍分节 + 对比条 + 徽章(已实现,直接移入)
- 其余 tab 按下表分两批:LCU 可做(先交付)、SGP 增强(方向 F 后)

| Tab | LCU 版(先行) | SGP 增强(方向 F) | Akari 参照 |
|---|---|---|---|
| 数据对比 | 10 人透视表:行分组 + 双 sticky + 行过滤 + hover 柱状图;数据=现有 `game_detail.participants` | 补 challenges(单杀/视野/15种ping)、超细统计 | `MatchCardDetailsTab.vue` |
| 符文 | 现有符文已展示;tab 化 + 每人卡片 | statPerks(LCU 无) | `MatchCardRunesTab.vue` |
| 事件 | LCU timeline events 降级版(击杀/建筑/特殊,无坐标) | 完整 15+ 事件流 + 地图坐标 + 击杀伤害明细 + 镀层统计 | `MatchCardEventsTab.vue` |
| 出装 | 现有 7 件展示;补技能加点(LCU `SKILL_LEVEL_UP` 事件) | 装备购买时序/撤销 | `MatchCardBuildsTab.vue` |
| 时间线 | LCU `participantFrames`(金/CS/经验,无伤害) | 伤害曲线 + 队伍均值 + 玩家筛选 | `MatchCardDiffLineChart.vue` |
| 概览 | 现有实现直接移入 tab | 不变 | `MatchCardSummaryTab.vue` |

### E1 数据对比透视表(最高价值,LCU 先行)

- **行分组**:按 `RENDER_GROUPS` 思路分「基础/击杀/伤害/经济/视野/其他」;未识别字段进 `undocumented` 兜底组(SGP 响应演进不崩 UI)
- **双 sticky**:首列(统计名)+ 表头(玩家头像,队伍色描边)固定;表头滚轮横向滚动
- **行过滤**:输入框按 key/中文名过滤,composition 感知 + debounce 250ms(LCU 版可简化:仅名称过滤)
- **hover 柱状图**:数值型行 Popover 内横向条形图(10 人对比,队伍色)
- 数据源:`game_detail.participants` 的 `Stats`(已有 kda/伤害/承伤/治疗/金/补刀/视野字段),纯前端装配,零后端改动

### E2 时间线折线(LCU 先行)

- LCU `timeline` 端点:`/lol-match-history/v1/match-details/timeline/{gameId}`?——**开发时用 codegraph 确认**:若 LCU 提供 `participantFrames`(每分钟金/CS/经验),做 3 条折线 + 玩家多选;
- 无伤害曲线时标注「LCU 数据源,伤害曲线需 SGP」
- 坐标轴:横轴分钟,纵轴归一化差值(该玩家 - 队伍均值)或绝对值,设置可切

### E3 事件时间线(LCU 先行)

- NTimeline 按分钟流式排布,事件类型筛选(击杀/建筑/特殊击杀/塔皮)
- LCU events 有 `CHAMPION_KILL/BUILDING_KILL/ELITE_MONSTER_KILL/CHAMPION_SPECIAL_KILL` + position(LCU position 为 0,标记「无坐标」或隐藏地图)
- SGP 增强(方向 F):坐标画小地图、击杀伤害明细、镀层统计

### E4 任务卡

| # | 任务 | 涉及 | 验收 |
|---|---|---|---|
| E1-1 | ✅ tab 容器改造(KeepAlive + 懒加载) | `MatchDetailInline.vue` 重构为容器 + 子 tab | 6 tab 结构可切换,状态不丢 |
| E1-2 | ✅ 数据对比透视表 | 新 `tabs/MatchDetailStatsTab.vue` + `detailsTable.ts`(行分组/过滤/渲染器) | 10 人透视表可用,过滤/排序正确 |
| E2-1 | ✅ 符文 tab 化 | 新 `tabs/MatchDetailRunesTab.vue` | 每人符文卡片(LCU 数据) |
| E3-1 | ✅ 事件 tab | 新 `tabs/MatchDetailEventsTab.vue` | LCU 事件时间线可用,类型筛选 |
| E4-1 | ✅ 出装 tab | 新 `tabs/MatchDetailBuildsTab.vue` | 技能加点 + 装备展示 |
| E5-1 | ✅ 时间线 tab | 新 `tabs/MatchDetailTimelineTab.vue` | 金/CS/经验曲线 |
| E-测试 | ✅ 行分组纯函数 + 过滤 + 事件筛选 | 单测 | `npm run test` 全绿 |

### E5 验收标准(M4)
1. 6 tab 全部可切换,展开详情秒开(≈现状,tab 内容懒加载不阻塞首屏)
2. 数据对比透视表:50 场样本任意一局 10 人全统计可看,行过滤/排序无卡顿
3. 无 SGP 时全部 tab 有 LCU 数据降级,无空白/报错
4. SGP 就绪后(SGP 增强部分)自动升级展示,无手动开关

---

## 9. 方向 F:SGP 数据源升级(详情页地基)

> 目标:打通 SGP `DETAILS` 端点(帧数据/事件流/伤害明细),让方向 E 的「高级数据」成为现实;
> 同时补深翻页(>50 场)与缓存。**现状盘点**:跨区战绩列表(SUMMARY)已闭环
> (`lcu/api/sgp.rs` `fetch_match_history_summary` + `map_sgp_to_match_history` + `command/sgp.rs` 3 命令 + 前端 Header 大区下拉)。
> 缺:DETAILS 端点、深翻页、SGP 缓存、前端 services 封装。
>
> **完成记录(2026-08-12):全部落地(v1.5)**。DETAILS 无 TTL 500 条缓存(key=platform_id:game_id)+ SUMMARY 60s TTL;跨区深翻页 `collectSgpHistoryAll`(v1.6 强化至一键无限深翻页);`services/sgp.ts` 封装齐备。

### F1 SGP DETAILS 端点(Rust)

- 新增 `lcu/api/sgp.rs` `fetch_match_detail(platform_id, game_id)`:
  - URI:`match-history-query/v1/products/lol/{platform_id}_{game_id}/DETAILS`(对照 Akari `match-history-query.ts:58-69`,腾讯 subId = platformId 即 `HN10_8537174104` 格式)
  - token:复用 `get_entitlements_access_token`(DETAILS 用 entitlements)
  - 返回:`{ metadata, json: { endOfGameResult, frameInterval, frames[], participants[] } }`
- **帧结构** `DetailedFrame`:
  ```rust
  struct DetailedFrame {
      timestamp: i64,                        // 毫秒
      events: Vec<DetailedEvent>,            // 击杀/建筑/精英怪/技能加点/装备购买…
      participant_frames: HashMap<i32, FrameStats>, // participantId → 每分钟统计
  }
  struct FrameStats {
      current_gold, total_gold, gold_per_second, level, xp,
      minions_killed, jungle_minions_killed,
      position: { x, y },                    // 地图坐标(SGP 独有)
      damage_stats: { total_damage_done_to_champions, damage_taken, … }, // SGP 独有
  }
  ```
- **事件类型**(按 Akari `frames.ts` 的 `DetailedGameEventType` 枚举裁剪):CHAMPION_KILL(含 victimDamageDealt/Received 伤害明细)、CHAMPION_SPECIAL_KILL(一血/多杀/团灭)、BUILDING_KILL(塔/水晶)、ELITE_MONSTER_KILL、TURRET_PLATE_DESTROYED、ITEM_PURCHASED/SOLD/UNDO、SKILL_LEVEL_UP、WARD_PLACED、GAME_END
- **serde 容错**:字段缺失/default(腾讯响应随版本演进,宁可 null 不可 panic);`position` 缺失时(LCU 源)置 `None`
- 后端 command:`get_sgp_match_detail(region, game_id)` → 原始 `Value` 或类型化结构(先 Value,方向 E 前端消费时再定型,避免盲猜字段——沿用 `sgp.rs` 模块注释的既有策略)

### F2 深翻页(>50 场)

- SGP SUMMARY 支持 `startIndex/count` 无限翻页(现有 `fetch_match_history_summary` 已透传,只差前端):
- `MatchHistory.vue` 跨区分支:「收集更多」改为向后端追加拉取(现 `nextPage` 纯切片 50 场);记录 `lastStartIndex`,翻页即 `beg_index = 已加载数`
- 后端:`get_sgp_match_history_by_name` 已有 `beg_index/count` 参数,无需改;**注意去重**(SGP 翻页可能重叠),前端按 `gameId` 合并

### F3 SGP 缓存

- 列表:参照 `MATCH_HISTORY_CACHE`(`lcu/api/match_history.rs:127`)为 `(platform_id, puuid, start, count)` 建 moka(60s TTL 防串区,key 带 platform_id)
- 详情:复用 `GAME_DETAIL_CACHE`(`lcu/api/game_detail.rs:64`,key=gameId 天然跨源)或独立 `SGP_DETAIL_CACHE`(无 TTL,max 500)
- 前端:`services/sgp.ts` 新建,照 `rank.ts` 模块级缓存模式

### F4 段位/胜率跨区(可选,后置)

- 现状:跨区查询段位/胜率/标签均置默认(`usePlayerRecordData.ts`);Akari 用 `leagues-ledge` 端点(注释「无法跨区」)且 SGP rankedStats 跨区行为存疑
- 先不接;若用户反馈需要,再评估 `leagues-ledge/v2/rankedStats/puuid/{puuid}` 真机验证

### F5 任务卡

| # | 任务 | 涉及 | 验收 |
|---|---|---|---|
| F1-1 | ✅ DETAILS 端点 + 帧/事件结构 | `lcu/api/sgp.rs`、`lcu/util/http.rs`(如有需要) | 真机/样例 JSON 可解析;serde 容错单测 |
| F1-2 | ✅ command `get_sgp_match_detail` | `command/sgp.rs` | invoke 返回帧数据 |
| F2-1 | ✅ 跨区深翻页 | `MatchHistory.vue` | 「收集更多」跨区追加,gameId 去重 |
| F3-1 | ✅ SGP 缓存(moka) | `lcu/api/sgp.rs` | 重复查询 0 网络请求 |
| F4-1 | ✅ services/sgp.ts 前端封装 | `services/sgp.ts`(新) | 复用现有调用点 |
| F-测试 | ✅ 帧解析容错、翻页去重 | — | `cargo test` 全绿 |

### F6 验收标准(M5)
1. `get_sgp_match_detail` 真机返回帧数据,事件流/坐标/伤害明细字段齐全
2. 跨区翻页超过 50 场无重复、无空洞
3. 重复查询命中缓存,断网后详情页高级数据仍可显示(已缓存局)
4. 方向 E 各 tab 在 SGP 源下展示高级数据

---

## 10. 实施里程碑与验收标准

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

| 里程碑 | 范围 | 预计工作量(相对) | 阻塞 | 状态 |
|---|---|---|---|---|
| M0 | 方向 A 全量 | 1 | — | ✅(v1.1) |
| M1 | 方向 B 全量 | 3(最大,含 UI 打磨) | M0 | ✅(v1.2/v1.2.1) |
| M2 | 方向 C 全量 | 1.5 | M0(M1 仅影响展示位) | ✅(2026-08-13,降级纯 PUGG) |
| M3 | 方向 D 全量 | 2.5(分 P1..P4 交付) | M0 | ✅(v1.6/v1.6.1/v1.6.3) |
| M4 | 方向 E 全量 | 2.5(LCU 先行,SGP 增强后接) | M0;高级数据依赖 M5 | ✅(v1.4) |
| M5 | 方向 F 全量 | 1.5 | M0(M4 的 SGP 增强部分) | ✅(v1.5) |

**每里程碑完成即发一次 commit**(遵循仓库 Conventional Commits,见 CONTRIBUTING.md / CLAUDE.md 质量门禁:`npm run check` 全绿才可提交)。

---

## 11. 技术决策记录(ADR)

| ADR | 决策 | 理由 | 反方(保留) |
|---|---|---|---|
| A1 | 详情就地展开,弃独立窗口 | 性能根因;Akari 已验证 | 弹窗可多局对比查看(可通过展开层"固定多开"替代,后置) |
| A2 | 段位不再逐人实时查 | LCU rank 慢;数据随列表附带 | 段位非"打这局时"的局限仍在(tooltip 明示) |
| A4 | Rust 侧聚合一次 IPC | IPC 次数 = 延迟 | Rust 侧并发实现成本(用 `tokio::join!` 可控) |
| B2 | 左侧 sticky 自实现 | 依赖轻;复杂探针(如 Akari)暂不需要 | 后续若需悬浮/多列再评估库 |
| C1 | PUGG 优先于 OP.GG | 国服数据、零外部依赖、样本即玩家自己 | 小样本(<5 场)降级到 OP.GG |
| D-P1 | 强制 JSON 输出 + schema | 渲染确定性、可校验、防幻觉数字 | 文案自由度下降(可接受) |
| D-P2 | AI 阶段化走既有流式基建 | 复用 Channel/重试/看门狗 | 对局中触发频率需限流(prompt 节流 + 状态机) |
| E1 | tab 容器 + KeepAlive + 懒加载 | 展开秒开(内容懒加载)、切换保状态 | 多 tab 内存占用(有限,可接受) |
| E2 | LCU 先行、SGP 增强 | 无 SGP 也全部可用;SGP 就绪自动升级 | 部分 tab 两套数据路径(前端按 source 分支) |
| F1 | DETAILS 先返回原始 Value | 腾讯响应未定型,避免盲猜字段 | 前端消费时再定型(方向 E 落地) |
| F2 | SGP 翻页前端合并去重 | 后端无需改,gameId 天然唯一 | 跨页重叠时网络浪费(可容忍) |
| F3 | SGP 缓存 key 带 platform_id | 防串区(LCU 缓存 key=puuid 只因 LCU 单区) | 缓存条数翻倍(8 大区,可接受) |

---

## 12. 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| **LCU list 接口只返 50 场窗口(`MAX_CACHE_END`)** | 趋势条/聚合样本上限 | 跨区已由 collectMode 解除(「收集全部」无限深翻页, 2026-08-14);LCU 路径明示"仅近 50 场" |
| OP.GG 站改版破坏解析 | C2 失效 | 增益性功能,失败仅影响推荐来源标注;C1 PUGG 兜底 |
| 就地把 10 人对局表塞进 Drawer 的宽度不足 | B/A UI 挤 | 抽屉 min-width 1360 + 顺滑滚动(现有 MatchDetail.vue 版心 1360 经验复用) |
| AI 结构化输出偶发非法 JSON | D-P1 | 已有 json_object + 重试;前端解析失败回退 markdown 渲染 |
| 对局中 AI 触发过频烧 token | D-P2 | 状态机节流:同一对局同类型诊断最高 1 次/3min |
| 重构破坏既有用户习惯(翻页→滚动) | B | 保留"上一页/下一页"双模式入口 |
| codegraph 索引过期 | 全部 | 每次改动后 `codegraph sync`,开发生效快 |
| **SGP DETAILS 端点 URL/字段随腾讯版本变动** | E 高级数据失效 | DETAILS 返回原始 Value + serde 容错(default);对照 Akari 客户端定期校验;失效时 LCU 降级仍在 |
| **SGP token 401 轮换** | F1 请求失败 | 每次请求前重取 token(已实现);401 时重取重试一次 |
| **LCU timeline 端点可能不存在/字段不足** | E2 时间线 tab 数据不足 | 开发时 codegraph 确认;不足则时间线 tab 标注「SGP 增强」并先行展示金/CS(LCU participantFrames 若有) |

---

## 13. 参考:Akari 对标文件索引

> 仅作思路参照,不照搬代码(双方技术栈不同)。

| 我们的需求 | Akari 参照文件 | 借鉴点 |
|---|---|---|
| 就地展开 | `renderer-shared/components/match-card/MatchCard.vue` | isExpanded + KeepAlive 模式 |
| 紧凑左栏 | `main-window/views/player-tabs/.../PlayerTab.vue` + `StickyBox` | 双栏布局、sticky 探针 |
| 英雄池聚合 | `champion-analysis/ChampionAnalysisContent.vue` + `PlayerInfoCardChampionUsage.vue` | 胜率 ring、AkariScore、hover 浮层 |
| 筛选 | `match-history-filters/combinator-*` | 谓词组合思想(我们只做简单版:胜负/时间/英雄/模式) |
| 出装符文 | `src-opgg-window/opgg/widgets/OpggChampionRunes.vue` / `OpggChampionBoots.vue` / `OpggChampionSkills.vue` | 展示形态(10 格装备格/符文树) |
| 收集模式 | `match-history-init-param-collect.ts` | ✅ SGP 分批收集已落地:跨区「收集全部」`collectSgpHistoryAll`(2026-08-14) |
| 详情 6 tab 容器 | `match-card/MatchCardDetails.vue` | TabSwitch + KeepAlive + 条件 tab + watchEffect 回退 |
| 数据对比透视表 | `match-card/tabs/MatchCardDetailsTab.vue` + `utils/details-table.ts` | 行分组/双 sticky/行过滤/渲染器/undocumented 兜底组 |
| 事件时间线 | `match-card/tabs/MatchCardEventsTab.vue` | NTimeline + 类型/英雄筛选 + 地图位置/伤害明细 Popover |
| 时间线折线 | `match-card/tabs/timeline/MatchCardDiffLineChart.vue` | 指标 radio + 队伍均值 + 玩家多选控制面板 |
| 出装/技能加点 | `match-card/tabs/MatchCardBuildsTab.vue` | 技能加点序列(Q/W/E/R,EVOLVE 标记)、装备购买时间点 |
| 符文页 | `match-card/tabs/MatchCardRunesTab.vue` | 每人卡片 + style 配色 ring + statPerks |
| 击杀伤害明细 | `match-card/widgets/VictimDamageDetails.vue` + `DamageBarWithPopover.vue` | 伤害来源物理/魔法/真实分解条 |
| SGP DETAILS 客户端 | `shared/http-api-axios-helper/sgp/match-history-query.ts` | DETAILS 端点路径/参数、帧结构 |
| SGP 帧数据 adapter | `shared/data-adapter/match-history/frames.ts` | 帧类型守卫、SGP 独有字段判定 |
| SGP 双源决策 | `shared/data-adapter/source-selection.ts` | 跨区强制 SGP、同区可 fallback、token 未就绪 wait |

---

## 附:文档维护约定

- 本文档路径: `rank-analysis/docs/superpowers/specs/2026-08-11-akari-optimization-design.md`
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
| v1.2.1 | 2026-08-11 | **M1 数据流收敛 + B-测试单元部分**:MatchHistory 改为 50 场一次拉取 + 客户端四维筛选(模式/英雄/胜负/时间窗口)与 10 条/页切片,列表/趋势条/英雄池同源;"收集更多"改页内下一页。新增 MatchHistory.data.spec.ts(13 用例:分页/筛选/空态/复位/趋势同源/英雄池上抛/hover 事件链/趋势定位与就地展开/详情抽屉)。B-测试任务卡单元部分 ✅,分辨率与 10 场 ≤1s 手工验收等 exe 打包后执行 |
| v1.2.2 | 2026-08-12 | 新增 §5.5 对标结论:当前 UI vs Akari 界面示意图(ASCII)与 UX/UI 差距分析表(8 项,含优先级建议)。纯文档变更,无代码改动 |
| v1.3 | 2026-08-12 | 新增方向 E(详情页 6 tab 追平:tab 容器/数据对比透视表/符文/事件/出装/时间线,LCU 先行 + SGP 增强)与方向 F(SGP 数据源升级:DETAILS 端点/深翻页/缓存);里程碑新增 M4/M5;ADR/风险/参考索引同步扩充。基于对 Akari 详情页源码拆解(6 tab 能力矩阵:LCU 可做 vs SGP 独有) |
| v1.4 | 2026-08-12 | **M4 完成(方向 E 全部落地)**:E1-1 tab 容器(MatchDetailInline 重构为固定 header + 6 tab KeepAlive,新增 matchDetailContext provide/inject 共享数据面,概览移入 SummaryTab);E1-2 数据对比透视表(detailsTable.ts 21 行×6 组纯函数 + StatsTab 过滤/hover 条形/best 高亮,12 单测);E2-1 符文 tab(每人卡片:基石+主副系风格,海克斯模式提示);E3-1 事件 tab(SGP DETAILS 事件流时间线,类型筛选+击杀伤害明细 tooltip,eventsTable.ts 7 单测);E4-1 出装 tab(装备 7 槽/强化槽 + SKILL_LEVEL_UP 加点序列);E5-1 时间线 tab(自绘 SVG 金/CS/经验折线,指标切换+玩家多选,timelineData.ts 8 单测)。关键决策:LCU 无 timeline 端点(风险项验证),事件/时间线数据源直接走 SGP DETAILS(方向 F 已落地);SGP 详情经 context 懒加载共享 |
| v1.5 | 2026-08-12 | **M5 完成(方向 F 收尾)**:F3-1 SGP 缓存——DETAILS 无 TTL(500 条,key=platform_id:game_id 防串区) + SUMMARY 60s TTL(key 含大区/分页),两 fetch 先查缓存(缓存行为单测×2);F1/F2/F4 已在 4ecd4e4 落地(DETAILS 端点+serde 容错、跨区深翻页 gameId 去重、services/sgp.ts 前端封装+局级缓存)。前端 844 测试全绿;Rust 门禁由 GitHub Actions 兜底 |
| v1.6 | 2026-08-14 | **M3 完成(方向 D 全量)**:D-P1 结构化复盘+磁盘缓存+D-P2 阶段化 AI(D2-2 含 C4 出装诊断)+D-P3 用户画像+D-P4 平台化(provider 抽象/测试连接按钮)——见 `.opencode-session/D-P4.md` 与 `.opencode-session/D3-1.md`。**collectMode 落地(风险清单解除)**:跨区「收集全部」一键无限深翻页(`collectSgpHistoryAll`,gameId 去重/上限 500/可取消续收/切换玩家作废),趋势条与英雄池样本解除 50 场窗口;服务单测 12 例 + 组件验收 4 例(含真实 UX bug 修复:naive-ui `loading` 吞 click,取消交互改标签状态承载)。全量 vitest 997/997,CI run `31772175058` 全绿 |
| v1.6.1 | 2026-08-14 | **D-P3 补全(分时曲线)**:趋势卡新增「分时曲线」节——SGP DETAILS 帧流 → 本人逐分钟累计补刀(含野怪)/累计死亡/参团击杀 → 跨近 10 场按在场局数平均(`minuteCurve.ts` 纯函数 11 单测);懒加载展开才串行拉详情、generation 防串(`useMinuteCurve` composable 6 单测);三条迷你 SVG 折线 + 空态降级;接线 MatchHistory `games-change` → Record → UserSidePanel → 趋势卡。全量 vitest 1070/1070,CI run `31810121321` 全绿 |
| v1.6.2 | 2026-08-14 | **符文页去 SGP 依赖 + 时间线/事件失败态**:符文 tab 完整页落地——Rust `Participant.perks` 透传(LCU match-details 与 SGP match-v5 同构,serde 单测×2),前端渲染主系 3 符文 + 副系 2 符文 + 属性碎片,删除误导性「完整符文页需 SGP」提示(LCU 自带完整符文,该提示永远无法兑现);时间线/事件 tab:loadSgpDetail 区分失败(null→error)与成功无数据,失败态新增重试按钮,修正「LCU 战绩无 participantFrames」误导文案(同区详情同样走 SGP DETAILS 端点)。前端单测 6 例;全量 vitest 1076/1076;CI run `31815031940` 全绿(win+mac 双矩阵,Rust clippy/单测全过) |
| v1.6.3 | 2026-08-14 | **成长报告接入分时画像(D-P3 完善)**:`summarizeMinuteCurve` 从场均分钟曲线提炼确定性特征(15/25 分钟累计补刀锚点、15 分钟前与全场累计死亡、死亡集中段=累计增速最快≤3 分钟、参团活跃段=每分钟参团击杀峰值、场均参团击杀/分钟)——原样而非长数组喂 LLM;生成报告前曲线未加载则先串行拉取(SGP 帧流,失败降级不带画像不阻塞报告);prompt 新增「分时画像」事实块(引用禁止改写),纪律区由「没有数据的维度(如分时曲线)一律不分析」改为「未提供的维度一律不分析」。单测 10 例(summarize 4 + prompt 3 + 组件 2 + 透传 1);全量 vitest 1086/1086;CI run `31818136851` |
| v1.6.4 | 2026-08-15 | **战绩行参团率修复 + 行卡增强**:①参团率恒 0% 根因——Rust `calculate()` 算了金/伤/承/治占比却从未填充 `stats.group_rate`,现按同队总击杀补写((kills+assists)/teamKills,CHERRY 按 subteam 与 MVP 评分同分母,上限 100%,分母 0 保持 0)→ 前端战绩行不再恒显示 0%。②行卡增强:CS/分钟(含野怪,时长异常降级 0.0)、召唤师技能两枚小图标(头像左上竖排,MatchHistory 已预载 spell 资源)、模式短名(单双/灵活/极地/斗魂…未知 queueId 退回 queueName 前 4 字)、时长 hover 显示对局日期(MM-DD HH:mm)。新增 RecordCard 专属单测 9 例,前端全量 vitest 1095/1095;Rust 单测+2(参团率 100%/94% 截断与分母 0),CI run `31853244796` 全绿(win+mac 双矩阵) |
| v1.7 | 2026-08-17 | **文档同步收尾(无代码改动)**:①补 §3 里程碑总览表 M4/M5 行(此前 v1.3 已新增里程碑但总览表未同步),并为 M0-M5 全部加「状态」列标记 ✅(对应实现版本);②头部「计划版本」从 v1.3 对齐到 v1.7;③方向 E 任务卡 E1-1..E5-1/E-测试 补 ✅(v1.4 已全部落地);④方向 F 任务卡 F1-1..F4-1/F-测试 补 ✅(v1.5 已全部落地,codegraph 复核 `fetch_match_detail`/`SGP_DETAIL_CACHE`/`collectSgpHistoryAll`/`services/sgp.ts` 均在);⑤§10 里程碑定义表补完成状态列 |