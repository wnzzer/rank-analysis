# 英雄榜（OP.GG 独立页）设计文档

日期：2026-09-16
后续：`2026-09-17-champion-tier-list-v2-design.md` 推翻了本文的「全部分路」与表格外观两处，其余仍然有效。
分支：feat/rune-recommend（数据层已在前两期落地，见 `2026-09-15-rune-recommend-design.md` / `2026-09-16-rune-presets-design.md`）

## 背景与目标

前两期把 OP.GG 数据接了进来，但只在选人期的推荐栏里露出：数据都有了，想「赛前看看这版本谁强」却没有入口。上一份 spec 把英雄榜列为非目标、另开一份，就是这一份。

目标：新增一个独立页面，**以榜单为主**，回答「这个版本（这个段位、这条路）谁强」，点某一行可以拉出抽屉看这个英雄的符文 / 出装 / 加点 / 召唤师技能 / 苦手对位，并能把某套符文**记成方案**（下次选人期自动用）。

## 非目标

- **不做大乱斗榜**。本期只做排位；大乱斗列表数据虽然有（无分路、无 Ban 率、不分段位），但交互上要砍掉三个筛选维度，等排位榜跑顺了再说。
- **抽屉里不写客户端符文页**：只提供「☆ 记住」（存成方案）。不在选人期时写页会把用户当前选中的符文页换掉，收益不值当。
- 不做出装写入、不做自建榜单 / 收藏、不做跨版本对比曲线（趋势只用 OP.GG 白送的上版本排名）。
- 不自己算胜率数据（口径同前两期：DAU 不足以统计显著）。

## 交互设计

### 入口

侧边栏第四项「英雄」（现有三项：战绩 / 对局 / 设置），路由 `/Champions`。

### 工具栏

```
英雄榜   [全部分路 ▾] [翡翠以上 ▾]  搜索 英雄名 / 别名___        OP.GG 16.18 · 刷新
```

- 分路筛选：全部 / 上单 / 打野 / 中单 / 下路 / 辅助。
- 段位下拉：复用 `useOpggTier`（与对局页、设置页同一个配置键 `settings.opgg.tier`；切换会重拉快照，失败回滚并提示）。
- 搜索：英雄名 / 称号 / 别名，复用 `utils/champion.ts` 的 `filterChampionFunc` 口径。
- 右侧：数据版本（`get_opgg_status` 的 patch；`stale` 时标「数据滞后」）+ 刷新（`update_opgg_data('ranked')`）。

### 榜单表格

`n-data-table`（设置页已在用，自带列排序）。列：

| 列 | 说明 |
|---|---|
| # | 序号（当前排序下的行号） |
| 英雄 | 头像 + 中文名 |
| 分路 | 上单 / 打野 / 中单 / 下路 / 辅助 |
| T 级 | T1~T5，颜色分级 |
| 胜率 / 登场率 / Ban 率 | 百分比，可点列头排序 |
| 版本趋势 | 上版本同分路排名 - 本版本排名：↑n（变强）/ ↓n / →（持平）/ —（无上版本数据） |

- **默认排序**：T 级升序，同级按 OP.GG 的同分路排名升序。
- **「全部分路」时每个英雄只出现一次**，取它的主分路（`is_main_position`）那条；选了具体分路则只看该分路的全部英雄。
- 排序、筛选、搜索全部在前端做：整份榜单约 170 英雄 × 分路 ≈ 400 行，一次取齐，点列头即时重排，不来回请求。

### 详情抽屉

点行 → 右侧 `n-drawer`：

1. 头部：英雄头像 + 名字 + 分路 + T 级 / 胜率 / 登场率 / Ban 率（即该行数据）。
2. 符文：至多 3 套，每套「主系 · 基石 / 副系」+ 出场率 · 胜率 + 完整 9 个符文图标；每套右侧 `☆ 记住`，已是本英雄本分路的方案时显示 `★ 已记住`（再点取消）。
3. 出装：出门装 / 鞋 / 核心三件套 / 后期备选，各带出场率。
4. 加点顺序：15 级顺序 + 出场率。
5. 召唤师技能：两两组合 + 出场率。
6. 苦手对位：该英雄该分路最难打的前三个对手（现有 `counters` 数据，胜率 + 样本量）。

