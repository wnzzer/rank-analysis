/**
 * AI 自然语言搜战绩:结构化查询模型(issue #157)
 *
 * 模型只负责把自然语言解析成本文件的 `ParsedMatchQuery`,
 * 所有筛选/统计由本地纯函数完成,不信任模型的数字结论。
 */

/** 自然语言解析出的战绩检索条件(全部字段可缺省 = 不筛该维度) */
export interface ParsedMatchQuery {
  /** 时间窗,ISO 日期(YYYY-MM-DD),null = 该侧不设限;to 含当日整天 */
  timeRange: { from: string | null; to: string | null }
  /** 我用的英雄,多个为「其中之一」(用户记不清是哪个时的备选) */
  selfChampionIds: number[]
  /** 队友(不含我)用的英雄,多个为「都要在场」 */
  allyChampionIds: number[]
  /** 对面用的英雄,多个为「都要在场」 */
  enemyChampionIds: number[]
  /** 我方(含我)出现过的英雄,多个为「都要在场」——「忘了自己玩的啥」场景 */
  myTeamChampionIds: number[]
  /** 胜负 */
  result: 'win' | 'loss' | 'any'
  /** 队列 id 白名单,空 = 不限模式 */
  queueIds: number[]
  /** 出现过的玩家名(「跟 XXX#XXX 碰见过几次」),支持 名#tag 或纯名 */
  playerNames: string[]
  /** 我玩的位置(「我玩辅助的那几把」),多个为其中之一;按排除法推断的分路匹配 */
  selfPositions: ('TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY')[]
  /** list = 列出对局;count_encounters = 统计与 playerNames 的相遇次数 */
  intent: 'list' | 'count_encounters'
}

/** 相遇统计结果(count_encounters 意图) */
export interface EncounterStats {
  /** 命中任一目标玩家的对局数 */
  total: number
  /** 每个目标玩家的同队/对面相遇局数 */
  perName: Record<string, { ally: number; enemy: number }>
}

/** 解析条件的可视化 chip(供结果页展示与删除) */
export interface QueryChip {
  /** 删除定位用,如 `self:51` / `time` / `player:某人#123` */
  key: string
  /** 人类可读文案,如 `我用: 皮城女警` */
  label: string
}
