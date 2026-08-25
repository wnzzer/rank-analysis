/**
 * Home 旗舰页结构回归金丝雀：
 * 样式曾在外部 CSS 化改造中被整块丢失且未进提交（页面裸奔无线索），
 * 这里锁死三个不变量——模板根、样式引用、关键交互类。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = (p: string) => readFileSync(resolve(__dirname, '../../views', p), 'utf8')

describe('Home 旗舰页结构', () => {
  const vue = src('Home.vue')
  const css = src('Home.styles.css')

  it('SFC 挂载外部 scoped 样式', () => {
    expect(vue).toContain('<style scoped src="./Home.styles.css">')
  })

  it('视差/走马灯/入口行等旗舰关键类在样式表中', () => {
    for (const cls of ['.stage__kicker', '.gmarquee__track', '.qentry__arrow', '.shard']) {
      expect(css).toContain(cls)
    }
  })

  it('reduced-motion 与亮色对比度修正不回退', () => {
    expect(css).toContain('prefers-reduced-motion')
    expect(css).toContain('.theme-light .stage__kicker')
  })
})
