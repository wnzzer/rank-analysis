# 超级搜索(Header Omnibox + AI 自然语言搜战绩)设计

> issue #157「建议增加模糊搜索战绩功能」+ 讨论扩展:名字查人也做成模糊的,
> 把 Header 搜索框升级为大而全的超级搜索。

## 目标

把 Header 现有的「召唤师名#Tag 精确查人」搜索框升级为三合一 omnibox:

1. **精确查人**(现有能力,保留):输入形似 Riot ID(含 `#`)→ 跳 Record 页。
2. **模糊查人**(新):输入片段时下拉展示本地已知玩家候选(搜索历史 / 备注玩家 /
   好友),子串匹配,点击即按精确流程搜索。
3. **AI 自然语言搜战绩**(新,issue 主体):输入自然语言(如「这个月有一把我用
   女警队友有金克斯最后赢了」)→ qwen 解析为结构化条件 → 深分页拉当前登录玩家
   战绩 → 本地确定性筛选 → Record 页以条件 chips + 战绩列表呈现。

## 非目标(第一期明确砍掉)

- 装备/事件黑话查询(「坦克引擎」「飞身踢」→ itemId):别名表维护成本高、模型
  幻觉率高。schema 不为其建模,后续按需加。
- 对「当前登录玩家」以外的人做 AI 搜索(所有 issue 例句主语都是「我」)。
- AI 搜索联动大区下拉:跨区 puuid 是不同账号,「我」在别区无意义。AI 搜索固定
  当前登录玩家 + 当前大区。
- 拼音/首字母模糊匹配玩家名:v1 只做大小写不敏感子串匹配。

## 交互设计(Header omnibox)

输入框获得焦点且有输入时,下方弹出候选面板(n-popover / 自绘下拉),分组:

```
┌──────────────────────────────────────┐
│ ➤ 搜索召唤师「xxx#yyy」        ← 仅输入形似 Riot ID 时置顶
│ ── 玩家 ──────────────────────       │
│ 👤 某好友#123        (好友)          │
│ 📝 某备注哥#456      (备注)          │
│ 🕘 上次搜过#789      (历史)          │
│ ── AI ───────────────────────        │
│ ✨ AI 搜战绩:「<原文>」              │
└──────────────────────────────────────┘
```

- **回车默认行**:形似 Riot ID → 精确查人;否则有玩家候选 → 第一条候选;
  否则 → AI 搜战绩。上下键可换选,点击任意行执行该行。
- **形似 Riot ID 判定**:包含恰好一个 `#` 且其后有 1+ 非空白字符(gameName
  可含空格,不能按空格判)。
- **候选数据源**(全部本地/毫秒级,不打网络):
  - 搜索历史:新建,`localStorage`,记录成功执行过的精确查人
    `{name, region, ts}`,按 name+region 去重,上限 20,最近在前。
  - 备注玩家:`usePlayerNotesStore`,已有 `gameName`/`tagLine`。
  - 好友:新增 Rust command `get_friends`(LCU `GET /lol-chat/v1/friends`),
    返回 `{gameName, tagLine, puuid}`;Header 挂载后懒加载一次,失败静默降级
    (LCU 未连时无好友组)。
  - 匹配:`gameName#tagLine` 大小写不敏感子串;三组去重(同名玩家按
    好友 > 备注 > 历史优先保留),每组最多 4 条。
- AI 行选中 → 解析当前登录玩家名(`useGameState` 的 summoner,未连接时兜底
  `get_my_summoner`)→ `router.push('/Record?name=<我>&aiq=<原文>&t=...')`
  (带 name 让左侧 UserRecord 复用现有逻辑展示「我」;不带 region)。
- 精确/候选行选中 → 现有流程 `/Record?name=...&region=...`,并写入搜索历史。

## AI 搜索管线(`services/ai/matchSearch/`)

纯前端管线,复用现有 AI 基建(`requestAIContent` + JSON mode + qwen-flash),
不新增 Rust AI 代码。

### 1. 解析(parse)

单轮 qwen-flash JSON mode 调用:

- prompt 注入:今天日期(绝对化「这个月/前两天」)、英雄清单(来自
  `get_champion_options`,每行 `id|官方名|昵称|称号`,约 170 行,消灭英雄名
  幻觉——模型只许从清单选 id)、常见队列关键词说明(单双排/灵活/大乱斗/斗魂…
  → queueId 直接给映射表)。
- 输出 schema(TS 手写校验,非法字段丢弃并降级):

```ts
interface ParsedMatchQuery {
  timeRange: { from: string | null; to: string | null } // ISO 日期
  selfChampionIds: number[]      // 我用的英雄(任一命中)
  allyChampionIds: number[]      // 队友用的(不含我,任一命中)
  enemyChampionIds: number[]     // 对面用的(任一命中)
  myTeamChampionIds: number[]    // 我方出现过即可(含我;「忘了自己玩的啥」场景)
  result: 'win' | 'loss' | 'any'
  queueIds: number[]             // 空 = 不限模式
  playerNames: string[]          // 「跟 XXX#XXX 碰过几次」里的名字
  intent: 'list' | 'count_encounters'
}
```

