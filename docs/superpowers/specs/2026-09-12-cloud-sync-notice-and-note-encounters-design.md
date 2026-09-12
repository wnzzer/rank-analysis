# 云端配置提醒分层 + 备注遇见记录被动追踪

- 日期：2026-09-12
- 状态：已批准，待写实现计划

## 背景

两个独立的小优化，来自同一次对话里用户提出的体验反馈：

1. 设置页「数据与同步」顶部的云端配置提醒，文案/配色让人容易忽略或读不出严重性。
2. 玩家备注的「遇见记录」功能骨架早就存在（类型、UI 都有），但写入时机太窄，绝大多数备注的遇见记录始终是空的，达不到"记录标记局 + 后续遇见局"的预期。

两者互不依赖，可分别验收，但足够小，合在一份计划里一起做。

## 设计 A：云端配置提醒分层

### 问题

`pinia/cloudSync.ts` 的 `pendingCloudConfig` 字段同时覆盖两种场景，UI（`views/settings/DataSync.vue` 顶部的 `n-alert`）对两者一视同仁：

- **首次绑定**（`syncConfig` 中 `!syncedOnce` 分支）：本机还没同步过，云端有配置且和本机不一致（本机很可能是默认值，没有真实"损失"）。
- **真冲突**（`syncConfig` 中 `syncedOnce` 之后 `configDirty && cloudNewer` 分支）：两边都真的改过设置，选"用云端"会覆盖本机这期间的改动，是有实际代价的决策。

现有文案用"首次绑定，或两台设备都改过"这种含糊的二选一去猜测场景，导致两种场景都读起来不痛不痒——该轻松的时候显得像警告，该郑重的时候又不够郑重。

### 方案

1. **`pinia/cloudSync.ts`**：新增 `pendingCloudConfigReason: Ref<'first-bind' | 'conflict' | null>`，与 `pendingCloudConfig` 同步维护——`syncConfig` 的两处 `pendingCloudConfig.value = pulled` 赋值点分别标注对应 reason；`resolveCloudConfig` 裁决后与 `pendingCloudConfig` 一起清空。
2. **`views/settings/DataSync.vue`** 顶部 `n-alert` 按 `pendingCloudConfigReason` 分叉：
   - `'first-bind'` → `type="success"`，文案："云端存在可用的配置，是否使用"（不再提"覆盖""建议尽快处理"这类警告语气）。
   - `'conflict'` → 保持现有 `type="warning"` 与原文案不变。
3. **`CloudConfigPullDialog.vue`（点"去处理"弹出的裁决框）不变**——内容本身中性，两种场景通用，不拆分。
4. **`SideNavigation.vue` 的呼吸角标发现路径不变**——本次只改文案与配色，不改发现路径。

### 验收

- 首次绑定场景（本机从未同步过、云端有配置、内容不同）：`DataSync.vue` 顶部条目渲染为绿色，文案为"云端存在可用的配置，是否使用"。
- 真冲突场景（已同步过、本机有未推送改动、云端比上次同步更新）：顶部条目仍是黄色警告，文案不变。
- 两种场景点「去处理」弹出的裁决框内容不变。

## 设计 B：备注遇见记录被动追踪

### 问题

`types/domain/playerNote.ts` 的 `PlayerNote.encounters` 字段和对应 UI（`PlayerNoteBadge.vue` 的"遇见记录"面板、`views/settings/PlayerNotes.vue` 的可展开行，均复用 `MettingPlayersCard`）早就存在，但写入只发生在一处：`components/record/MatchDetailModal.vue` 里给 `PlayerNoteBadge` 传 `:encounter="buildEncounter(player)"`，且**仅在用户手动打开该局详情、编辑并保存备注时**才会把"当前这一局"并入 `encounters`（`pinia/playerNotes.ts` 的 `setNote` 里 `mergeEncounters`）。

其余入口（`components/gaming/PlayerCard.vue`——选人/游戏内玩家卡，`components/record/UserRecord.vue`——玩家战绩主页）打备注都不传 `encounter`，且**没有任何被动/自动追踪**：哪怕标记时记上了第一局，之后再同场多少次都不会自动补充。

同时后端 `command/user_tag.rs` 的 `get_user_tag_by_puuid` 在 `RecentData.one_game_players_map` 里已经算好了"查询对象最近 20 场里，每个同场玩家分别是哪几局"（含每局的 champion/KDA/win/isMyTeam），但前端 `types/domain/analysis.ts` 里对应字段名写成了 `oneGamePlayers`（与后端 `#[serde(rename_all = "camelCase")]` 序列化出的 `oneGamePlayersMap` 对不上），这份数据从未被前端读取。

### 方案

#### B1. 修复字段名不对齐（前置）

`types/domain/analysis.ts`：`RecentData.oneGamePlayers: Record<string, OneGamePlayer[]>` 改名为 `oneGamePlayersMap`，类型改为 `Record<string, OneGamePlayer[]> | null`（对应后端 `Option<HashMap<..>>`，`None` 序列化为 `null`）。`defaultRecentData()` 对应默认值改为 `null`。

#### B2. `pinia/playerNotes.ts` 新增 `recordEncounters`

