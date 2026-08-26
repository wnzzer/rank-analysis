/**
 * C2 桥接层：Live Client Data 事件流 → 台词引擎 → overlay 气泡。
 *
 * - 事件映射（mapLiveEvents）：ChampionKill/Multikill/Ace(s)/GameEnd → CompanionEvent，
 *   只对「我」的击杀/阵亡开口（me = 当前召唤师 gameName）
 * - 去重：LCD 的 events 数组是全量窗口，按事件键去重后只喂新增
 * - 出口：pushOverlayPanel('companion-bubble')，气泡自动消失由 overlay 端兜底
 *
 * 依赖全部注入，单测无需 Tauri/LCU。
 */
import { invoke } from '@tauri-apps/api/core'

import type { LiveEvent, LiveGameSnapshot } from '@renderer/features/gaming/services/liveGame'
import { pushOverlayPanel } from '@renderer/features/overlay/panels'

import { createActiveSpeaker, type CompanionEvent } from './engine'
import { createPolisher } from './polish'
import { getPersona, getActivePersonaId } from './persona'

export interface LiveBridgeDeps {
  getSnapshot?: () => Promise<LiveGameSnapshot | null>
  /** 当前玩家名（gameName）；默认 get_my_summoner */
  getMe?: () => Promise<string>
  /** 台词出口；默认推 companion-bubble 面板 */
  onLine?: (text: string) => Promise<void>
  intervalMs?: number
}

export interface LiveBridge {
  start(): void
  stop(): void
  tick(): Promise<void>
  readonly running: boolean
}

/** LCD EventName → 触发器类型映射（只关心「我」的事件）。 */
export function mapLiveEvents(events: LiveEvent[], me: string): CompanionEvent[] {
  const out: CompanionEvent[] = []
  const now = Date.now()
  for (const e of events) {
    switch (e.eventName) {
      case 'ChampionKill': {
        if (e.killerName === me) {
          out.push({ type: 'kill', at: now, championName: e.victimName })
        } else if (e.victimName === me) {
          out.push({ type: 'death', at: now })
        }
        break
      }
      case 'Multikill': {
        if (e.killerName === me) {
          out.push({
            type: 'multikill',
            at: now,
            streak: (e as { killStreak?: number }).killStreak ?? 2
          })
        }
        break
      }
      case 'Ace':
      case 'Aces': {
        const involved = [e.killerName ?? '', ...(e.assisters ?? [])].includes(me)
        if (involved) out.push({ type: 'ace', at: now })
        break
      }
      case 'GameEnd': {
        // GameEnd 的 Result 字段在部分版本缺失：缺省按失败处理（关怀优先）
        const win = /win/i.test((e as { result?: string }).result ?? '')
        out.push({ type: win ? 'victory' : 'defeat', at: now })
        break
      }
      default:
        break
    }
  }
  return out
}

function eventKey(e: LiveEvent): string {
  return `${e.eventName}:${e.eventTime}:${e.killerName ?? ''}:${e.victimName ?? ''}`
}

export function createLiveBridge(deps: LiveBridgeDeps = {}): LiveBridge {
  const getSnapshot =
    deps.getSnapshot ?? (() => invoke('get_live_game_data') as Promise<LiveGameSnapshot | null>)
  const getMe =
    deps.getMe ??
    (async () => {
      try {
        const s = (await invoke('get_my_summoner')) as { gameName?: string }
        return s.gameName ?? ''
      } catch {
        return ''
      }
    })
  const onLine = deps.onLine ?? ((text: string) => pushOverlayPanel('companion-bubble', { text }))
  const intervalMs = deps.intervalMs ?? 5_000

  const persona = getPersona(getActivePersonaId())
  const speaker = createActiveSpeaker({ polish: createPolisher(persona) })

  let seen = new Set<string>()
  let me = ''
  let timer: ReturnType<typeof setInterval> | null = null

  async function tick(): Promise<void> {
    try {
      if (!me) me = await getMe()
      if (!me) return // 拿不到身份时保持沉默（不误报他人事件）
      const snap = await getSnapshot()
      if (!snap?.events?.length) return

      const fresh: LiveEvent[] = []
      for (const e of snap.events) {
        const k = eventKey(e)
        if (!seen.has(k)) {
          seen.add(k)
          fresh.push(e)
        }
      }
      // 窗口防膨胀：一局事件量级 ~百条
      if (seen.size > 500) seen = new Set([...seen].slice(-200))

      for (const evt of mapLiveEvents(fresh, me)) {
        const line = await speaker.onEvent(evt)
        if (line?.text) await onLine(line.text)
      }
    } catch (e) {
      console.warn('[companion-bridge] tick failed:', e)
    }
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
    }
  }
}

let singleton: LiveBridge | null = null

/** 应用级单例桥（Framework.vue 启动一次；重复调用返回同一实例）。 */
export function startLiveBridge(deps: LiveBridgeDeps = {}): LiveBridge {
  singleton ??= createLiveBridge(deps)
  if (!singleton.running) singleton.start()
  return singleton
}
