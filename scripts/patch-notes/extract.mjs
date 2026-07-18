/**
 * 公告 HTML → 纯文本，以及 GitHub Models 结构化抽取调用。
 * AI 负责「理解」：判定是否端游版本公告、提取英雄段、判方向；
 * 文本预处理只做机械转换，不做任何语义筛选。
 */

export const MODELS_URL = 'https://models.github.ai/inference/chat/completions'
export const MODEL_ID = 'openai/gpt-4o-mini'

/** 公告页实际出现的 HTML 实体子集 */
function decodeEntities(s) {
  return s
    .replaceAll('&rarr;', '→')
    .replaceAll('&emsp;', ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&mdash;', '—')
}

/** 去标签取纯文本：块级闭合转换行，行内标签直接剥掉，空行压缩 */
export function htmlToText(html) {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|blockquote|li|div)>/gi, '\n')
  const noTags = withBreaks.replace(/<[^>]*>/g, '')
  return decodeEntities(noTags)
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export const SYSTEM_PROMPT = `你是一个数据提取器。用户会给你一篇英雄联盟国服官网公告的纯文本。
任务：判断它是否为端游（PC《英雄联盟》）的版本更新公告；若是，提取「英雄」部分中每个英雄的平衡性改动。
必须只输出一个 JSON 对象，不要输出任何其他文字，结构如下：
{"isPatchNotes": true 或 false, "champions": [{"name": "英雄中文名（如 阿兹尔，不含称号）", "direction": "buff" 或 "nerf" 或 "adjusted", "lines": ["逐字摘录的改动条目原文"]}]}
规则：
- direction：数值提升类改动为 buff，数值下调为 nerf；注意冷却时间、法力消耗、施法时间等「越低越好」的属性方向相反（数值降低是 buff）；加强与削弱并存、重做或无法判断时为 adjusted
- lines 必须逐字摘录原文，不得改写、翻译或总结；设计师评论、开发者说明段落不要包含
- 只提取「英雄」部分；装备、符文、系统、云顶之弈、斗魂竞技场、无限乱斗等其他部分一律忽略
- 若文章不是端游版本更新公告（如活动公告、云顶公告），输出 {"isPatchNotes": false, "champions": []}`

/** 容忍模型偶发的 ```json 代码栅栏包装 */
export function parseModelJson(content) {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
  return JSON.parse(stripped)
}

export async function callModel(articleText, token, fetchFn = fetch) {
  const res = await fetchFn(MODELS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: MODEL_ID,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        // 60k 字符 ≈ 30k+ token，gpt-4o-mini 128k 上限内；公告实测 20-50KB
        { role: 'user', content: articleText.slice(0, 60000) }
      ]
    })
  })
  if (!res.ok) {
    throw new Error(`GitHub Models HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('GitHub Models: 回包无 content')
  return parseModelJson(content)
}
