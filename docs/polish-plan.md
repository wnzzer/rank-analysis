# 持续优化迭代计划（离线功能专项）

> 运作方式：每轮列 3-6 个可独立验证的条目；全部完成后在本文件追加下一轮；
> 单条目完成后就地勾选。约束：只做离线功能 / 不依赖运行时外部资源。

## Round 1 —— 视觉一致性与可访问性收尾 ✅（2026-08-25 完成）

- [x] R1-1 RecordCardSkeleton 对齐真实行几何（44px/radius-md/左缘占位条），
      消除加载完成瞬间的布局跳动
- [x] R1-2 TrendBar 一次性 hex 收编 token（胜负渐变/MVP 金点辉光/银点中性化）
- [x] R1-3 可访问性扫描：NavRail 三个纯图标按钮补 aria-label；
      其余嫌疑均为带可见文字按钮（误报）
- [x] R1-4 About 页走查：7 个内联 Material SVG 换 Lucide、版本章换品牌金
- [x] R1-5 game_state_monitor 去抖抽 resolved_connected 纯函数 + 5 单测
      （CI Quality Checks 绿验证）

---

## Round 2 —— 离线功能增强 + 数据层细节 ✅（2026-08-26 完成）

- [x] R2-1 战绩页「导出 CSV」：当前筛选全集导出（UTF-8 BOM + CRLF + 转义 +
      零死亡 Perfect KDA）；新增通用 `save_text_file` 命令（Rust 侧对话框+写盘，
      与 export_backup 同安全范式）；5 个纯函数单测
- [x] R2-2 PlayerBar 数字字体统一 Space Mono（段位文本/近期胜率值）
- [x] R2-3 CornerCard emphasis 亮色描边核查：金 .32α 于白底清晰可见，**通过无需改动**
- [x] R2-4 RecordCardSkeleton 补 reduced-motion 守卫（骨架脉冲静止）；
      TrendBar 无持续动画，复核通过

### 完成标准
同 Round 1；R2-1 额外要求导出文件可用 Excel 直接打开（UTF-8 BOM + 转义正确）。

---

## Round 3 —— 离线功能增强第二批 ✅（2026-08-26 完成）

- [x] R3-1 导出扩展：三格式下拉（CSV 基础 / CSV 完整含补刀经济视野 /
      JSON 全量），同一 `save_text_file` 通道；JSON roundtrip + 对话框链路 8 单测
      （偏离说明：R3-3 的 Esc 未走 useWindowShortcuts——那是多窗口级设施，
      Record 聚焦 Esc 用本地监听更内聚）
- [x] R3-3 Record 聚焦模式 Esc 收回详情（onGlobalKey 常驻监听 + focusMode 门控）
- [x] R3-2 Growth 目标本地备注列：localStorage 持久化、孤儿清理、
      内联输入（回车/失焦保存 · Esc 取消）
- [x] R3-4 EmptyState 支持 #art 大号图形槽（纯 CSS 尺寸，不引入图片资源）

### 完成标准
同前；R3-1 导出的 JSON 需可被重新导入校验（roundtrip 测试 ✓ 已含）。

---

## Round 4 —— 健壮性与开发者体验 ✅（2026-08-26 完成）

- [x] R4-1 CommandPalette 可访问性：aria-modal + Tab/Shift+Tab 焦点陷阱
      （input 与命令项循环）+ 关闭后焦点归还触发元素
- [x] R4-2 路由级错误兜底：Framework onErrorCaptured 捕获子树渲染异常，
      展示「页面出错了 · 重试」切角卡；路由变化自动清除，renderKey 强制重挂
- [x] R4-3 CLAUDE.md 补两条工程约定：PageStage 统一横幅；
      大段样式外置 + 结构金丝雀测试模式
- [x] R4-4 Growth 两个空态接 #art 图形槽示范接线

### 完成标准
同前；R4-1 需键盘路径人工复核一遍。

---

## Round 5 —— 数据与交互的最后一公里

- [x] R5-1 导出格式记忆：主按钮按上次格式直出，▾ 下拉重选并持久化
      （loadExportFormat/saveExportFormat + 非法值回退 csv）
- [x] R5-2 Home 快捷入口数据驱动化 + 上/下移排序（localStorage 持久化，
      hover 浮现手柄；Home.spec 契约保持）
- [x] R5-3 Growth 目标备份/还原：serializeGoalsBackup/parseGoalsBackup
      （结构校验+脏数据过滤+roundtrip）+ remapNotesByTitleKey 按 维度::标题
      回填备注；还原走 web 标准 file input（零 capability）
