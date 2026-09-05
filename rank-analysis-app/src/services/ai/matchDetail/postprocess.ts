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
 * - 名册外的条目留在原章节(不妄动),空章节补模板空态文案
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
