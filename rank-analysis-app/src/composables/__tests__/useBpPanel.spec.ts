import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { withSetup } from '@renderer/test-utils/withSetup'
import { useBpPanel } from '../useBpPanel'
import type { BpPanelSnapshot } from '@renderer/types/bpPanel'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))
vi.mock('@renderer/services/ai/champion-names', () => ({
  loadChampionNames: () => Promise.resolve(),
  getChampionName: (id: number) => `英雄${id}`
}))

function snapshot(overrides: Partial<BpPanelSnapshot> = {}): BpPanelSnapshot {
  return {
    action_type: 'Pick',
    stage: 'Acting',
    candidates: [
      {
        champion_id: 103,
        score: 0.55,
        in_pool: true,
        physical_share: 0.1,
        games: 10,
        wins: 6,
        unfamiliar: false,
        reasons: [],
        warning: null
      }
    ],
    auto_target_id: 103,
    hovered_id: 0,
    overridden: false,
    time_left_secs: 20,
    total_secs: 27,
    execute_at_secs_left: 5,
    ally_mix: { physical: 0, magic: 0, known: 0 },
    enemy_mix: { physical: 0, magic: 0, known: 0 },
    result_champion_id: 0,
    ...overrides
  }
}

/** 按命令名分发的 invoke 桩；`panel` 可在用例里随时替换 */
function stubInvoke(state: { panel: BpPanelSnapshot | null }): void {
  invokeMock.mockImplementation((command: string) => {
    if (command === 'get_bp_panel') return Promise.resolve(state.panel)
    if (command === 'get_champion_options')
      return Promise.resolve([{ value: 103, label: '阿狸', alias: 'Ahri' }])
    return Promise.resolve()
  })
}

const callsOf = (command: string) => invokeMock.mock.calls.filter(c => c[0] === command)

describe('useBpPanel', () => {
  const icon = (id: number) => `/icon/${id}`

  beforeEach(() => {
    vi.useFakeTimers()
    invokeMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should poll only during champ select', async () => {
    stubInvoke({ panel: snapshot() })
    const phase = ref('ChampSelect')
    const [panel, app] = withSetup(() => useBpPanel(phase, { icon }))

    await vi.advanceTimersByTimeAsync(1100)
    expect(panel.view.value?.candidates[0].name).toBe('英雄103')
    const polled = callsOf('get_bp_panel').length
    expect(polled).toBeGreaterThan(0)

    phase.value = 'InProgress'
    await nextTick()
    expect(panel.view.value).toBeNull()
    await vi.advanceTimersByTimeAsync(3000)
    expect(callsOf('get_bp_panel').length).toBe(polled)

    app.unmount()
  })

  it('should load search options once', async () => {
    stubInvoke({ panel: snapshot() })
    const [panel, app] = withSetup(() => useBpPanel('ChampSelect', { icon }))

    await vi.advanceTimersByTimeAsync(100)

    expect(panel.championOptions.value).toEqual([{ value: 103, label: '阿狸' }])
    app.unmount()
  })

  it('should count down to auto execution and interpolate locally', async () => {
    stubInvoke({ panel: snapshot() })
    const [panel, app] = withSetup(() => useBpPanel('ChampSelect', { icon }))

    await vi.advanceTimersByTimeAsync(50)
    // 20s 剩余 - 5s 执行阈值
    expect(panel.secsLeft.value).toBeCloseTo(15, 0)
    expect(panel.totalSecs.value).toBe(22)

    await vi.advanceTimersByTimeAsync(3000)
    // 同一份快照反复到达不重置基准，倒计时继续往下走
    expect(panel.secsLeft.value).toBeLessThan(12.5)
    expect(panel.secsLeft.value).toBeGreaterThan(11.5)

    app.unmount()
  })

  it('should hover optimistically and take over', async () => {
    stubInvoke({ panel: snapshot() })
    const [panel, app] = withSetup(() => useBpPanel('ChampSelect', { icon }))
    await vi.advanceTimersByTimeAsync(50)
    // 未接管时显示自动目标
    expect(panel.view.value?.hoveredId).toBe(103)
    expect(panel.view.value?.overridden).toBe(false)

    await panel.hover(90)

    expect(callsOf('bp_hover')).toEqual([['bp_hover', { championId: 90 }]])
    expect(panel.view.value?.hoveredId).toBe(90)
    expect(panel.view.value?.overridden).toBe(true)
    // 接管后倒计时指向回合结束，而不是自动执行
    expect(panel.totalSecs.value).toBe(27)

    app.unmount()
  })

  it('should confirm the champion shown as hovered', async () => {
    stubInvoke({ panel: snapshot() })
    const [panel, app] = withSetup(() => useBpPanel('ChampSelect', { icon }))
    await vi.advanceTimersByTimeAsync(50)
    await panel.hover(90)

    await panel.confirm()

    expect(callsOf('bp_confirm')).toEqual([['bp_confirm', { championId: 90 }]])
    app.unmount()
  })

  it('should not confirm when nothing is hovered', async () => {
    stubInvoke({ panel: snapshot({ auto_target_id: null }) })
    const [panel, app] = withSetup(() => useBpPanel('ChampSelect', { icon }))
    await vi.advanceTimersByTimeAsync(50)

    await panel.confirm()

    expect(callsOf('bp_confirm')).toEqual([])
    app.unmount()
  })

  it('should report a failed action through onError', async () => {
    stubInvoke({ panel: snapshot() })
    const onError = vi.fn()
    const [panel, app] = withSetup(() => useBpPanel('ChampSelect', { icon, onError }))
    await vi.advanceTimersByTimeAsync(50)
    invokeMock.mockImplementation((command: string) =>
      command === 'bp_confirm' ? Promise.reject('还没轮到你操作') : Promise.resolve(snapshot())
    )

    await panel.confirm()

    expect(onError).toHaveBeenCalledWith('还没轮到你操作')
    app.unmount()
  })

  it('should drop local hover when the turn changes', async () => {
    const state = { panel: snapshot({ action_type: 'Ban' }) as BpPanelSnapshot | null }
    stubInvoke(state)
    const [panel, app] = withSetup(() => useBpPanel('ChampSelect', { icon }))
    await vi.advanceTimersByTimeAsync(50)
    await panel.hover(90)
    expect(panel.view.value?.hoveredId).toBe(90)

    state.panel = snapshot({ action_type: 'Pick', stage: 'Waiting', auto_target_id: null })
    await vi.advanceTimersByTimeAsync(1100)

    expect(panel.view.value?.action).toBe('pick')
    expect(panel.view.value?.hoveredId).toBeNull()
    expect(panel.view.value?.overridden).toBe(false)
    app.unmount()
  })
})
