# 符文方案（记住 + 多方案切换）设计文档

日期：2026-09-16
分支：feat/rune-recommend（在「英雄符文推荐 + 选人期应用」之上迭代，前作见 `2026-09-15-rune-recommend-design.md`）

## 背景与目标

上一期把 OP.GG 推荐符文做进了选人期推荐栏，能一键 / 自动写成临时符文页。真机看过界面后的两点反馈：

1. **能不能记进自动化，下次自动应用**——同一个英雄同一条路，用户往往固定用某一套，不想每局再挑。
2. **交互偏单薄**——推荐栏只露第一套构筑，OP.GG 其实给了 3 套，用户看不到也选不了。

本期目标：

- 推荐栏改成**多方案卡片**：OP.GG 至多 3 套 + 用户记住的方案，点选切换，应用 / 记住作用于选中的那套。
- 新增**符文方案**：按「英雄 + 分路」记住一套符文，自动应用时优先写它；没有记住的英雄可选用 OP.GG 推荐兜底。
- 设置页的自动应用改成与「自动选择英雄」同构的独立卡片：总开关 + 我的方案列表 + 兜底策略。

## 非目标

- **不记住客户端里手动改过的符文页**。本期只能记住 OP.GG 给出的方案；数据结构预留 `source` 字段，将来加「记住当前页」不改 schema。
- **不做独立 OP.GG 英雄榜页**。前作 spec 已列为非目标，另开 spec；本期的数据层它可直接复用。
- 不写召唤师技能 / 出装（前作非目标不变）。
- 不改写入层：仍是「原地改写自己的 (RA) 临时页、绝不 DELETE」。

## 交互设计

### 推荐栏

```
┌ 推荐符文 ────────────────────────────────────────────────────────────────┐
│ [★ 我的 · 征服者]  [▣ 致命节奏 32%·46%]  [迅捷步法 6%·48%]  [致命节奏 5%·52%] │
│  核心装 ⚔⚔⚔ · 2.5万场 · 版本 16.18                   [应用符文] [★ 记住]   │
└──────────────────────────────────────────────────────────────────────────┘
```

- **方案卡**：每张 = 基石图标 + 「主系 · 基石」+ 出场率 · 胜率。样本 `< 200` 的 OP.GG 卡变淡并标「样本少」。hover 任一张出完整 9 个符文（沿用现有浮层）。
- **我的方案**：当前「英雄 + 分路」有记住的方案时：
  - 与某张 OP.GG 卡的 9 个符文完全相同 → 不另起卡，那张 OP.GG 卡加 ★ 角标；
  - 不同（旧版本记的、或将来记的客户端自改页）→ 最前面单独一张「★ 我的」卡，不显示统计（没有样本数据）。
- **默认选中**：我的方案 → 否则第一套样本达标的 OP.GG 构筑 → 否则第一套。换英雄 / 分路时重置选中。
- **第二行**：选中方案的核心装（仅 OP.GG 方案有）、样本量、旧版本提示，右侧两个按钮。
- **应用符文**：写入**选中的那套**。样本少的卡也允许手动应用——用户主动点选即是知情选择；样本阈值只约束「默认选中」与「OP.GG 兜底的自动写入」。（放宽前作「全部低于阈值时禁用按钮」的规则。）
- **★ 记住 / ★ 已记住**：选中的那套已是本「英雄 + 分路」的方案 → 显示「★ 已记住」，再点即取消记住；否则点击把选中那套存为方案（覆盖旧的）。总开关关着时照样保存，toast 提示「已记住，开启『自动应用符文』后下次自动写入」。
- **自动模式**（总开关开）：
  - 算出「自动会写的方案」= 我的方案 → 否则（兜底为 OP.GG 时）第一套样本达标的 OP.GG 构筑 → 否则无。
  - 选中的正是自动方案且尚未写入 → 按钮是状态指示（锁定后自动应用 / 自动应用中…）；
  - 用户选了别的方案 → 按钮恢复为可点的「应用符文」，点了即**手动接管**：本次选人期内自动任务不再为这个英雄写入（见后端「手动接管」），避免与用户抢页；接管后任何卡都按手动模式显示；
  - 没有自动方案（兜底为「不写」且没记住）→ 与手动模式相同。
- **无 OP.GG 数据但有我的方案**：推荐栏照常渲染，只有「★ 我的」一张卡。两者都没有才整条不渲染。

### 设置页「自动应用符文」卡片

从「基本设置」里挪出来，与「自动选择英雄」卡片同构：

