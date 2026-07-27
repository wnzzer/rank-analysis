# 战绩详情页「观看回放」设计

- 日期：2026-07-27
- 分支：`worktree-match-replay`（基于 `main` @ 67da92e）
- 目标：战绩详情页（`MatchDetailModal.vue`）支持一键观看该局回放

## 背景与约束

`.rofl` 是 Riot 私有格式，只有游戏客户端本身能播放——**不存在自研播放器的选项**，
整条链路必须走 LCU 的 `lol-replays` 接口。

国服是否支持这组接口没有可靠公开资料，且 LOL 客户端是提权进程、外部 shell 拿不到
它的 `remoting-auth-token`（`CommandLine` 读出为空，`lockfile` 是 0 字节的陈旧文件），
所以**先做了真机探针**，本设计的每一条接口行为都是实测结论，不是推测。

## 实测结论（2026-07-27，国服 TJ100，客户端 `16.14.794.9266`）

探针方式：在 worktree 里加临时 `probe_lcu` 命令，经 tauri-plugin-mcp-bridge
（本实例自动占用 9224，未干扰已在跑的 9223 实例）驱动。

### 可用端点

| 请求 | 结果 |
| --- | --- |
| `GET lol-replays/v1/configuration` | 200 —— `isReplaysEnabled:true`、`isReplaysForMatchHistoryEnabled:true`、`gameVersion:"16.14.794.9266"`、`isPlayingReplay`、`minutesUntilReplayConsideredLost:30` |
| `GET lol-replays/v1/rofls/path` | 200 —— `"C:/Users/<user>/Documents/League of Legends/Replays"` |
| `POST lol-replays/v1/rofls/{gameId}/download` | 204（body `{"componentType":"string"}`） |
| `GET lol-replays/v1/metadata/{gameId}` | 200 —— `{gameId, state, downloadProgress}` |
| `POST lol-replays/v1/rofls/{gameId}/watch` | 204 —— 实测拉起 `League of Legends.exe`，`isPlayingReplay` 转 `true` |

**结论：国服完整支持回放，全链路已跑通。** 实测下载产出
`TJ100-300934069971.rofl`（7.4 MB），随后 `watch` 成功进入回放。

### 不存在的端点（勿再尝试）

`lol-replays/v2/metadata/{id}`、`lol-replays/v1/rofls/{id}`、
`lol-replays/v1/rofls/{id}/download/path`、`lol-replays/v1/metadata/create`
均返回 404 `RESOURCE_NOT_FOUND` / `"Invalid URI format"`。
`metadata/{gameId}` 是 **GET-only**（POST → 405 `WRONG_METHOD`）。

> 排错要点：LCU 的两种 404 含义不同——`RPC_ERROR` 表示**路由存在但没数据**，
> `RESOURCE_NOT_FOUND` + `"Invalid URI format"` 才表示**路由不存在**。

### 四个反直觉的坑（直接决定设计）

1. **`GET metadata` 在任何 download 之前必然 404**，body 明说
   `"Plugin found no local metadata. Try using the POST metadata create endpoint first."`
   → **不能靠 metadata 做无副作用的可用性预判**（否则光是打开详情页就会触发下载）。
2. **`downloadProgress` 不是百分比**。`checking` 态实测为 `203028176` 这类垃圾值，
   只有 `state==="watch"` 时的 `100` 可信 → **不能拿它渲染进度条**。
3. **非法 / 不属于本人的 gameId 永远停在 `checking`**，不会转入任何终态错误
   （实测轮询 16s 无变化）→ **轮询必须有超时兜底**，"卡在 checking" 就是失败信号。
4. `POST download` 对任意 gameId（哪怕 `1`）都返回 204 → **204 不代表这局有回放**。

### 使可用性预判成立的两个事实

- 回放文件名规律为 `{platformId}-{gameId}.rofl`，而 `Game.platformId` 前端已有 →
  **查文件是否存在 = 零副作用地判断"是否已下载"**。
