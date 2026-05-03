# PlayerCard 标签布局重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `PlayerCard.vue` 的标签区从右栏 `tags-container`（width: 100px）拆出，作为 `profile-section` 内的第三个 flex 子元素 `flex: 1`，让 tags 跟 avatar/info-wrapper 同行右对齐，使卡片高度由 left-section 的 profile + history grid 决定，与标签数量解耦。

**Architecture:** 仅修改 `lol-record-analysis-tauri/src/components/gaming/PlayerCard.vue` 一个文件的 template 与 scoped CSS。`right-section` 删掉 `tags-container`，只保留 `PlayerStatsCard`；`profile-section` 内 flex 容器加第三个子元素 `.profile-tags` 持有所有标签（preGroupMarkers / meetGames / userTag.tag），右对齐贴近右栏。ARAM 增强/削弱 popover 仍保留在 `info-wrapper` 内，不动。

**Tech Stack:** Vue 3 + TypeScript + naive-ui + scoped CSS

**Spec:** `docs/superpowers/specs/2026-05-03-player-card-tag-layout-design.md`

---

## File Structure

仅一个文件改动：

- Modify: `lol-record-analysis-tauri/src/components/gaming/PlayerCard.vue`
  - Template: 把 tags-container 的内容（含 `n-tag preGroupMarkers`、`n-tag 遇见过 + popover`、`v-for userTag.tag` 的 `n-tooltip`）从 `right-section` 内的 `<div class="tags-container">` 整体迁移到 `profile-section` 的 `<n-flex>` 内 info-wrapper 之后的新 `<div class="profile-tags">`。
  - CSS: 删除 `.tags-container`；新增 `.profile-tags`；`profile-section` 的 `<n-flex>` 横向容器需要确保 info-wrapper 不再 `flex: 1` 抢占空间（让 tags 区拿到剩余空间）。

---

## Task 1: 重构 PlayerCard.vue 标签布局

**Files:**
- Modify: `lol-record-analysis-tauri/src/components/gaming/PlayerCard.vue`

### Step 1: 读取当前 PlayerCard.vue 完整内容

- [ ] 用 Read 工具读 `lol-record-analysis-tauri/src/components/gaming/PlayerCard.vue` 全文，确认当前模板结构（特别是 `.profile-section` 内 `<n-flex>` 的子元素布局，以及 `.right-section` 内 `.tags-container` 的位置）。

预期：
- profile-section 内 `<n-flex align="center" :wrap="false" style="gap: 10px">` 含两个子元素：`.avatar-wrapper`（40×40 头像）和 `.info-wrapper`（name 行 + tagLine 行）
- right-section 内有 `.tags-container`（标签）+ `<PlayerStatsCard>`
- `.right-section` 是 `width: 100px; flex-shrink: 0`，`.left-section` 是 `flex: 1; min-width: 0`
- `.info-wrapper` 当前是 `flex: 1; min-width: 0`（需要修改）

### Step 2: 修改 template — 在 profile-section 的 n-flex 内 info-wrapper 后追加 .profile-tags

将 `profile-section` 内的 `<n-flex>` 子元素由 2 个变为 3 个，新增第三个 `.profile-tags`：

- [ ] 用 Edit 工具修改 template。

定位 profile-section 内 `<n-flex align="center" :wrap="false" style="gap: 10px">` 块（约 45 行起），在 `.info-wrapper` 闭合的 `</div>` 之后、外层 `</n-flex>` 之前，追加：

```vue
            <div class="profile-tags">
              <n-tag
                v-if="sessionSummoner.preGroupMarkers?.name"
                size="small"
                :type="sessionSummoner.preGroupMarkers.type as any"
              >
                {{ sessionSummoner.preGroupMarkers.name }}
              </n-tag>
              <n-tag v-if="sessionSummoner.meetGames?.length > 0" type="warning" size="small" round>
                <n-popover trigger="hover">
                  <template #trigger>遇见过</template>
                  <MettingPlayersCard :meet-games="sessionSummoner.meetGames"></MettingPlayersCard>
                </n-popover>
              </n-tag>
              <n-tooltip
                v-for="tag in sessionSummoner?.userTag.tag"
                :key="tag.tagName"
                trigger="hover"
              >
                <template #trigger>
                  <n-tag size="small" :type="tag.good ? 'success' : 'error'" :bordered="false">
                    {{ tag.tagName }}
                  </n-tag>
                </template>
                <span>{{ tag.tagDesc }}</span>
              </n-tooltip>
            </div>
```

### Step 3: 修改 template — 删除 right-section 内的 tags-container 整段

- [ ] 用 Edit 工具删除 right-section 内 `<div class="tags-container">...</div>` 整段。

