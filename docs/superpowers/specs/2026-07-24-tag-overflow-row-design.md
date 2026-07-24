# 玩家标签行:优先级排序 + 溢出收纳

**日期**: 2026-07-24
**状态**: 已批准(方案 A)
**范围**: `UnifiedTagRow.vue` + `PlayerCard.vue`(对局页玩家卡),战绩页/对局详情随组件自动受益

## 问题

对局页玩家卡右上角标签簇(预组队 / 遇见过×N / 备注 chip / 系统标签)无优先级、无上限、自由换行:

- 标签多的玩家换行到 2-3 行,`justify-content: flex-end` 导致每行起点参差("排序不工整");
- 标签区和名字/段位行同处一个受限高度的 flex 行,换行撑高后与段位行的 `版本↑` 徽章重叠;
- 色彩过载:黄/红/绿/粉各说各话。

## 设计决策

| 决策点 | 结论 |
|---|---|
| 优先级排序 | 备注 > 预组队 > 遇见过 > 系统 bad > 系统 good(bad 警示价值高于 good) |
| 可见上限 | `UnifiedTagRow` 新增 `maxVisible` prop;PlayerCard 传 2;其他调用点不传 = 不限(行为不变) |
| 溢出交互 | 超出部分收进一个 `+N` 中性 chip,click 弹 popover 列出全部溢出 chip,溢出 chip 保留原有 tooltip(tagDesc)与点击固化交互 |
| 单行强制 | `.profile-tags` 改 `flex-wrap: nowrap`;预组队/遇见过物理在前(DOM 顺序即优先级),`UnifiedTagRow` 内部 note 最前、bad 在 good 前 |
| 排序位置 | `UnifiedTagRow` 内新增纯函数 `orderTags(tags)`(bad 前 good 后,同组保持后端原序),单测覆盖 |
| 不做 | 不动 OP.GG chip / 版本徽章(它们在段位行,归属正确);不改 chip 配色体系(留给亮色批 2) |

## 验收

- 对局页 10 张玩家卡标签区全部单行,无重叠、右对齐工整;
- 标签溢出的玩家出现 `+N`,点开能看到全部并可固化为备注;
- 战绩页/对局详情的 UnifiedTagRow 行为不变(不传 maxVisible);
- 真机双主题截图确认;`npm run check` + `npm run test` 全绿,orderTags/切片逻辑有单测。
