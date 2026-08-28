/**
 * 大乱斗助手触发调度器（A3 触发时机层 v2 - 智能等级事件驱动状态机）。
 *
 * 核心机制：
 * 海克斯大乱斗的三选一强化在固定等级节点弹出（3级开局、7级、11级、15级）。
 * 调度器通过 Live Client API（127.0.0.1:2999）超轻量监听玩家实时等级：
 * 1. 💤 静默休眠期（95%+ 时间）：0 截屏、0 渲染开销，仅 1s 轮询一次等级。
 * 2. ⚡ 目标等级唤醒（Burst 突发）：达到 3/7/11/15 级时唤醒高频 OCR 识别。
 * 3. 🎯 识别推送与收拢：推送浮窗推荐；检测卡片消失后立即推进下一轮并重回休眠。
 */

export interface BandStatsDto {
  slot: number
  rect: { x: number; y: number; w: number; h: number }
  stddev: number
}

/** 校准截图（BMP base64） */
export interface BandDumpDto {
  slot: number
  bmpBase64: string
}

/** 局内玩家轻量状态（Live Client API） */
export interface LivePlayerStateDto {
  inGame: boolean
  level?: number | null
  gameTime?: number | null
  currentGold?: number | null
  championName?: string | null
}

/** 标题带亮度标准差阈值（0-255）。目测初值：纯色≈0、文字内容>20；需实测校准。 */
export const BAND_ACTIVE_THRESHOLD = 18

/** 判定「三选一出现」所需的活跃带数量。 */
export const ACTIVE_SLOTS_REQUIRED = 2

/** 海克斯大乱斗强化解锁目标等级（4 轮） */
export const MAYHEM_AUGMENT_TARGET_LEVELS = [3, 7, 11, 15] as const

export type AssistSchedulerMode =
  | 'idle_sleep'
  | 'burst_detecting'
  | 'pushed_waiting_choice'
  | 'all_completed'

export interface AssistDeps {
  getPhase(): Promise<string>
  getLivePlayer?(): Promise<LivePlayerStateDto | null>
  getBandStats(): Promise<BandStatsDto[] | null>
  /** 每轮 tick 完成后的回调（UI 状态展示用；异常不影响调度） */
  onTick?(tick: AssistTick): void
  /**
   * 检测沿回调：detected 从 false→true（或离开冷却期再次成立）时触发一次。
   * 用于调用后端 assist_tick 真管线并推送面板；内部带冷却防抖。
   */
  onDetected?(tick: AssistTick): Promise<void>
  /** 检测沿触发冷却（毫秒），默认 8s——三选一停留期间不重复推面板 */
  detectCooldownMs?: number
  /** 单轮突发检测最大窗口时长（毫秒），默认 25s */
  burstTimeoutMs?: number
}

export interface AssistTick {
  phase: string
  /** 活跃标题带数 */
  activeSlots: number
  maxStddev: number | null
  note: string
  /** 三选一画面已确认出现 */
  detected: boolean
  /** 当前状态机模式 */
  mode: AssistSchedulerMode
  /** 当前强化轮次（1..=4，5 为全部完成） */
  currentRound: number
  /** 当前玩家等级（null 为未能读取到） */
  level: number | null
}

export interface AssistScheduler {
  start(): void
  stop(): void
  tick(): Promise<AssistTick>
  readonly running: boolean
  lastTick(): AssistTick | null
  /** 重置对局状态机到第 1 轮 */
  reset(): void
}

