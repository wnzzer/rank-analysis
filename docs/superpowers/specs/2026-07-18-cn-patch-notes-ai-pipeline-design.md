# 英雄改动明细：GitHub Actions AI 数据管线设计

日期：2026-07-18
状态：已批准

## 背景与目标

选人页的版本改动徽章（`PatchNoteBadge.vue`）已上线，数据源是 LoL Wiki 英文补丁页
（`fandom/patch_notes.rs`），明细为英文且以 OP.GG 全球 patch 号为键，与国服实际
版本节奏不一致。已另行编写的国服公告解析器 `cn_patch_notes.rs`（未接线）经实测
可解析近 4 个月全部 5 期公告，但存在两个稳定性缺口：

1. **覆盖缺口**：部分公告为站内文章（无 lol.qq.com 跳转链）或标题不规范，
   规则筛选会漏，导致中文快照停留在旧版本；
2. **方向判定保守**：无 `X → Y` 数值对比时靠关键词启发式，误差不可控。

本设计将「拉取 + 解析 + 方向判定」整体搬进 GitHub Actions，由 AI（GitHub
Models）做语义抽取，产物为仓库内受校验的静态 JSON；客户端只消费成品数据，
不再包含任何 HTML 解析逻辑。脆弱环节从全体用户机器收敛到单一可观测的 CI。

**非目标**：版本改动独立浏览页（archive 数据为其预留，但本期不做）；Wiki
英文源改造（保持现状作为降级层）；装备/符文改动（只做英雄段）。

## 总体架构

```
GitHub Actions（cron 每 6h + workflow_dispatch）
  1. 拉 CMC 频道列表（target=24，官方公告频道）
  2. 宽松筛选候选文章（含「更新公告」即候选，AI 负责确认）
  3. 拉文章页 → GBK 解码 → 去标签取纯文本
  4. GitHub Models 结构化抽取（GITHUB_TOKEN，permissions: models: read）
  5. 校验闸门（Schema + 英雄名对照 + 数量边界）
  6. docid 有变化才 commit data/patch-notes/ → push main
       └→ 现有 sync-gitcode.yml 自动镜像到 GitCode
客户端
  拉静态 JSON（jsDelivr → GitCode raw 兜底）→ 三级降级链不变
```

## 组件设计

### 1. CI 脚本 `scripts/patch-notes/`（Node，无第三方依赖）

- `fetch.mjs`：CMC 列表拉取与候选筛选。筛选比 `cn_patch_notes.rs` 现行规则更宽：
  标题含「更新公告」、排除「云顶」「手游」「周免」，跳转链须含 `lol.qq.com`
  且路径含 `/news/`。取最新一篇候选。站内文章（无跳转链）不支持——实测（2026-07）
  近 4 个月全部 5 期正式版本公告均带跳转链，且站内帖无稳定正文接口（CMC 详情
  端点返回 p0 error，gicp 模式 404）；不停机小补丁通常无英雄平衡改动，可接受。
- `extract.mjs`：文章 HTML → 纯文本（GBK 解码、`<br>` 转行、去标签、实体解码——
  逻辑自 `cn_patch_notes.rs` 平移）；调 GitHub Models
  （`https://models.github.ai/inference/chat/completions`，模型 `openai/gpt-4o-mini`
  级别），system prompt 要求输出严格 JSON：判断该文是否为端游版本更新公告、
  提取每个英雄的中文名 / 改动方向（buff|nerf|adjusted）/ 改动条目原文数组。
- `validate.mjs`：校验闸门（见下）。
- `run.mjs`：编排 + docid 对比 + 写文件。

### 2. 校验闸门（AI 幻觉的硬约束）

全部通过才允许写文件，任一失败则退出码非 0（workflow 红灯，保留旧数据）：

- JSON Schema：字段齐全、direction 为三枚举、lines 非空字符串数组；
- 英雄名白名单：CI 内从 CommunityDragon 拉 zh_CN champion-summary（注意该数据
  `name` 是称号「黑暗之女」，`description` 才是中文名「安妮」，白名单以
  `description` 为键），AI 输出的每个中文名必须精确命中，同时得到
  `championId` 与英文 alias；
- 数量边界：英雄数 1..40；单英雄条目数 1..30；
- 条目原文性抽查：每个英雄至少一条 line 是文章纯文本的子串（防 AI 改写）。

### 3. 数据格式 `data/patch-notes/`

```
data/patch-notes/
├── cn-latest.json          # 客户端唯一拉取入口
└── archive/{docId}.json    # 每期归档，为将来历史浏览预留
```

`cn-latest.json`：

