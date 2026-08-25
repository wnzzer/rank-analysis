/**
 * 成长报告（D-P1 用户画像：战绩页左栏趋势卡）——纯用户触发式流式生成。
 *
 * 与 D-P2 分析块不同，这里没有轮询/自动发起：用户点「生成」才跑，
 * 可重复点击重新生成（替换旧结果）。样本不足（samples === 0）时不允许生成。
 *
 * @module composables/useGrowthReport
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useMessage } from 'naive-ui'
import { analyzeGrowthReportWithAIStream, type StreamCallbacks } from '@renderer/services/ai'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import type { MinuteCurveInsights } from '@renderer/components/record/minuteCurve'
import type { RecentData } from '@renderer/types/domain/analysis'

export function useGrowthReport(): {
  loading: Ref<boolean>
  result: Ref<string>
  renderedResult: ComputedRef<string>
  generate: (recent: RecentData, curveInsights?: MinuteCurveInsights | null) => Promise<void>
} {
  const message = useMessage()
  const loading = ref(false)
  const result = ref('')
  const renderedResult = computed(() => renderAnalysisReport(result.value))

  async function generate(
    recent: RecentData,
    curveInsights?: MinuteCurveInsights | null
  ): Promise<void> {
    if (loading.value) return
    if ((recent.samples ?? 0) <= 0) {
      message.warning('近 20 场暂无有效样本，无法生成成长报告')
      return
    }
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
          message.error('成长报告生成失败: ' + error)
          loading.value = false
        }
      }
      await analyzeGrowthReportWithAIStream(recent, callbacks, curveInsights)
    } catch (e) {
      message.error('成长报告生成失败: ' + ((e instanceof Error && e.message) || '未知错误'))
      loading.value = false
    }
  }

  return {
    loading,
    result,
    renderedResult,
    generate
  }
}
