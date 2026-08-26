/**
 * Overlay 多面板注册表（feature-expansion-plan B1）
 *
 * 面板是 overlay 窗口内的独立渲染单元（三选一卡组/出装推荐/战斗指标…）。
 * 主窗口通过 `push_overlay_panel` 推送 `{ panel, payload }` 信封，overlay 端按
 * panel id 分发到对应组件——主窗侧不感知 overlay 内部结构。
 */

import { invoke } from '@tauri-apps/api/core'

/** 内置面板 id（与 OverlayView 的渲染分支一一对应） */
export const OVERLAY_PANEL_IDS = ['next-actions', 'mayhem-augments', 'mayhem-builds'] as const

export type OverlayPanelId = (typeof OVERLAY_PANEL_IDS)[number]

/** 面板信封（Rust push_overlay_panel 的事件负载） */
export interface OverlayPanelEnvelope {
  panel: string
  payload: unknown
}

/** 向指定面板推送数据（主窗口调用） */
export async function pushOverlayPanel(
  panel: OverlayPanelId,
  payload: unknown
): Promise<void> {
  await invoke('push_overlay_panel', { panel, payload })
}

/** 调整 overlay 尺寸与锚点 */
export async function setOverlayLayout(
  width: number,
  height: number,
  anchor: 'top-left' | 'top-center' | 'top-right'
): Promise<void> {
  await invoke('set_overlay_layout', { width, height, anchor })
}

/** 切换鼠标穿透（手动校正面板交互时传 false） */
export async function setOverlayClickThrough(enabled: boolean): Promise<void> {
  await invoke('set_overlay_click_through', { enabled })
}

// ---------------------------------------------------------------------------
// 三选一面板数据契约（A3 主窗口侧填充）
// ---------------------------------------------------------------------------

/** 强化稀有度（与 mayhemData 口径一致） */
export type AugmentRarity = 'prismatic' | 'gold' | 'silver' | string

/** 三选一单卡候选（slot 映射屏幕左/中/右卡位） */
export interface MayhemAugmentCandidate {
  slot: 0 | 1 | 2
  /** 词表匹配到的强化 id；识别失败时缺省 */
  augmentId?: number
  /** 展示名；未知显示占位符 */
  name?: string
  rarityName?: AugmentRarity
  /** 综合分（0-100） */
  score?: number | null
  /** 档位文案：S+/A/B/C */
  grade?: string
  /** 推荐高亮（打分引擎判定最优） */
  best?: boolean
  /** 模板化推荐理由（首条展示、全部进 tooltip） */
  reasons?: string[]
}

/** 三选一面板负载 */
export interface MayhemAugmentsPayload {
  candidates: MayhemAugmentCandidate[]
  /** 重随剩余次数（打分引擎的 reroll 维度输入） */
  rerollsLeft?: number
}

/** 类型守卫：判断未知 payload 是否为三选一负载 */
export function isMayhemAugmentsPayload(p: unknown): p is MayhemAugmentsPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    Array.isArray((p as { candidates?: unknown }).candidates)
  )
}
