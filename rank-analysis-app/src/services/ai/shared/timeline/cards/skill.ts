/**
 * 加点卡（S）：主/副升级顺序（先满 5 级的为主），大招是否在 6/11/16 点。
 * 首个大招早于第 6 点的英雄（1 级可学大招）不检查大招时机。
 */
import type { CardDraft, CardInput } from '../types'

const SLOT = ['', 'Q', 'W', 'E', 'R']
const ULT_LEVELS = [6, 11, 16]

/**
 * 生成加点卡。
 * @returns weight：大招晚点为 1，否则 0.3
 */
export function buildSkillCards(input: CardInput): CardDraft[] {
  const out: CardDraft[] = []
  for (const me of input.roster) {
    const seq = input.tl.events
      .filter(
        e =>
          e.type === 'SKILL_LEVEL_UP' &&
          e.participantId === me.participantId &&
          e.levelUpType === 'NORMAL'
      )
      .map(e => (e.type === 'SKILL_LEVEL_UP' ? e.skillSlot : 0))
    if (seq.length === 0) continue

    // 主副顺序：先到 5 级的排前；没满的按点数降序，同分按 Q/W/E 顺序
    const count = [0, 0, 0, 0]
    const maxedAt = [Infinity, Infinity, Infinity, Infinity]
    seq.forEach((slot, i) => {
      if (slot < 1 || slot > 3) return
      count[slot]++
      if (count[slot] === 5) maxedAt[slot] = i + 1
    })
    const order = [1, 2, 3].sort((a, b) => maxedAt[a] - maxedAt[b] || count[b] - count[a] || a - b)

    // 没有任何 Q/W/E 点满 5 级时，主副顺序只是按当前点数估计
    const provisional = !maxedAt.some(Number.isFinite) ? '（未满级，按点数）' : ''

    // 大招检查覆盖序列已到达的等级（seq 长度约等于最终等级），未学或晚点都要报出
    const ultIdx = seq.map((s, i) => (s === 4 ? i + 1 : 0)).filter(i => i > 0)
    let ultText = '大招 未学'
    let late = false
    if (ultIdx.length && ultIdx[0] < ULT_LEVELS[0]) {
      ultText = '大招 1 级可学，不检查时机'
    } else {
      const reached = ULT_LEVELS.filter(l => l <= seq.length)
      if (reached.length) {
        const parts: string[] = []
        reached.forEach((lv, k) => {
          if (ultIdx[k] === undefined) parts.push(`第${k + 1}次未学`)
          else if (ultIdx[k] > lv) parts.push(`第${k + 1}次晚 ${ultIdx[k] - lv} 级`)
        })
        late = parts.length > 0
        ultText = late ? `大招 ${parts.join('、')}` : `大招 按时（${reached.join('/')} 级）`
      }
    }

    out.push({
      kind: 'skill',
      subjects: [me.participantId],
      minute: 0,
      weight: late ? 1 : 0.3,
      text: `${me.champion} 加点｜主${SLOT[order[0]]} 副${SLOT[order[1]]}${provisional}｜${ultText}`
    })
  }
  return out
}
