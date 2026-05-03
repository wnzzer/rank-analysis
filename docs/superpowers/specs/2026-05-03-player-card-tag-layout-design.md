# PlayerCard 标签布局重构 - 设计文档

## 背景

当前 `PlayerCard.vue` 把所有标签（队伍 1/2、遇见过、AI user tags）塞在右栏 `width: 100px` 的 `tags-container` 内。当某玩家的 AI tag 较多时，标签在窄栏内换行，把右栏高度撑过左栏（profile + 战绩 grid ≈ 120px）。由于 flex 默认 `align-items: stretch`，整张卡片高度跟着变高，**同列卡片高度不齐**——这是这次优化要解决的核心问题。

观察到现有布局存在大块**横向空间浪费**：profile 行内 `info-wrapper` 没填满 `left-section`，加上右栏 `tags-container` 是 `justify-content: flex-end` 右对齐，info-wrapper 末尾到右栏标签之间形成一段空白横条。这次优化把 tags 移到这段被浪费的空间，**卡片整体高度不变**。

## 目标

- 标签数量增加时**不再撑高卡片**——常见场景下卡片高度由 profile + 战绩 grid 决定，与 tag 数量解耦
- 标签数量增加时不丢信息（不引入 `+N` 折叠、不引入滚动条、不引入 `overflow: hidden` 截断）
- 改动局限在 `PlayerCard.vue` 单文件内

## 方案：标签内联到 profile 行右侧

把 `tags-container` 从右栏 `right-section` 拆出，作为 `profile-section` 的第三个横向子元素塞在 `info-wrapper` 之后，`flex: 1` 占满 profile 行剩余横向空间。

### Layout 变化

变更前：

```
┌──────────────────────────────────────────┐
│ [头像 info-wrapper       ] │tags(100px)  │
│                            │─────────────│
│ [history grid 2x2]         │data card    │
└──────────────────────────────────────────┘
            ↑
    tags 在 100px 窄栏换行 → 撑卡
```

变更后：

```
┌──────────────────────────────────────────┐
│ [头像 info-wrapper] [tags 填充剩余]│data │
│                                    │card │
├────────────────────────────────────│     │
│ [history grid 2x2]                 │     │
└──────────────────────────────────────────┘
            ↑
tags 和 profile 同行，卡片高度由 left-section 的
profile + history grid 决定，与 tag 数量解耦
```

### DOM 结构调整

`<n-card>` 内部：

```vue
<n-flex :wrap="false">
  <div class="left-section">
    <div class="profile-section">
      <n-flex :wrap="false" align="center" style="gap: 10px">
        <div class="avatar-wrapper">...</div>
        <div class="info-wrapper">{{ name + tagLine + tier + ARAM增强/削弱 }}</div>
        <div class="profile-tags">
          <!-- 队伍标记 / 遇见过 / userTag.tag -->
        </div>
      </n-flex>
    </div>
    <PlayerHistoryGrid />
  </div>
  <div class="right-section">
    <PlayerStatsCard />  <!-- 原 tags-container 已移除 -->
  </div>
</n-flex>
```

变更要点：

- **新增 `.profile-tags`** 作为 profile 行的第三个 flex 子元素，`flex: 1` 占满剩余横向空间
- `right-section` 删掉 `tags-container`，只保留 `PlayerStatsCard`
- `right-section` 宽度保持 `100px` 不变
- ARAM 增强/削弱 popover 保留在 `info-wrapper` 内，**不下沉**
- `meetGames` 的"遇见过"、`preGroupMarkers` 队伍标记、`userTag.tag` 三类都搬到 `.profile-tags`

### CSS 关键点

只新增 `.profile-tags`，并把 `.info-wrapper` 的 `flex: 1` 改为 `flex: 0 1 auto`（不再独占剩余空间，把空间让给 `.profile-tags`）。`.profile-section` 的 `padding-bottom` 和 `border-bottom` 保持不变。

```css
.info-wrapper {
  flex: 0 1 auto;
  min-width: 0;
}

.profile-tags {
  flex: 1;
  min-width: 0; /* flex 子元素允许收缩到 0 */
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end; /* 标签贴右栏数据卡靠拢，视觉平衡 */
  align-items: center;
  padding-left: 8px; /* 与 info-wrapper 之间留视觉间距 */
}
```

`justify-content: flex-end` 让 tag 集中到 profile 行右侧（贴近 data card），与左侧的 avatar+name 信息区形成"身份在左、附加在右"的视觉布局。

### 卡片高度构成（改后）

| 区段 | 高度 |
|------|------|
| profile-section（包含 tags） | ~50px（tag 数量正常时单行不撑高） |
| history grid (4 局，2×2) | ~70px |
| 总和 | ~125-130px |

横向空间：tags 区可用宽度 ≈ 卡片宽度（~280px）- avatar（~40px）- info-wrapper 内容（~120-150px）- gap（~20px）= **~80-110px**

> 注：这比原来 100px 窄栏并没有戏剧性增加横向空间。**优化的核心收益不是"标签横向空间变大"，而是"标签换行不再撑卡"**——因为 profile 行高度由 info-wrapper 内部的两行（name 行 + tagLine 行）决定，tags 即使换行到第二行也不会超过 info-wrapper 已经占据的高度。

## 不在范围内

- 不调整 ARAM 增强/削弱标签的位置
- 不重构 `PlayerStatsCard`（保留 compact / expanded 双态）
- 不重构 `PlayerHistoryGrid`
- 不修改 AI tag 生成逻辑（长度限制、语气、分类规则保持现有）
- 不改 `PlayerCard.vue` 的 props / 对外接口

## 风险与权衡

- **极端情况下 tags 换行到第三行**：当玩家有 6+ 个 AI tag + 队伍标记 + 遇见过时，tags 仍可能换到第三行，把 profile-section 高度从 ~50px 撑到 ~74px。这种情况下卡片确实会加高 ~24px，但同列每张卡按相同规则计算，**仍然等高**。
- **小屏（窄卡片）下 tags 横向空间被进一步压缩**：当卡片宽度变窄时（如响应式调整），tags 区可用宽度急剧下降，换行更容易。本方案不针对极端窄屏特别优化。
- **数据卡顶部不再有标签作为视觉锚点**：原来 tags 在右栏顶部、数据卡在右栏底部形成一个紧凑的"信息列"；改后右栏只剩数据卡。视觉上数据卡会显得更孤立——可以接受，因为换来更整齐的卡片高度。

## 验收

1. 同一列任意 5 张卡片，当所有卡片的 tag 总数（preGroupMarkers + meetGames + userTag.tag）都不触发换行时，`offsetHeight` 严格相等
2. 当某张卡 tag 总数过多触发 `.profile-tags` 换行时，该卡 profile-section 加高一行（~24px），但同列其他卡片如果也触发换行则同步加高；不会出现"右栏单独撑高、profile 行不动"的不齐情况
3. ARAM 模式下，召唤师名旁的增强/削弱 popover 仍在原位
4. tag 区右对齐，最右侧紧贴 right-section 边界
5. 没有任何 tag 时，profile 行视觉无空白凹陷（avatar + info-wrapper 自然铺开）
6. `npm run check` 通过；前端 vitest 不需要新增测试（纯样式调整，无逻辑变更）
