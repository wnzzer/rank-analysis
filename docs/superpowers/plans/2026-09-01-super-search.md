# 超级搜索实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Header 搜索框升级为三合一超级搜索(精确查人 / 本地模糊查人候选 / AI 自然语言搜战绩),落地 issue #157。

**Architecture:** 前端为主:`services/ai/matchSearch/` 纯函数管线(schema 校验 → prompt → 单轮 qwen-flash JSON 解析 → SGP 深分页拉取 → 本地筛选/统计),Header 换装 omnibox 组件,Record 页按 `aiq` 参数切换 AI 结果视图。Rust 仅新增 `get_friends`(LCU /lol-chat/v1/friends)。

**Tech Stack:** Vue 3 + TS + vitest;现有 AI 基建 `requestAIContent`(JSON mode, qwen-flash);SGP 命令 `get_sgp_match_history_by_name`。

**Spec:** `docs/superpowers/specs/2026-09-01-super-search-design.md`(接口/交互细节以 spec 为准)

## Global Constraints

- 质量门禁:每个任务结束 `cd rank-analysis-app && npm run check && npm run test`;Rust 改动加 `cargo test`。
- 提交:分支 `feat/super-search`,Conventional Commits,显式路径 `git add`。
- 英雄 id 只允许来自 `get_champion_options` 清单;统计/日期比较全部本地算,不信模型输出的数字结论。
- AI 搜索目标固定当前登录玩家(`get_my_summoner`)+ 当前大区;上限 200 局(无时间窗 100 局),SGP 失败降级 LCU 0-49。

---

### Task 1: matchSearch 类型 + 校验 + 筛选纯函数

**Files:**
- Create: `rank-analysis-app/src/services/ai/matchSearch/types.ts`
- Create: `rank-analysis-app/src/services/ai/matchSearch/schema.ts`
- Create: `rank-analysis-app/src/services/ai/matchSearch/filter.ts`
- Create: `rank-analysis-app/src/services/ai/matchSearch/chips.ts`
- Test: `rank-analysis-app/src/services/ai/matchSearch/__tests__/schema.spec.ts`、`filter.spec.ts`、`chips.spec.ts`

**Interfaces (Produces):**

```ts
// types.ts
export interface ParsedMatchQuery {
  timeRange: { from: string | null; to: string | null } // ISO 日期(仅日期部分即可)
  selfChampionIds: number[]
  allyChampionIds: number[]      // 队友(不含我)
  enemyChampionIds: number[]
  myTeamChampionIds: number[]    // 我方出现过即可(含我)
  result: 'win' | 'loss' | 'any'
  queueIds: number[]             // 空 = 不限
  playerNames: string[]
  intent: 'list' | 'count_encounters'
}
export interface EncounterStats {
  total: number
  perName: Record<string, { ally: number; enemy: number }>
}
export interface QueryChip { key: string; label: string } // key 供删除定位

// schema.ts
export function emptyQuery(): ParsedMatchQuery
export function validateParsedQuery(
  raw: unknown,
  validChampionIds: Set<number>,
  validQueueIds: Set<number>
): ParsedMatchQuery // 非法字段降级为空/any,绝不 throw

// filter.ts
export function filterGames(games: Game[], q: ParsedMatchQuery): Game[]
export function countEncounters(games: Game[], q: ParsedMatchQuery): {
  stats: EncounterStats; games: Game[]  // games = 命中对局(时间/模式过滤后)
}

// chips.ts
export function queryToChips(q: ParsedMatchQuery, championName: (id: number) => string, queueName: (id: number) => string): QueryChip[]
export function removeChipFromQuery(q: ParsedMatchQuery, key: string): ParsedMatchQuery
```

**筛选语义(filter.ts 核心):**
- 自己 = `game.participants[0]`;全队 = `game.gameDetail.participants`(与 `participantIdentities` 按下标对齐)。
- 我方/敌方按 `teamId` 与 participants[0].teamId 对比;在 gameDetail 中定位"我"用 championId+teamId 双匹配(SGP/LCU 数据都无法保证 puuid 在 detail 中)。
- playerNames 匹配:`gameName#tagLine` 与 `gameName` 均做大小写不敏感全等,再退化到子串。
- 时间窗:`gameCreationDate`(ISO 字符串)与 from/to 比较,from/to 为 null 则该侧不设限;to 按当日 23:59:59 含端点。

- [ ] 写 schema/filter/chips 失败测试(用例:非法 championId 剔除、from>to 归零、result 非枚举→any、ally/enemy 划分、忘我场景 myTeam 命中自己、count 同队/对面分计、chips 删除后字段清空)
- [ ] 实现并跑绿
- [ ] `npm run check && npm run test` 全绿后提交 `feat: AI 搜战绩查询模型与本地筛选纯函数`