```
┌ ✨ 自动应用符文 ─────────────────────────────── [●──] ┐
│ 我的符文方案（先匹配这里）                               │
│   [亚索] 亚索 · 中单     ⚙ 精密 · 致命节奏 / 坚决   [删除] │
│   [亚索] 亚索 · 大乱斗   ⚙ 精密 · 征服者 / 主宰     [删除] │
│   （空）还没有记住的方案，选人期在推荐栏点「★ 记住」添加     │
│ 没记住的英雄：(•) 用 OP.GG 推荐   ( ) 不自动写            │
└───────────────────────────────────────────────────────┘
```

- 总开关沿用 `settings.auto.applyRunesSwitch`（上一期新增、尚未发布，改位置不涉及迁移）。开关关时卡片内容降透明度（沿用 `.rules-inactive`），仍可编辑。
- 列表按保存时间倒序；删除即时生效并落盘。
- 分路文案：top 上单 / jungle 打野 / middle 中单 / bottom 下路 / utility 辅助 / none 大乱斗。

## 数据模型

### 配置键

| 键 | 形状 | 缺省 | 说明 |
|---|---|---|---|
| `settings.auto.applyRunesSwitch` | bool | false | 总开关（沿用） |
| `settings.auto.runePresets` | `RunePreset[]`（经 `putConfigByIpc` 存为 `{value: [...]}`） | `""` → 空 | 我的符文方案 |
| `settings.auto.runeFallback` | `"opgg"` \| `"none"` | `""` → `"opgg"` | 没记住的英雄用什么兜底 |

`runeFallback` 用字符串而非布尔：`config.rs` 的 `zero_value_for_key` 对 `*Switch` 键缺省读出 `false`，而本项默认要「用 OP.GG」。两个新键都进云同步（非设备级数据，不登记 `BACKUP_BLACKLIST`）——换设备方案跟着走。

### `RunePreset`（Rust / TS 同构，snake_case）

```rust
pub struct RunePreset {
    pub champion_id: i32,
    /// LCU 小写分路 top/jungle/middle/bottom/utility；大乱斗 "none"
    pub position: String,
    pub primary_style_id: i32,
    pub sub_style_id: i32,
    pub primary_perk_ids: Vec<i32>, // 4
    pub sub_perk_ids: Vec<i32>,     // 2
    pub stat_mod_ids: Vec<i32>,     // 3
    /// 保存时刻（unix 毫秒），列表排序用
    pub saved_at: i64,
    /// 来源：本期恒为 "opgg"；预留 "client"（记住客户端当前页）
    pub source: String,
}
```

- 唯一键 `(champion_id, position)`：记住即覆盖同键旧方案。
- 三段 id 数量不是 4/2/3 的条目解析时丢弃（与 `opgg::detail` 解析口径一致）。
- 与 `RuneBuild` 互转：统计字段（play / win / pick_rate）写 0。

## 后端设计

### 新模块 `command/rune_preset.rs`

与 `command/rule_config.rs` 同类（规则数据 + 纯函数，无命令）：

- `parse_presets(value: &Value) -> Vec<RunePreset>`：容忍 `{value: [...]}` / 裸数组 / 空串 / Null，形状错误 warn 后返回空（对齐 `automation.rs` 的 `parse_pick_rules_value`）。
- `parse_fallback(value: &Value) -> Fallback`：`"none"` → `Fallback::None`，其余（含空串）→ `Fallback::Opgg`。
- `find_preset(presets, champion_id, position) -> Option<&RunePreset>`。
- `choose_auto_rune(preset, build, fallback) -> Option<RuneBuild>`：我的方案 → 兜底为 Opgg 时 `build.auto_rune()` → None。

### `command/champion_build.rs`

拆出目标解析 `resolve_build_target(state, champion_id, game_mode, position) -> Option<BuildTarget>`（现 `resolve_champion_build` 内部那段），供自动任务在**不拉 OP.GG 的情况下**先算出匹配方案用的分路（大乱斗 none / 分配分路 / 主分路兜底）。

### `apply_runes` 任务

每 tick 在现有流程上改为：

1. 同前：非选人期清空状态；定位自己；只认已锁定英雄；取 gameMode。
2. `resolve_build_target` 得到分路 → 读 `runePresets` / `runeFallback` → `find_preset`。
3. 有方案 → 直接用；无方案且兜底 Opgg → `resolve_champion_build` → `auto_rune()`；否则跳过。
4. **手动接管**：若本次选人期对该 `(champion_id, position)` 发生过手动应用 → 跳过。
5. 其余不变：内容幂等键、同内容失败最多 3 次、`rune-apply-result` 事件。

### 手动接管（新增）

