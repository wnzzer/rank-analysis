# Rank Analysis

## 项目概述
英雄联盟排位分析工具，基于 Tauri 2.0 构建
- **前端**: Vue 3 + TypeScript + Vite
- **后端**: Rust (Tauri)
- **核心功能**: LCU API 通信、战绩查询、AI 分析、自动化辅助

## 项目结构
- 前端源码: `lol-record-analysis-tauri/src/`
  - `components/` 组件 / `views/` 页面 / `pinia/` 状态 / `services/` API / `composables/` 组合式函数 / `types/` 类型
- 后端源码: `lol-record-analysis-tauri/src-tauri/src/`
  - `command/` Tauri Commands / `lcu/` LCU API 客户端 / `automation.rs` 自动化 / `fandom/` Fandom 数据

## 工作流约定
- 提交前的质量门禁与 commit/PR 流程：见 `.claude/skills/shipping-changes/SKILL.md`（代码改动后或将要 `git commit` 时触发）
- 详细的 lint / format / 命名 / Conventional-Commits 规范：见 `CODE_QUALITY.md` 与 `CONTRIBUTING.md`

---

## 代码注释规范

### TypeScript / Vue 注释规范 (JSDoc)

```typescript
/**
 * 计算玩家近期 KDA 数据
 * @param matches - 近期对局列表
 * @param mode - 游戏模式过滤 (可选)
 * @returns KDA 统计对象，包含 kills, deaths, assists, kda
 * @throws 当 matches 为空数组时返回 0/0/0/0
 * @example
 * ```ts
 * const kda = calculateKda(matchHistory.games.games, 420);
 * console.log(kda.kda); // "3.5"
 * ```
 */
export function calculateKda(
  matches: Game[],
  mode?: number
): { kills: number; deaths: number; assists: number; kda: string } {
  // 实现...
}

/**
 * 玩家卡片组件属性
 * @property sessionSummoner - 召唤师会话数据
 * @property team - 所属队伍颜色
 */
interface PlayerCardProps {
  sessionSummoner: SessionSummoner;
  team?: 'blue' | 'red';
}
```

### Rust 注释规范 (RustDoc)

```rust
/// 自动化任务管理器
///
/// 负责管理所有自动化任务的启动、停止和生命周期
///
/// # 示例
/// ```
/// let manager = AutomationManager::new();
/// manager.start_task("accept_match", accept_match_task()).await;
/// ```
pub struct AutomationManager {
    tasks: Arc<Mutex<HashMap<String, AutomationTask>>>,
}

impl AutomationManager {
    /// 启动一个新的自动化任务
    ///
    /// # 参数
    /// - `name`: 任务名称，用于后续管理
    /// - `task`: 异步任务 Future
    ///
    /// # 行为
    /// - 如果同名任务已存在，会先停止旧任务
    /// - 任务会自动加入任务列表管理
    ///
    /// # 示例
    /// ```rust
    /// manager.start_task("auto_accept", async {
    ///     // 自动接受匹配逻辑
    /// }).await;
    /// ```
    pub fn start_task(&self, name: &str, task: impl Future<Output = ()> + Send + 'static) {
        // 实现...
    }
}
```

### 注释检查清单

- [ ] **文件头注释**: 描述文件用途和主要职责
- [ ] **函数/方法注释**: 描述功能、参数、返回值、异常
- [ ] **复杂逻辑注释**: 解释"为什么"而非"做什么"
- [ ] **类型/接口注释**: 描述用途和字段含义
- [ ] **常量注释**: 解释值的来源和用途
- [ ] **TODO/FIXME**: 标记待处理项，附带说明和优先级

---

## 单元测试规范

### 前端测试 (Vitest)

```typescript
// composables/useTheme.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { useTheme } from './useTheme'
import { createPinia, setActivePinia } from 'pinia'

describe('useTheme', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should detect dark mode when theme is Dark', () => {
    // Arrange
    const { isDark } = useTheme()

    // Act & Assert
    expect(isDark.value).toBe(true)
  })

  it('should return correct asset URL for champion', () => {
    const { getChampionUrl } = useAssetUrl()

    const url = getChampionUrl(1)

    expect(url).toContain('/champion/1')
  })
})
```

### Rust 测试

```rust
// command/rank.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn should_calculate_win_rate_correctly() {
        // Arrange
        let wins = 7;
        let losses = 3;

        // Act
        let rate = calculate_win_rate(wins, losses);

        // Assert
        assert_eq!(rate, 70.0);
    }

    #[test]
    fn should_return_zero_when_no_games() {
        assert_eq!(calculate_win_rate(0, 0), 0.0);
    }
}
```

### 测试目录结构

```
lol-record-analysis-tauri/
├── src/
│   ├── composables/
│   │   ├── useTheme.ts
│   │   └── useTheme.spec.ts          # 同目录测试文件
│   ├── services/
│   │   ├── ipc.ts
│   │   └── __tests__/ipc.spec.ts     # 或 __tests__ 目录
│   └── utils/
│       ├── format.ts
│       └── __tests__/format.spec.ts
└── src-tauri/src/
    ├── command/
    │   ├── rank.rs
    │   └── rank_tests.rs             # 子模块测试
    └── lcu/
        └── api/
            └── summoner.rs
```

### 测试覆盖率要求

| 模块类型 | 覆盖率要求 | 说明 |
|---------|-----------|------|
| 工具函数 | 90%+ | format, calculate 等纯函数 |
| Composables | 80%+ | 核心业务逻辑 |
| Services | 70%+ | API 调用（可 mock）|
| Components | 60%+ | 关键交互组件 |
| Rust Commands | 80%+ | 后端核心逻辑 |
| Rust API 客户端 | 70%+ | LCU API 封装 |

---

## 文档规范

### 文档类型

| 文档 | 位置 | 更新时机 |
|------|------|---------|
| `README.md` / `README.zh-CN.md` | 根目录 | 功能变更 |
| `CODE_QUALITY.md` | 根目录 | 质量标准变更 |
| `CONTRIBUTING.md` | 根目录 | 贡献流程变更 |
| `CHANGELOG.md` | 根目录（如有） | 每次发布 |

### API 文档模板

```markdown
## get_summoner_by_name

获取召唤师信息

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 召唤师名称（格式: 名称#标签）|

### 返回值

```typescript
interface Summoner {
  gameName: string;      // 游戏名称
  tagLine: string;       // 标签
  puuid: string;         // 唯一标识
  summonerLevel: number; // 等级
  profileIconId: number; // 头像ID
}
```

### 示例

```typescript
const summoner = await invoke('get_summoner_by_name', {
  name: 'PlayerName#1234'
});
```

### 错误

- `SummonerNotFound`: 召唤师不存在
- `InvalidNameFormat`: 名称格式错误
```

---

## 项目规范速查

### 文件命名
- Vue 组件: `PascalCase.vue`
- TS 文件: `camelCase.ts`
- Rust 文件: `snake_case.rs`
- 测试文件: `*.spec.ts` 或 `*_tests.rs`

### Git 提交
- 格式: `<type>: <description>`
- Types: feat, fix, refactor, docs, test, chore

### 代码质量
本仓库的 canonical 门禁是 `npm run check`（= prettier + eslint + vue-tsc + cargo fmt --check + cargo clippy -Dwarnings，与 CI 一致）。
```bash
cd lol-record-analysis-tauri
npm run check          # 一把跑完前后端 lint/format/typecheck/clippy
npm run test           # vitest（前端单元测试）
cd src-tauri && cargo test   # Rust 单元测试
```
触发时机与 commit/PR 流程见 `.claude/skills/shipping-changes/SKILL.md`。
