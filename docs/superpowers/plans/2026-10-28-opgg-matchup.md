# OP.GG 对位内页实施计划

> **For agentic workers:** 按任务实施并记录测试证据；使用 subagent-driven-development 或 executing-plans 的任务与审查方法。用户已授权按设计开始，沿用原目录分支，不另建工作树。

**Goal:** 在原选人战绩页面增加带段位筛选、英雄头像和自然转场的 OP.GG 对位内页，并提供无需客户端的演示。

**Architecture:** Rust 独立只读模块获取完整对位列表和双方详情；Vue 查询状态与展示分离。SubteamCard 保留原战绩树，通过可选操作插槽进入新增内页，与 Gaming 共用段位。独立演示入口复用正式内页组件并注入数据提供器。

**Tech Stack:** Vue 3、TypeScript、Naive UI、Rust、Tauri 2、Vitest、现有 reqwest/moka；不增加运行依赖。

**Spec:** `docs/superpowers/specs/2026-10-28-opgg-matchup-design.md`

## 实施结果（2026-10-28）

四个任务的实现均已完成，保存在本地功能分支。下方细项为原实施步骤，实际验收以本节记录为准；国服客户端联调未完成，不把离线演示当作完整验收。

| 任务 | 完成内容与证据 |
| --- | --- |
| 1 后端 | 独立只读HTTP、DTO、参数/版本校验、有界缓存与同键合并、11项对位测试。Rust全量507项通过/2项忽略，文档测试1项通过/23项忽略。实际HTTP核查中路和打野。首次红灯因依赖下载阻塞，未观察到预期逻辑失败；后续行版本回归观察到RED/GREEN，不追认初次步骤。 |
| 2 查询状态 | 类型与注入服务、分路记忆、按页查询、跨代次总并发3、竞态隔离；7项状态测试和2项来源链接测试通过。 |
| 3 原页面接入 | 原卡片可选插槽、敌方局部导航、保留原DOM和焦点、共享段位、头像与主题/动效；Workspace 2项及既有Gaming段位2项通过；实际浏览器验证。 |
| 4 演示交付 | 独立入口复用真实卡片与内页，中文说明完成；check、全量前端/Rust测试及正式构建通过。两次独立模块复审与最终跨层审查均无剩余P0-P2问题。 |

前端最终全量120个测试文件、1223项通过。`npm run check` 无错误，120条既有lint警告；构建有既有大包提示。来源链接使用项目现有opener打开系统浏览器，失败在来源区反馈；该增量已通过独立复审。

浏览器证据包含：1000/1200/1600宽度、1200×800窗口、深浅主题、匿名卡、段位同步、换英雄、返回焦点/滚动、inert、Escape下拉、分页、小样本、头像回退、空数据、失败重试、慢响应及减少动态效果。开发产物与验收证据保留在被忽略的本地 `.superpowers/sdd/2026-10-28-opgg-matchup/`，不进入正式构建。

仓库没有OpenSpec，沿用当前设计文档与实施计划。未新增工作树、未引入依赖、未推送/提PR/合并；本机无LoL客户端，真实国服会话、头像协议、设置持久化及原生窗口行为保留为后续验收。

## Global Constraints

- 原 PlayerCard / ChampionIntelCard / 顶部功能全部保留；只增加入口与内页。
- 仅传统双队召唤师峡谷 ChampSelect 支持，其他阶段/模式不干扰。
- OP.GG 全球数据，复用现有六种段位；不采用国服排行榜。
- 候选胜率用候选自身 win/play，线杀率用双方 lane_kill 比例；打野不适用，缺失不补零。
- 每页 8 个，详情并发最多 3，同键合并，缓存 30 分钟且键含版本/段位/分路/英雄。
- 复用主题与资源协议；250ms 内页过渡、150ms 局部反馈，支持减少动态效果。
- 新增方法、类型、字段有中文文档注释；中文交付文档与提交说明。
- 演示数据与真实接口验证区分；无 LoL 客户端不能宣称完成国服联调。

## Review Focus

- 快速换人/换段位后旧请求后到：旧结果不得覆盖新上下文（任务 2）。
- 隐藏战绩或加载失败但已知英雄：入口不依赖召唤师详情成功（任务 3）。
- 双方胜场/样本不互补：不可用 1-enemyRate 生成候选胜率（任务 1）。
- 内页关闭与原下拉/弹窗同时 Escape：不误关闭其他界面，返回焦点和滚动正确（任务 3）。
- 无客户端运行：不能靠正常 Tauri 启动假装联调，演示必须复用生产展示组件（任务 4）。

### Task 1: 只读 OP.GG 对位后端

**Files:** 创建 `rank-analysis-app/src-tauri/src/opgg/matchup.rs`（必要时拆 data/tests）；修改 `opgg/mod.rs`、`command/opgg.rs`、`main.rs`。

