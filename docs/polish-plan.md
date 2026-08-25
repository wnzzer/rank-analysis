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

## Round 2 —— 离线功能增强 + 数据层细节

- [ ] R2-1 战绩页「导出 CSV」：把当前筛选后的对局清单（时间/英雄/胜负/KDA/
      时长）导出为本地 CSV（tauri-plugin-dialog 保存对话框，纯本地无网络）
- [ ] R2-2 PlayerBar 数字字体统一 Space Mono（段位/胜率/战绩数等数值位）
- [ ] R2-3 CornerCard emphasis 变体亮色描边核查（羊皮纸底上的金描边对比度）
- [ ] R2-4 RecordCardSkeleton / TrendBar 复核 prefers-reduced-motion 表现
      （骨架屏脉冲动画在减弱动效下应静止）

### 完成标准
同 Round 1；R2-1 额外要求导出文件可用 Excel 直接打开（UTF-8 BOM + 转义正确）。

---

## Round 3 —— （Round 2 完成度 ≥80% 时续写）

（待续写）
