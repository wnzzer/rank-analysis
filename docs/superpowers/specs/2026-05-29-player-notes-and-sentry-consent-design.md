# 玩家备注 + Sentry 首次同意弹窗 设计

日期: 2026-05-29
关联: issue #67(标记玩家)、commit 6163f86(Sentry opt-in)

## Context（为什么做）

两个独立但相关的需求：

1. **玩家备注（issue #67）**：用户希望给碰到过的人留"备注 + 颜色标记"（友好 / 一般 / 小心 / 拉黑），
   在对局玩家卡和玩家详情页都能看到，并能在设置里集中管理。社区讨论结论是
   **单机本地版即可**（区里人少、常遇到重复的人，留个提醒就够，不追求"挂人"共享）。

2. **Sentry 首次同意弹窗**：#70 已接入 opt-in 错误上报（release 默认关闭）。
   现在没有任何首次提示，用户不知道这功能存在。目标是**提高透明度并适度抬高开启率**，
   做法是首次启动弹一次说明 + 默认推荐启用，但**保留真实拒绝、不强制**。

两个功能都**零 Rust 改动**：存储复用现有 `config` IPC，不新增 Tauri command、不碰 `config.rs`。

## 设计一：玩家备注

### 数据模型

新建 `src/types/domain/playerNote.ts`：

```ts
export type NoteLabel = 'friendly' | 'normal' | 'careful' | 'blacklist'

export interface PlayerNote {
  note: string        // 备注文本，可为空（只标颜色不写字）
  label: NoteLabel
  gameName: string    // 冗余存一份，用于设置列表展示（puuid 不可读）
  tagLine: string
  updatedAt: number   // 毫秒时间戳
}
```

存储：复用 config 系统，key = `"playerNotes"`，值为 `Record<puuid, PlayerNote>`。
通过现有 `putConfigByIpc('playerNotes', map)` / `getConfigByIpc('playerNotes')`（`src/services/ipc.ts`）。

### 状态层

新建 Pinia store `src/pinia/playerNotes.ts`（仿 `src/pinia/setting.ts` 结构）：

- `notes: Ref<Record<string, PlayerNote>>` 内存副本
- `init()`：从 `getConfigByIpc('playerNotes')` 载入，由 `main.ts` 启动时调用（仿 `initTheme()`）
- `getNote(puuid): PlayerNote | undefined`
- `setNote(puuid, { note, label, gameName, tagLine })`：写内存 + 整体 `putConfigByIpc` 落盘 + 盖 `updatedAt`
- `removeNote(puuid)`：删内存 + 落盘

组件只读 store / 调 store 方法，**不直接碰 IPC**。

### 颜色映射（纯函数，可测）

在 `playerNote.ts` 导出 `NOTE_LABELS`（含 `value / text / naiveType / cssVar`）：

| label | 文案 | 颜色（复用现有 CSS 变量） | naive type |
|---|---|---|---|
| friendly | 友好 | `--semantic-win`（绿） | success |
| normal | 一般 | 默认灰 | default |
| careful | 小心 | warning（橙） | warning |
| blacklist | 拉黑 | `--semantic-loss`（红） | error |

### 展示组件

新建 `src/components/common/PlayerNoteBadge.vue`（props: `puuid`, `gameName`, `tagLine`, 可选 `size`）：

- **有备注**：显示对应颜色的小色块/圆点 + `n-popover`，hover/点击弹出备注文字 + 「编辑」入口。
- **无备注**：显示一个淡色"加备注"小图标按钮。
- **编辑态**：`n-popover` 内嵌四档颜色选择（`n-radio-group` 或色块按钮）+ `n-input` 文本框 + 保存/删除。
  不再单开 modal，就地编辑。
- 保存时调 `store.setNote(puuid, ...)`，把 `gameName/tagLine` 一起传入用于列表展示。

### 接入点

