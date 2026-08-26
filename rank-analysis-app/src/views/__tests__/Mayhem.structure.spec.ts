/**
 * Mayhem 页结构回归金丝雀（UI 工程约定：外置样式必须配套结构金丝雀）：
 * 锁死模板根、样式引用与榜单页/详情页关键交互类，防止样式块在提交链路中静默丢失。
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

  it('双 Tab 与榜单关键交互类在样式表中', () => {
    for (const cls of [
      '.m-grid',
      '.ccard',
      '.ctier',
      '.m-search',
      '.chip--on',
      '.cwr',
      '.mtab.on',
      '.acard',
      '.rr-prismatic'
    ]) {
      expect(css).toContain(cls)
    }
  })

  it('数据源说明与空态样式不回退', () => {
    expect(css).toContain('.m-note')
    expect(css).toContain('.m-empty')
    expect(vue).toContain('aramgg')
  })

  it('强化榜消费 stages 轮次与稀有度筛选', () => {
    expect(vue).toContain('bestStage')
    expect(vue).toContain('activeRarity')
    expect(vue).toContain('MayhemChampionDetail')
  })
})

describe('Mayhem 英雄详情页结构', () => {
  const vue = src('MayhemChampionDetail.vue')
  const css = src('MayhemChampionDetail.styles.css')

  it('SFC 挂载外部 scoped 样式', () => {
    expect(vue).toContain('<style scoped src="./MayhemChampionDetail.styles.css">')
  })

  it('详情关键区块类在样式表中', () => {
    for (const cls of ['.d-hero', '.d-augs', '.dtrio', '.d-coreset', '.skillbar .k-r']) {
      expect(css).toContain(cls)
    }
  })

  it('消费分片数据的关键能力不被误删', () => {
    for (const token of ['getMayhemChampionDetail', 'coreItems', 'skillOrders', 'itemExtensions']) {
      expect(vue).toContain(token)
    }
  })
})
