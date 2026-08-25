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

- [ ] R5-1 导出格式记忆：localStorage 记住上次选择的导出格式，下次默认选中
- [ ] R5-2 Home 快捷入口自定义排序（上移/下移按钮 + localStorage 持久化，
      无拖拽依赖）
- [ ] R5-3 Growth 目标备注纳入 JSON 导出（目标数据整体备份/还原 roundtrip）
- [ ] R5-4 亮色主题第二遍：OverlayView 之外的 record 详情 tabs .theme-light
      块与新旗舰组件交叉核对（重点 CornerCard emphasis 渐变在亮色下的层次）

### 完成标准
同前；R5-1 需断言「刷新后默认选中上次格式」的单测。
