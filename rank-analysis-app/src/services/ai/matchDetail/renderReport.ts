/**
 * AI 复盘报告渲染：markdown → 带语义高亮的 HTML（纯函数，便于单测）。
 *
 * 两步：
 * 1. markdown-it 渲染（html:false 阻断 raw HTML，CSP 之外的 XSS 纵深防御），
 *    并按固定章节标题给 `<h2>` 着 section class（图标走 CSS ::before）。
 * 2. DOMParser 走查“仅文本节点”：数字包成 `.ai-num`、列表项首个「：」前的名字包成
 *    `.ai-name`。只改文本节点、不碰标签/属性，不引入注入面。
 *
 * 章节标题与 prompts/stage2-critique.ts、critiqueTemplate.ts 的 5 段保持一致。
 */

import MarkdownIt from 'markdown-it'
import { dedupeSectionMentions } from './postprocess'

// html:false 阻断 AI/外部数据中夹带 raw HTML（XSS 防线，CSP 之外的纵深防御）
const md = new MarkdownIt({ html: false, breaks: true, linkify: true })

/**
 * 固定章节标题 → section modifier class。
 * 上半部为战绩详情「AI 复盘」5 段，下半部为对局页「AI 分析」5 段；
 * 复用同一套配色（绿=正面 / 红=负面警示 / 琥珀=风险 / 中性=结论与依据）。
 */
const SECTION_CLASS: Record<string, string> = {
  // 战绩详情 · 赛后复盘
  一句话定论: 'ai-section--verdict',
  谁尽力了: 'ai-section--effort',
  谁要背锅: 'ai-section--blame',
  '谁被打爆 / 被连累': 'ai-section--crushed',
  关键证据: 'ai-section--evidence',
  // 对局页 · 赛前分析
  一句话判断: 'ai-section--verdict',
  优势点: 'ai-section--effort',
  风险点: 'ai-section--crushed',
  重点盯防: 'ai-section--blame',
  建议: 'ai-section--evidence'
}

// heading_open：按下一 inline token 的文本匹配章节，给标题加 class。未知/未拼全的标题
// 退化为中性 base class（流式中途优雅降级）。class 值来自固定映射，非用户输入，安全。
md.renderer.rules.heading_open = (tokens, idx) => {
  const inline = tokens[idx + 1]
  const title = inline && inline.type === 'inline' ? inline.content.trim() : ''
  const modifier = SECTION_CLASS[title]
  const cls = modifier ? `ai-section ${modifier}` : 'ai-section'
  return `<${tokens[idx].tag} class="${cls}">`
}

/** 数字（含千分位、小数、可选 % / k / 万 后缀）。 */
const NUMBER_PATTERN = '\\d[\\d,]*(?:\\.\\d+)?(?:%|k|万)?'

/**
 * 渲染 AI 复盘 markdown 为高亮 HTML。
 * 空输入返回空串；对部分 / 非法 markdown 不抛异常（流式每 chunk 都会调用）。
 */
export function renderAnalysisReport(markdown: string): string {
  if (!markdown) return ''
  // 确定性去重：模型偶发把同一玩家写进两个人物章节，代码层兜底（见 postprocess.ts）
  return enhance(md.render(dedupeSectionMentions(markdown)))
}

/** DOM 走查：名字加粗 + 数字高亮，仅改文本节点。 */
function enhance(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.body
  boldListItemNames(root, doc)
  highlightNumbers(root, doc)
  return root.innerHTML
}

/** 给每个 `<li>` 首个「：」前的名字段包 `<strong class="ai-name">`，无「：」则跳过。 */
function boldListItemNames(root: HTMLElement, doc: Document): void {
  root.querySelectorAll('li').forEach(li => {
    const textNode = firstTextNode(li, doc)
    const text = textNode?.textContent
    if (!textNode || !text) return
    const colon = text.indexOf('：')
    if (colon <= 0) return

    const strong = doc.createElement('strong')
    strong.className = 'ai-name'
    strong.textContent = text.slice(0, colon)

    const frag = doc.createDocumentFragment()
    frag.appendChild(strong)
    frag.appendChild(doc.createTextNode(text.slice(colon)))
    textNode.parentNode?.replaceChild(frag, textNode)
  })
}

/** 把所有文本节点里的数字包成 `<span class="ai-num">`（跳过 code / pre 内）。 */
function highlightNumbers(root: HTMLElement, doc: Document): void {
  const texts = collectTextNodes(root, doc)
  for (const node of texts) {
    const text = node.textContent
    if (!text || !/\d/.test(text)) continue
    if (hasAncestorTag(node, ['CODE', 'PRE'])) continue

    const re = new RegExp(NUMBER_PATTERN, 'g')
    const frag = doc.createDocumentFragment()
    let last = 0
    let matched = false
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      matched = true
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)))
      const span = doc.createElement('span')
      span.className = 'ai-num'
      span.textContent = m[0]
      frag.appendChild(span)
      last = m.index + m[0].length
    }
    if (!matched) continue
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)))
    node.parentNode?.replaceChild(frag, node)
  }
}

/** 第一个文本节点（document order）。 */
function firstTextNode(el: Node, doc: Document): Text | null {
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text | null
}

/** 收集子树内所有文本节点（先收集再改，避免边遍历边改 DOM）。 */
function collectTextNodes(root: Node, doc: Document): Text[] {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const out: Text[] = []
  let n = walker.nextNode()
  while (n) {
    out.push(n as Text)
    n = walker.nextNode()
  }
  return out
}

/** 节点是否有指定标签的祖先。 */
function hasAncestorTag(node: Node, tags: string[]): boolean {
  let p = node.parentElement
  while (p) {
    if (tags.includes(p.tagName)) return true
    p = p.parentElement
  }
  return false
}