export function createAssistScheduler(deps: AssistDeps, idleIntervalMs = 1_000): AssistScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let isRunning = false
  let last: AssistTick | null = null
  let lastDetectedAt = -Infinity

  let currentRound = 1
  let mode: AssistSchedulerMode = 'idle_sleep'
  let burstStartTime = 0

  const cooldown = deps.detectCooldownMs ?? 8_000
  const burstTimeout = deps.burstTimeoutMs ?? 25_000

  function reset() {
    currentRound = 1
    mode = 'idle_sleep'
    burstStartTime = 0
    lastDetectedAt = -Infinity
  }

  async function tick(): Promise<AssistTick> {
    try {
      const phase = await deps.getPhase()
      if (phase !== 'InProgress') {
        reset()
        last = {
          phase,
          activeSlots: 0,
          maxStddev: null,
          note: '非对局中（等待进入对局）',
          detected: false,
          mode: 'idle_sleep',
          currentRound: 1,
          level: null
        }
        deps.onTick?.(last)
        return last
      }

      // 获取当前实时玩家状态
      let playerState: LivePlayerStateDto | null = null
      if (deps.getLivePlayer) {
        try {
          playerState = await deps.getLivePlayer()
        } catch {
          /* 局内 API 偶发超时不阻塞 */
        }
      }
      const level = playerState?.level ?? null

      // 1. 全部 4 轮已选完 → 深度休眠
      if (currentRound > MAYHEM_AUGMENT_TARGET_LEVELS.length) {
        mode = 'all_completed'
        last = {
          phase,
          activeSlots: 0,
          maxStddev: null,
          note: `🎉 本局 4 轮强化已全部选毕 (当前 ${level ?? '--'} 级)`,
          detected: false,
          mode: 'all_completed',
          currentRound: 4,
          level
        }
        deps.onTick?.(last)
        return last
      }

      const targetLevel = MAYHEM_AUGMENT_TARGET_LEVELS[currentRound - 1]

      // 2. 静默休眠态：监听是否达到目标等级
      if (mode === 'idle_sleep') {
        if (level != null && level >= targetLevel) {
          // 达标！唤醒 OCR 突发捕获
          mode = 'burst_detecting'
          burstStartTime = Date.now()
        } else {
          // 未达标或未获知等级：保持休眠，0 截屏
          const levelText = level != null ? `${level} 级` : '连接中'
          last = {
            phase,
            activeSlots: 0,
            maxStddev: null,
            note: `💤 静默休眠中 (当前 ${levelText} / 等待目标 ${targetLevel} 级)`,
            detected: false,
            mode: 'idle_sleep',
            currentRound,
            level
          }
          deps.onTick?.(last)
          return last
        }
      }

      // 3. 突发探测态（Burst Detecting）
      if (mode === 'burst_detecting') {
        const stats = await deps.getBandStats()
        const active = stats ? stats.filter(s => s.stddev >= BAND_ACTIVE_THRESHOLD) : []
        const maxStddev = stats && stats.length ? Math.max(...stats.map(s => s.stddev)) : null

        if (active.length >= ACTIVE_SLOTS_REQUIRED) {
          // 抓到卡片！
          mode = 'pushed_waiting_choice'
          last = {
            phase,
            activeSlots: active.length,
            maxStddev,
            note: `🎯 触发第 ${currentRound} 轮三选一强化推荐 (目标 ${targetLevel} 级)`,
            detected: true,
            mode: 'pushed_waiting_choice',
            currentRound,
            level
          }

          if (Date.now() - lastDetectedAt >= cooldown) {
            lastDetectedAt = Date.now()
            if (deps.onDetected) {
              try {
                await deps.onDetected(last)
              } catch (e) {
                last.note = `推送推荐失败：${String(e)}`
              }
            }
          }

          deps.onTick?.(last)
          return last
        }

        // 未抓到卡片：检查突发超时
        if (Date.now() - burstStartTime >= burstTimeout) {
          // 本轮突发超时（玩家可能手速极快选毕或跳过），推进到下一轮休眠
          currentRound += 1
          mode = currentRound > 4 ? 'all_completed' : 'idle_sleep'
          last = {
            phase,
            activeSlots: 0,
            maxStddev,
            note: `第 ${currentRound - 1} 轮突发窗口结束，进入下一轮休眠`,
            detected: false,
            mode: 'idle_sleep',
            currentRound,
            level
          }
          deps.onTick?.(last)
          return last
        }

        last = {
          phase,
          activeSlots: active.length,
          maxStddev,
          note: `⚡ 突发检测中 (第 ${currentRound} 轮 / 目标 ${targetLevel} 级)`,
          detected: false,
          mode: 'burst_detecting',
          currentRound,
          level
        }
        deps.onTick?.(last)
        return last
      }

      // 4. 已推送，等待玩家选卡（Pushed & Waiting Choice）
      if (mode === 'pushed_waiting_choice') {
        const stats = await deps.getBandStats()
        const active = stats ? stats.filter(s => s.stddev >= BAND_ACTIVE_THRESHOLD) : []
        const maxStddev = stats && stats.length ? Math.max(...stats.map(s => s.stddev)) : null

        // 卡片已从画面消失，说明玩家完成选卡！
        if (active.length < ACTIVE_SLOTS_REQUIRED || Date.now() - burstStartTime >= burstTimeout) {
          currentRound += 1
          mode = currentRound > 4 ? 'all_completed' : 'idle_sleep'
          last = {
            phase,
            activeSlots: 0,
            maxStddev: null,
            note: `✅ 第 ${currentRound - 1} 轮选择完毕，重回休眠`,
            detected: false,
            mode: 'idle_sleep',
            currentRound,
            level
          }
          deps.onTick?.(last)
          return last
        }

        last = {
          phase,
          activeSlots: active.length,
          maxStddev,
          note: `等待玩家选定第 ${currentRound} 轮强化…`,
          detected: true,
          mode: 'pushed_waiting_choice',
          currentRound,
          level
        }
        deps.onTick?.(last)
        return last
      }
    } catch (e) {
      last = {
        phase: 'unknown',
        activeSlots: 0,
        maxStddev: null,
        note: `tick 异常：${String(e)}`,
        detected: false,
        mode,
        currentRound,
        level: null
      }
    }

    deps.onTick?.(last!)
    return last!
  }

  function scheduleNext() {
    if (!isRunning) return
    // 动态调整间隔：突发态 350ms，休眠态 1000ms
    const delay = mode === 'burst_detecting' || mode === 'pushed_waiting_choice' ? 350 : idleIntervalMs
    timer = setTimeout(async () => {
      if (!isRunning) return
      await tick()
      scheduleNext()
    }, delay)
  }

  return {
    start() {
      if (isRunning) return
      isRunning = true
      void tick().then(() => scheduleNext())
    },
    stop() {
      isRunning = false
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    },
    tick,
    get running() {
      return isRunning
    },
    lastTick: () => last,
    reset
  }
}

let sharedAssistScheduler: AssistScheduler | null = null

export function getSharedAssistScheduler(): AssistScheduler {
  if (!sharedAssistScheduler) {
    // 延迟动态引入，避免在无 Tauri 环境单测中顶层执行 invoke 抛错
    sharedAssistScheduler = createAssistScheduler({
      getPhase: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        return (await invoke('mayhem_gameflow_phase')) as string
      },
      getLivePlayer: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        return (await invoke('mayhem_get_live_player')) as LivePlayerStateDto
      },
      getBandStats: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        return (await invoke('mayhem_capture_band_stats')) as BandStatsDto[]
      },
      onDetected: async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        const { setOverlayLayout, pushOverlayPanel } = await import(
          '@renderer/features/overlay/panels'
        )
        const outcome = (await invoke('mayhem_assist_tick', { championId: null })) as {
          pushed?: boolean
          payload?: unknown
        }
        if (!outcome.pushed || !outcome.payload) return
        await setOverlayLayout(560, 240, 'top-center')
        await pushOverlayPanel('mayhem-augments', outcome.payload)
      }
    })
  }
  return sharedAssistScheduler
}
