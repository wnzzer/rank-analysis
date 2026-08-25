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

## Round 3 —— 离线功能增强第二批

- [ ] R3-1 战绩导出扩展：可选字段集（补刀/经济/视野）与 JSON 格式导出
      （同一 save_text_file 通道，复用转义逻辑）
- [ ] R3-2 Growth 目标清单支持本地备注列（纯前端 state + 现有 toggle 通道，
      不新增后端表）
- [ ] R3-3 键盘快捷键补齐：Record 聚焦模式下 Esc 收回详情、Gaming AI 抽屉
      Esc 已有——统一走 useWindowShortcuts 注册
- [ ] R3-4 空状态插画级打磨：EmptyState 支持可选大号图形槽（纯 CSS 图形，
      不引入图片资源）

### 完成标准
同前；R3-1 导出的 JSON 需可被重新导入校验（roundtrip 测试）。