```jsonc
{
  "schemaVersion": 1,
  "docId": "6214312643829369760",
  "title": "7月16日凌晨1点停机版本更新公告",
  "patchLabel": "7月16日更新",        // 徽章弹层显示用
  "publishedAt": "2026-07-15",        // 来自列表 sIdxTime（人读）
  "publishedAtEpoch": 1784138400,     // 同上的 Unix 秒（机器读，Rust 免日期解析）
  "generatedAt": "2026-07-16T02:00:00Z",
  "sourceUrl": "https://lol.qq.com/gicp/news/410/37091415.html",
  "champions": [
    {
      "championId": 267,
      "alias": "Nami",               // 白名单校验时顺带解析，客户端免映射
      "name": "娜美",
      "direction": "buff",
      "lines": ["W 潮涌 治疗量：60/85/110/135/160 → 65/95/125/155/185"]
    }
  ]
}
```

### 4. Workflow `.github/workflows/patch-notes-data.yml`

- 触发：`schedule`（每 6h）+ `workflow_dispatch`；
- `permissions: contents: write, models: read`；
- 步骤：checkout → node scripts/patch-notes/run.mjs → 若 `cn-latest.json` 有
  diff 则以 bot 身份 commit + push main（commit message
  `chore(data): 更新国服英雄改动 <patchLabel>`）；
- GITHUB_TOKEN 的 push **不会触发其他 workflow**（GitHub 防递归机制），
  sync-gitcode 不会跟跑；因此本 workflow 自带「推 GitCode 镜像」一步，
  复用现有 `GITCODE_TOKEN` secret，与 sync-gitcode.yml 同款推法；
- 并发组 `patch-notes-data`，`cancel-in-progress: true`。

### 5. 客户端改造

- **`cn_patch_notes.rs` 重写为瘦客户端**：删除 HTML 解析 / 方向判定 / CMC 逻辑
  （平移至 CI 脚本后不再需要），只保留：拉 JSON（依次尝试
  `https://cdn.jsdelivr.net/gh/wnzzer/rank-analysis@main/data/patch-notes/cn-latest.json`
  → `https://gitcode.com/wnzzer/rank-analysis/raw/main/data/patch-notes/cn-latest.json`，
  后者已实测 200，`raw.gitcode.com` 域名 403 不可用）、
  serde 反序列化（`schemaVersion != 1` 视为不可用）、内存 + 磁盘缓存
  （TTL 6h，网络失败旧快照续命，负缓存不落盘——沿用现有约定）；
- **新鲜度守卫**：`publishedAt` 距今超过 21 天视为过期快照，查询按未命中处理
  （避免跨版本误导）；
- **command 合并**（`command/fandom.rs::get_champion_patch_note`）：
  先按 `championId` 查 CN 快照（数据自带 id，无需名字映射），命中返回中文
  note（`champion` 字段格式 `名字（patchLabel）`）；未命中/过期降级现有
  Wiki 英文逻辑；`lib.rs` 注册模块（本仓库模块声明集中在 lib.rs）；
- **前端零改动**：`ChampionPatchNote` 结构不变，徽章与弹层直接显示中文条目。

## 错误处理

| 故障 | 行为 |
| --- | --- |
| CI：腾讯接口不可达 / 改版 / AI 输出不合格 | workflow 红灯（GitHub 邮件通知），旧数据保留，用户无感 |
| CI：docid 未变 | 正常绿灯，无 commit |
| 客户端：两个 CDN 都失败 | 旧快照续命；无快照则按无 CN 数据处理，降级 Wiki → OP.GG |
| 客户端：JSON 损坏 / schemaVersion 不识别 | 同上，log warn |
| 快照过期（>21 天） | 按未命中处理，走 Wiki 降级 |

## 测试

- CI 脚本（Node，`node --test`）：候选筛选规则、GBK→纯文本抽取（用
  `cn_patch_notes.rs` 现有 fixture 平移）、校验闸门各拒绝路径（错名/坏方向/
  改写条目/数量越界）、docid 无变化时不写文件；AI 调用 mock；
- Rust（`cargo test`）：JSON 反序列化与 schemaVersion 门槛、新鲜度守卫边界
  （21 天整）、缓存降级链（复用现有测试模式）、command 合并优先级
  （CN 命中优先于 Wiki）；
- 端到端验收：手动 `workflow_dispatch` 一次真跑（验证 runner 可达 qq.com 与
  GitHub Models 配额），确认产物 JSON 落库；应用内选人页看到中文明细。

## 里程碑

1. CI 脚本 + 测试（可本地跑通，AI 用真 key 手测一次）
2. workflow 上线 + 首次 dispatch 验收，产出第一份 `cn-latest.json`
3. 客户端瘦身改造 + command 合并 + 测试
4. 端到端验收（选人页中文明细可见）
