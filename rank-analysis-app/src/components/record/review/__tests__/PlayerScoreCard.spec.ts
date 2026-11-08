/**
 * PlayerScoreCard：分项条方向与长度、等级词 + 数据、分位显示、异常标签、无基准降级说明。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerScoreCard from '../PlayerScoreCard.vue'
import { modelB } from './fixtureModels'

const model = modelB()

describe('PlayerScoreCard', () => {
  it('本人：英雄名带（你）、位置、分位', () => {
    const w = mount(PlayerScoreCard, { props: { player: model.players[9], hasBaseline: true } })
    expect(w.find('[data-test="score-card-name"]').text()).toBe('英雄112（你）')
    expect(w.text()).toContain('下路（ADC）')
    expect(w.find('[data-test="score-card-rank"]').text()).toMatch(/^大约处于同位置玩家的/)
    expect(w.find('[data-test="score-card-note"]').text()).toBe('中线 = 同英雄同位置的国服平均')
  })

  it('每个分项一条：落后向左红、领先向右绿，长度按 ±3 截断', () => {
    const player = model.players[9]
    const w = mount(PlayerScoreCard, { props: { player, hasBaseline: true } })
    const fills = w.findAll('[data-test="score-part-fill"]')
    expect(fills).toHaveLength(player.parts.length)

    const lane = player.parts[0]
    const laneFill = fills[0].element as HTMLElement
    expect(fills[0].classes()).toContain('is-behind')
    expect(parseFloat(laneFill.style.width)).toBeCloseTo((Math.abs(lane.bar) / 3) * 50, 5)
    expect(parseFloat(laneFill.style.left)).toBeCloseTo(50 - (Math.abs(lane.bar) / 3) * 50, 5)

    const fight = fills[1].element as HTMLElement
    expect(fills[1].classes()).toContain('is-ahead')
    expect(fight.style.left).toBe('50%')
  })

  it('分项下一行：等级词 + 具体数据', () => {
    const w = mount(PlayerScoreCard, { props: { player: model.players[9], hasBaseline: true } })
    const first = w.findAll('[data-test="score-part"]')[0]
    expect(first.text()).toContain('对线')
    expect(first.text()).toContain('大幅落后 · 14 分钟对位经济落后 1700')
  })

  it('异常小标签', () => {
    const w = mount(PlayerScoreCard, { props: { player: model.players[6], hasBaseline: true } })
    expect(w.findAll('[data-test="flag"]').map(x => x.text())).toContain(
      '第一件传说装比对位晚 3.7 分钟'
    )
    const me = mount(PlayerScoreCard, { props: { player: model.players[9], hasBaseline: true } })
    expect(me.find('[data-test="flag"]').exists()).toBe(false)
  })

  it('无国服基准：不显示分位，中线说明改为本局平均', () => {
    const arena = modelB({ patch: { queueId: 1700, gameMode: 'CHERRY' } })
    const w = mount(PlayerScoreCard, { props: { player: arena.players[9], hasBaseline: false } })
    expect(w.find('[data-test="score-card-rank"]').exists()).toBe(false)
    expect(w.find('[data-test="score-card-note"]').text()).toBe(
      '本模式暂无国服基准：中线 = 本局平均'
    )
  })
})