- `lol-match-history/v1/games/{gameId}` 返回 `gameVersion:"16.14.794.9266"`，
  与 `configuration.gameVersion` **同格式** → 比对 `major.minor` 即可零副作用地
  判断"补丁是否匹配"。当前 Rust `GameDetail` 与前端 `Game` 都**未**取该字段，需补上。

## 设计

### 分层

| 层 | 文件 | 职责 |
| --- | --- | --- |
| LCU 封装 | `src-tauri/src/lcu/api/replay.rs` | 上表 5 个端点的薄封装 |
| 命令 + 归一 | `src-tauri/src/command/replay.rs` | 暴露给前端的 command；把实测状态归一成 UI 直接可用的结论 |
| 编排 | `src/composables/useMatchReplay.ts` | 一键流程、轮询、超时、清理 |
| UI | `src/components/record/MatchDetailModal.vue` | header 右侧「观看回放」按钮 |

同时在 `lcu/util/http.rs` 增加 `lcu_get_with_status` / `lcu_post_with_status`：
现有 `lcu_get` 把一切非 200 压成同一句「请求失败或认证失效」，而回放接口**用状态码
和 errorCode 表达业务含义**，压掉就拿不到要展示给用户的原因。

### 可用性预判（打开详情页时，无副作用）

按序短路，第一个命中的即为结论：

| 条件 | 按钮 |
| --- | --- |
| LCU 连不上 | 禁用 ·「未检测到游戏客户端，请先启动游戏」 |
| `isReplaysEnabled === false` | 禁用 ·「当前客户端未开启回放功能」 |
| `isPlayingReplay === true` | 禁用 ·「正在播放其他回放」 |
| 对局 `gameVersion` 与客户端 `major.minor` 不符 | 禁用 ·「该对局为旧版本（16.13），当前客户端 16.14，无法观看」 |
| `.rofl` 已存在 | 可点 ·「观看回放」（跳过下载直接播） |
| 其余 | 可点 ·「观看回放」 |

### 点击后的流程

```
.rofl 已存在？
  ├─ 是 → POST watch
  └─ 否 → POST download
           └─ 每 1s 轮询 GET metadata
                ├─ state === "watch"  → POST watch
                ├─ 超时 60s           → 失败：「未能获取该对局回放，可能已过期或不可用」
                └─ 其他 state         → 继续轮询
```

- 轮询间隔 1s（`lcu_get` 自带 100ms singleflight，不会被误合并）。
- 超时 60s：兼顾"卡在 checking 的无效局"与"大文件下载"。实测 7.4 MB 秒级完成。
- 组件卸载时必须清除定时器。
- 进度**不显示百分比**（坑 2），改用不确定态文案「正在获取回放…」。

### UI

按钮置于 header 右侧 `match-detail-summary-side`，紧邻「AI 整局复盘」，复用同一套
`n-tooltip + n-button`。**沿用该文件已记录的教训：不用 `:loading`**——naive-ui
的 Button 在 loading 时不 emit click，会导致按钮再也点不回来；进行中用图标与文案表达。

## 测试

- Rust 纯函数单测：状态归一（各 state → 结论）、`gameVersion` 的 `major.minor` 比对
  （含缺字段 / 格式异常兜底）、`.rofl` 文件名拼接。
- 前端 `useMatchReplay.spec.ts`（mock invoke）：已下载直接播、未下载先下再播、
  轮询超时报错、不可用时不发任何请求、卸载清定时器。

## 收尾

探针代码（`probe_lcu` / `probe_replay_*`）**必须在实现完成前删除**——`probe_lcu`
等于把任意 LCU 调用暴露给前端。`lcu_*_with_status` 两个 helper 保留，是正式实现的一部分。

## 未实测的分支

`download` / `downloading` / `lost` / `incompatible` / `found` 这些 state 未能构造出来
（账号 50 局战绩全在当前补丁内）。设计上只把 `watch` 当成功终态、其余一律继续轮询到
超时，因此未知取值不会导致错误行为，只会走超时文案。