### Task 2: prompt 构造 + 解析(parse)

**Files:**
- Create: `rank-analysis-app/src/services/ai/matchSearch/prompt.ts`、`parse.ts`
- Test: `__tests__/prompt.spec.ts`、`parse.spec.ts`(mock `../stream` 与 `@tauri-apps/api/core`)

**Interfaces:**
- Consumes: Task 1 `validateParsedQuery`;现有 `requestAIContent`(jsonMode)、`get_champion_options`、`getGameModesByIpc`。
- Produces:

```ts
// prompt.ts
export interface PromptContext {
  today: string // YYYY-MM-DD
  champions: { value: number; label: string; nickname: string; realName: string }[]
  modes: { label: string; value: number }[]
}
export function buildMatchSearchPrompt(text: string, ctx: PromptContext): { system: string; user: string }

// parse.ts
export function extractJson(content: string): unknown | null // 容忍 ```json 围栏
export async function parseMatchQuery(text: string): Promise<ParsedMatchQuery> // 失败 throw Error(中文可展示信息)
```

**prompt 要点:** system 固定「把玩家对战绩的自然语言描述解析为 JSON 检索条件」+ 输出 schema 说明 + 规则(只能从英雄清单选 id;日期输出绝对 ISO;不确定的字段留空;「队友有X但不记得自己玩什么」归 myTeamChampionIds);user 注入今天日期、英雄清单(`id|label|nickname|realName` 每行一个)、模式清单、原文。

- [ ] 失败测试 → 实现 → 全绿(prompt 断言含日期/清单/原文;parse 断言 jsonMode 调用、校验降级、错误路径)
- [ ] 提交 `feat: AI 搜战绩自然语言解析(qwen JSON mode)`

### Task 3: SGP 深分页拉取(fetch)

**Files:**
- Create: `rank-analysis-app/src/services/ai/matchSearch/fetch.ts`
- Test: `__tests__/fetch.spec.ts`(mock invoke)

**Interfaces:**
- Consumes: 命令 `get_my_summoner`、`get_current_sgp_region`、`get_sgp_match_history_by_name`、`get_match_history_by_puuid`。
- Produces:

```ts
export interface FetchProgress { fetched: number; oldestDate: string | null }
export interface FetchResult {
  games: Game[]
  source: 'sgp' | 'lcu'
  truncated: boolean       // 因上限截断(结果区提示)
  selfName: string         // gameName#tagLine
}
export async function fetchGamesForQuery(
  q: ParsedMatchQuery,
  onProgress?: (p: FetchProgress) => void
): Promise<FetchResult>
```

**逻辑:** 每页 20 循环;停止条件 = 空页 / 页内最旧 `gameCreationDate` < timeRange.from / 累计 ≥ 200(无 from 则 100);SGP 任一页失败 → 整体降级 LCU 0-49 一次(source='lcu')。

- [ ] 失败测试(停止条件×3、降级、进度回调序列)→ 实现 → 全绿
- [ ] 提交 `feat: AI 搜战绩 SGP 深分页拉取与 LCU 降级`

### Task 4: Rust `get_friends`

**Files:**
- Create: `rank-analysis-app/src-tauri/src/lcu/api/chat.rs`
- Modify: `rank-analysis-app/src-tauri/src/lcu/api.rs`(注册 mod)、`src-tauri/src/command.rs` 或 `command/` 新增 `chat.rs` + `main.rs` 注册
- Test: `chat.rs` 内 serde 单测

**Produces:** command `get_friends() -> Result<Vec<Friend>, String>`,`Friend { game_name, tag_line, puuid }`(serde 把 LCU 的 `gameTag` alias 到 `tag_line`;camelCase 序列化给前端 `gameName/tagLine/puuid`)。

- [ ] serde 失败测试(样例 JSON 含 gameTag)→ 实现 → `cargo test` 绿 → `npm run check`
- [ ] 提交 `feat: 新增好友列表命令 get_friends`

### Task 5: 候选聚合 composable

**Files:**
- Create: `rank-analysis-app/src/composables/useSearchSuggestions.ts`
- Test: `rank-analysis-app/src/composables/useSearchSuggestions.spec.ts`

**Produces:**

```ts
export function isRiotIdLike(input: string): boolean // 恰一个'#'且后有非空白
export interface PlayerSuggestion { name: string; region?: string; source: 'friend' | 'note' | 'history' }
export function buildPlayerSuggestions(
  input: string,
  sources: { friends: PlayerSuggestion[]; notes: PlayerSuggestion[]; history: PlayerSuggestion[] }
): PlayerSuggestion[] // 去重(friend>note>history)、每源≤4、大小写不敏感子串
// 搜索历史(localStorage key 'searchHistory.v1', 上限20, name+region 去重, 最近在前)
export function loadSearchHistory(): { name: string; region: string; ts: number }[]
export function pushSearchHistory(name: string, region: string): void
// composable: 组件侧封装(懒加载好友、订阅 notes store、输入→分组候选)
export function useSearchSuggestions(input: Ref<string>): {
  playerSuggestions: ComputedRef<PlayerSuggestion[]>
  riotIdLike: ComputedRef<boolean>
}
```

- [ ] 纯函数失败测试 → 实现 → 全绿
- [ ] 提交 `feat: 超级搜索候选聚合(历史/备注/好友)`

### Task 6: SuperSearch omnibox 组件 + Header 接入

**Files:**
- Create: `rank-analysis-app/src/components/SuperSearch.vue`
- Modify: `rank-analysis-app/src/components/Header.vue`(header-center 换 `<SuperSearch/>`,大区下拉逻辑随迁)

**行为(spec 交互节):** 输入非空聚焦时弹候选面板;行序 = 精确 Riot ID 行(仅 riotIdLike)→ 玩家候选 → AI 行(恒有,输入非空时);↑↓ 换选、Enter 执行当前选中(默认:精确行 > 首个玩家候选 > AI 行)、Esc 收起;点击行执行。执行精确/候选 → `/Record?name&region&t` + `pushSearchHistory`;执行 AI 行 → 解析当前玩家名(`useGameState().summoner` 兜底 `get_my_summoner`)→ `/Record?name=<我>&aiq=<原文>&t`。样式沿用现 header-search 造型。

- [ ] 实现组件与 Header 接入;`npm run check` + 手动 dev 冒烟(查人回归 + 候选 + AI 行跳转)
- [ ] 提交 `feat: Header 超级搜索 omnibox(模糊查人 + AI 入口)`

### Task 7: AI 结果视图 + Record 集成

**Files:**
- Create: `rank-analysis-app/src/composables/useAiMatchSearch.ts`(编排:parse→fetch→filter/count,暴露状态机)
- Create: `rank-analysis-app/src/components/record/AiSearchResults.vue`
- Modify: `rank-analysis-app/src/views/Record.vue`(`route.query.aiq` 存在时内容区渲染 AiSearchResults)
- Test: `useAiMatchSearch.spec.ts`(mock matchSearch 各模块)

**Produces:**

```ts
export type AiSearchPhase = 'idle' | 'parsing' | 'fetching' | 'done' | 'error'
export function useAiMatchSearch(): {
  phase: Ref<AiSearchPhase>
  error: Ref<string>
  progress: Ref<FetchProgress>
  query: Ref<ParsedMatchQuery | null>
  chips: ComputedRef<QueryChip[]>
  results: Ref<Game[]>
  encounterStats: Ref<EncounterStats | null>
  meta: Ref<{ source: 'sgp' | 'lcu'; truncated: boolean; searchedCount: number } | null>
  run(text: string): Promise<void>
  removeChip(key: string): void   // 本地重筛,不重打模型/网络
}
```

UI:chips 行(可删)+ 阶段态(解析中/拉取进度/错误重试/未配 key 引导)+ count 答案卡 + `RecordCard` 列表(复用 MatchHistory 的资产预载模式 provide recordAssets)+ 空态说明已搜范围。

- [ ] composable 失败测试 → 实现 → 全绿;视图实现;`npm run check`
- [ ] 提交 `feat: Record 页 AI 搜战绩结果视图(chips/进度/统计卡)`

### Task 8: 真机端到端验收 + 收尾

- [ ] `npm run tauri dev` + MCP bridge(ws://127.0.0.1:9223),用本机真实 LOL + env 密钥跑 issue 四个例句 + 查人回归 + 候选下拉
- [ ] 全量门禁:`npm run check && npm run test`,`cargo test`
- [ ] push + PR:标题 `feat(search): Header 超级搜索——模糊查人与 AI 自然语言搜战绩 (#157)`

## Self-Review 备注

- spec 覆盖:交互(T6)、AI 管线(T1-3)、好友(T4)、候选(T5)、呈现(T7)、测试/验收(T8)。
- 类型一致性:ParsedMatchQuery/FetchResult/QueryChip 名称已在各任务 Interfaces 区锁定。
- 本计划由本会话内联执行(执行者已具全部上下文),故省略每步完整代码,以接口与测试用例清单为约束;若移交无上下文执行者需先读 spec。
