# PlayerCard 标签布局重构 - 设计文档

## 背景

当前 `PlayerCard.vue` 把所有标签（队伍 1/2、遇见过、AI user tags）塞在右栏 `width: 100px` 的 `tags-container` 内。当某玩家的 AI tag 较多时，标签在窄栏内换行，把右栏高度撑过左栏（profile + 战绩 grid ≈ 120px）。由于 flex 默认 `align-items: stretch`，整张卡片高度跟着变高，**同列卡片高度不齐**——这是这次优化要解决的核心问题。

## 目标

- 同列玩家卡片高度差异从当前的 ~3 行（≈72px）降到最多 1 行（≈28px），常见场景下严格等高
- 标签数量增加时不再丢信息（不引入 `+N` 折叠、不引入滚动条、不引入 `overflow: hidden` 截断）
- 改动局限在 `PlayerCard.vue` 单文件内

## 方案：标签下沉到卡片底部跨整行

把标签条从右栏 `right-section` 中拆出，作为独立的 footer 行铺在卡片底部，横跨整张卡片宽度。

### Layout 变化

变更前：

```
┌─────────────────────────────┐
│ [profile section]   │tags │ │
│                     │─────│ │
│ [history grid 2x2]  │data │ │
│                     │card │ │
└─────────────────────────────┘
            ↑
    tags 在窄栏 100px 内换行 → 右栏变高 → 撑卡
```

变更后：

```
┌─────────────────────────────┐
│ [profile section]      │data│
│                        │card│
│ [history grid 2x2]     │    │
├─────────────────────────────┤
│ [队伍1] [遇见过] [tag] ...  │  ← 全宽 tag 条
└─────────────────────────────┘
            ↑
卡片高度由 left-section + tag 条决定
同列每张卡都按相同结构计算 → 等高
```

### DOM 结构调整

`<n-card>` 内部从原来的 `n-flex(left | right)` 改为：

```vue
<div class="card-body">
  <n-flex :wrap="false">
    <div class="left-section">{{ profile + PlayerHistoryGrid }}</div>
    <div class="right-section">{{ PlayerStatsCard }}</div>
  </n-flex>
  <div class="tags-footer">
    <!-- 队伍标记 / 遇见过 / userTag.tag 列表 -->
  </div>
</div>
```

- `right-section` 只剩 `PlayerStatsCard`，原 `tags-container` 整体下沉成 `tags-footer`；`right-section` 的 `width: 100px` 保持不变
- ARAM 增强/削弱标签**保留**在召唤师名旁的 `n-popover`（profile-section 内），不下沉——它和段位、tagLine 是同一组上下文
- `meetGames` 的"遇见过"标签 + popover、`preGroupMarkers` 队伍标记、`userTag.tag` 都搬到 `tags-footer`

### CSS 关键点

```css
.card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
}

.tags-footer {
  min-height: 24px; /* 没标签时也保留占位，让同列卡片严格等高 */
  padding-top: 6px;
  border-top: 1px solid var(--n-divider-color);
}

.tags-footer :deep(.n-flex) {
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-start; /* 改为左对齐，因为已经横跨整行 */
}
```

`min-height: 24px` 保证即使整张卡 0 标签也保留 ~24px 占位行，**同列卡片严格等高**。

### 卡片高度构成（改后）

| 区段 | 高度 |
|------|------|
| profile-section | ~50px |
| history grid (4 局，2×2) | ~70px |
| tags-footer | ≥ 24px（多标签时换行扩到 ~50px） |
| 总和 | ~150-170px |

横向空间从 100px → 280px，6 个长度 2-7 字的 AI tag 横排基本一行装下；极端情况换到 2 行也只是同列所有卡片同步加高。

## 不在范围内

- 不调整 ARAM 增强/削弱标签的位置
- 不重构 `PlayerStatsCard`（保留 compact / expanded 双态）
- 不重构 `PlayerHistoryGrid`
- 不修改 AI tag 生成逻辑（长度限制、语气、分类规则保持现有）
- 不改 `PlayerCard.vue` 的 props / 对外接口

## 风险与权衡

- **卡片整体加高 ~24px**：同列每张卡都加同样高度，对齐性保留；纵向密度略降，是接受的代价。
- **`tags-footer` 用 `min-height` 占位**：如果团队后续想做"无标签时彻底不留 footer"，需要重新讨论；本次为了优先解决"等高"问题选择保留占位。
- **左对齐 vs 右对齐**：原右栏 tags 是 `justify-content: flex-end`，下沉后改左对齐更符合"卡片底部信息条"的视觉惯例。

## 验收

1. 同一列任意 5 张卡片的 `offsetHeight` 差异 ≤ 28px（即一行 tag 高度）；当列内所有卡 tag 总数都能塞进单行时严格等高
2. 单张卡 `userTag.tag` 数量 0 / 1 / 3 / 6 时，卡片底部 tag 区视觉表现合理且不撑高
3. ARAM 模式下，召唤师名旁的增强/削弱 popover 仍在原位
4. 浅色 / 深色主题下 `tags-footer` 的 `border-top` 颜色协调
5. `npm run check` 通过；前端 vitest 不需要新增测试（纯样式调整，无逻辑变更）
