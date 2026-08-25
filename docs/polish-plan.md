# 持续优化迭代计划（离线功能专项）

> 运作方式：每轮列 3-6 个可独立验证的条目；全部完成后在本文件追加下一轮；
> 单条目完成后就地勾选。约束：只做离线功能 / 不依赖运行时外部资源。

## 轮次速览

| 轮 | 一句话摘要 |
|----|-----------|
| R1 | 视觉一致性/可访问性/后端去抖测试化 |
| R2 | 导出 CSV / mono 数字 / emphasis 核查 / 骨架守卫 |
| R3 | 三格式导出 + 聚焦 Esc + 目标备注 |
| R4 | 焦点陷阱 / 路由错误兜底 / 工程约定 / 图形槽 |
| R5 | 格式记忆 / 入口排序 / 目标备份还原 / 亮色核对 |
| R6 | 静态余烬帧 / Record 空态统一 / 备份时间 / 阴影失效修复 |
| R7 | 剪贴板复制 / 走马灯提示 / cursor 审计 / actions 换行 |
| R8 | 备份元信息 / 还原确认 / 秒级时间戳 |
| R9 | 导出路径条 / 恢复默认排序 / 拖拽导入 / 空态走查 |
| R10 | 聚焦导航 / 等待态联动 / 样式快照 |
| R11 | 最近使用排序 / 版本复制 / 聚焦记忆 / README |
| R12 | 还原联动刷新 / 频次上限 / README 英文同步 |
| R13 | Overlay 动效 / 跨断点聚焦保持 / CSV 对位列 |
| R14 | 对手列镜像回退 / Overlay 高度自适应 |
| R15 | 主题跟随评估 / 窄窗图标化 / 轮次索引表 |
| R16 | 面板命令总数 / 聚焦键盘导航 / 拖拽导入引导 |
| R17 | 路径条自动消失 / 导航按钮提示 / ticker 核查 |
| R18 | 空态 #art 收口 / 下拉可达性核实 / 还原链路测试 |
| R19 | 空态三态测试 / 拖拽导入提示 / README 核实 |
| R20 | 重连恢复提示 / 结构断言归并 / 门禁复核 |

---

## Round 1 —— 视觉一致性与可访问性收尾 ✅（2026-08-25）

- [x] RecordCardSkeleton 对齐真实行几何，消除加载跳动
- [x] TrendBar 一次性 hex 收编 token
- [x] NavRail 纯图标按钮补 aria-label
- [x] About 页内联 SVG 换 Lucide、版本章换品牌金
- [x] game_state_monitor 去抖抽 resolved_connected 纯函数 + 5 单测

---

## Round 2 —— 离线功能增强 + 数据层细节 ✅（2026-08-26）

- [x] 战绩导出 CSV：save_text_file 命令 + BOM/CRLF/转义 + 5 单测
- [x] PlayerBar 数字字体 Space Mono
- [x] CornerCard emphasis 亮色核查通过
- [x] RecordCardSkeleton reduced-motion 守卫

---

## Round 3 —— 离线功能增强第二批 ✅（2026-08-26）

- [x] 导出三格式下拉（CSV 基础/完整、JSON 全量）+ 8 单测
- [x] Record 聚焦模式 Esc 收回详情
- [x] Growth 目标本地备注（localStorage）
- [x] EmptyState #art 图形槽

---

## Round 4 —— 健壮性与开发者体验 ✅（2026-08-26）

- [x] CommandPalette aria-modal + Tab 焦点陷阱 + 焦点归还
- [x] Framework 路由级错误兜底卡（errorCaptured + renderKey 重试）
- [x] CLAUDE.md 补 PageStage / 样式外置金丝雀两条工程约定
- [x] Growth 两个空态接 #art 图形槽

---

## Round 5 —— 数据与交互的最后一公里 ✅（2026-08-26）

- [x] 导出格式记忆（主按钮直出 + ▾ 重选持久化）
- [x] Home 快捷入口数据驱动 + 上/下移排序持久化
- [x] Growth 目标备份/还原（serializeGoalsBackup/parseGoalsBackup + 备注 remap）
- [x] record 详情 tabs .theme-light 核对通过

---

## Round 6 —— 可感知性补缺 ✅（2026-08-26）

- [x] useEmberField reduced-motion 静态单帧 + 主题切换重绘
- [x] Record 加载失败/筛选空态换 EmptyState（#art），移除 NEmpty 依赖
- [x] Growth 上次备份时间（PageStage #meta）
- [x] 组合阴影失效 bug 修复（亮色 glow=none 与实值并列导致整条丢弃）

---

## Round 7 —— 微交互与一致性终扫 ✅（2026-08-26）

- [x] 导出下拉新增「复制 CSV 到剪贴板」
- [x] Home 走马灯悬停暂停提示
- [x] cursor-pointer 审计：PlayerStatsCard 两处可点击 div 补齐
- [x] PageStage actions 槽 flex-wrap

---

## Round 8 —— 数据完整性收口 ✅（2026-08-26）

- [x] 备份 JSON 纳入 appVersion 元信息
- [x] 还原二次确认：新建目标 >5 条时 confirm 防误导入
- [x] 导出/备份文件名时间戳精确到秒（fake-timers 单测）
- [x] polish-plan 就地勾选 + 归档约定建立

---

## Round 9 —— 体验纵深（离线） ✅（2026-08-26）

- [x] 导出成功路径条：可选中完整路径 + 一键复制 + 关闭
- [x] Home 快捷入口「恢复默认排序」
- [x] Growth 清单卡拖拽 .json 导入（与文件选择同管线）
- [x] 空态文案语气走查通过

