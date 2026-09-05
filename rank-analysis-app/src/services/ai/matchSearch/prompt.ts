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
  "selfPositions": ["说话人自己玩的位置: TOP|JUNGLE|MIDDLE|BOTTOM|UTILITY"],
  "intent": "list" | "count_encounters"
}

规则:
1. 英雄 id 只能从下方英雄清单里选,俗称/绰号对照清单归一;清单里没有的英雄一律忽略。
2. 「我用X」→ selfChampionIds;「队友有X」→ allyChampionIds;「对面/敌方有X」→ enemyChampionIds;「忘了自己玩的什么,但这边有X」这类不确定是不是自己在用的 → myTeamChampionIds。
3. 相对时间按「今天」换算成绝对日期:口语的「这个月/最近一个月/近一个月」一律取最近 30 天(from = 今天-30天,to 省略);「上周/最近一周」取最近 7 天;「前两天」取最近 3 天;只有明确点名某个日历月(如「8月」)才用该月 1 日到月末。to 不得晚于今天,「至今」直接省略 to。完全没提时间就不要输出 timeRange。
4. 「跟某某碰见/遇到几次」这类统计问题 → intent = "count_encounters",玩家名进 playerNames;其余 intent = "list"。
5. selfPositions **只有用户明确说了位置词**(上单/上路=TOP、打野=JUNGLE、中单/中路=MIDDLE、下路/AD/射手=BOTTOM、辅助=UTILITY)才填;禁止从英雄名推断位置(「我玩亚索」只说明英雄,不说明位置);大乱斗/斗魂等无分路模式不填。
6. 队列映射:「排位」没细分时 = [420,440];「单双排」=420;「灵活组排」=440;「匹配」=430;其余按队列清单名称对应。
7. 不确定的信息宁可省略,不要猜。所有数字必须来自清单,禁止编造。`

/** 上个月的中文叫法(如「8月」),用于日历月示例 */
function prevMonthCn(today: string): string {
  const d = new Date(`${today}T00:00:00.000Z`)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCMonth() + 1}月`
}

/** 上个月的边界 JSON(如 {"from":"2026-08-01","to":"2026-08-31"}) */
function prevMonthRangeJson(today: string): string {
  const d = new Date(`${today}T00:00:00.000Z`)
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))
  const iso = (x: Date): string => x.toISOString().slice(0, 10)
  return JSON.stringify({ from: iso(first), to: iso(last) })
}

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

  // few-shot 时间换算示例:qwen-flash 对抽象规则不敏感,给带具体日期的样例
  const daysAgo = (n: number): string => {
    const d = new Date(`${ctx.today}T00:00:00.000Z`)
    d.setUTCDate(d.getUTCDate() - n)
    return d.toISOString().slice(0, 10)
  }

  const user = `今天是 ${ctx.today}。

时间换算示例(严格照此风格):
- 「这个月/最近一个月/近一个月」→ {"from":"${daysAgo(30)}","to":null}
- 「上周/最近一周」→ {"from":"${daysAgo(7)}","to":null}
- 「前两天」→ {"from":"${daysAgo(3)}","to":null}
- 明确点名某日历月(如「${prevMonthCn(ctx.today)}」)才用该月边界 → ${prevMonthRangeJson(ctx.today)}

英雄清单(id|官方名|昵称|称号):
${championLines}

队列清单(id|名称):
${modeLines}

玩家描述:
${text}

请输出 JSON 检索条件。`

  return { system: SYSTEM_PROMPT, user }
}