- `src/components/gaming/PlayerCard.vue`：在复制按钮（L74 附近）旁放一个 `<PlayerNoteBadge>`。
- `src/components/record/UserRecord.vue`：在复制按钮（L21 附近）旁放一个 `<PlayerNoteBadge>`。

### 设置页：我标记过的人

- `src/views/settings/PlayerNotes.vue`（新页面，仿 `Tags.vue` 的 `n-data-table`）：
  列出 名字#tag、颜色标签（`n-tag`）、备注、更新时间、删除按钮（`n-popconfirm`）。
  空状态友好提示。
- `src/views/Settings.vue`：`menuOptions` 加一项 `{ label: '我标记过的人', key: 'PlayerNotes', icon: ... }`。
- `src/router/index.ts`：`/Settings` children 加 `PlayerNotes` 路由。

### 已知局限（写进 README/CHANGELOG）

纯本地存储，换机 / 重装会丢失，无法跨设备同步。冗余存 `gameName/tagLine` 仅供展示，
玩家改名后列表可能显示旧名（备注仍按 puuid 生效）。

## 设计二：Sentry 首次同意弹窗

### 保持现状

`errorReportingEnabled` 默认 false 不变；`General.vue` 的开关不动。

### 新增配置键

`"errorReportingConsentShown"`（非自动默认键，读出 `undefined` 即视为"未问过"）。

### 首次弹窗逻辑

在 `src/components/Framework.vue` 的 `onMounted` 中（已能用 `currentWindow.label` 排除
`match-detail-` 子窗口，避免多窗口重复弹）：

1. 若是 `match-detail-` 子窗口 → 跳过。
2. `getConfigByIpc('errorReportingConsentShown')`，已问过 → 跳过。
3. 未问过 → `useDialog().info(...)`：
   - 标题：「帮助改进应用？」
   - 正文（利己 + 开源可查 + 脱敏清单，3 行内）：
     说明仅上报已脱敏的崩溃/报错堆栈，**不含**召唤师名 / puuid / 对局数据；
     本项目开源，上报内容可在代码中查看；默认关闭，随时可在设置→常规修改。
   - **正向按钮（primary、强调，预选效果）**：「好，帮忙改进」→ `putConfigByIpc('errorReportingEnabled', true)`，提示重启生效。
   - **否定按钮（中性、真实可点）**：「不，保持关闭」→ 不改 enabled。**不使用 confirmshaming 文案。**
   - 两个分支都写 `putConfigByIpc('errorReportingConsentShown', true)`，永久不再弹。
   - `closable: false` / `maskClosable: false` / `closeOnEsc: false`：逼用户明确二选一（否则下次还弹）。

### 不做

- 不做"出错时弹 / N 天后 banner 轻推"——ROI 最低、状态最多、最难维护。
- 不做预勾选 + 强制同意（不让用就退出）——非必要功能不该当门票，开源项目尤其招黑，且是 #70 的回退。
- "预选"仅通过**正向按钮强调 + 默认推荐启用**实现，不剥夺真实拒绝权。

## 测试

- `src/pinia/__tests__/playerNotes.spec.ts`：mock IPC，测 set/get/remove + 落盘调用 + updatedAt。
- `src/types/domain/__tests__/playerNote.spec.ts`（或并入上）：测 `NOTE_LABELS` 映射完整。
- 组件层依赖 naive-ui，优先保证 store/纯函数覆盖；UI 用运行中客户端 + Tauri MCP 手动验证。

## 验证（端到端）

1. `cd lol-record-analysis-tauri && npm run check && npm run test` 全绿。
2. LoL 客户端运行下，借 Tauri MCP（webview 截图/交互）验证：
   - 对局卡 / 详情页能加备注、选颜色、看到色块、编辑、删除。
   - 设置「我标记过的人」列表正确展示与删除。
   - 首启弹窗：选「启用」后 `errorReportingEnabled=true`；选「不」后保持 false；二者都不再弹。
