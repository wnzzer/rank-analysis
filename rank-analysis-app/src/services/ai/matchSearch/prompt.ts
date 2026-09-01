/**
 * 自然语言搜战绩的 prompt 构造
 *
 * 反幻觉设计:
 * - 英雄清单(id|官方名|昵称|称号)整体注入,模型只许从清单选 id,
 *   「女警/金克斯」这类俗称由模型对着清单归一,本地再按白名单过滤兜底
 * - 注入今天日期,让「这个月/前两天」被解析为绝对 ISO 日期
 * - 队列同理给出 id|名称 映射表
 */

/** prompt 构造所需的上下文(全部来自本地命令,调用方负责缓存) */
export interface PromptContext {
  /** 今天日期 YYYY-MM-DD */
  today: string
  /** 英雄清单,来自 get_champion_options */
  champions: { value: number; label: string; nickname: string; realName: string }[]
  /** 队列清单,来自 get_game_modes(value=0 的「全部」项由调用方过滤或本函数忽略) */
  modes: { label: string; value: number }[]
}

const SYSTEM_PROMPT = `你是英雄联盟战绩检索条件解析器。把玩家对某些对局的自然语言描述解析为 JSON 检索条件,只输出一个 JSON 对象,不要任何解释。

输出 schema(所有字段可省略,省略视为不筛该维度):
{
  "timeRange": { "from": "YYYY-MM-DD 或 null", "to": "YYYY-MM-DD 或 null" },
  "selfChampionIds": [说话人自己使用的英雄id],
  "allyChampionIds": [队友(不含说话人)使用的英雄id],
  "enemyChampionIds": [对面使用的英雄id],
  "myTeamChampionIds": [说话人这边出现过的英雄id(含本人)],
  "result": "win" | "loss" | "any",
  "queueIds": [队列id],
  "playerNames": ["提到的玩家名,保留原样(可含#tag)"],
  "intent": "list" | "count_encounters"
}

规则:
1. 英雄 id 只能从下方英雄清单里选,俗称/绰号对照清单归一;清单里没有的英雄一律忽略。
2. 「我用X」→ selfChampionIds;「队友有X」→ allyChampionIds;「对面/敌方有X」→ enemyChampionIds;「忘了自己玩的什么,但这边有X」这类不确定是不是自己在用的 → myTeamChampionIds。
3. 相对时间(这个月/上周/前两天)按「今天」换算成绝对日期;完全没提时间就不要输出 timeRange。
4. 「跟某某碰见/遇到几次」这类统计问题 → intent = "count_encounters",玩家名进 playerNames;其余 intent = "list"。
5. 不确定的信息宁可省略,不要猜。所有数字必须来自清单,禁止编造。`

/**
 * 构造解析请求的 system/user prompt
 * @param text - 用户的自然语言描述原文
 * @param ctx - 日期/英雄/队列上下文
 */
export function buildMatchSearchPrompt(
  text: string,
  ctx: PromptContext
): { system: string; user: string } {
  const championLines = ctx.champions
    .map(c => `${c.value}|${c.label}|${c.nickname}|${c.realName}`)
    .join('\n')
  const modeLines = ctx.modes
    .filter(m => m.value > 0)
    .map(m => `${m.value}|${m.label}`)
    .join('\n')

  const user = `今天是 ${ctx.today}。

英雄清单(id|官方名|昵称|称号):
${championLines}

队列清单(id|名称):
${modeLines}

玩家描述:
${text}

请输出 JSON 检索条件。`

  return { system: SYSTEM_PROMPT, user }
}
