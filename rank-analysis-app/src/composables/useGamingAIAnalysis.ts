/**
 * 对局页 AI 分析的状态与生命周期
 *
 * 从 Gaming.vue 抽出，核心是把**面板显隐**与**请求生命周期**分成两件事：
 * 按钮的语义是「打开面板」，不是「发起分析」。分析只在面板里没东西可看
 * （既不在跑、也没有结果）时才顺带发起，重跑要走显式的 {@link rerun}。
 *
 * 这样关掉面板不再是死路——旧实现里 `showAIResult = true` 只出现在发起新请求
 * 的那一处，关掉即永久失去入口，直到那次请求自己结束；结束后再点又会清空结果
 * 从头重跑，把已经流完的内容和一次 API 调用一起丢掉。
 *
 * @module composables/useGamingAIAnalysis
 */
import { computed, ref, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import { useMessage } from 'naive-ui'
import {
  analyzeChampSelectWithAIStream,
  analyzeGameWithAIStream,
  type StreamCallbacks
} from '@renderer/services/ai'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import type { SessionData } from '@renderer/types/domain/gaming'
import type { OpggMode } from '@renderer/services/opgg'

export function useGamingAIAnalysis(
  sessionData: SessionData,
  opggMode: MaybeRefOrGetter<OpggMode>
): {
  /** 是否有分析正在进行 */
  loading: Ref<boolean>
  /** 已流入的 markdown 原文 */
  result: Ref<string>
  /** 结果面板是否展示（可双向写，供 n-modal v-model） */
  showPanel: Ref<boolean>
  renderedResult: ComputedRef<string>
  panelTitle: ComputedRef<string>
  /** 按钮入口：总是打开面板；面板里没东西可看时才顺带发起分析 */
  openPanel: () => void
  /** 面板内「重新分析」：无条件丢弃旧结果重跑 */
  rerun: () => Promise<void>
} {
  const message = useMessage()

  const loading = ref(false)
  const result = ref('')
  const showPanel = ref(false)

  const renderedResult = computed(() => renderAnalysisReport(result.value))
  /** 面板标题：选人期是「阵容分析」，对局中/赛后沿用旧的「AI 分析」 */
  const panelTitle = computed(() =>
    sessionData.phase === 'ChampSelect' ? '选人期阵容分析' : 'AI 分析'
  )

  async function run(): Promise<void> {
    loading.value = true
    result.value = ''

    try {
      const callbacks: StreamCallbacks = {
        onChunk: chunk => {
          result.value += chunk
        },
        onDone: () => {
          loading.value = false
        },
        onError: error => {
          message.error('AI 分析出错: ' + error)
          loading.value = false
        }
      }
      if (sessionData.phase === 'ChampSelect') {
        await analyzeChampSelectWithAIStream(sessionData, toValue(opggMode), callbacks)
      } else {
        await analyzeGameWithAIStream(sessionData, 'team', callbacks, {
          opggMode: toValue(opggMode)
        })
      }
    } catch (e: any) {
      message.error('AI 分析出错: ' + (e?.message || '未知错误'))
      loading.value = false
    }
  }

  function openPanel(): void {
    showPanel.value = true
    // 正在跑 → 回去看进度；已有结果 → 回去看结果。两者都不该再烧一次调用。
    if (loading.value || result.value) return
    void run()
  }

  async function rerun(): Promise<void> {
    if (loading.value) return
    showPanel.value = true
    await run()
  }

  return { loading, result, showPanel, renderedResult, panelTitle, openPanel, rerun }
}