**Interfaces:** `get_matchup_list(query: MatchupQuery)`、`get_matchup_detail(query: MatchupQuery, candidate_id: i32)` Tauri 命令。Query camelCase `{enemyId:number,position:'top'|'jungle'|'mid'|'adc'|'support',tier:string,version?:string}`。List `{enemyId,position,tier,version,cachedAt:string|null,fetchedAt:number,stale:boolean,candidates:{championId:number,enemyWinRate:number,play:number}[]}`。Detail `{enemyId,candidateId,position,tier,version,cachedAt:string|null,fetchedAt:number,stale:boolean,candidateWinRate:number|null,laneKillRate:number|null,play:number|null}`。fetchedAt 为 unix 秒，所有比例 0..1，cachedAt 为源时间字符串（缺失 null）。列表首次允许不传 version 从 meta 发现；详情必须固定返回列表 version。

- [ ] 写原始 JSON 解析测试：双方样本不同、零胜场、零分母、打野、负值/超额胜场、缺一方、版本错误、非法入参。
- [ ] 运行测试观察未实现失败；实现 HTTP/解析/验证/30 分钟缓存与同键合并。固定 https 全球域，参数白名单，无用户任意 URL；错误不缓存为成功。
- [ ] 缓存测试验证跨 tier/version 隔离，失败只回退同键旧值并 stale，容量有上限。
- [ ] 运行 cargo test 对位测试和 fmt/clippy；以实际运行结果报告，不把环境失败写成通过。

### Task 2: 前端查询契约与状态

**Files:** 创建 `src/types/matchup.ts`、`src/services/matchup.ts`、`src/composables/useMatchup.ts` 及对应 spec。

**Interfaces:** 服务提供 `getList(query):Promise<MatchupList>` / `getDetail(query,candidateId):Promise<MatchupDetail>` / `getPosition(enemyId):Promise<string|null>`；可通过 Vue 注入提供器供测试/演示使用，生产默认调用真实 Tauri。组件统一使用 MatchupEnemy `{slot,championId,pickState?}`。查询上下文显式含 tier/version，详情从列表已确认版本产生。

- [ ] 写排序/样本阈值与异步竞态测试：推荐按敌方率升序，谨慎降序，恰好50%不归组，小于200局置后；切换目标/段位期间不显示旧数字。
- [ ] 实现元数据分路推测、手动修正、每页8项并发3、行级错误重试、版本上下文验证、源时间显示模型。
- [ ] 运行相关 Vitest；验证无可用候选、请求失败、换英雄重置分路、关闭/卸载后无旧响应写入。

### Task 3: 正式内页与原页面接入

**Files:** 创建 `src/components/gaming/MatchupPanel.vue`、`MatchupWorkspace.vue` 及测试；修改 `SubteamCard.vue`、`PlayerCard.vue`、`ChampionIntelCard.vue`、`views/Gaming.vue`。

**Interfaces:** Panel props `enemies:MatchupEnemy[]`, `selectedSlot:number`, `tier:OpggTier`, `tierLoading:boolean`, `unavailableIds:number[]`, `active:boolean`；emits `back`, `select-slot(number)`, `change-tier(OpggTier)`。Workspace 保留默认 slot（原列表）并提供 `open(slot,event)`，承载导航/转场和 Panel。父 Gaming 唯一 useOpggTier 状态通过事件复用；不新建独立全局状态。

- [ ] 写入口/返回保留原节点、焦点、隐藏区域 inert、槽位换人、非选人模式不显示、tier emit 的组件测试。
- [ ] 在 PlayerCard 的近期数据下提供可选 matchup 插槽；加载与隐藏分支也有入口；不替换原头像/战绩点击。不向我方注入。
- [ ] 实现导航、头像/中文名、段位分路控件、胜率/线杀率/样本、骨架/错误/空状态、页码、来源链接、受禁选限制的行提示。
- [ ] 使用原主题变量与 scoped CSS，保持两个页面实例，转场不改变外层尺寸；减少动态效果设置生效。
- [ ] 运行组件与 Gaming 回归测试，再浏览器核验长名字/图片失败/滚动/快速切换。

### Task 4: 离线演示、整体验证与交付

**Files:** 创建 `matchup-demo.html`、`src/demo/matchup/*`、演示专用 Vite 配置与中文使用说明；修改 package.json 增加 demo 命令。演示不加入正式构建入口，不接正常产品导航。

- [ ] 使用正式 Workspace/Panel，注入明确标记的固定示例与模拟会话；演示五敌方、段位、换人、慢请求、空数据和失败重试。
- [ ] 独立真实 OP.GG 冒烟验证，检查阿狸中路和李青打野的版本/方向/缺失值；不把 mock 结论当真实接口验证。
- [ ] 运行 npm run check、npm test、cargo test、npm run build；检查修改范围，不保留无关格式化改动。
- [ ] Edge/浏览器在 1000、1200、1600 宽度及浅/深主题下核验关键交互，保存必要截图与可复用演示入口。
- [ ] 独立最终审查，修复实质问题，更新设计验收与中文交付说明；保留分支用于自用，不擅自 push、PR 或合并。