数据走已有的 `get_champion_build`（内存 / 磁盘缓存，第二次点开秒开）与 `get_lane_counters`。抽屉内的「记住」复用 `useRunePresets`，分路取该行的分路。

### 空态与边界

- 快照未就绪（启动预热失败 / 离线）→ 整页「数据未就绪」+ 刷新按钮，不渲染空表格。
- 某英雄详情拉不到 → 抽屉只显示头部统计与苦手，符文 / 出装区块给一行「数据未取到」，不报错、不阻塞。
- 搜索无结果 → 表格空态文案「没有匹配的英雄」。
- 段位切换失败 → 复用现有回滚 + toast（`useOpggTier`）。

## 后端设计

### 新命令 `list_champion_metas`

```rust
#[tauri::command]
pub async fn list_champion_metas(
    mode: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChampionMeta>, String>
```

- 位置：`command/opgg.rs`（与 `get_champion_meta` / `get_lane_counters` 同模块，读同一份快照）。
- 行为：`validate_mode` 后把快照里的 `champions: HashMap<i32, Vec<ChampionMeta>>` 摊平返回；快照缺失返回空 Vec（与既有「数据缺失是常态降级」口径一致，不报错）。
- 不做过滤 / 排序 / 分页：那些都在前端做（见上）。

其余复用：`update_opgg_data` / `get_opgg_status` / `get_champion_build` / `get_lane_counters`，均已存在。

## 前端设计

- 路由 `/Champions` → `views/Champions.vue`；`SideNavigation.vue` 加一项。
- `views/Champions.vue`：页面壳 + 工具栏 + 空态，持有筛选 / 搜索 / 选中行状态。
- `components/champions/ChampionTierTable.vue`：表格（列定义、排序、行点击 emit）。
- `components/champions/ChampionDetailDrawer.vue`：抽屉（符文 / 出装 / 加点 / 技能 / 苦手 + 记住）。
- `components/champions/championTier.ts`（纯函数，同目录测试）：
  - `toRows(metas, position, names)`：按分路过滤 / 全部分路取主分路，拼上中文名
  - `filterRows(rows, keyword)`：名字 / 称号 / 别名匹配
  - `sortRows(rows, key, order)`：默认 T 级 + 排名，其余按列
  - `trendOf(rank, rankPrevPatch)`：`{ dir: 'up' | 'down' | 'flat' | 'none', delta }`
- `services/opgg.ts` 加 `listChampionMetas(mode)`（失败吞掉返回 `[]`，与该模块既有惯例一致）。
- 复用：`useOpggTier`、`useRunePresets`、`useRecordAssets`（符文 / 装备名字与图标）、`services/ai/champion-names`（中文名）、`utils/champion.filterChampionFunc`。

## 测试

Rust：

- `list_champion_metas`：非法模式报错；快照缺失返回空；摊平后条数 = 各英雄分路条数之和。

前端（Vitest）：

- `championTier.ts`：全部分路取主分路（多分路英雄只出一行）、指定分路过滤、搜索命中三种名字、排序（默认 T 级 + 排名；按胜率降序）、趋势四种取值。
- `ChampionTierTable.vue`：行渲染（头像 / T 级 / 百分比 / 趋势）、点行 emit、空态文案。
- `ChampionDetailDrawer.vue`：四个区块渲染、详情拉不到时的降级文案、「☆ 记住 / ★ 已记住」切换写配置。
- `Champions.vue`：快照缺失时渲染「数据未就绪」而不是空表格；段位切换触发重拉。

## 实施拆分建议

1. 后端 `list_champion_metas` + `services/opgg.ts` 封装 + 测试。
2. `championTier.ts` 纯函数 + 测试。
3. `Champions.vue` + `ChampionTierTable.vue` + 路由 + 侧边栏 + 测试（到这一步榜单已可用）。
4. `ChampionDetailDrawer.vue`（复用 championBuild / counters / presets）+ 测试。
5. 门禁 + dev 版截图验收（mock 数据，不写客户端 / 不写配置）。
