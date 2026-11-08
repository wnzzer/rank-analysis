/**
 * MatchupBoard / LabelBadge：五路成行与经济差、选中高亮、点击切换、无分路两队并列、无时间线不显示经济差。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MatchupBoard from '../MatchupBoard.vue'
import LabelBadge from '../LabelBadge.vue'
import { modelB } from './fixtureModels'

function mountBoard(model = modelB(), selected: number | null = 9) {
  return mount(MatchupBoard, {
    props: { matchup: model.matchup, players: model.players, selected }
  })
}

describe('LabelBadge', () => {
  it.each([
    ['尽力', 'good'],
    ['被连累', 'warn'],
    ['被爆', 'warn'],
    ['犯罪', 'bad'],
    ['缚地灵', 'bad'],
    ['正常', 'neutral']
  ] as const)('%s → %s 色调', (label, tone) => {
    const w = mount(LabelBadge, { props: { label } })
    expect(w.text()).toBe(label)
    expect(w.classes()).toContain(`review-label--${tone}`)
  })
})

describe('MatchupBoard', () => {
  it('有分路：五行，下路经济差 +1700 记为蓝方领先', () => {
    const w = mountBoard()
    const lanes = w.findAll('[data-test="matchup-lane"]')
    expect(lanes).toHaveLength(5)
    const diff = lanes[3].find('[data-test="matchup-diff"]')
    expect(diff.text()).toBe('+1700')
    expect(diff.classes()).toContain('is-blue')
    expect(lanes[0].find('[data-test="matchup-diff"]').text()).toBe('−530')
    expect(w.text()).toContain('14 分钟对位经济差')
  })

  it('经济差为 0：中性色，不记为任何一方领先', () => {
    const model = modelB()
    if (model.matchup.kind !== 'lanes') throw new Error('fixture should have lanes')
    model.matchup.rows[3].goldDiff14 = 0
    const diff = mountBoard(model)
      .findAll('[data-test="matchup-lane"]')[3]
      .find('[data-test="matchup-diff"]')
    expect(diff.text()).toBe('0')
    expect(diff.classes()).toContain('is-even')
    expect(diff.classes()).not.toContain('is-blue')
    expect(diff.classes()).not.toContain('is-red')
  })

  it('选中行高亮，点击玩家发出 select', async () => {
    const w = mountBoard()
    expect(w.find('[data-pid="9"]').classes()).toContain('is-selected')
    expect(w.find('[data-pid="4"]').classes()).not.toContain('is-selected')
    await w.find('[data-pid="4"]').trigger('click')
    expect(w.emitted('select')).toEqual([[4]])
  })

  it('本人标「你」、显示 KDA 与标签', () => {
    const w = mountBoard()
    const me = w.find('[data-pid="9"]')
    expect(me.text()).toContain('你')
    expect(me.text()).toContain('24/11/15')
    expect(me.find('.review-label').exists()).toBe(true)
  })

  it('无分路：两队并列各 5 人，无经济差列', () => {
    const w = mountBoard(modelB({ patch: { queueId: 450, gameMode: 'ARAM' } }))
    const teams = w.findAll('[data-test="matchup-team"]')
    expect(teams).toHaveLength(2)
    expect(teams[0].findAll('[data-test="matchup-player"]')).toHaveLength(5)
    expect(teams[1].classes()).toContain('matchup-team--red')
    expect(w.find('[data-test="matchup-diff"]').exists()).toBe(false)
  })

  it('无时间线：五行但不显示经济差与说明', () => {
    const w = mountBoard(modelB({ timeline: false }))
    expect(w.findAll('[data-test="matchup-lane"]')).toHaveLength(5)
    expect(w.find('[data-test="matchup-diff"]').exists()).toBe(false)
    expect(w.text()).not.toContain('14 分钟对位经济差')
  })
})
