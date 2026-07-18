# 赛后 AI 复盘去幻觉：确定性回填 + Stage2 名册 + Stage1 位置感知 — 设计

日期：2026-07-18
状态：已口头批准（三层都做），本文档为实现依据

## 症状（真机截图，2026-07-18 单双排）

1. 把下路赏金猎人（用户）写成"中路核弹手"——Stage2 只拿到归因 JSON + 模式描述，
   `Verdict` 无英雄/分路/胜负方，写手只能编。
2. 败方 SVP 被塞进"谁尽力了"章节，配文却是被连累口吻——Stage2 模板没规定
   label→章节映射。
3. 辅助因"助攻王但伤害最低"进背锅席——Stage1 标签量化标准位置盲，
   damageShare/goldShare 阈值结构性冤枉辅助/坦克。
4. "死得比补刀多"——材料里没有 cs 对比字段，Stage2 编造数据性断言。

## 修法（三层）

### 1. 确定性回填（validator.ts，TS 写入不信模型）

`validateAttribution` 通过后，按 `participantId` 从 snapshot 回填每条 verdict：
- `champion`（中文名）、`teamPosition`、`teamResult`（win ? '胜方' : '败方'）
- `Verdict` 类型加这三个可选字段；找不到对应玩家则不填（保持 undefined）。
- 模型若自己输出了这些字段，一律被快照值覆盖。

### 2. Stage2 prompt（stage2-critique.ts）

- 输入区新增【玩家名册（快照事实，禁止偏离）】：每条 verdict 一行
  `名字｜英雄｜分路(中文，无分路模式省略)｜胜方/败方｜label`。
- 硬规则追加：
  a) 章节映射固定：尽力→谁尽力了；犯罪/缚地灵→谁要背锅；被爆/被连累→谁被打爆/被连累；
     正常→不单独上榜（可进关键证据）。
  b) 分路/英雄/胜负方只能抄名册，禁止写名册外的分路（如把下路写成中路）。
  c) 禁止编造材料外的数据性比较/断言（如"死得比补刀多"——evidenceMetrics 里没有
     cs 字段就不准写）；夸张修辞只能建立在已给数字上。

### 3. Stage1 prompt（stage1-attribution.ts）

- 硬性规则追加：teamPosition=UTILITYの玩家，damageShare/goldShare 低**不构成**负面证据，
  评价改用 killParticipation / assists / wardScore；"被爆/缚地灵"对 UTILITY 的判定
  同理替换。
- finalCall 中提到分路时必须用该玩家 snapshot.teamPosition 的值（hasLanes=true 时）。

## 测试

- validator.spec：回填三字段（含胜负方两侧）；participantId 不在快照 → 不填但校验仍过；
  模型自带的 champion 字段被快照覆盖。
- prompts.spec：stage2 含名册行/章节映射/禁比较关键词；stage1 含 UTILITY 豁免关键词。
- 验收：真实 buildStage2Prompt + 复刻截图场景（败方 SVP 被连累 + 辅助负面 verdict）
  打 qwen 模型，人工核对章节归位与分路不再编造。
