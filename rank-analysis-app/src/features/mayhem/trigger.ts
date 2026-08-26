/**
 * 大乱斗助手触发调度器（A3 触发时机层 v1）。
 *
 * 对局中周期性 tick：gameflow 阶段过滤 → 抓取三卡标题带活跃度 → 判定是否
 * 出现三选一画面。OCR 引擎接入前仅**报告**不推送（note 说明原因），
 * 引擎就位后把 push 动作接进 onDetected 即可，调度逻辑不变。
 *
 * 依赖全部注入（getPhase/getBandStats），单测无需 Tauri。
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

/** 标题带亮度标准差阈值（0-255）。目测初值：纯色≈0、文字内容>20；需实测校准。 */
export const BAND_ACTIVE_THRESHOLD = 18

/** 判定「三选一出现」所需的活跃带数量。 */
export const ACTIVE_SLOTS_REQUIRED = 2

export interface AssistDeps {
  getPhase(): Promise<string>
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
}

export interface AssistTick {
  phase: string
  /** 活跃标题带数 */
  activeSlots: number
  maxStddev: number | null
  note: string
  /** 三选一画面已确认出现（OCR 接入后此值为 true 时触发打分推送） */
  detected: boolean
}

function evaluate(phase: string, stats: BandStatsDto[] | null): AssistTick {
  if (phase !== 'InProgress') {
    return { phase, activeSlots: 0, maxStddev: null, note: '非对局中', detected: false }
  }
  if (!stats || !stats.length) {
    return { phase, activeSlots: 0, maxStddev: null, note: '截屏不可用', detected: false }
  }
  const active = stats.filter(s => s.stddev >= BAND_ACTIVE_THRESHOLD)
  const maxStddev = Math.max(...stats.map(s => s.stddev))
  if (active.length >= ACTIVE_SLOTS_REQUIRED) {
    return {
      phase,
      activeSlots: active.length,
      maxStddev,
      note: '检测到强化选择画面（OCR 引擎未接入，暂不推送）',
      detected: true
    }
  }
  return {
    phase,
    activeSlots: active.length,
    maxStddev,
    note: active.length === 1 ? '疑似强化画面' : '未检测到强化画面',
    detected: false
  }
}

export interface AssistScheduler {
  start(): void
  stop(): void
  tick(): Promise<AssistTick>
  readonly running: boolean
  lastTick(): AssistTick | null
}

export function createAssistScheduler(deps: AssistDeps, intervalMs = 10_000): AssistScheduler {
  let timer: ReturnType<typeof setInterval> | null = null
  let last: AssistTick | null = null
  let lastDetectedAt = -Infinity
  const cooldown = deps.detectCooldownMs ?? 8_000

  async function tick(): Promise<AssistTick> {
    try {
      const phase = await deps.getPhase()
      const stats = phase === 'InProgress' ? await deps.getBandStats() : null
      last = evaluate(phase, stats)
    } catch (e) {
      last = {
        phase: 'unknown',
        activeSlots: 0,
        maxStddev: null,
        note: `tick 失败：${String(e)}`,
        detected: false
      }
    }

    // 检测沿 + 冷却：三选一停留期间只触发一次 onDetected
    if (last.detected && Date.now() - lastDetectedAt >= cooldown) {
      lastDetectedAt = Date.now()
      if (deps.onDetected) {
        try {
          await deps.onDetected(last)
          last.note = '已推送三选一推荐'
        } catch (e) {
          last.note = `推送失败：${String(e)}`
        }
      }
    }

    try {
      deps.onTick?.(last)
    } catch {
      /* 回调异常不干扰调度 */
    }
    return last
  }

  return {
    start() {
      if (timer != null) return
      void tick()
      timer = setInterval(() => void tick(), intervalMs)
    },
    stop() {
      if (timer != null) {
        clearInterval(timer)
        timer = null
      }
    },
    tick,
    get running() {
      return timer != null
    },
    lastTick: () => last
  }
}