- `rune_page.rs` 新增 `MANUAL_OVERRIDE: Mutex<Option<(i32, String)>>`；命令 `apply_rune_page`（仅手动路径）成功后记下 `(champion_id, position)`。
- 与 `LAST_APPLIED` 同生命周期：离开选人期由 `game_state_monitor` 与 `apply_runes` 清空。
- 理由：自动任务按「内容幂等」判断，用户手动写了别的方案后，自动方案与 `LAST_APPLIED` 不同，下一 tick 就会把页写回去——与用户抢方向盘。沿用 BP「你已接管，本阶段不再自动」的先例。
- `get_last_applied_rune` 的返回值追加 `manual_override: bool`（当前英雄 + 分路是否已被手动接管）。前端据此在接管后不再显示「自动应用中…」——否则推荐栏重新挂载后，用户切回自动方案那张卡会看到一个自动任务不会兑现的承诺。

## 前端设计

- `types/championBuild.ts`：新增 `RunePreset`、`RuneFallback = 'opgg' | 'none'`、`RuneOption`（`{ key, rune, source: 'preset' | 'opgg', starred, sufficient, stats? }`）。
- `composables/useRunePresets.ts`：与 `useRules.ts` 同形——`presets` / `fallback` / `reload()` / `remember(preset)` / `forget(championId, position)`，读写走 `getConfigByIpc` / `putConfigByIpc`。
- `useChampionBuild`：
  - 入参新增 presets / fallback（或内部组合 `useRunePresets`）；
  - 新增 `options`（方案卡列表，含合并 ★ 逻辑）、`selectedKey` / `selected`、`autoTarget`；
  - `apply()` 写选中方案；`toggleRemember()`；
  - 「已应用」判定改为比较选中方案与后端写入记录；
  - 匹配方案用的分路：`build.position` → 否则大乱斗类 gameMode 为 `none` → 否则分配分路；都没有则不显示我的方案（OP.GG 与列表快照都不可用时的已知边界）。
- `BuildRecommendBar.vue`：重做为两行（方案卡行 + 信息 / 按钮行），props 改收 `options` / `selectedKey` / `autoTarget` 等，emit `select` / `apply` / `toggle-remember`。
- `components/automation/RunePresetsCard.vue`：设置页新卡片（`Automation.vue` 已近 700 行，新卡片独立成组件）；`Automation.vue` 删掉「基本设置」里的那一行，挂载新卡片。
- `services/configKeys.ts`：登记 `runePresets` / `runeFallback`。

## 边界情况

- **版本更新删了某个符文**：旧方案写入被 LCU 拒绝 → 按钮「应用失败，重试」，toast 追加「方案可能已过期，可重新记住」。
- **OP.GG 挂了**：有我的方案时推荐栏只显示「★ 我的」卡，自动任务照常写方案。
- **删掉方案**：下一 tick 起回到兜底策略；本次选人期已写入的页不回滚。
- **同英雄不同分路**：互不影响；匹配自选按主分路匹配。
- **云同步冲突**：配置整体 LWW（既有机制），两台设备同时改方案以后写为准，不做合并。

## 测试

Rust（模块内 `#[cfg(test)]`）：

- `rune_preset`：`{value:[...]}` / 裸数组 / 空串 / 坏形状解析；4/2/3 校验丢弃；`find_preset` 按英雄 + 分路（含 none）；`parse_fallback` 空串默认 Opgg；`choose_auto_rune` 四种组合（有方案 / 无方案 × Opgg / None / OP.GG 数据缺失）。
- 手动接管：记录 → 同键跳过、换英雄不跳过；离开选人期清空。

前端（Vitest）：

- `useRunePresets`：记住覆盖同键、取消记住、兜底缺省为 opgg。
- `useChampionBuild`：方案列表（含 ★ 合并与单独「我的」卡）、默认选中优先级、应用写入选中方案、切换英雄重置选中、`autoTarget` 随方案 / 兜底变化。
- `BuildRecommendBar`：方案卡渲染与选中态、样本少标注、点卡发 `select`、「★ 已记住」切换、自动模式下选中非自动方案时按钮可点、无 OP.GG 仅方案时仍渲染。
- `RunePresetsCard`：列表渲染、删除落盘、兜底单选写入 `settings.auto.runeFallback`、空态文案。

## 实施拆分建议

1. 后端：`rune_preset.rs` + `resolve_build_target` 拆分 + 自动任务接入方案 / 兜底 + 手动接管 + 测试。
2. 前端数据：类型 + `useRunePresets` + `useChampionBuild` 方案 / 选中 / 自动目标 + 测试。
3. 推荐栏重做为方案卡 + 测试。
4. 设置页 `RunePresetsCard` + 挪走旧开关行 + 测试。
5. 门禁 + dev 版截图验收（mock 会话，不写客户端）；真实选人期验证与上一期的 V5 一并做。
