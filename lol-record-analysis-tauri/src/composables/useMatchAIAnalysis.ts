/**
 * 战绩详情页 AI 分析流控制
 * 管理 modal 可见性、分析模式、目标参与者以及流式请求生命周期
 */

import { computed, ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import MarkdownIt from 'markdown-it'
import { useMessage } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import { analyzeMatchDetailWithAIStream, type MatchDetailAnalysisMode } from '@renderer/services/ai'

// html:false 阻断 AI/外部数据中夹带 raw HTML（XSS 防线，CSP 之外的纵深防御）
const md = new MarkdownIt({ html: false, breaks: true, linkify: true })

export function useMatchAIAnalysis(game: MaybeRefOrGetter<Game | null>) {
  const message = useMessage()

  const showAiModal = ref(false)
  const aiLoading = ref(false)
  const aiResult = ref('')
  const aiMode = ref<MatchDetailAnalysisMode>('overview')
  const aiTargetParticipantId = ref<number | null>(null)

  const renderedAiResult = computed(() => (aiResult.value ? md.render(aiResult.value) : ''))

  async function runCurrentAiAnalysis() {
    if (!toValue(game) || aiLoading.value) return

    if (aiMode.value === 'player' && !aiTargetParticipantId.value) {
      message.warning('请选择要分析的玩家')
      return
    }

    aiLoading.value = true
    aiResult.value = ''

    const g = toValue(game)
    if (!g) return

    try {
      await analyzeMatchDetailWithAIStream(
        g,
        {
          onChunk: chunk => {
            aiResult.value += chunk
          },
          onDone: () => {
            aiLoading.value = false
          },
          onError: error => {
            message.error('AI 分析出错: ' + error)
            aiLoading.value = false
          }
        },
        {
          mode: aiMode.value,
          participantId:
            aiMode.value === 'player' ? (aiTargetParticipantId.value ?? undefined) : undefined
        }
      )
    } catch (error: any) {
      message.error('AI 分析出错: ' + (error.message || '未知错误'))
      aiLoading.value = false
    }
  }

  async function openOverviewAnalysis(defaultParticipantId: number | null) {
    aiMode.value = 'overview'
    aiTargetParticipantId.value = defaultParticipantId
    showAiModal.value = true
    await runCurrentAiAnalysis()
  }

  async function openPlayerAnalysis(participantId: number) {
    aiMode.value = 'player'
    aiTargetParticipantId.value = participantId
    showAiModal.value = true
    await runCurrentAiAnalysis()
  }

  watch([aiMode, aiTargetParticipantId], ([mode, pid], [prevMode, prevPid]) => {
    if (!showAiModal.value || !toValue(game)) return
    if (mode === prevMode && pid === prevPid) return
    void runCurrentAiAnalysis()
  })

  function resetOnGameChange(defaultParticipantId: number | null) {
    aiResult.value = ''
    aiMode.value = 'overview'
    aiTargetParticipantId.value = defaultParticipantId
  }

  return {
    showAiModal,
    aiLoading,
    aiResult,
    aiMode,
    aiTargetParticipantId,
    renderedAiResult,
    runCurrentAiAnalysis,
    openOverviewAnalysis,
    openPlayerAnalysis,
    resetOnGameChange
  }
}
