/**
 * 召唤师技能 spellId → 中文名 lookup。
 * 喂给 AI 之前转中文，让 prompt 含义直接可读。
 */

const SPELL_NAMES: Record<number, string> = {
  1: '净化',
  3: '虚弱',
  4: '闪现',
  6: '幽魂',
  7: '治疗',
  11: '惩戒',
  12: '传送',
  13: '洞悉',
  14: '点燃',
  21: '屏障',
  32: '雪球'
}

export function spellIdToName(id: number): string {
  return SPELL_NAMES[id] ?? '未知技能'
}

export function spellIdsToNames(ids: number[]): string[] {
  return ids.map(spellIdToName)
}
