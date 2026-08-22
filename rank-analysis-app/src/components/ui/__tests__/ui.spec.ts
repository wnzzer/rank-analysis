import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CornerCard from '../CornerCard.vue'
import ChargeRing from '../ChargeRing.vue'
import StatChip from '../StatChip.vue'
import VerdictBanner from '../VerdictBanner.vue'

describe('CornerCard', () => {
  it('渲染标题与副题', () => {
    const w = mount(CornerCard, { props: { title: '今日战况', subtitle: '近 5 场' } })
    expect(w.text()).toContain('今日战况')
    expect(w.text()).toContain('近 5 场')
  })

  it('emphasis 变体挂强调类', () => {
    const w = mount(CornerCard, { props: { title: '短板提醒', emphasis: true } })
    expect(w.find('.corner-card').classes()).toContain('corner-card--emph')
  })

  it('无标题且无 extra 时不渲染头部行', () => {
    const w = mount(CornerCard)
    expect(w.find('.corner-card__head').exists()).toBe(false)
  })
})

describe('ChargeRing', () => {
  it('percent 换算为 conic 角度', () => {
    const w = mount(ChargeRing, { props: { percent: 25 } })
    expect(w.find('.ring').attributes('style')).toContain('--deg: 90.0')
  })

  it('brand 色低于 20% 自动转告急', () => {
    const w = mount(ChargeRing, { props: { percent: 10 } })
    expect(w.find('.ring').classes()).toContain('ring--urgent')
  })

  it('loss tone 强制告急色但不加 urgent 类语义混淆——直接验证颜色变量', () => {
    const w = mount(ChargeRing, { props: { percent: 80, tone: 'loss' } })
    expect(w.find('.ring').attributes('style')).toContain('var(--loss)')
  })
})

describe('StatChip', () => {
  it('tone 映射到对应类名', () => {
    const w = mount(StatChip, { props: { label: 'LP', value: '+42', tone: 'win' } })
    expect(w.find('.statc__v').classes()).toContain('statc__v--win')
    expect(w.text()).toContain('+42')
  })
})

describe('VerdictBanner', () => {
  it('decision 态显示金色结论与理由', () => {
    const w = mount(VerdictBanner, {
      props: {
        state: 'decision',
        verb: '选',
        champion: '杰斯',
        reason: 'counter 凯南',
        tierLabel: 'T1',
        seconds: 17
      }
    })
    expect(w.find('.vb').classes()).not.toContain('vb--fallback')
    expect(w.text()).toContain('杰斯')
    expect(w.text()).toContain('T1')
  })

  it('fallback 态弱化并标注兜底', () => {
    const w = mount(VerdictBanner, {
      props: { state: 'fallback', verb: 'BAN', champion: '亚索', seconds: 8 }
    })
    expect(w.find('.vb').classes()).toContain('vb--fallback')
    expect(w.text()).toContain('兜底建议')
  })

  it('idle 态显示等待文案且无秒数环', () => {
    const w = mount(VerdictBanner, { props: { state: 'idle' } })
    expect(w.text()).toContain('等待锁定…')
    expect(w.find('.ring--idle').exists()).toBe(true)
    expect(w.findComponent(ChargeRing).exists()).toBe(false)
  })

  it('梯度选择器点击上抛 switchTier', async () => {
    const w = mount(VerdictBanner, {
      props: { state: 'decision', champion: '杰斯', tierLabel: 'T1', seconds: 5 }
    })
    await w.find('.vb__tiersel').trigger('click')
    expect(w.emitted('switchTier')).toHaveLength(1)
  })
})