定位 `<!-- Right Side: Tags & Stats -->` 注释下方的 `<div class="right-section">` 内整个 `<div class="tags-container">` 块（含内部的 `<n-flex>` 和 4 个标签子元素），将其整段删除。删除后 right-section 内只剩 `<PlayerStatsCard ... />`。

同时把 `<!-- Right Side: Tags & Stats -->` 注释改为 `<!-- Right Side: Stats -->`。

### Step 4: 修改 CSS — 新增 .profile-tags、删除 .tags-container

- [ ] 用 Edit 工具替换 CSS。

定位 `.tags-container { min-height: 24px; }` 整段并删除。

在 `.tag-line` 与 `.tier-icon` 之间（或任意合理位置）新增：

```css
.profile-tags {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
  align-items: center;
  padding-left: 8px;
}
```

说明：
- `flex: 1; min-width: 0` 让 tags 区拿到 profile 行剩余横向空间且允许收缩到 0（避免 flex item 默认 min-content 撑爆容器）
- `justify-content: flex-end` 让 tags 集中到右侧贴近 data card
- `align-items: center` 单行场景下让 tag 在垂直方向居中
- `padding-left: 8px` 与 info-wrapper 之间留视觉间距

### Step 5: 修改 CSS — info-wrapper 不再独占剩余空间

- [ ] 用 Edit 工具修改 `.info-wrapper`。

当前：
```css
.info-wrapper {
  flex: 1;
  min-width: 0;
}
```

改为：
```css
.info-wrapper {
  flex: 0 1 auto;
  min-width: 0;
}
```

说明：原来 `flex: 1` 会让 info-wrapper 抢占整行剩余空间，导致后面追加的 `.profile-tags` 拿不到 flex 剩余。改为 `flex: 0 1 auto` 让 info-wrapper 按内容自然尺寸占据，剩余空间留给 `.profile-tags`。gameName 已被 `<n-ellipsis style="max-width: 110px">` 截断兜底，info-wrapper 不会被超长名字撑过头。

### Step 6: 运行前端类型检查与 lint

- [ ] 在 `lol-record-analysis-tauri` 目录运行：

```bash
cd lol-record-analysis-tauri && npm run check
```

预期：通过（prettier + eslint + vue-tsc + cargo fmt --check + cargo clippy 全绿）。

如失败：根据报错定位修复。常见可能：
- prettier 缩进不一致 → 让 prettier 自动 format
- eslint 未使用变量 → 检查是否还有遗留的 tags-container 相关代码

### Step 7: 启动 dev 模式视觉验证

- [ ] 在 `lol-record-analysis-tauri` 目录后台启动：

```bash
cd lol-record-analysis-tauri && npm run dev
```

- [ ] 等待 Tauri 窗口起来（或前端 vite dev server 起来），打开"对局"页（如有正在进行的对局）或战绩页面观察 PlayerCard。

视觉验收清单（对照 spec § 验收）：
1. **同列卡片等高**：同一队 5 张卡片，当 tag 数量正常（≤4 个）时高度严格相等
2. **tags 右对齐**：tags 在 profile 行右侧紧贴 data card 列
3. **ARAM 标签未动**：ARAM 模式下召唤师名旁的增强/削弱 popover 仍在原位（不在 .profile-tags 里）
4. **空标签态**：没有任何 tag 的卡片，profile 行视觉无空白凹陷，avatar+info-wrapper 自然铺开
5. **多标签换行**：当某玩家有 6+ tag 时，profile-tags 换行到第二行，profile-section 加高一行——但同列其他卡片如同样多 tag 也应同步换行（否则就是预期行为，不是 bug）
6. **暗色 / 亮色主题切换**正常

如有视觉问题：回到 Step 4 或 Step 5 调整 CSS 数值。

### Step 8: 提交

- [ ] 触发 shipping-changes skill 走质量门禁与提交流程：

```bash
cd "C:/Users/wnzzer/rank-analysis"
git add lol-record-analysis-tauri/src/components/gaming/PlayerCard.vue
git commit -m "refactor(player-card): 标签内联到 profile 行右侧 + 高度与 tag 数量解耦"
```

提交信息说明：refactor 类型、scope `player-card`，描述聚焦于"为什么"——卡片高度不再被标签数量撑开。

---

## Self-Review

完成所有 step 后，对照 spec § 验收清单逐条复核：

- [ ] 验收 1: 同列等高（tag 总数都未触发换行时）
- [ ] 验收 2: 部分卡 tag 多到换行时，profile-section 加高一行；不出现"右栏单独撑高"的旧不齐
- [ ] 验收 3: ARAM 增强/削弱 popover 仍在 info-wrapper 内
- [ ] 验收 4: tag 区右对齐，最右紧贴 right-section 边界
- [ ] 验收 5: 没有任何 tag 时 profile 行无空白凹陷
- [ ] 验收 6: `npm run check` 通过；vitest 无需新增测试

如发现 spec 验收无法满足，回到对应 step 调整后再次验证。