- 校验规则:championId 必须在清单内;日期必须合法且 from ≤ to;playerNames
  原样保留。校验失败字段置空(宁可少筛不误筛)。

### 2. 拉取(fetch)

- 目标:当前登录召唤师(现有命令 `get_my_summoner`,得到 `gameName#tagLine`
  与 puuid)。
- 走 SGP 深分页(`get_sgp_match_history_by_name`,当前大区
  `get_current_sgp_region`):每页 20 条循环,直到任一停止条件:
  - 页内最旧一局 `gameCreationDate` < `timeRange.from`;
  - 已拉满上限 **200 局**(无 timeRange 时上限 100 局);
  - 返回空页。
- 每页回调进度(已拉 N 局 / 已覆盖到 X 月 X 日),供 UI 展示。
- SGP 失败(如权限/网络)降级 LCU `get_match_history_by_puuid` 0-49
  一次性 50 局,并在结果区提示「仅搜索了最近 50 局」。
- SGP 返回的 `MatchHistory` 全队数据在 `gameDetail.participants` +
  `participantIdentities`,`participants[0]` 为被查玩家——满足队友/对手/
  玩家名筛选,无需逐局 enrich。

### 3. 筛选与统计(filter,纯函数)

对 `Game[]` 依次应用:时间窗 → queueIds → 胜负(participants[0].stats.win)
→ selfChampionIds(participants[0].championId)→ ally/enemy/myTeam(按
gameDetail.participants 的 teamId 与 participants[0] 对比划分)→
playerNames(participantIdentities 的 `gameName#tagLine` 或 `gameName`
大小写不敏感匹配)。

`intent === 'count_encounters'`:在时间窗+模式过滤后,统计 playerNames
出现的对局数(区分同队/对面各几次),命中对局同时作为列表结果展示。

### 4. 呈现(Record 页)

- `Record.vue` 检测 `route.query.aiq`:内容区从 `MatchHistory` 切换为新组件
  `AiSearchResults.vue`(左侧 UserRecord 维持展示当前登录玩家)。
- `AiSearchResults` 自上而下:
  - **条件 chips 行**:解析出的每个条件一枚 chip(`时间: 8月`「我用: 女警」
    「队友: 金克斯」「结果: 胜」…),chip 可删除 → 本地重筛(不重新调模型、
    不重新拉取);另有「重新解析」入口。用户由此看到 AI 的理解并可修正,
    化解误解析风险。
  - **进度态**:解析中(AI 图标脉冲)→ 拉取中(已拉 N 局/覆盖至某日)→ 完成。
  - **统计答案卡**(仅 count 意图):「最近一个月与 XXX#XXX 相遇 5 次
    (同队 2 / 对面 3)」。
  - **结果列表**:复用 `RecordCard`(SGP 数据已是其可渲染形态),空态给
    「没有找到匹配对局 + 已搜索范围说明」。
- 错误处理:未配 API key → 引导去设置页;解析失败/超时 → 错误态 + 重试;
  LCU 未连接 → 提示先登录客户端。

## 代码落点

| 位置 | 内容 |
| --- | --- |
| `src/services/ai/matchSearch/schema.ts` | ParsedMatchQuery 类型 + 校验(纯函数) |
| `src/services/ai/matchSearch/prompt.ts` | prompt 构造(日期/英雄清单/队列映射注入) |
| `src/services/ai/matchSearch/parse.ts` | 调 `requestAIContentStream` 聚合 + JSON 提取 |
| `src/services/ai/matchSearch/fetch.ts` | SGP 分页循环 + LCU 降级 + 进度回调 |
| `src/services/ai/matchSearch/filter.ts` | 筛选/统计纯函数 |
| `src/components/SuperSearch.vue` | Header omnibox(输入框 + 候选面板),替换现 n-input |
| `src/composables/useSearchSuggestions.ts` | 候选聚合(历史/备注/好友)+ 模式判定 |
| `src/components/record/AiSearchResults.vue` | 结果页(chips/进度/答案卡/列表) |
| `src-tauri/src/lcu/api/chat.rs` + `command/chat.rs` | `get_friends`(LCU /lol-chat/v1/friends) |

## 测试

- 单测(vitest):riot-id 判定与回车默认行选择;候选聚合去重/分组/上限;
  schema 校验(非法 id/日期/枚举的降级);filter 全维度(含 ally/enemy/
  myTeam 划分与 count 统计);fetch 停止条件(mock invoke:时间窗越界/
  上限/空页/SGP 失败降级)。
- prompt 构造快照式断言(注入了日期与英雄清单)。
- Rust:`get_friends` 反序列化单测(样例 JSON)。
- 端到端:本机真实 LOL + DashScope key,经 MCP bridge 手动验收 issue 四个例句。

## 成本与性能

- 每次 AI 搜索恰好 1 次 qwen-flash 调用(prompt ≈ 3-4KB,几乎免费)。
- 大头是 SGP 分页请求(≤ 10 次/搜索),有明确上限与进度展示。
- 候选下拉全本地,零网络。
