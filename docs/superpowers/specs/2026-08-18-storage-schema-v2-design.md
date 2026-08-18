# Storage Schema v2 设计（M1 交付物）

> 状态：设计定稿，落地随 M1 收尾推进（2026-08-18，路线图 v1.3 §5.7）
> 关联：`meet_db.rs`（现网）、`backtest/store.rs`（M1 新增 ledger）、`config.rs`（key-value）

## 1. 背景与目标

M1 之前数据是"三处各管各"：

| 存储 | 内容 | 问题 |
|------|------|------|
| `meet.db` | 收集/查询过的对局快照 | 无事件级明细，schema 是 SUMMARY 平铺 |
| `backtest.db`（M1 新增） | 决策对账 ledger | 独立库，与对局数据无外键 |
| config（JSON） | `settings.*` 点分 key | 只放轻量配置，不放对局 |

**v2 目标**：单一 `app.db` 承载「对局事实 → 表现分 → L3 事件 → 决策对账」全链，
让回测样本（英雄+位置+对位+胜负）可从对局事实**派生**，不重复落盘；
决策 ledger 以 `gameId + suggestedAtMs + 英雄` 关联回对局事实（路线图 v1.3 §6.5.5）。

## 2. 设计原则

1. **事实表只存事实，不存结论**：`games` / `participants` 存官方数据；
   `scores`、`timeline_events`、`decision_ledger` 存本工具计算/标注结果——重算可覆盖。
2. **派生不落盘**：英雄对位样本（backtest 输入）是 `participants` 的查询视图，
   不设 `samples` 表；M1 的 `BacktestInput` 由视图组装，避免双写漂移。
3. **关联键统一**：`gameId`（LCU 局号）+ `suggestedAtMs` + `championId` 三层，
   缺任一环的记录不写 ledger（数据不足宁可缺失）。
4. **迁移用 `PRAGMA user_version`**：`migrate.rs` 现有通道扩展，逐版本升级，
   不删除旧库——旧库改名保留 `*.v1.bak`，确认无误后清理。
5. **隐私纪律**（路线图 §14）：玩家 `puuid` 可哈希存储（保留 `sha256(puuid)` 前缀
   用于本机关联），原始 `puuid` 不入表；UI 只展示可辨认的 Riot ID。

## 3. v2 目标 schema（`app.db`）

```sql
-- 版本管理
PRAGMA user_version = 2;

-- 对局事实（一局一行）
CREATE TABLE games (
    game_id          INTEGER PRIMARY KEY,   -- LCU 局号
    platform_id      TEXT NOT NULL,         -- 'TENCENT-1' 等（sgg 归一化值）
    queue_id         INTEGER NOT NULL,
    game_mode        TEXT,                  -- CLASSIC / ARAM / …
    game_created_at  INTEGER,               -- 毫秒时间戳
    game_duration_s  INTEGER,
    win_team         INTEGER,               -- 100 / 200
    json_payload     TEXT                   -- 原始 DETAILS（SGP 全量，备用重算）
);

-- 参与者事实（每局每玩家一行）
CREATE TABLE participants (
    game_id       INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL,
    champion_id   INTEGER NOT NULL,
    team_id       INTEGER NOT NULL,          -- 100 / 200
    position      TEXT,                      -- TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY
    summoner_id   TEXT,                      -- 本机可辨认 ID（哈希），非原始 puuid
    win           INTEGER NOT NULL,          -- 0/1
    PRIMARY KEY (game_id, participant_id)
);
CREATE INDEX idx_participants_champ ON participants(champion_id, position);

-- 表现分结果（L1/L2 计算，可覆盖）
CREATE TABLE scores (
    game_id       INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL,
    total         REAL NOT NULL,
    breakdown_json TEXT NOT NULL,            -- PlayerScoreBreakdown 全字段
    PRIMARY KEY (game_id, participant_id)
);

-- L3 事件（归因引擎产出，可覆盖）
CREATE TABLE timeline_events (
    game_id        INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL,
    dimension      TEXT NOT NULL,            -- ScoreDimension camelCase
    ts_secs        INTEGER NOT NULL,
    description    TEXT NOT NULL,
    delta          REAL NOT NULL
);
CREATE INDEX idx_timeline_lookup
    ON timeline_events(game_id, participant_id, dimension);

-- 决策对账 ledger（M1 已建 `backtest.db`，v2 并入本库同构迁移）
CREATE TABLE decision_ledger (
    game_id                INTEGER NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    suggested_at_ms        INTEGER NOT NULL,
    suggestion_champion_id INTEGER NOT NULL,
    actual_champion_id     INTEGER NOT NULL,
    enemy_champion_id      INTEGER NOT NULL,
    position               TEXT NOT NULL,
    adopted                INTEGER NOT NULL,
    result_win             INTEGER NOT NULL,
    matchup_delta          REAL NOT NULL,
    confidence             REAL NOT NULL,
    caveats_json           TEXT NOT NULL,
    PRIMARY KEY (game_id, suggestion_champion_id, suggested_at_ms)
);
CREATE INDEX idx_ledger_adopted ON decision_ledger(adopted, result_win);
```

### 3.1 回测样本视图（派生，不落盘）

```sql
-- 建议/实选英雄的对位历史样本 = participants 按 (champion_id, position, enemy_champion)
-- 聚合；M1 的 BacktestInput.suggestion_samples 即由该视图组装
```

实现：`backtest::compute` 的输入从 `app.db` 查询组装（M2 接数据飞轮时落地），
M1 保留 `BacktestInput` 显式传参形态（命令侧拼接），接口不变。

## 4. 迁移策略

1. `PRAGMA user_version=1` → 建 `games`/`participants`/`scores`/`timeline_events` 空表；
2. `user_version=2` → 建 `decision_ledger` 并入 + 从 `backtest.db` 一次性导入
   （导入失败不阻塞：ledger 留空，M2 数据飞轮补齐）；
3. `meet.db` 现网数据**不迁移**（查询快照，价值低），新收集路径直接写 `app.db`；
4. 双写过渡：M1→M2 期间 `meet_db` 与 `app.db` 并存，UI 读取按新库优先。

## 5. 开放问题（M2 前定）

- **跨区冲突**：同一 `game_id` 在国服/国际服不冲突（platform_id 入主键？——
  倾向 `PRIMARY KEY (platform_id, game_id)`，M1 单区先行，M2 开国际服时升级）。
- **保留时长**：`timeline_events`/`json_payload` 体量大，建议 90 天滚动清理
  （对账/回测只需结果，事件明细过期即删）。
- **golden 标注集**：标注真值仍存代码（`score/golden.rs` 测试），不进 `app.db`。

## 6. 验收

- [ ] `app.db` 单库建表脚本落地（`migrate.rs` 通道，`user_version` 逐级可回放）；
- [ ] 决策 ledger 关联键 `gameId + suggestedAtMs + 英雄` 唯一约束生效；
- [ ] 回测样本视图 SQL 在本机 20 局历史数据上可跑通且与 M1 手工样例一致；
- [ ] 旧库备份 + 无数据丢失演练（破坏性测试在 CI 之外手工跑一次）。