- [x] R5-4 record 详情 tabs .theme-light 块核对通过（新组件均走 token，
      主题切换自动跟随；CornerCard emphasis 渐变亮色层次已确认）

### 完成标准
格式记忆回退路径由 loadExportFormat 覆盖 ✓；导出 JSON roundtrip ✓。

---

## Round 6 —— 可感知性补缺

- [x] R6-1 useEmberField：prefers-reduced-motion 下改为绘制「静态单帧」
      （当前直接跳过=画布空白；保留氛围但零动效）
- [x] R6-2 Record 无对局数据时的列表空态接 #art 图形槽 + 引导文案统一
- [x] R6-3 Growth 头部显示上次备份时间（localStorage 持久化，PageStage #meta）
- [x] R6-4 亮色动画层次校验：发现并修复组合阴影失效 bug——
      `box-shadow: var(--shadow-3), var(--glow-brand)` 在亮色（glow=none）下
      整条声明被丢弃；改为暗色主题叠加辉光的独立规则

### 完成标准
同前。

---

## Round 7 —— 微交互与一致性终扫

- [x] R7-1 战绩导出追加「复制 CSV 到剪贴板」次级动作（clipboard API，离线）
- [x] R7-2 Home 走马灯 hover 暂停补 title 提示；reduced-motion 下弱化处理
- [x] R7-3 全局 cursor-pointer 审计：所有 @click 元素逐个核对
      （修复 PlayerStatsCard 两处可点击 div）
- [x] R7-4 Growth 备份/还原按钮组窄窗换行适配
      （PageStage actions 槽 flex-wrap，惠及所有页面按钮组）

### 完成标准
同前。

---

## Round 8 —— 数据完整性收口 ✅（2026-08-26 完成）

- [x] R8-1 备份 JSON 纳入 appVersion 元信息（getVersion，旧备份缺省兼容）
- [x] R8-2 还原二次确认：新建目标 >5 条时 window.confirm 防误导入
- [x] R8-3 导出/备份文件名时间戳精确到秒（fake-timers 单测断言跨秒不同名）
- [x] R8-4 polish-plan 归档说明：完成轮次就地打勾 + 完成标准随轮保留
      （轻量归档；后续轮次多时再迁移文末归档章节）

---

## Round 9 —— 体验纵深（离线） ✅（2026-08-26 完成）

- [x] R9-1 导出成功路径条：工具栏下可选中路径 + 一键复制 + 关闭
      （direction:rtl 实现长路径尾部对齐省略）
- [x] R9-2 Home 快捷入口「恢复默认排序」按钮（清空持久化顺序即回默认）
- [x] R9-3 Growth 清单卡支持拖拽 .json 导入（dragover/drop，与文件选择同管线）
- [x] R9-4 空态文案语气走查：四条空态均有下一步指引，无需改动

### 完成标准
同前。

---

## Round 10 —— 稳态维护轮（候选池） ✅（2026-08-26 完成）

- [x] R10-a Record 详情聚焦模式补「上一个/下一个对局」快速切换按钮
      （含 n/total 位置计数，按全量列表顺序步进）
- [x] R10-b Gaming 等待态文案与 phase 联动细化（大厅/匹配中分档提示）
- [x] R10-c vitest 补 Home.styles.css 关键选择器快照（新增 7 选择器主干断言）
- [x] R10-d Growth 备份文件拖拽时的视觉高亮已有——补充 drop 后 loading 态
      （importingFile 防重入 + 卡内指示文案 + 拖拽虚线高亮）

### 完成标准
同前。

---

## Round 11 —— 命令面板与身份细节

- [ ] R11-1 CommandPalette 最近使用排序：按使用频次（localStorage 计数）
      在同分组内前置展示，重置入口放页脚
- [ ] R11-2 About 版本章点击复制版本号（title 提示 + 成功消息）
- [ ] R11-3 Record 聚焦模式记忆：会话内重进页面恢复上次聚焦对局
      （sessionStorage）
- [ ] R11-4 README 功能清单补：战绩导出 CSV/JSON、目标备份还原、
      聚焦模式、命令面板

### 完成标准
同前；R11-1 需单测覆盖计数递增与排序稳定性。

---

## Round 12 —— （Round 11 完成度 ≥80% 时续写）

（待续写）

---

## 归档说明

完成轮次就地打勾并保留完成标准；当活跃轮次超过三个时，
把最早的两轮移入文末「归档」章节（保持文档可读性）。

---

## 归档

（暂无；R1-R9 完成记录见上文各轮勾选区）

