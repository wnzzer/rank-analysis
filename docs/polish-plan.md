# 持续优化迭代计划（离线功能专项）

> 运作方式：每轮列 3-6 个可独立验证的条目；全部完成后在本文件追加下一轮；
> 单条目完成后就地勾选。约束：只做离线功能 / 不依赖运行时外部资源。

## Round 1 —— 视觉一致性与可访问性收尾

- [ ] R1-1 RecordCard 骨架屏（RecordCardSkeleton）对齐新行的胜负左缘色条占位，
      消除加载完成瞬间的布局跳动
- [ ] R1-2 TrendBar 迷你趋势条配色统一为品牌金渐变（当前若为一次性 hex 则收编 token）
- [ ] R1-3 可访问性扫描：新增/改动过的组件中 icon-only 按钮补 aria-label、
      可点击元素补 cursor-pointer（范围：views/ + components/ui/ + components/shell/）
- [ ] R1-4 About 页走查：排版与全局字体层级对齐，无 emoji/字形残留
- [ ] R1-5 后端 game_state_monitor 断连去抖抽纯函数并补单元测试
      （grace 判定逻辑独立为 fn，便于无 LCU 环境验证；CI 跑）

### 完成标准
eslint 0 / vite build 通过 / vitest 全绿 / prettier 全仓干净；
R1-5 额外要求 CI Quality Checks 绿。

---

## Round 2 —— （Round 1 完成度 ≥80% 时续写）

（待续写）
