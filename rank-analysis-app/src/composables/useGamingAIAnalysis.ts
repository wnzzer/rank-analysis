/**
 * 对局页 AI 分析的状态与生命周期（D-P2 tab 化：选人期 / 对局中·赛后 各自独立进度）
 *
 * 从 Gaming.vue 抽出，核心是把**面板显隐**与**请求生命周期**分成两件事：
 * 按钮的语义是「打开面板」，不是「发起分析」。分析只在面板里没东西可看
 * （既不在跑、也没有结果）时才顺带发起，重跑要走显式的 {@link rerun}。
 *
 * D-P2 扩展：
 * - 按阶段分 kind：`champSelect`（选人期阵容分析）与 `game`（对局中/赛后整队分析），
 *   两个 kind 各自持有 loading/result，切 tab 不丢对方进度；
 * - 自动发起带 3 分钟限流（同一阶段内关窗重开不反复烧 token，spec D-P2 节流）；
 *   显式 {@link rerun} 不受限——用户明确的动作不该被节流拦；
 * - 选人期可注入确定性事实（规则引擎决策 + 阵容强度分），AI 只解释不推翻。
 *
 * 三 tab 化后（选人/对局中/赛后），本 composable 负责「选人期」与「赛后」两个 kind，
 * 「对局中」的实时分析走独立的 {@link useLiveAIAnalysis}（自带快照轮询）。
 * 面板内重跑按钮按当前 tab 分发：{@link rerunKind} 只动指定 kind 的进度。
 *
 * @module composables/useGamingAIAnalysis
 */
import {
  computed,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref
} from 'vue'
import { useMessage } from 'naive-ui'
import {
  analyzeChampSelectWithAIStream,
  analyzeGameWithAIStream,
  type StreamCallbacks
} from '@renderer/services/ai'
import type { ChampSelectPromptExtras } from '@renderer/services/ai/prompts/champSelect'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import type { SessionData } from '@renderer/types/domain/gaming'
import type { OpggMode } from '@renderer/services/opgg'

/** 分析种类：选人期阵容分析 / 对局中+赛后整队分析 */
export type AiAnalysisKind = 'champSelect' | 'game'

/** 自动发起限流窗口（同一 kind 同一阶段连续自动触发的最小间隔） */
const AUTO_RUN_THROTTLE_MS = 3 * 60 * 1000

export interface GamingAIAnalysisOptions {
  /** 选人期确定性事实（规则引擎决策 + 阵容强度分），注入 prompt 供 AI 引用，可传 ref/getter 实时读取 */
  champSelectExtras?: MaybeRefOrGetter<ChampSelectPromptExtras | null>
}

export function useGamingAIAnalysis(
  sessionData: SessionData,
  opggMode: MaybeRefOrGetter<OpggMode>,
  options: GamingAIAnalysisOptions = {}
): {
  /** 当前激活 kind 是否有分析正在进行 */
  loading: Ref<boolean>
  /** 当前激活 kind 已流入的 markdown 原文 */
  result: Ref<string>
  /** 当前激活 kind */
  activeKind: ComputedRef<AiAnalysisKind>
  /** 结果面板是否展示（可双向写，供 n-modal v-model） */
  showPanel: Ref<boolean>
  renderedResult: ComputedRef<string>
  panelTitle: ComputedRef<string>
  /** 选人期 / 对局中·赛后的 tab 结构：champSelect 与 game 各自的 loading/result */
  kindState: Record<AiAnalysisKind, { loading: Ref<boolean>; result: Ref<string> }>
  /** 按钮入口：总是打开面板；当前 kind 面板里没东西可看时才顺带发起分析（带限流） */
  openPanel: () => void
  /** 面板内「重新分析」：无条件丢弃当前 kind 旧结果重跑（不受限流约束） */
  rerun: () => Promise<void>
  /** 指定 kind 的「重新分析」——三 tab 化后每个 tab 的重跑按钮只动自己的进度 */
  rerunKind: (kind: AiAnalysisKind) => Promise<void>
} {
  const message = useMessage()

  /** 当前阶段对应的 kind：选人期走阵容分析，其余（对局中/赛后）走整队分析 */
  const activeKind = computed<AiAnalysisKind>(() =>
    sessionData.phase === 'ChampSelect' ? 'champSelect' : 'game'
  )

  // 两个 kind 各自独立的进度：切 tab 不丢，关窗重开也还在
  const kindState: Record<AiAnalysisKind, { loading: Ref<boolean>; result: Ref<string> }> = {
    champSelect: { loading: ref(false), result: ref('') },
    game: { loading: ref(false), result: ref('') }
  }

  const loading = computed(() => kindState[activeKind.value].loading.value)
  const result = computed(() => kindState[activeKind.value].result.value)
  const renderedResult = computed(() => renderAnalysisReport(result.value))

  const showPanel = ref(false)
  const panelTitle = computed(() =>
    sessionData.phase === 'ChampSelect' ? '选人期阵容分析' : 'AI 分析'
  )

  // 实例级限流台账：key = kind，value = 最近一次自动发起时刻（0 = 未发起）。
  // 放实例内而不是模块级——限流只约束本面板的自动触发，不该跨实例/跨测试单元共享。
  const lastAutoRunAt: Record<AiAnalysisKind, number> = { champSelect: 0, game: 0 }

  // 新一局/新阶段来临（phase 变化）重置限流台账——同一阶段内的限流不该跨阶段生效
  watch(
    () => sessionData.phase,
    () => {
      lastAutoRunAt.champSelect = 0
      lastAutoRunAt.game = 0
    }
  )

  async function run(kind: AiAnalysisKind): Promise<void> {
    const state = kindState[kind]
    state.loading.value = true
    state.result.value = ''

    try {
      const callbacks: StreamCallbacks = {
        onChunk: chunk => {
          state.result.value += chunk
        },
        onDone: () => {
          state.loading.value = false
        },
        onError: error => {
          message.error('AI 分析出错: ' + error)
          state.loading.value = false
        }
      }
      if (kind === 'champSelect') {
        const extras = toValue(options.champSelectExtras) ?? undefined
        await analyzeChampSelectWithAIStream(sessionData, toValue(opggMode), callbacks, extras)
      } else {
        await analyzeGameWithAIStream(sessionData, 'team', callbacks, {
          opggMode: toValue(opggMode)
        })
      }
    } catch (e: any) {
      message.error('AI 分析出错: ' + (e?.message || '未知错误'))
      state.loading.value = false
    }
  }

  function openPanel(): void {
    showPanel.value = true
    const kind = activeKind.value
    const state = kindState[kind]
    // 正在跑 → 回去看进度；已有结果 → 回去看结果。两者都不该再烧一次调用。
    if (state.loading.value || state.result.value) return
    // 自动发起限流：同一阶段内 3 分钟最多自动跑一次，防关窗重开反复烧 token
    const now = Date.now()
    if (now - lastAutoRunAt[kind] < AUTO_RUN_THROTTLE_MS) return
    lastAutoRunAt[kind] = now
    void run(kind)
  }

  async function rerun(): Promise<void> {
    return rerunKind(activeKind.value)
  }

  async function rerunKind(kind: AiAnalysisKind): Promise<void> {
    const state = kindState[kind]
    if (state.loading.value) return
    showPanel.value = true
    lastAutoRunAt[kind] = Date.now()
    await run(kind)
  }

  return {
    loading,
    result,
    activeKind,
    showPanel,
    renderedResult,
    panelTitle,
    kindState,
    openPanel,
    rerun,
    rerunKind
  }
}
