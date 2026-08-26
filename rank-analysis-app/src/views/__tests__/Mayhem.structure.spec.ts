/**
 * Mayhem 页结构回归金丝雀（UI 工程约定：外置样式必须配套结构金丝雀）：
 * 锁死模板根、样式引用与榜单页关键交互类，防止样式块在提交链路中静默丢失。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = (p: string) => readFileSync(resolve(__dirname, '../../views', p), 'utf8')

describe('Mayhem 榜单页结构', () => {
  const vue = src('Mayhem.vue')
  const css = src('Mayhem.styles.css')

  it('SFC 挂载外部 scoped 样式', () => {
    expect(vue).toContain('<style scoped src="./Mayhem.styles.css">')
  })

  it('榜单关键交互类在样式表中', () => {
    for (const cls of ['.m-grid', '.ccard', '.ctier', '.m-search', '.chip--on', '.cwr']) {
      expect(css).toContain(cls)
    }
  })

  it('数据源说明与空态样式不回退', () => {
    expect(css).toContain('.m-note')
    expect(css).toContain('.m-empty')
    expect(vue).toContain('aramgg')
  })
})
