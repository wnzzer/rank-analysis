import { describe, it, expect } from 'vitest'
import { renderAnalysisReport } from '../renderReport'

describe('renderAnalysisReport', () => {
  it('空输入返回空串', () => {
    expect(renderAnalysisReport('')).toBe('')
  })

  it('已知章节标题 → h2 带对应 section class', () => {
    const html = renderAnalysisReport(
      [
        '## 一句话定论',
        '红温局',
        '',
        '## 谁尽力了',
        '- a',
        '',
        '## 谁要背锅',
        '- b',
        '',
        '## 谁被打爆 / 被连累',
        '- c',
        '',
        '## 关键证据',
        '- d'
      ].join('\n')
    )
    expect(html).toContain('ai-section--verdict')
    expect(html).toContain('ai-section--effort')
    expect(html).toContain('ai-section--blame')
    expect(html).toContain('ai-section--crushed')
    expect(html).toContain('ai-section--evidence')
  })

  it('未知/未拼全的标题 → 仅中性 base class，不带 modifier', () => {
    const html = renderAnalysisReport('## 谁要\n内容')
    expect(html).toContain('class="ai-section"')
    expect(html).not.toContain('ai-section--blame')
  })

  it('数字（含 % 与小数）被包成 ai-num', () => {
    const html = renderAnalysisReport('## 关键证据\n- 伤害占比 32% KDA 7.5 共 12 杀')
    expect(html).toContain('<span class="ai-num">32%</span>')
    expect(html).toContain('<span class="ai-num">7.5</span>')
    expect(html).toContain('<span class="ai-num">12</span>')
  })

  it('列表项首个「：」前的名字被加粗为 ai-name', () => {
    const html = renderAnalysisReport('## 谁要背锅\n- 张三：送了一血 — 死太多')
    expect(html).toContain('<strong class="ai-name">张三</strong>')
  })

  it('无冒号的列表项不加 ai-name', () => {
    const html = renderAnalysisReport('## 关键证据\n- 团队总伤害领先')
    expect(html).not.toContain('ai-name')
  })

  it('XSS：markdown 内嵌 raw HTML 仍被转义，不产生真实标签', () => {
    const html = renderAnalysisReport(
      '## 一句话定论\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>'
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
  })

  it('部分/流式中途的 markdown 不抛异常', () => {
    expect(() => renderAnalysisReport('## 谁尽力')).not.toThrow()
    expect(() => renderAnalysisReport('- 张三：')).not.toThrow()
  })
})
