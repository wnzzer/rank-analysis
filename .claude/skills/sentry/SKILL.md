---
name: sentry
description: 查 rank-analysis 项目的 Sentry 数据（日活/DAU、日志量、错误趋势、release 分布、issue 列表）。直接走 Sentry REST API，不走 mcp.sentry.dev（那玩意的 search_events agent 烂了）。当用户问"DAU""日活""日志量""log 用量""错误数""error 趋势""release 分布""线上 issue""Sentry 上 xx"时触发。
---

# Sentry 查询 (rank-analysis)

## 为什么不用 MCP

`mcp.sentry.dev` 的 `search_events` / `search_issues` 内嵌了一个 LLM agent 做自然语言→Sentry 查询语法的翻译。Sentry 那边 LLM provider 配置坏了（见 getsentry/sentry-mcp#779、#781），统统返回 "Feature Unavailable / server configuration issue"。

我们这边自己能写 Sentry 查询语法，绕掉 agent 直接调 REST API 即可。

## 前置条件

```bash
echo $SENTRY_TOKEN | head -c 10   # 应该输出 sntryu_xxxx
```

如果没有：
1. https://sentry.io/settings/account/api/auth-tokens/ 新建 user auth token
2. 勾 scope：`org:read` + `event:read`（足够查询；写操作再勾对应 scope）
3. `export SENTRY_TOKEN=sntryu_...` 加到 shell rc

固定参数：
- `organizationSlug` = `rank-analysis`
- `projectSlug` = `lol-record-analysis-tauri`
- Sentry release 命名约定 = `lol-record-analysis-app@<version>`（来自 `tauri.conf.json` 的 `version`）

## 核心 API

所有查询走两个端点：

| 用途 | 端点 |
|---|---|
| 单点聚合（count / count_unique） | `GET /api/0/organizations/{org}/events/` |
| 时间序列（按天/小时切片） | `GET /api/0/organizations/{org}/events-stats/` |
| 已分组 issue 列表 | `GET /api/0/organizations/{org}/issues/` |
| Sessions（DAU 用） | `GET /api/0/organizations/{org}/sessions/` |
| Releases 列表 + 健康 | `GET /api/0/organizations/{org}/releases/` |

通用查询参数：
- `dataset` ∈ `errors` / `ourlogs`（注意是 **ourlogs** 不是 logs）/ `spans` / `metrics` / `profiles`
- `field` 重复传多个，例：`field=release&field=count()&field=count_unique(user)`
- `statsPeriod` = `24h` / `7d` / `30d` 等；或 `start` + `end` ISO8601
- `query` Sentry 查询语法，例：`level:error environment:production release:lol-record-analysis-app@1.8.3`
- `sort` = `-count()` 等
- `interval` 仅 events-stats 用，`1h` / `1d`

## 常用查询模板

> 全部假设 `SENTRY_TOKEN` 已设。`jq` / `python3 -m json.tool` 二选一格式化。

### 1. 日活 / DAU（unique users 24h）

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/events/?field=count_unique(user)&field=count()&statsPeriod=24h&dataset=errors"
```

注意：这个口径只覆盖**触发过 error 上报的用户**，不是真 DAU，会严重低估（数据量通常个位数）。

sessions 端点（客户端已开 session tracking，见 `observability.rs` 的 `auto_session_tracking`）能拿到真实 session 次数，但 `count_unique(user)` 恒为 0——sentry-rust 的 Release Health 信封不带 scope 里的 user，是 SDK 层限制，不是配置问题（详见下方"常见坑"）。只能当次数指标用，不能当去重人数用：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/sessions/?field=sum(session)&field=count_unique(user)&statsPeriod=24h&interval=1d"
```

**目前最接近真 DAU 的口径：`ourlogs` 数据集 + `count_unique(user.id)`**（注意字段名必须是 `user.id`，不是 `user`——见下方"常见坑"）。日志几乎覆盖所有活跃场景（`track_feature` 打点、各类 info 日志），不像 errors 那样只在报错时才有信号：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/events/?field=count_unique(user.id)&field=count()&statsPeriod=24h&dataset=ourlogs"
```

### 2. 日志量

24h / 30d 总条数：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/events/?field=count()&statsPeriod=24h&dataset=ourlogs"

curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/events/?field=count()&statsPeriod=30d&dataset=ourlogs"
```

