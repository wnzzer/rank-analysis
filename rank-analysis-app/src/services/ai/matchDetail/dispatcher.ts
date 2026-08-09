/**
 * 模式路由：根据 ModeContext.kind 返回对应的 prompt addon。
 *
 * 三档 + 兜底：
 * - ranked  → ranked.ts
 * - aram    → aram.ts
 * - augment → augment.ts
 * - unknown → aram.ts（最宽容）
 */

import type { ModeContext } from '../shared/types'
import * as rankedPrompt from './prompts/ranked'
import * as aramPrompt from './prompts/aram'
import * as augmentPrompt from './prompts/augment'

export interface ModePromptAddon {
  kind: 'ranked' | 'aram' | 'augment'
  rules: string
}

export function getModePromptAddon(modeContext: ModeContext): ModePromptAddon {
  switch (modeContext.kind) {
    case 'ranked':
      return { kind: rankedPrompt.kind, rules: rankedPrompt.rules }
    case 'aram':
      return { kind: aramPrompt.kind, rules: aramPrompt.rules }
    case 'augment':
      return { kind: augmentPrompt.kind, rules: augmentPrompt.rules }
    case 'unknown':
    default:
      return { kind: aramPrompt.kind, rules: aramPrompt.rules }
  }
}
