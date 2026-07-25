# 亮色主题补完方案(冷瓷方向)

**日期**: 2026-07-24
**状态**: 已批准
**范围**: 前端 `lol-record-analysis-tauri/src/`,49 个 Vue 组件分批全覆盖

## 背景与问题

亮色主题不是独立设计,而是在暗色结构上"打补丁"打出来的:

- Token 基建本身是对的(`global.css` 的 `:root` 深色 + `.theme-light` 冷瓷覆盖),但 49 个组件里只有 9 个写过 `.theme-light` 覆盖,其余 40 个的浅色表现从未被专门审视——只是换了 token 值,结构和强弱关系照搬暗色版。
- 暗色靠 glow / 白 alpha / 玻璃拟态出彩的地方,浅色下变弱变糊(白轨道贴白底隐形、7% 透明度点缀在近白底上等于没有)。
- 结构性问题:`theme-light` 类挂在 `n-config-provider` 根节点而非 `documentElement`,teleport 到 `body` 的浮层拿到的是 `:root` 深色 token;`overrides.ts` 因此被迫用 `isDark ? a : b` 三元把颜色手抄一遍,同一颜色语义活在三处。
- 已定位的硬编码漏网:`ProgressStatRow.vue`(白轨道)、`MettingPlayersCard.vue`(硬编码深色胜负色渐变)、`MatchDetailModal.vue`(白 alpha 提亮层)、`RecordCard.vue`(inset 白高光待确认)。

## 决策记录

| 决策点 | 结论 |
|---|---|
| 设计方向 | 保留已 A/B 定稿的"冷瓷"语言,补完而非推翻 |
| 验收方式 | 真机渲染 + 截图循环(dev 模式 MCP bridge `ws://127.0.0.1:9223`) |
| 覆盖面 | 分批全覆盖,49 个组件最终全过一遍,随时可停 |
| 执行顺序 | 直接逐页打磨,结构问题**碰到哪批修哪批**(不做前置结构改造) |

## 一、冷瓷强弱层级规范(每批打磨的统一标尺)

暗色表现力手段到浅色的翻译规则:

| 暗色手段 | 浅色翻译 |
|---|---|
| 玻璃层(透明白 alpha 底 + 细边) | 纸面:白底 + 冷墨发丝边 + 低层投影(扩展 `global.css` 已有材质补丁区) |
| glow 发光(胜负光晕、激活态) | 不用发光,改用加深的实色边框/背景块;白底上光晕读作污渍 |
| 白 alpha 提亮(hover、高亮行) | 冷墨 alpha 加深(`--glass-bg-*` 已是冷墨,组件裸写的白 alpha 需翻译) |
| 亮度差分层(越亮越靠前) | 投影差分层:越靠前投影越明显,底色更白 |

每批验收判断标准:**该页面的视觉重点排序与暗色版一致**——胜负一眼可辨、激活项一眼可辨、层级不塌。

## 二、工作循环(每批固定流程)

1. dev 起真机,MCP bridge 切浅色,逐屏截图;
2. 对截图列该批问题清单(层级塌 / 深色假设残留);
3. 改代码,原则:
   - 值差异 → 提升为 token,两主题各给值;
   - 禁止新增组件内 `.theme-light` 块,存量补丁顺手归拢(结构差异集中到 `global.css` 材质补丁区);
   - 主题无关的固定色(如图片黑蒙层)加 `/* theme-fixed */` 注释;
4. 复截同屏对比,发用户验收;
5. 通过后走 shipping-changes 流程,一批一个 PR。

## 三、批次划分(按曝光排序)

- **批 0 壳**:SideNavigation / Header / Framework。顺带把 SideNavigation 的 8 处 `.theme-light` 补丁收敛为 token,树立样板。
- **批 1 战绩页**:RecordCard / UserRecord / RankCard / MatchHistory / RecentStatsTable / ProgressStatRow(修白轨道漏网)。
- **批 2 对局页**:PlayerCard / SubteamCard / ChampionIntelCard / MettingPlayersCard(修硬编码渐变)/ PlayerHistoryGrid。浮层密集,**本批开头先做 theme class 挪 `documentElement` 的结构修复**(挂类 watcher 用 `{ flush: 'sync', immediate: true }`,保证类翻转先于 overrides 重算),否则浮层调色基准是错的。
- **批 3 战绩详情**:MatchDetailModal / MatchDetail,5 处 `.theme-light` 补丁归拢。
- **批 4 设置页 + 杂项**:Settings 各页 / Loading / 各 dialog。naive-ui 控件多,`overrides.ts` 三处重复的收敛放本批:组件级键(Card.color、Layout.color 等原样入样式表的)改 `var(--xxx)` 字符串;**`common.*` 颜色键保留字面值走 `cssVar()`**——已验证 naive-ui 有 26 个组件主题在 `self()` 派生阶段对 `common` 色做 JS 颜色运算(seemly `rgba()` 解析器遇 `var()` 字符串直接 throw),`common` 写 `var()` 会运行时崩溃。

## 四、收尾守门(最后一批)

- vitest:解析 `global.css`,断言 `:root` 每个颜色类 token 在 `.theme-light` 有对应覆盖;
- `npm run check` 加检查:组件 `<style>` 内禁止新增裸 `rgba(255,255,255,…)` / `rgba(0,0,0,…)`,`/* theme-fixed */` 注释豁免;
- 翻译规则四条写进 `CODE_QUALITY.md`。

## 测试与验收

- 每批:浅色截图对比作为验收 artifact,用户人工定夺;
- 每批:`npm run check` + `npm run test` 全绿;
- 收尾:token 奇偶测试与裸颜色检查纳入 CI 门禁,防复发。