```ts
/**
 * 被动合并遇见记录：只给已有备注的玩家补充新的遇见局，不新建备注、不改 note/label。
 * 没有实际新增 gameId 时不落盘、不推送——避免每次打开自己战绩页都空转一次 updatedAt。
 */
async function recordEncounters(
  puuid: string,
  games: OneGamePlayer[]
): Promise<void> {
  const existing = notes.value[puuid]
  if (!existing || existing.deleted || games.length === 0) return

  const existingIds = new Set((existing.encounters ?? []).map(e => e.gameId))
  const hasNew = games.some(g => !existingIds.has(g.gameId))
  if (!hasNew) return

  let encounters = existing.encounters
  for (const g of games) encounters = mergeEncounters(encounters, g)

  notes.value = {
    ...notes.value,
    [puuid]: { ...existing, updatedAt: nextTs(), encounters }
  }
  userMutationSeq.value++
  await persist()
}
```

- 复用现有 `mergeEncounters`（按 gameId 去重、最近在前、截断 `MAX_ENCOUNTERS`），不改其签名。
- `updatedAt` 会推进（`nextTs()`），`userMutationSeq` 会递增——按前面确认的口径，被动补充算真实更新：设置页备注列表排序会反映最新遇见，且会经现有 30 秒防抖推送到云端。
- 只处理**已有备注**的 puuid，不新建；不影响 `note`/`label` 内容。

#### B3. 接入点：`components/record/UserRecord.vue`

`getTags()` 拿到 `user_tag.recentData` 后，仅当本次查询对象是"我自己"时执行被动扫描：

```ts
const { summoner: mySummoner } = useGameState() // 已有的当前登录召唤师

const getTags = async (name: string, mode: number) => {
  const user_tag = await invoke<UserTag>('get_user_tag_by_name', { name, mode })
  tags.value = user_tag.tag
  recentData.value = user_tag.recentData

  if (summoner.value.puuid && summoner.value.puuid === mySummoner.value?.puuid) {
    const map = recentData.value.oneGamePlayersMap ?? {}
    for (const [otherPuuid, games] of Object.entries(map)) {
      if (notesStore.getNote(otherPuuid)) {
        notesStore.recordEncounters(otherPuuid, games).catch(() => {})
      }
    }
  }
}
```

- 判定"是我自己"用 `summoner.value.puuid`（本次查询返回的 summoner）与 `useGameState()` 暴露的当前登录召唤师 puuid 比对，查看别人战绩页不触发——避免把两个陌生人之间的同场误记成"我的遇见"。
- 应用启动连上 LCU 后会自动跳转 `/Record?name=我自己`（`views/Loading.vue`），因此这个扫描在几乎每次启动时都会自然执行一次，不需要额外的定时任务或后台轮询。

#### B4. 现状保留

- `MatchDetailModal.vue` 现有的显式 `encounter` 记录不变——覆盖"标记的人不在我自己最近 20 场里"这类被动扫描覆盖不到的情况（例如在对手的战绩详情页里认出并标记一个跟你同局过、但已经滚出你自己最近 20 场窗口的人），两者互补。
- `PlayerCard.vue`、`UserRecord.vue` 的 `PlayerNoteBadge` 不新增 `encounter` 入参——被动追踪已覆盖这类场景，没必要再造一个显式入口。
- 展示 UI（`PlayerNoteBadge.vue` 遇见记录面板、`PlayerNotes.vue` 展开行）不变。

### 验收

- 已有备注的玩家，若其 puuid 出现在"我自己"最近 20 场的同场玩家里，打开一次自己的战绩页后，该玩家的备注 `encounters` 应包含这些局（按 gameId 去重、最近在前）。
- 重复打开自己战绩页、数据没有新的同场记录时，对应备注的 `updatedAt` 不应变化（不触发不必要的重排/同步）。
- 查看别人的战绩主页不应触发任何 `recordEncounters` 调用。
- 没有备注的玩家，即便同场，也不会被自动建一条新备注。

## 范围外（本次明确不做）

- 宿敌/好友统计的 4 个既有问题（分类逻辑、门槛计算、`take(5)` 无序截断、宿敌栏胜率取反）——已与用户确认本次不动。
- 云端配置提醒的"发现路径"（导航栏/设置菜单呼吸角标）——已与用户确认本次不动，只改文案与配色。

## 测试要点

- **`pinia/cloudSync.ts`**：`pendingCloudConfigReason` 在首次绑定分支置 `'first-bind'`、真冲突分支置 `'conflict'`；`resolveCloudConfig` 裁决后两个字段一起清空。
- **`views/settings/DataSync.vue`**：按 `pendingCloudConfigReason` 渲染对应 `type` 与文案的快照/断言测试。
- **`pinia/playerNotes.ts` 的 `recordEncounters`**：无变化时不落盘不推送；有新 gameId 时正确合并、去重、截断、推进 `updatedAt` 与 `userMutationSeq`；对不存在/已删除（墓碑）的 puuid 静默跳过。
- **`UserRecord.vue`**：查询"我自己"且命中已有备注的同场玩家时调用 `recordEncounters`；查询他人时不调用。
