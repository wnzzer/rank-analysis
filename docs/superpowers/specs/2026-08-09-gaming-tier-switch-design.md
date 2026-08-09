# 对局页 OP.GG 段位切换 + 自动 BP 空池提示

**日期**: 2026-08-09
**状态**: 待批准
**范围**: 前端 `lol-record-analysis-tauri/src/`（Gaming 页、ChampionIntelCard、opgg service、Automation 设置页）
**交付**: 单个 PR

## 背景与问题

### 问题一：段位只能在设置页改

OP.GG 段位 `settings.opgg.tier` 决定了英雄强度分级（T1~T5）、胜率、克制关系这三份数据取自哪个分段。它现在只有一个入口——设置 → 自动化 → 基本设置里的下拉（`views/settings/Automation.vue:35`）。

用户真正需要换段位的时刻是**选人期看着对局页**：想知道「我这把在钻石局这英雄什么水平」。此刻要退出对局页、进设置页、改完再切回来，中途选人计时器还在跑。

### 问题二：自动 BP 开了但什么都不会发生

自动 Ban / 自动 Pick 的开关和「规则 + 兜底池」是两个独立的配置。开关打开、但规则一条没有、兜底池也是空的时候，界面上没有任何异常信号——开关是绿的，看起来一切正常，实际整局不会有任何动作。

`bp_decision/evaluate.rs:322-338` 的兜底分支在 `pool` 为空时 `pick_best_from` 返回 `None`，`target` 为 `None`，执行侧 `apply_bp_decision` 在 `decision.target` 为 `None` 时静默返回。这个链路本身是对的（没有目标就不该动手），缺的是**告诉用户为什么什么都没发生**。

## 决策记录

| 决策点 | 结论 |
|---|---|
| 对局页段位与设置页的关系 | 共用同一份 `settings.opgg.tier`，两边同步 |
| 数据刷新的传递方式 | service 层模块级信号，不做三层 prop 传递 |
| 空池提示的实现层 | 纯前端，读页面上已有的响应式值，不新增后端命令 |
| 空池提示的判定 | 开关 ON **且** 启用中的规则数为 0 **且** 兜底池为空 |

### 为什么共用配置而不是对局页临时覆盖

自动 BP 的决策求值（`automation.rs:653` 的 `ensure_opgg_snapshot`）读的就是 `settings.opgg.tier`。如果对局页搞一份只影响展示的临时段位，就会出现「决策带上写着按翡翠局数据建议 ban 某英雄，卡片上显示的却是钻石局胜率」——同一屏两套数据，用户无法判断该信哪个。

### 为什么用 service 层信号而不是 prop

段位切换后卡片要重新取数。走 prop 需要 `Gaming.vue` → `SubteamCard.vue` → `ChampionIntelCard.vue` 三层传递一个纯粹的刷新计数器，三个组件的接口都要为一件与它们无关的事情加字段。

数据源变了是 `services/opgg.ts` 自己的事。在那里导出一个模块级 `opggRevision`，谁消费 OP.GG 数据谁把它加进 watch 依赖，组件接口不动。

## 一、对局页段位选择器

### 位置与可见性

挂在选人期横幅的 `banner-meta` 那一行（`views/Gaming.vue:119-126`），紧跟在现有的 `· OP.GG {{ patch }}` 后面。

**仅当 `opggMode === 'ranked'` 时渲染**。ARAM 快照没有段位概念（`command/opgg.rs:131` 的 `tier_ok` 对非 ranked 模式直接跳过段位判定），在那里给一个段位下拉是在承诺一个不存在的能力。

尺寸用 `size="tiny"`，横幅那行是辅助信息密度，不能被一个下拉压垮版式。

### 选项来源

段位白名单目前硬编码在 `views/settings/Automation.vue:277` 的 `TIER_OPTIONS`，与 Rust 侧 `opgg::api::VALID_TIERS` 靠注释约定同步。这次要在两个页面用，把它抽到 `services/opgg.ts` 导出，两个页面共同引用——一份来源，避免两处各写一份日后漂移。设置页改成 import，其本地定义删除。

### 切换逻辑放在哪

