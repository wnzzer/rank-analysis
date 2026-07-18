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