按天切片（人类可读）：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/events-stats/?field=count()&statsPeriod=7d&dataset=ourlogs&interval=1d" \
  | python3 -c "import json,sys,datetime; d=json.load(sys.stdin)['data']; [print(datetime.date.fromtimestamp(t).isoformat(), f'{int(v[0][\"count\"]):>10,}') for t,v in d]"
```

按 env 拆分：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/events/?field=environment&field=count()&statsPeriod=7d&dataset=ourlogs&sort=-count"
```

配额对比：开源档每月 **5000 GB** logs，不用算太细。

### 3. 错误趋势 / Top issues

近 7 天按版本+严重度看错误数：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/events/?field=release&field=level&field=count()&statsPeriod=7d&dataset=errors&sort=-count"
```

Top 10 issue：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/issues/?query=is:unresolved&sort=freq&limit=10"
```

### 4. Release 分布

⚠️ 修复 fix(sentry): 用 tauri.conf.json 当 release 版本号来源 (`ef71a30`) 之前，所有 release 都是 `lol-record-analysis-app@0.0.0`。修复后才有真实分布。

按版本看错误数 / 受影响用户：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/events/?field=release&field=count()&field=count_unique(user)&statsPeriod=7d&dataset=errors&sort=-count"
```

Releases 列表（含 crash_free_users 等健康指标）：

```bash
curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" \
  "https://sentry.io/api/0/organizations/rank-analysis/releases/?per_page=10"
```

### 5. 项目级用量看板

直接打浏览器：
- Logs 用量 https://rank-analysis.sentry.io/explore/logs/
- 整体配额 https://rank-analysis.sentry.io/stats/
- Issues https://rank-analysis.sentry.io/issues/

## 常见坑

| 坑 | 解法 |
|---|---|
| `dataset=logs` 报错 / 返回空 | Sentry Logs 的 dataset 名是 `ourlogs`，不是 `logs` |
| `ourlogs` 数据集里 `count_unique(user)` 恒为 0，但数据明明有 user | **静默陷阱**：`ourlogs` 必须用 `count_unique(user.id)`，泛化的 `user` 字段别名在这个 dataset 里不生效（不报错，直接算出 0，很容易误判成"没上报 user"）。`errors` 数据集两种写法都行，`ourlogs` 只认 `user.id` |
| `sessions` 端点 `count_unique(user)` 永远是 0，`errors` 端点却不是 | 客户端**已经设了 user.id**（匿名 device_id，见 `observability.rs:126-131`，跨启动持久化在本地 `device_id` 文件），errors/logs 事件正常带着走。但 Release Health 的 session 信封走独立管道，sentry-rust SDK 不会把 scope 里的 user 带上去，所以 sessions 数据集去重人数算不出来，只能拿 `sum(session)` 当次数用；真「按人头去重」的活跃数只能退而求其次，用 errors 数据集的 `count_unique(user)` 近似（即"至少报过一次错误的独立用户数"，会偏低估） |
| `release` 全是 `0.0.0` | 用了 `ef71a30` 之前的版本；升级到最新版后才会有真实值 |
| 429 / rate limit | 单 token 每分钟有限速，连查时 `sleep 1` 即可；或加 `&per_page=50` 少分页 |
| 国服网络下偶尔超时 | 走代理 / 等几秒重试，Sentry SDK 本身在国服 `flush` 也会超时（见 `observability.rs:80`） |

## 调试技巧

- **不确定字段名**：`?field=...` 写错 Sentry 会忽略并返回所有字段；先用浏览器在 Discover 里拖一遍，再把 URL 里的 query string 抄过来。
- **想知道客户端实际上报了什么**：随便挑一个 issue 进详情，看 event 的 tags / context 区，对照本地 `observability.rs` 的 scrub 逻辑。
- **怀疑 token 没生效**：`curl -sS -H "Authorization: Bearer $SENTRY_TOKEN" https://sentry.io/api/0/` 应该返回 API 根，401/403 就是 token 问题。

## 不属于本 skill 的事

- 上报错误（客户端代码改 `observability.rs`，跟查询无关）
- 改 Sentry 项目设置 / 添加成员（去 https://rank-analysis.sentry.io/settings/ 手动操作）
- 写代码绕过查询接口（不需要，REST API 够用）
