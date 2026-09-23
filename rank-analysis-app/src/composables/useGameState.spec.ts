/**
 * useGameState 路由豁免单元测试
 *
 * 守的是一件事：**未开英雄联盟客户端时，哪些页面还能待得住**。
 *
 * `game-state-changed` 是 ≤10s 一次的心跳（见 src-tauri/src/game_state_monitor.rs
 * 的 `state_changed || diff_time > 10s`），状态没变也推。所以任何没声明
 * `meta.offlineCapable` 的页面，在未连接时最多 10 秒就被弹回 Loading——等于不可用。
 *
 * 这条判定此前无测试守护，`/Champions`（#168 新增，数据走 OP.GG 与 LCU 无关）
 * 因此漏出了一个版本：能点进去，10 秒后被踢走。
 *
 * @module composables/useGameState
 */
import { describe, it, expect, vi } from 'vitest'

// useGameState 模块顶层会 import tauri 的 event/window，测试环境下需要挡掉
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' })
}))

import { shouldRedirectToLoading } from './useGameState'
import router from '../router'

describe('shouldRedirectToLoading', () => {
  it('should keep user on offline-capable page when client disconnected', () => {
    const stay = shouldRedirectToLoading({
      path: '/Champions',
      meta: { offlineCapable: true }
    })

    expect(stay).toBe(false)
  })

  it('should redirect to Loading on a page that needs LCU', () => {
    const redirect = shouldRedirectToLoading({
      path: '/Record',
      meta: {}
    })

    expect(redirect).toBe(true)
  })

  it('should not redirect when already on Loading', () => {
    // 否则每次心跳都会产生一次重复导航
    const redirect = shouldRedirectToLoading({ path: '/Loading', meta: {} })

    expect(redirect).toBe(false)
  })

  it('should treat a missing offlineCapable as LCU-dependent', () => {
    // 默认值必须是「需要 LCU」：漏标记的新页面宁可被踢走，也不要在未连接时
    // 静默展示一屏空数据
    expect(shouldRedirectToLoading({ path: '/Whatever', meta: {} })).toBe(true)
  })
})

describe('route offlineCapable contract', () => {
  // 这三个页面的数据源都与 LCU 无关，必须声明豁免，否则未开客户端时压根打不开
  it.each(['/Champions', '/Settings', '/MatchDetail'])(
    '%s should be marked offlineCapable',
    path => {
      const matched = router.resolve(path)

      expect(matched.meta.offlineCapable).toBe(true)
    }
  )

  it('should inherit offlineCapable on Settings children', () => {
    // vue-router 会合并 matched records 的 meta，子路由无需各自声明
    const matched = router.resolve('/Settings/General')

    expect(matched.meta.offlineCapable).toBe(true)
  })
})
