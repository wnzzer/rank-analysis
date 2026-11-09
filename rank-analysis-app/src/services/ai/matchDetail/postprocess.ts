/**
 * AI 复盘 markdown 的确定性后处理。
 *
 * 重复上榜去重：stage2 prompt 明令"每名玩家只出现在 label 对应的一个章节"，
 * 但 qwen-flash 实测 ~15% 场次仍会把同一玩家写进两个人物章节——prompt 层已到顶，
 * 由代码兜底：同一玩家（按 `名字#数字` 识别）在人物章节中只保留首次出现的条目。
 * 关键证据章节不去重（复述数字属正常）。纯函数，流式中途的不完整 markdown 也安全。
 */

/** 人物章节标题（出现顺序即保留优先级） */
const PERSON_SECTIONS = ['谁尽力了', '谁要背锅', '谁被打爆 / 被连累', '谁被打爆']

/** label → 应归属的人物章节标题(正常 = 不上榜) */
const SECTION_OF_LABEL: Record<string, string> = {
  尽力: '谁尽力了',
  犯罪: '谁要背锅',
  缚地灵: '谁要背锅',
  被爆: '谁被打爆 / 被连累',
  被连累: '谁被打爆 / 被连累'
}

/** 各人物章节被清空后的 canonical 空态文案(与 stage2 模板一致) */
const EMPTY_FILLER: Record<string, string> = {
  谁尽力了: '- 本局都是混子局，没人称得上扛把子',
  谁要背锅: '- 本局没人能甩锅，混战自有命数',
  '谁被打爆 / 被连累': '- 无明显被针对者'
}

/** 模板空态文案的识别片段(重排后可能与真实条目共存,一律先剔除再按需补回) */
const FILLER_MARKERS = ['本局都是混子局', '没人能甩锅', '无明显被针对者', '混战自有命数']

/** 供重排使用的最小 verdict 形状 */
export interface SectionVerdict {
  name: string
  label: string
}

/**
 * 按 stage1 label 把人物章节的条目确定性归位。
 *
 * stage2 prompt 明令「章节归属由名册 label 固定映射」,但 qwen-flash 真机实测
 * 仍会把缚地灵写进「谁尽力了」、被爆写进「谁要背锅」——prompt 已到顶,由代码
 * 接管排版:模型只负责每条锐评句,归哪个章节由 label 决定。
 * - label=正常(含 validator 降级产物)的条目直接移除,矛盾文案不见光
 * - 带 名字#数字 但不在名册的条目移除(没有 verdict 的人不该被定性);
 *   认不出玩家的条目留在原章节(不妄动),空章节补模板空态文案
 * 纯函数,流式中途的不完整 markdown 也安全。
 */
