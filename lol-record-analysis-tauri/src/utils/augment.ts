/**
 * 海克斯符文稀有度 → CSS 类名
 * 由调用方提供 style prefix（例如 record-card-augment 或 match-detail-augment）
 */

export function augmentRarityClass(rarity: string | undefined, prefix: string) {
  switch (rarity) {
    case 'kPrismatic':
      return `${prefix}-prismatic`
    case 'kGold':
      return `${prefix}-gold`
    case 'kSilver':
      return `${prefix}-silver`
    case 'kBronze':
      return `${prefix}-bronze`
    default:
      return `${prefix}-default`
  }
}
