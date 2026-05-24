/**
 * 战绩详情页 AI 分析流控制
 * 管理 modal 可见性、aiState 状态机、profile 预拉取与流式请求生命周期
 */

import { computed, ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import MarkdownIt from 'markdown-it'
import { useMessage } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import {
  analyzeMatchDetailWithAIStream,
  type MatchDetailAnalysisMode,
  type MatchAIState
} from '@renderer/services/ai'
import { fetchBatchProfiles } from '@renderer/services/ai/shared/recentProfile.batch'
import type { RecentPlayerProfile, TeamPosition } from '@renderer/services/ai/shared/types'

// html:false 阻断 AI/外部数据中夹带 raw HTML（XSS 防线，CSP 之外的纵深防御）
const md = new MarkdownIt({ html: false, breaks: true, linkify: true })

export function useMatchAIAnalysis(game: MaybeRefOrGetter<Game | null>) {
  const message = useMessage()

  const showAiModal = ref(false)
  const aiLoading = ref(false)
  const aiResult = ref('')
  const aiState = ref<MatchAIState>('idle')
  const aiMode = ref<MatchDetailAnalysisMode>('overview')
  const aiTargetParticipantId = ref<number | null>(null)

  const renderedAiResult = computed(() => (aiResult.value ? md.render(aiResult.value) : ''))
  const aiStateLabel = computed(() => {
    switch (aiState.value) {
      case 'profiles':
        return '正在加载玩家近期数据...'
      case 'attribution':
        return 'AI 正在归因...'
      case 'critique':
        return '正在生成锐评...'
      case 'error':
        return 'AI 分析失败'
      default:
        return ''
    }
  })

  // Per-game profile cache so re-opening the modal doesn't re-fetch
  const profileCache = new Map<number, Map<string, RecentPlayerProfile | null>>()

  async function ensureProfiles(g: Game): Promise<Map<string, RecentPlayerProfile | null>> {
    const cached = profileCache.get(g.gameId)
    if (cached) return cached
    const identities = g.participantIdentities ?? []
    const participants = g.participants ?? []
    const requests = identities
      .map(idn => {
        const pid = (idn as any).participantId
        const p = participants.find(pp => pp.participantId === pid)
        if (!p || !idn.player?.puuid) return null
        const tp = ((p as any).teamPosition || 'UNKNOWN') as TeamPosition
        return {
          puuid: idn.player.puuid,
          teamPosition: tp,
          championId: p.championId
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const profiles = await fetchBatchProfiles(requests)
    profileCache.set(g.gameId, profiles)
    return profiles
  }

  async function runCurrentAiAnalysis() {
    const g = toValue(game)
    if (!g || aiLoading.value) return

    if (aiMode.value === 'player' && !aiTargetParticipantId.value) {
      message.warning('请选择要分析的玩家')
      return
    }

    aiLoading.value = true
    aiResult.value = ''
    aiState.value = 'profiles'

    let profileMap: Map<string, RecentPlayerProfile | null> | null = null
    try {
      profileMap = await ensureProfiles(g)
    } catch (err) {
      // Profile prefetch is best-effort: if it fails the AI still runs without
      // recentProfile context. Log and continue.
      console.warn('profile prefetch failed, continuing without profile', err)
      profileMap = null
    }

    aiState.value = 'attribution'

    try {
      await analyzeMatchDetailWithAIStream(
        g,
        {
          onChunk: chunk => {
            if (aiState.value === 'attribution') aiState.value = 'critique'
            aiResult.value += chunk
          },
          onDone: () => {
            aiState.value = 'done'
            aiLoading.value = false
          },
          onError: error => {
            aiState.value = 'error'
            message.error('AI 分析出错: ' + error)
            aiLoading.value = false
          }
        },
        {
          mode: aiMode.value,
          participantId:
            aiMode.value === 'player' ? (aiTargetParticipantId.value ?? undefined) : undefined
        },
        { profileMap }
      )
    } catch (error: any) {
      aiState.value = 'error'
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
    aiState.value = 'idle'
    aiMode.value = 'overview'
    aiTargetParticipantId.value = defaultParticipantId
  }

  return {
    showAiModal,
    aiLoading,
    aiResult,
    aiState,
    aiStateLabel,
    aiMode,
    aiTargetParticipantId,
    renderedAiResult,
    runCurrentAiAnalysis,
    openOverviewAnalysis,
    openPlayerAnalysis,
    resetOnGameChange
  }
}