---

## Round 10 —— 稳态维护轮（候选池） ✅（2026-08-26）

- [x] Record 聚焦模式上一个/下一个导航（n/total 计数）
- [x] Gaming 等待态文案与 phase 联动细化（大厅/匹配中分档）
- [x] Home.styles.css 关键选择器快照扩容（7 断言）
- [x] Growth 拖拽导入 loading 态（防重入 + 卡内指示 + 虚线高亮）

---

## Round 11 —— 命令面板与身份细节 ✅（2026-08-26）

- [x] sortByUsage 组内频次降序纯函数（分组边界稳定，3 单测）+ 页脚重置常用
- [x] About 版本章点击复制版本号
- [x] Record 聚焦记忆：sessionStorage 会话级恢复（仅宽屏）
- [x] README.zh-CN 功能清单补导出/聚焦模式/成长与效率小节

---

## Round 12 —— 收尾观察轮 ✅（2026-08-26）

- [x] Growth 还原成功后 refreshAll 联动短板卡数据源
- [x] Palette 使用频次持久化仅保留 top 20（0 计数剔除）
- [x] README.md 英文版同步成长小节与 Match History 条目
- [-] console.log 清理暂缓：需区分诊断输出与调试日志（errorHandler 已兜底可见性）

---

## Round 13 —— 真机反馈驱动轮（候选池） ✅（2026-08-26）

- [x] OverlayView maxItems 变化平滑化：条目淡入下滑动画 + reduced-motion 守卫
- [x] Record 聚焦跨断点保持：宽→窄转交 focusGameId 内嵌展开
- [x] 导出 CSV 扩至 11 列：队伍列 + 对手英雄列（teamPosition 防御性匹配，
      缺失留空不编造；基础表头扩至 11 列，单测同步更新）
- [x] Growth 拖拽导入 loading 态（防重入 + 卡内指示 + 虚线高亮）

---

## Round 14 —— 观察轮（候选池沿用 Round 13 未尽项） ✅（2026-08-26）

- [x] 对手英雄列回退策略：teamPosition 缺失时按标准 10 人局
      participantId ±5 镜像配对（非 10 人局/布局不符留空不编造），3 个专项单测
- [x] Overlay maxItems 与屏幕高度自适应：resize 监听 + 高度钳制

### 完成标准
同前。

---

## Round 15 —— 稳态轮（低频维护） ✅（2026-08-26）

- [x] R15-a OverlayView 主题跟随评估：**结论=保持恒暗色**。
      游戏内叠加层面对高亮场景，暗色卡对比度最优；
      跟随羊皮纸亮色反而降低实战可读性（评估记录，无代码改动）
- [x] R15-b 导出按钮组在超窄窗 (<640) 收敛为纯图标
- [x] R15-c polish-plan 增加轮次速览索引表

### 完成标准
同前。

---

## Round 16 —— 微体验三连 ✅（2026-08-26）

- [x] R16-1 命令面板页脚显示当前命令总数（Space Mono 弱化色）
- [x] R16-2 Record 聚焦模式 ←/→ 键盘切换对局（与按钮同管线 stepDetail）
- [x] R16-3 Growth 清单副标题补「支持拖拽 .json 导入」引导

### 完成标准
同前。

---

## Round 17 —— 微交互终扫 ✅（2026-08-26）

- [x] R17-1 导出路径条 10s 自动收起（组件卸载清 timer，重导出重置）
- [x] R17-2 Record 聚焦导航按钮补键盘提示 title（←/→）
- [x] R17-3 Home 走马灯 OP.GG 版本接入——评估后跳过：
      走马灯为静态装饰（aria-hidden），动态数据应走 hero meta 而非装饰条

### 完成标准
同前。

---

## Round 18 计划 空态与可达性终扫（2026-08-26）
- [x] R18-1 Record 无筛选空态补 EmptyState #art（Inbox 图标 + 引导文案）
- [x] R18-2 导出下拉键盘可达性核实——n-dropdown 原生支持（Enter/Esc/方向键），无需改动
- [x] R18-3 还原全链路数据级集成测试（缺失检测→补建→重映射，镜像 importGoalsFile）
- [x] R18-4 polish-plan 轮次速览索引表补齐 R17/R18 行

（待续写）

---

## Round 19 计划 空态断言与导入反馈（2026-08-26）
- [x] R19-1 Record 空态三态测试（加载失败/筛选无匹配/无对局引导，20 用例通过）
- [x] R19-2 导出下拉 ARIA 核实——n-dropdown 原生 menu/menuitem 语义，无需改动
- [x] R19-3 Growth 拖拽非 .json 文件给出 warning 提示（含文件名回显）
- [x] R19-4 README 双语核实——导出（基础/含经济视野/剪贴板）与目标备份还原均已记载

## Round 20 计划 重连恢复与收尾核验（2026-08-26）
- [x] R20-1 空态三态结构断言已随 R19-1 落地（.empty__act/.list-item 类级锚定）
- [x] R20-2 Gaming 重连恢复提示（isConnected false→true 触发 3s「连接已恢复」文案）
- [x] R20-3 polish-plan 轮次速览表补 R17-R20 行
- [x] R20-4 全量门禁复核——lint/type/test/build 全绿

## Round 21 计划 重连提示测试化（2026-08-26）
- [x] R21-1 useReconnectBanner 组合式函数 + 5 个时序单测（fake timers 断言闪烁窗口）
- R21-2 Record 导出路径条 aria-live 播报
- R21-3 polish-plan 轮次速览表同步维护
- R21-4 下一轮候选池滚动续写

## 归档说明