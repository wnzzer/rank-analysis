/**
 * AiCommentary：HTML 渲染、引用角标点击定位、三个按钮、骨架与空态。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiCommentary from '../AiCommentary.vue'

const base = {
  html: '',
  loading: false,
  stateLabel: '',
  title: '整局点评',
  playerActionLabel: null,
  showOverviewAction: false
}

describe('AiCommentary', () => {
  it('点击引用角标发出卡片编号；点普通文字不发', async () => {
    const w = mount(AiCommentary, {
      props: {
        ...base,
        html: '<p>前期孤立被杀<sup class="ai-cite" title="4:54 …">D4</sup>，团战<span class="x">不错</span></p>'
      }
    })
    await w.find('.ai-cite').trigger('click')
    await w.find('.x').trigger('click')
    expect(w.emitted('cite')).toEqual([['D4']])
    expect(w.find('.ai-cite').attributes('title')).toBe('4:54 …')
  })

  it('按钮：生成单人点评 / 回到整局 / 重新生成', async () => {
    const w = mount(AiCommentary, {
      props: {
        ...base,
        html: '<p>x</p>',
        playerActionLabel: '生成英雄4的点评',
        showOverviewAction: true
      }
    })
    await w.find('[data-test="ai-player"]').trigger('click')
    await w.find('[data-test="ai-overview"]').trigger('click')
    await w.find('[data-test="ai-rerun"]').trigger('click')
    expect(w.emitted('player')).toHaveLength(1)
    expect(w.emitted('overview')).toHaveLength(1)
    expect(w.emitted('rerun')).toHaveLength(1)
    expect(w.find('[data-test="ai-player"]').text()).toBe('生成英雄4的点评')
  })

  it('无按钮文案时不显示单人/整局按钮', () => {
    const w = mount(AiCommentary, { props: base })
    expect(w.find('[data-test="ai-player"]').exists()).toBe(false)
    expect(w.find('[data-test="ai-overview"]').exists()).toBe(false)
  })

  it('首块到达前显示骨架与状态文案；空态提示', () => {
    const loading = mount(AiCommentary, {
      props: { ...base, loading: true, stateLabel: '正在生成锐评...' }
    })
    expect(loading.find('[data-test="ai-skeleton"]').text()).toContain('正在生成锐评...')
    expect(mount(AiCommentary, { props: base }).text()).toContain('打开复盘后会自动生成整局点评')
  })

  it('失败态（非加载、无正文、有失败文案）：显示失败原因而非空态提示', () => {
    const w = mount(AiCommentary, { props: { ...base, stateLabel: 'AI 分析失败：额度不足' } })
    expect(w.find('[data-test="ai-error"]').text()).toBe('AI 分析失败：额度不足')
    expect(w.find('[data-test="ai-empty"]').exists()).toBe(false)
  })

  it('加载中三个操作按钮全部禁用', () => {
    const w = mount(AiCommentary, {
      props: {
        ...base,
        loading: true,
        playerActionLabel: '生成英雄4的点评',
        showOverviewAction: true
      }
    })
    for (const k of ['ai-player', 'ai-overview', 'ai-rerun'])
      expect(w.find(`[data-test="${k}"]`).attributes('disabled')).toBeDefined()
  })
})