export function resectionByLabels(markdown: string, verdicts: SectionVerdict[]): string {
  if (verdicts.length === 0) return markdown
  // 名字长的优先匹配,防止短名是长名子串时张冠李戴
  const roster = [...verdicts].sort((a, b) => b.name.length - a.name.length)

  const lines = markdown.split('\n')
  /** 每个人物章节收到的条目(含名册外滞留条目,保持原相对顺序) */
  const buckets: Record<string, string[]> = {
    谁尽力了: [],
    谁要背锅: [],
    '谁被打爆 / 被连累': []
  }
  const structural: { kind: 'line' | 'personSection'; value: string }[] = []

  let currentPerson: string | null = null
  for (const line of lines) {
    const heading = line.match(/^##\s*(.+?)\s*$/)
    if (heading) {
      const title = heading[1]
      const person = PERSON_SECTIONS.find(s => title.startsWith(s))
      // 「谁被打爆」缩写标题归一到全名桶
      currentPerson = person ? (person === '谁被打爆' ? '谁被打爆 / 被连累' : person) : null
      if (currentPerson) {
        structural.push({ kind: 'personSection', value: currentPerson })
        structural.push({ kind: 'line', value: line })
      } else {
        structural.push({ kind: 'line', value: line })
      }
      continue
    }
    if (!currentPerson) {
      structural.push({ kind: 'line', value: line })
      continue
    }
    // 人物章节内容行:空态文案剔除;按名册归位;名册外留在原章节
    if (FILLER_MARKERS.some(m => line.includes(m))) continue
    const hit = roster.find(v => line.includes(v.name) || line.includes(v.name.split('#')[0]))
    if (!hit) {
      // 带玩家标识却不在名册 = 模型给没出 verdict 的人定了性(真机 301039452606
      // 把名册外玩家写进「谁要背锅」),丢弃;认不出是谁的条目留在原章节
      if (PLAYER_ID_PATTERN.test(line)) continue
      if (line.trim()) buckets[currentPerson].push(line)
      continue
    }
    const target = SECTION_OF_LABEL[hit.label]
    if (!target) continue // 正常/未知 label:不上榜
    buckets[target].push(line)
  }

  const rebuilt: string[] = []
  for (let i = 0; i < structural.length; i++) {
    const seg = structural[i]
    if (seg.kind === 'line') {
      rebuilt.push(seg.value)
      continue
    }
    // personSection 标记:下一段是标题行,先输出标题,再倾倒对应桶
    const headingSeg = structural[i + 1]
    if (headingSeg?.kind === 'line') {
      rebuilt.push(headingSeg.value)
      i++
    }
    const bucket = buckets[seg.value]
    if (bucket.length > 0) rebuilt.push(...bucket)
    else rebuilt.push(EMPTY_FILLER[seg.value])
  }
  return rebuilt.join('\n')
}

/** 玩家标识：名字#数字（与 LCU gameName#tagLine 展示一致） */
const PLAYER_ID_PATTERN = /[^\s：:（(【\-#]+#\d{3,6}/

export function dedupeSectionMentions(markdown: string): string {
  const lines = markdown.split('\n')
  const seen = new Set<string>()
  let inPersonSection = false
  const out: string[] = []

  for (const line of lines) {
    const heading = line.match(/^##\s*(.+?)\s*$/)
    if (heading) {
      inPersonSection = PERSON_SECTIONS.some(s => heading[1].startsWith(s))
      out.push(line)
      continue
    }
    if (inPersonSection) {
      const id = line.match(PLAYER_ID_PATTERN)?.[0]
      if (id) {
        if (seen.has(id)) continue // 重复上榜：丢弃后出现的条目
        seen.add(id)
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

/** 数字 token(支持千分位与小数),与 stripUngroundedSentences 共用 */
const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g

/**
 * 提取文本中出现的全部数字(千分位归一),供数字接地过滤做白名单。
 * 通常直接对喂给模型的完整 prompt 调用——prompt 里有的数字才是模型可引用的。
 */
export function extractNumbers(text: string): Set<number> {
  const out = new Set<number>()
  for (const tok of text.match(NUMBER_TOKEN) ?? []) {
    const n = Number.parseFloat(tok.replace(/,/g, ''))
    if (Number.isFinite(n)) out.add(n)
  }
  return out
}

/**
 * 单人复盘的数字接地过滤:剔除含材料外数字的句子。
 *
 * qwen-flash 在单人复盘的「责任归因」段落会编造数字(真机复现:材料只有
 * 经济占比 14.3%,输出写成「14 次死亡、参团率 25%」)。prompt 禁令无效,
 * 由代码兜底:凡句子里出现材料(prompt)中不存在的数字,整句剔除——
 * 宁可少说一句,不给用户看编造数据。中文数字(如「三次」)不在覆盖范围,
 * 属 fail-open。纯函数,流式中途的不完整 markdown 也安全(未完句暂时
 * 被截也会随后续 chunk 恢复)。
 *
 * @param markdown - 模型输出(可为流式中间态)
 * @param allowed - 材料数字白名单(空集 = 无材料可依,不过滤)
 */
export function stripUngroundedSentences(markdown: string, allowed: Set<number>): string {
  if (!markdown || allowed.size === 0) return markdown
  const nums = [...allowed]
  // 容差 0.05:模型偶发把 8.20 写成 8.2 之类的等值变体;不容忍四舍五入级改写
  const grounded = (t: number): boolean => nums.some(s => Math.abs(s - t) <= 0.05)

  const out: string[] = []
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line)
      continue
    }
    const bullet = line.match(/^(\s*[-*]\s+)([\s\S]*)$/)
    const prefix = bullet ? bullet[1] : ''
    const content = bullet ? bullet[2] : line
    // 按句末标点切句(保留分隔符);句内出现任一未接地数字 → 整句剔除
    const kept = content.split(/(?<=[。!?;！？；])/).filter(sentence => {
      const tokens = sentence.match(NUMBER_TOKEN) ?? []
      return tokens.every(tok => grounded(Number.parseFloat(tok.replace(/,/g, ''))))
    })
    const joined = kept.join('').trim()
    if (!joined) continue
    out.push(prefix + joined)
  }
  return out.join('\n')
}

/**
 * 评分黑话：分位 token（P30、P30~P40）、「分位」（排除「分位置」「分位移」）、标准差、z 值、
 * 「总分」接数字、分项名紧跟带符号小数（对线 -1.9、团战+1.1；含全角负号 −）。
 * 「对线落后 1209 经济」「14 分钟补刀差 39」这类不带符号的具体数据不命中。
 */
const SCORE_JARGON: RegExp[] = [
  /(?<![A-Za-z])P\d0(?!\d)/,
  /分位(?![置移])/,
  /标准差/,
  /z\s*值/i,
  /总分\s*[-+−]?\d/,
  /(对线|团战|死亡质量|发育|资源|视野|职责)\s*[-+−]\d+(\.\d+)?/
]

/** 句子是否含评分黑话（渲染兜底与评测指标共用） */
export function isScoreJargon(sentence: string): boolean {
  return SCORE_JARGON.some(re => re.test(sentence))
}

/** 列表项开头的「名字：」（剔句时保留，免得人物条目丢了名字后无法按名册归位） */
const ITEM_HEAD = /^[^：:。！？；!?;]{1,40}[：:]/

/**
 * 剔除含评分黑话的句子（prompt 已禁止，模型仍偶发照抄分数时的兜底）。
 * 整条清空则删行；标题行不动。材料里没有分数时无副作用。纯函数，流式中间态安全。
 * @param markdown - 模型输出
 */
export function stripScoreJargon(markdown: string): string {
  if (!markdown) return markdown
  const out: string[] = []
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !isScoreJargon(line)) {
      out.push(line)
      continue
    }
    const bullet = line.match(/^(\s*[-*]\s+)([\s\S]*)$/)
    const prefix = bullet ? bullet[1] : ''
    const content = bullet ? bullet[2] : line
    const head = content.match(ITEM_HEAD)?.[0] ?? ''
    const body = content.slice(head.length)
    const kept = body
      .split(/(?<=[。!?;！？；])/)
      .filter(s => !isScoreJargon(s))
      .join('')
      .trim()
    if (!kept && body.trim()) continue
    out.push(prefix + head + kept)
  }
  return out.join('\n')
}

/** 卡片引用标记（与 shared/timeline 的 CITATION_RE 同形，这里独立声明避免循环依赖） */
const CITATION_TOKEN = /\[([LDISVFT]\d+)\]/g

/** 带空格/小写的卡片引用，如 [ I4 ]、[d12] */
const LOOSE_CITATION = /\[\s*([A-Za-z])(\d+)\s*\]/g
/** 纯字母方括号标记（模型发明的 [TS] 之类）；后跟 ( 的是 markdown 链接，不算。评测指标共用 */
export const BOGUS_TAG = /\[\s*[A-Za-z]{1,4}\s*\](?!\()/g
const BOGUS_TAG_LINE_START = /^([ \t]*)\[\s*[A-Za-z]{1,4}\s*\](?!\()[ \t]*/gm
const BOGUS_TAG_INLINE = /[ \t]*\[\s*[A-Za-z]{1,4}\s*\](?!\()/g

/**
 * 规整模型输出里的卡片引用：[ I4 ] / [i4] → [I4]；删除发明的纯字母标记（[TS]）并收拢留下的空格。
 * 只应在本次带时间线卡片时调用。纯函数，流式中间态安全。
 * @param markdown - 模型输出的 markdown
 */
export function normalizeCitations(markdown: string): string {
  if (!markdown) return markdown
  return markdown
    .replace(LOOSE_CITATION, (m, letter: string, digits: string) =>
      'LDISVFT'.includes(letter.toUpperCase()) ? `[${letter.toUpperCase()}${digits}]` : m
    )
    .replace(BOGUS_TAG_LINE_START, '$1')
    .replace(BOGUS_TAG_INLINE, '')
}

/** 句内 mm:ss 时间 token（评测指标共用） */
export const TIME_TOKEN = /\b\d{1,2}:\d{2}\b/g

/** 句末标点切句（保留分隔符） */
const SENTENCE_SPLIT = /(?<=[。!?;！？；])/

/** 一条引用及其所辖文本段 */
export interface CitationSegment {
  id: string
  /** `[ID]` 在句中的起始下标 */
  index: number
  /** 该引用所辖文本：[ID] 起到下一个引用前；首个引用之前的文字并入第一段 */
  segment: string
}

/**
 * 把一句话按引用切段（修复与评测共用的口径）。
 * @param sentence - 单个句子（需已 normalizeCitations）
 */
export function citationSegments(sentence: string): CitationSegment[] {
  const hits = [...sentence.matchAll(CITATION_TOKEN)].map(m => ({ id: m[1], index: m.index ?? 0 }))
  return hits.map((h, i) => {
    const start = i === 0 ? 0 : h.index
    const end = i + 1 < hits.length ? hits[i + 1].index : sentence.length
    return { ...h, segment: sentence.slice(start, end) }
  })
}

/**
 * 确定性引用修复：句子文字对、引用 id 错时，按时间改指向或摘掉角标。
 *
 * 对每个引用，若其所辖段含 mm:ss 且有时间不在被引卡片文本里：
 * 找文本包含该段全部时间的卡片（优先同前缀字母），唯一则换 id，否则删掉该角标（保留句子）。
 * 段内无时间 / id 不存在的引用原样保留（后者交给 stripInvalidCitations）。
 * 纯函数，流式中间态安全。
 * @param markdown - 已 normalizeCitations 的模型输出
 * @param cards - 本次可引用的卡片
 */
export function repairCitations(
  markdown: string,
  cards: Array<{ id: string; text: string }>
): string {
  if (!markdown || cards.length === 0) return markdown
  const byId = new Map(cards.map(c => [c.id, c.text]))
  const out: string[] = []
  for (const line of markdown.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) {
      out.push(line)
      continue
    }
    out.push(
      line
        .split(SENTENCE_SPLIT)
        .map(s => repairSentence(s, cards, byId))
        .join('')
    )
  }
  return out.join('\n')
}

function repairSentence(
  sentence: string,
  cards: Array<{ id: string; text: string }>,
  byId: Map<string, string>
): string {
  const edits: Array<{ index: number; length: number; replacement: string | null }> = []
  for (const seg of citationSegments(sentence)) {
    const text = byId.get(seg.id)
    const times = seg.segment.match(TIME_TOKEN)
    if (text === undefined || !times || times.every(t => text.includes(t))) continue
    const all = cards.filter(c => times.every(t => c.text.includes(t)))
    const same = all.filter(c => c.id[0] === seg.id[0])
    const pool = same.length > 0 ? same : all
    edits.push({
      index: seg.index,
      length: seg.id.length + 2,
      replacement: pool.length === 1 ? `[${pool[0].id}]` : null
    })
  }
  let result = sentence
  // 从后往前改，前面的下标不受影响
  for (const e of edits.reverse()) {
    let start = e.index
    let end = e.index + e.length
    if (e.replacement === null && result[start - 1] === ' ') {
      // 摘掉角标后收拢空格：前后都是空格删后一个；后面是标点或句尾则删前一个
      if (result[end] === ' ') end++
      else if (end >= result.length || /[，。,.!?;！？；、：:)）]/.test(result[end])) start--
    }
    result = result.slice(0, start) + (e.replacement ?? '') + result.slice(end)
  }
  return result
}

/**
 * 剔除引用了不存在卡片的句子（模型编造卡片编号）。纯函数，流式中间态安全。
 * @param markdown - 模型输出的 markdown
 * @param validIds - 本次材料里的全部卡片编号；空集 = 无时间线，不过滤
 * @returns 过滤后的 markdown
 */
export function stripInvalidCitations(markdown: string, validIds: Set<string>): string {
  if (!markdown || validIds.size === 0) return markdown
  const out: string[] = []
  for (const line of markdown.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) {
      out.push(line)
      continue
    }
    const bullet = line.match(/^(\s*[-*]\s+)([\s\S]*)$/)
    const prefix = bullet ? bullet[1] : ''
    const content = bullet ? bullet[2] : line
    const kept = content
      .split(/(?<=[。!?;！？；])/)
      .filter(s => [...s.matchAll(CITATION_TOKEN)].every(m => validIds.has(m[1])))
    const joined = kept.join('').trim()
    if (joined) out.push(prefix + joined)
  }
  return out.join('\n')
}
