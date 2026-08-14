## Goal
- 交付「选人期对位悬浮弹窗（P1）+ 敌方已锁阵容→我方最优英雄推荐（P2）+ 协同搭档节（T6）」（spec `docs/superpowers/specs/2026-08-14-champselect-counter-hover-design.md` v1.1）；**全部任务卡 ✅，spec 已关闭**

## Constraints & Preferences
- 数据源 = LeagueAkari 逆向端点 `lol-api-champion.op.gg/api/{region}/champions/ranked/{id}/{POSITION}?tier=`（counters）+ `/synergies`（协同 UI 排 V1.1 T6）
- 弹窗要求：360px、滚动 max-height 400px、胜率/场次表头排序（默认胜率降序）、来源标注（region·tier·patch·stale）、>52% 绿 / 48-52% 中性 / <48% 红
- 现有克制 pill/段位徽章/AI prompt 不动；弹窗与 pill 并存；不接管 `bp_decision`（只读展示）
- 低段位用 `tier=ibsg`；P2 不做候选分路过滤（敌方分路恒空，跨位全量评分）
- 门禁：vitest 全量 / prettier / vue-tsc / eslint 0 errors；push fork `lnsjcr0873/rank-analysis` 触发 CI；本机无 cargo → Rust 靠 CI

## Progress
### Done
- **T1**（commit `edc9237` + 修复系列 `057928c`/`4fc4949`/`6217f10`/`aee9850`）：`src-tauri/src/opgg/intel.rs` 新模块——VALID_REGIONS 19/VALID_TIERS 10/VALID_POSITIONS 5 白名单、`lcu_to_opgg_position` 转换、parse_counters/parse_synergies、内存 moka + 磁盘缓存（12h TTL、`cache_key`/`default_path`）、`ensure_intel_impl` 降级链（内存 fresh → 磁盘 fresh → 拉取）、15 单测（fixture `intel_counters_sample.json`/`intel_synergies_sample.json`）；`opgg/mod.rs` 注册、`state.rs` 加 `opgg_intel_cache`、`command/opgg.rs` 加 `get_champion_intel` 命令、`main.rs` 注册
- **T2**（commit `c89d8f5`）：`services/counterIntel.ts`（类型/`positionToOpgg`/`sortCounters`/`formatCounterLine`/`getChampionIntel` 失败返 null/`computeBestPicks` 反查评分）+ `composables/useCounterIntel.ts`（150ms 防抖 + 模块级 Map 缓存 + revision 失效 + onScopeDispose 清理；`useBestPicks` 敌方主分路 + mainPositionCache）；22 单测
- **T3**（commit `c2119ca`）：`CounterHover.vue`（n-popover trigger="hover" 360px、n-scrollbar max-height 400px、表头排序、底栏 region·tier·patch·stale；patch 直接取 `status.patch` 不拼前缀；champion 名走 `loadChampionNames`）；ChampionIntelCard 头像在 `mode==='ranked'` 时包裹；tier 透传链 Gaming→SubteamCard→卡；11 单测
- **T4**（commit `d7ff49a`）：`BestPicksPanel.vue`（Top3 常驻条 + 点击展开 Top5、证据行"克制 X（胜率 · 局数）"、全≤0"无正面对位优势"提示、敌方 ≥2 才可见、评分柱 8-100%）；PlayerCard 头像包 CounterHover（ranked && championId>0、position=`opggMeta?.position`）；Gaming.vue 集成（`invoke` import、`allChampionIds`/`ensureChampionOptions` 懒加载候选池、`enemyLockedIds`、`showBestPicks`=ranked && ChampSelect && 候选池就绪、`bestPickCandidates` 排除 myBans/theirBans/myChampionIds/enemyLockedIds、`subteam-col` flex 列）；9 单测
- **全量门禁绿**：vitest 1039/1039；prettier 全仓绿；vue-tsc 无错误；eslint 改动文件全干净（全仓存量 131 warnings 0 errors）
- **CI 修复完成 ✅**：三轮迭代全部解决——(1) rustfmt 9 处 diff（`057928c`）；(2) clippy 编译错误×3：`counters_url` 6 占位符 5 参数、`ChampionIntel` 缺 `PartialEq`（E0369）、`lcu_to_opgg_position` lifetime（`4fc4949`）；(3) clippy lint×2：`ensure_intel_impl` too_many_arguments 8/7（`6217f10`）、`&position` needless_borrow（`aee9850`）
- **CI 全绿确认**：Quality Checks run `31795960055` success——Frontend Code Quality / Security Audit / Rust (macos) / Rust (windows) 全 ✓（rustfmt + clippy -D warnings + cargo test 全过）
- **spec 收尾**（commit `8c49342`）：任务卡 T1-T4 ✅ + 变更记录 v1.1 交付行 + 交付记录 `.opencode-session/champselect-counter.md`
- **T6 协同搭档节已交付**（commit `c4cbe4c`）：`counterIntel.ts` 加 `sortSynergies`/`formatSynergyLine` + `DEFAULT_SYNERGY_SORT`；`useCounterIntel` 加 `sortedSynergies`；CounterHover「最佳搭档」节（副标题分隔、独立排序表头、仅搭档有数据也渲染、空态条件改为对位与搭档皆空）；新增 10 测试（service 5 + composable 2 + 组件 3）；前端全量 1049/1049 绿 + prettier/vue-tsc/eslint 全干净；**CI `31797335422` success 全绿**
- **spec 关闭**（commit `6bec28a`）：任务卡 T1-T6 全 ✅ + 变更记录 v1.1 交付（终）行
- **EXE 交付件**：Build EXE (No Sign) run `31798501298` success，artifact `rank-analysis-exe`（`Rank Analysis_0.0.0_x64-setup.exe` 5.4MB，含 T1-T6 全部功能）；已下载至 `%TEMP%\opencode\exe-download\rank-analysis-exe\`

### In Progress
- (none) — T6 完成，spec 关闭

### Blocked
- 本机无 cargo：rustfmt/clippy/cargo test 全部依赖 CI 反馈，迭代慢（T1 修复 3 轮循环，T6 无 Rust 改动未受影响）

## Key Decisions
- 测试隔离（T2 修复根因）：每个 composable 测试 `effectScope()` 包裹 + `scope.stop()` + `vi.clearAllTimers()`——根治 revision 测试 3 次调用（前序测试实例存活导致 bump revision 时旧 watch 也调度 fetch）
- naive-ui `NPopover` 实际组件 name 是 `Popover`：测试 stub 键名必须写 `Popover`
- `vi.hoisted` 中取 vue API 用 `require('vue')`（避免 hoisting 前 import 未初始化）
- BestPicksPanel 用 trigger="click"（常驻条可点开 Top5）；CounterHover 用 trigger="hover"（防抖由 useCounterIntel 承担）
- 评分 `score(C)=Σ(wr(C vs E)-0.5)`，未知=0 不编造；evidences `relation: 'favored' | 'countered'`
- patch 展示直接取 `getOpggStatus('ranked').status.patch`（如 16.16，不可拼前缀）
- rustfmt 修复全按 CI diff 逐处手动对齐（VALID_REGIONS 数组合并行、`get_text(...)`/`format!`/async 块/assert! 折行）——无 cargo fmt 的替代方案

## Next Steps
1. 手工验证（spec §9.6 清单，真机 LCU）：悬浮弹窗视觉与排序、最佳搭档节、阵容推荐逐人核对 API 数据一致（无编造）；验证通过后把 EXE 分发
2. 后续功能迭代：以 codegraph 现状盘点为准（本项目已无此 spec 内待办）

## Critical Context
- **CI 最终全绿**：Quality Checks `31795960055`（T5 修复）+ `31797335422`（T6）success（4 job 全 ✓）
- 端点到货实测（2026-08-14）：counters 200/50 条、synergies 200/50 条、versions `["16.16","16.15"]`、非法 tier 422、POSITION 枚举大写（MID/ADC 非 LCU 命名需转换）
- 敌方 intent 恒 0 → 只看 `championId>0`；敌方 assignedPosition 恒空 → 主分路用 `getChampionMeta` 近似
- Gaming.vue 候选池 `get_champion_options` 返回 `championOption[]`（`{value,label,realName,nickname}`），`allChampionIds=map(o=>o.value)`
- 提交基线：`c4cbe4c`（T6 最新）→ `19d9111`（交付记录补录）→ `aee9850`（needless_borrow）→ `6217f10`（too_many_arguments）→ `4fc4949`（clippy 编译×3）→ `8c49342`（spec 收尾）→ `057928c`（rustfmt×9）→ `d7ff49a`（T4）→ `c2119ca`（T3）→ `c89d8f5`（T2）→ `edc9237`（T1）→ `068a046`（spec）
- push 命令：`git push fork main`（origin 是 upstream `wnzzer/rank-analysis` 只读）
- clippy 排查要点（供后续复用）：`-D warnings` 下 `too_many_arguments`（阈值 7，依赖注入聚合点可 allow）、`needless_borrow`（`&str` 参数前多 `&`）都会 fail 编译

## Relevant Files
- `rank-analysis-app/src-tauri/src/opgg/intel.rs`：T1 新模块（15 单测，rustfmt/clippy 已对齐）
- `docs/superpowers/specs/2026-08-14-champselect-counter-hover-design.md`：任务卡 T1-T6 全 ✅ + 变更记录 v1.1 交付（终）行（未提交）
- `rank-analysis-app/src/components/gaming/CounterHover.vue` + `__tests__/CounterHover.spec.ts`：T3 弹窗 + T6 最佳搭档节（14 测）
- `rank-analysis-app/src/services/counterIntel.ts` + `__tests__/counterIntel.spec.ts`：T2 数据层 + T6 `sortSynergies`/`formatSynergyLine`（19 测）
- `rank-analysis-app/src/composables/useCounterIntel.ts` + `useCounterIntel.spec.ts`：T2 数据层 + T6 `sortedSynergies`（12 测）
- `rank-analysis-app/src/components/gaming/BestPicksPanel.vue` + `__tests__/BestPicksPanel.spec.ts`：T4 推荐条（9 测）
- `rank-analysis-app/src/views/Gaming.vue`：T4 集成点（subteam-col 列布局、候选池懒加载、tier 透传）
- `rank-analysis-app/src/components/gaming/PlayerCard.vue`、`ChampionIntelCard.vue`、`SubteamCard.vue`：T3/T4 头像包裹 + tier prop 链
