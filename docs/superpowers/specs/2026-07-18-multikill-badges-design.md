# 战绩详情多杀徽章（三杀/四杀/五杀）— 设计

日期：2026-07-18
状态：已口头批准（方案 A 徽章行 + 不显示双杀），本文档为实现依据

## 背景与根因

用户要求战绩详情显示三杀/四杀/五杀。排查发现数据在 Rust 反序列化层就被丢了：
`lcu/api/model.rs::Stats` 未声明 `doubleKills/tripleKills/quadraKills/pentaKills`。
连带潜伏 bug：AI 复盘 snapshot 的 `(stats as any).tripleKills ?? 0` 因此恒为 0，
multiKills 证据从未生效。SGP 兜底源同名扁平字段（`from_value` 直灌 `Stats`），
Rust 加字段一处两源同修。

## 方案（已选 A）

### 数据层
- Rust `Stats` += 4 个字段：`#[serde(rename = "doubleKills", default)] pub double_kills: i32`
  及 triple/quadra/penta 同式。测试构造处均用 `..Default::default()`，无破坏。
- 前端 `ParticipantStats` += 可选字段 `doubleKills?/tripleKills?/quadraKills?/pentaKills?: number`
  （旧缓存数据无此字段，可选 + `?? 0` 兜底）。
- `shared/snapshot.ts` 摘掉 `as any`，改typed访问（行为不变，潜伏 bug 随 Rust 字段修复）。

### UI 层（useMatchDetailPlayers + MatchDetailModal 样式）
- 新增多杀荣誉徽章，插在"最多"类徽章**前面**，顺序 五杀 > 四杀 > 三杀：
  - label：次数 1 → "五杀"；次数 >1 → "五杀×2"。
  - 双杀不出徽章（数据照样透传）。
  - 图标统一 FlashOutline，配色分档：penta 金 / quadra 紫 / triple 蓝，
    CSS class `match-detail-badge-penta/quadra/triple` 加在 MatchDetailModal.vue 样式区。
- 模板零改动（badges v-for 自动渲染）。

## 测试
- Rust：Stats 反序列化含多杀字段 → 保留；缺失 → 0。
- useMatchDetailPlayers.spec：pentaKills=1 → "五杀"徽章；tripleKills=2 → "三杀×2"；
  全 0 → 无多杀徽章；doubleKills>0 不出徽章；多杀徽章排在"最多"类之前。
- snapshot 测试：stats 带 tripleKills → snapshot.multiKills.triple 取到值。
