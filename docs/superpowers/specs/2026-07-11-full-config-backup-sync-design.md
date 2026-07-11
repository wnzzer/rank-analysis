# 全量配置备份 + 云同步 设计

日期:2026-07-11
状态:已与用户确认
前置:PR #94(玩家备注导入导出 + Supabase 云同步)已合入、未发版

## 背景与目标

现有备份/云同步只覆盖玩家备注(`playerNotes`)。目标扩展为**全量配置**:

1. 文件导出/导入覆盖全量配置(含备注);
2. 云同步覆盖配置(与备注同一开关);
3. 本设备首次同步且云端已有配置时,弹窗确认后才覆盖本地——拉取覆盖必须有用户确认兜底。

## 范围:黑名单制

备份/同步内容 = config.yaml 全量键值,减去黑名单。黑名单在 **Rust 侧定义一处常量**,文件导出与云同步共用;新增配置键默认纳入备份,新增敏感键必须记得登记黑名单(接受此风险,换取"不怕漏")。

| 键 | 文件导出 | 云同步 | 排除原因 |
|---|---|---|---|
| `cloudSyncSession` | ✗ | ✗ | 本设备 Supabase 匿名凭据,外泄=账号漂移 |
| `gameInstallPath` | ✗ | ✗ | 本机路径,跨机无意义,后端会自动重新探测 |
| `cloudSyncEnabled` | ✗ | ✗ | 设备级开关,同步它会远程改变其他设备的同步行为 |
| `errorReportingConsentShown` / `cloudSyncNoticeShown` | ✗ | ✗ | 设备级一次性弹窗记录 |
| `dashscopeApiKey` | ✓ | ✗ | 用户自有 AI key;云端按 puuid 寻址任何人可读,放上去=公开;文件由用户自己保管,包含 |
| 其余所有键(theme、matchHistoryCount、settings.auto.*、pickRules/banRules、userTags、playerNotes、aiUsePlayerNotes、errorReportingEnabled、settings.user.selectMode…) | ✓ | ✓ | — |

`playerNotes` 在**文件导出**中包含(全量语义);**云端**仍走既有的 `data_type='playerNotes'` 逐条合并通道,`appConfig` 行内不重复存备注(避免同一数据两条通道两种合并语义打架)。

## 备份文件格式(v2,不做 v1 兼容)

```jsonc
{
  "version": 2,
  "type": "rank-analysis-backup",
  "exportedAt": 1783700000000,
  "playerNotes": { /* PlayerNotesMap */ },
  "appConfig": { /* 黑名单过滤后的 config 键值,含 dashscopeApiKey */ }
}
```

- 导出按钮文案改为"导出全量备份",旁注提示文件含 API key、请妥善保管。
- 导入:`playerNotes` 走既有逐条合并(`mergePlayerNotes`,updatedAt 新者赢);`appConfig` 弹确认框后**整份覆盖**本地(逐键写入,黑名单键即使出现在文件里也跳过)。
- `version !== 2` 直接报"备份文件版本不支持"。备注导入导出功能未发版,无存量 v1 文件,不做兼容分支。

## 云端存储

- 复用 `sync_data` 表与匿名会话/RLS,新增 `data_type='appConfig'`,每设备一行(与 notes 行同构)。
- 新增 Rust command:
  - `cloud_pull_config(puuid) -> Option<{ config, updatedAt }>`:拉所有设备的 appConfig 行,返回 `updated_at` 最新的一份(已含黑名单过滤,防御云端脏数据)。
  - `cloud_push_config(puuid)`:后端自己读 config、过滤黑名单后推送本设备行。**过滤在 Rust 侧完成,前端拿不到未过滤快照**,杜绝前端漏过滤导致凭据上云。
- 文件导出同理:后端提供 `export_backup(path)` / `import_backup(path)` 类 command,过滤逻辑不下放前端。

## 同步流程(单开关)

沿用现有 `cloudSyncEnabled` 开关,语义升级为"同步备注 + 配置";风险告知弹窗文案补充"你的应用配置(不含 API key)也会同步"。

### 首次同步(本设备)

判定:本地无 `configSyncedOnce` 标记(该标记本身入黑名单,设备级)。

1. 拉云端最新 `appConfig` 行;
2. **云端存在且与本地不一致** → 弹窗:"云端已有一份配置(更新于 X),是否用它覆盖本地?"
   - 确认 → 整份应用 + 立即生效;
   - 拒绝 → 保留本地,并把本地推送上云(覆盖云端);
3. 云端不存在,或与本地一致 → 静默推送本地(播种/对齐),不弹窗;
4. 任一分支完成后写 `configSyncedOnce=true`。

弹窗只在"内容不一致"时出现:一致时覆盖是空操作,弹窗徒增打扰(用户已确认此裁决)。"不一致"= 双方黑名单过滤后快照的深度相等比较(serde_json Value 相等),不看时间戳。

### 之后每次启动

静默整份后写胜(LWW):云端最新行 `updated_at` > 本地 `configLastSyncAt`(本设备上次推送/应用配置的时刻,黑名单键)→ 整份应用;否则推送本地。与既有备注同步在同一次 `syncNow` 编排中执行;LoL 未连接时沿用既有的 `lcuConnected` watch 补触发。

### change 自动推送

- 侦测:利用 `config.rs` 既有 `register_on_change_callback`——黑名单外的键变更时向前端 emit `config-changed` 事件(覆盖 `putConfigByIpc` 和 Rust 直写如 `save_tag_configs` 两条写路径)。
- 前端 cloudSync store 收到事件 → 复用既有 30 秒防抖 → `cloud_push_config`。
- **回环抑制**:应用云端配置期间置 `applying` 标记,期间的 change 事件不触发推送(否则拉取→写入→触发 change→再推送,死循环)。

## 生效机制(拉取覆盖后立即生效)

- 应用 = 后端逐键写入 config(黑名单键跳过)→ 完成后 emit `config-applied` 事件;
- 前端订阅该事件,重载受影响 store:theme 立即切换;playerNotes store 重载(文件导入路径);设置页/自动化页组件打开时现读,无需额外处理;
- 备注:`config-applied` 与 `config-changed` 的抑制窗口由同一 `applying` 标记管理。

## 错误处理

- 云端拉取/推送失败:沿用既有静默失败 + `lastError` 展示模式,不阻塞启动;
- 首次同步弹窗期间 app 被关闭:未写 `configSyncedOnce`,下次启动重新走首次流程;
- 导入文件校验失败(非 v2 / 容器形状不对):报错不落盘,与既有 `isBackupFile` 校验对称;
- 云端 `appConfig` 行形状不可信(jsonb 可被任意写):Rust 侧反序列化失败按"云端无配置"处理,并过滤其中的黑名单键。

## 测试

- **Rust**:黑名单过滤(dashscopeApiKey 云端剔除、文件保留;cloudSyncSession 两边剔除)、v2 文件校验与版本拒绝、LWW 判定(updated_at vs configLastSyncAt)、云端脏数据容错;
- **前端(vitest)**:首次同步三分支(覆盖/拒绝/云端为空)、一致时不弹窗、防抖推送与回环抑制、`config-applied` 触发 store 重载;
- **端到端**:dev 模式经 MCP bridge 驱动真实 Supabase 验证(方法见项目记忆 e2e-testing-via-mcp-bridge)。

## 已否决的备选

- 白名单制(易漏新键)、逐键时间戳合并(需改核心写路径,过度设计)、拉取只填空不覆盖(同步能力太弱)、配置与备注分开关/分文件(单人场景想象需求)、v1 兼容(无存量文件)。