抽成 `composables/useOpggTier.ts`，导出 `{ tier, loading, options, switchTier }`。设置页和对局页都用它——两个入口共用一份配置，那套「写配置 → 重拉 → bump → 失败回滚」的编排也该只有一份实现。设置页现有的 `opggTier` ref 与 `updateOpggTier` 函数（`Automation.vue:276-290`）由它替换。

`switchTier` 的行为：

1. 置 `loading`，禁用下拉
2. `putConfigByIpc('settings.opgg.tier', next)`
3. `await invoke('update_opgg_data', { mode: 'ranked' })` 强制重拉快照
4. 成功：`bumpOpggRevision()`，卡片自行重取
5. 失败：回滚 `tier` 到切换前的值，弹一次 message

顺带一提，设置页现在这个 `invoke(...).catch(() => {})` 是把失败完全吞掉的，换成 composable 后设置页也一并获得失败反馈。

对局页的 `opggStatus`（横幅上的补丁号）在 `switchTier` 成功后由 `Gaming.vue` 自己刷新——那是对局页独有的展示，不进 composable。

**为什么失败要回滚显示值**：配置已经写进去了，但快照没拉到，此时卡片上显示的仍是旧段位的数据（降级链保留最后已知快照）。下拉如果停在新段位，界面就在撒谎——说的是钻石，显示的是翡翠。回滚显示值让「下拉显示的段位」和「卡片显示的数据」保持一致，配置本身留在新值不影响下次成功拉取。

## 二、opggRevision 刷新信号

`services/opgg.ts` 新增：

```ts
/** OP.GG 数据源版本号。段位切换等会让已取数据失效的操作后 +1。 */
export const opggRevision = ref(0)

/** 标记 OP.GG 数据源已变更，触发所有消费方重取。 */
export function bumpOpggRevision(): void
```

`ChampionIntelCard.vue` 把 `opggRevision` 加进现有的取数 watch 依赖里。该组件当前按 `championId` / `mode` 取 `getChampionMeta` 与 `getLaneCounters`，加上这个依赖后段位切换会触发同一条取数路径，无需新增逻辑分支。

## 三、自动 BP 空池提示

在 `views/settings/Automation.vue` 的 Pick / Ban 两张卡里各加一条提示行，位于「兜底」小标题下方、兜底池上方。

判定条件（三者同时成立）：

- 对应开关为 ON
- `rules.filter(r => r.enabled).length === 0`
- 兜底池数组为空

文案：`已开启，但没有可执行目标：规则和兜底池都是空的，本局不会自动 Ban`（Pick 卡对应改成「自动选择」）。

样式用 `--semantic-warn` 系 token，不用 error 色——这不是错误，是配置未完成。

**为什么只在两者皆空时提示**：只有规则没兜底池是完全合理的配置（「只在特定局面 ban，其余交给我自己」）；只有兜底池没规则也合理。只有两者皆空才是「开关开着但系统无事可做」这个确定的失效态。

## 四、测试

| 对象 | 用例 | 落点 |
|---|---|---|
| `services/opgg.ts` | `bumpOpggRevision` 让 `opggRevision` 递增 | `src/services/__tests__/opgg.spec.ts`（已存在，追加） |
| `useOpggTier` | 成功路径：写配置、调 `update_opgg_data`、bump 一次 | `src/composables/useOpggTier.spec.ts` |
| `useOpggTier` | 失败路径：`tier` 回滚到切换前，不 bump | 同上 |
| 空池提示判定 | 三个条件的真值组合：全空且开 → 提示；有启用规则 → 不提示；有兜底池 → 不提示；开关关 → 不提示 | 判定函数同目录 spec |

空池判定要抽成 `Automation.vue` 外的纯函数才可测，否则要挂载整个设置页。

前端测试用 Vitest。`useOpggTier` 的测试需要 mock `@tauri-apps/api/core` 的 `invoke` 与 `services/ipc` 的 `putConfigByIpc`，仓库里已有同类 mock 写法可循（见 `src/composables/useStartupDialogs.spec.ts`）。

## 五、验收

`npm run check` + `npm run test` 全绿之外，真机验证两条：

1. 选人期在对局页切段位，卡片上的 T 级徽章与胜率数字确实变化（切「黄金以上」和「大师以上」，同一英雄的胜率应有可见差异）
2. 打开自动 Ban 开关、不配任何规则和兜底池，设置页出现提示行；随便加一个兜底英雄，提示消失
