/**
 * ObjectiveIcon：按野怪类型 / 龙元素给出 aria-label、图形类别与颜色，外圈按拿下方着色。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ObjectiveIcon from '../ObjectiveIcon.vue'

const icon = (props: Record<string, unknown>) => mount(ObjectiveIcon, { props: props as never })

describe('ObjectiveIcon', () => {
  it.each([
    ['DRAGON', 'FIRE_DRAGON', '小龙（火）', 'dragon', 'dragon_infernal'],
    ['DRAGON', 'WATER_DRAGON', '小龙（海洋）', 'dragon', 'dragon_ocean'],
    ['DRAGON', 'AIR_DRAGON', '小龙（云）', 'dragon', 'dragon_cloud'],
    ['DRAGON', 'EARTH_DRAGON', '小龙（山）', 'dragon', 'dragon_mountain'],
    ['DRAGON', 'HEXTECH_DRAGON', '小龙（海克斯）', 'dragon', 'dragon_hextech'],
    ['DRAGON', 'CHEMTECH_DRAGON', '小龙（化学科技）', 'dragon', 'dragon_chemtech'],
    ['DRAGON', 'ELDER_DRAGON', '远古龙', 'elder', 'dragon_elder'],
    ['DRAGON', '', '小龙', 'dragon', 'dragon'],
    ['BARON_NASHOR', '', '大龙', 'baron', 'baron'],
    ['RIFTHERALD', '', '峡谷先锋', 'herald', 'riftherald'],
    ['HORDE', '', '虚空巢虫', 'grub', 'grub'],
    ['ATAKHAN', '', '阿塔坎', 'atakhan', 'atakhan_v'],
    ['ATAKHAN', 'RUINOUS_ATAKHAN', '阿塔坎', 'atakhan', 'atakhan_r'],
    ['SOMETHING_NEW', '', 'SOMETHING_NEW', 'unknown', 'dragon']
  ])('%s/%s -> %s', (monster, subType, label, kind, file) => {
    const w = icon({ monster, subType })
    const img = w.find('img')
    expect(img.attributes('alt')).toBe(label)
    expect(img.attributes('aria-label')).toBe(label)
    expect(w.attributes('data-kind')).toBe(kind)
    // 资源经 Vite 打包：src 以文件名结尾（避免 dragon 匹配 dragon_xxx，要求 /name.png 或 name.png 结尾）
    expect(img.attributes('src')).toMatch(new RegExp(`(^|/)${file}[.-]`))
  })

  it('外圈按 side 着色；缺省无外圈', () => {
    expect(icon({ monster: 'DRAGON', side: 'blue' }).classes()).toContain('objective-icon--blue')
    expect(icon({ monster: 'BARON_NASHOR', side: 'red' }).classes()).toContain(
      'objective-icon--red'
    )
    const none = icon({ monster: 'HORDE' }).classes()
    expect(none).not.toContain('objective-icon--blue')
    expect(none).not.toContain('objective-icon--red')
  })

  it('size 默认 18，可覆盖', () => {
    expect(icon({ monster: 'HORDE' }).attributes('style')).toContain('width: 18px')
    expect(icon({ monster: 'HORDE', size: 30 }).attributes('style')).toContain('height: 30px')
  })
})
