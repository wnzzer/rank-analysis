/**
 * 战绩详情页 AI 分析流控制
 * 管理 modal 可见性、aiState 状态机、profile 预拉取与流式请求生命周期
 */

import { computed, ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import { useMessage } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import {
  analyzeMatchDetailWithAIStream,
  type MatchDetailAnalysisMode,
  type MatchAIState,
  type AIAnalysisReport
} from '@renderer/services/ai'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import { sampleCritiqueVocab } from '@renderer/services/ai/matchDetail/vocab'
import {
  fetchBatchProfiles,
  injectNoteBriefs
} from '@renderer/services/ai/shared/recentProfile.batch'
import type { RecentPlayerProfile, TeamPosition } from '@renderer/services/ai/shared/types'
import { scoreGame } from '@renderer/features/record/services/playerScore'

export function useMatchAIAnalysis(game: MaybeRefOrGetter<Game | null>) {
  const message = useMessage()

  const showAiModal = ref(false)
  const aiLoading = ref(false)
  const aiResult = ref('')
  /** D-P1 结构化报告：Stage 2 成功时由 onStructured 置入；失败降级时保持 null */
  const aiReport = ref<AIAnalysisReport | null>(null)
  const aiState = ref<MatchAIState>('idle')
  const aiMode = ref<MatchDetailAnalysisMode>('overview')
  const aiTargetParticipantId = ref<number | null>(null)

  /**
   * 当前 aiResult 对应的「模式 + 目标」。用于判断面板里已有的东西还算不算数——
   * 同一目标就直接看旧结果，换了目标才重新分析。
   */
  const resultKey = ref<string | null>(null)
  const currentKey = (): string =>
    `${aiMode.value}:${aiMode.value === 'player' ? aiTargetParticipantId.value : ''}`

  /**
   * 运行代次。换对局 / 发起新分析时自增，旧请求的回调靠它自我作废——
   * 否则被放弃的那次请求流回来的 chunk 会追加进新对局的面板里。
   */
  let runToken = 0

  const renderedAiResult = computed(() => renderAnalysisReport(aiResult.value))
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

  // Per-game profile cache so re-opening the modal doesn't re-fetch.
  // 只缓存"干净"（未注入备注的）map——备注注入必须在每次返回前实时做，
  // 否则隐私开关切换后缓存命中会绕过开关（旁路）。
  const profileCache = new Map<number, Map<string, RecentPlayerProfile | null>>()

  async function ensureProfiles(g: Game): Promise<Map<string, RecentPlayerProfile | null>> {
    const cached = profileCache.get(g.gameId)
    if (cached) return injectNoteBriefs(cached)
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
    return injectNoteBriefs(profiles)
  }

  async function runCurrentAiAnalysis() {
    const g = toValue(game)
    if (!g || aiLoading.value) return

    if (aiMode.value === 'player' && !aiTargetParticipantId.value) {
      message.warning('请选择要分析的玩家')
      return
    }

    const token = ++runToken
    aiLoading.value = true
    aiResult.value = ''
    aiReport.value = null
    resultKey.value = currentKey()
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

    // 确定性评分（best-effort）：Rust 侧纯计算秒出；失败静默降级，不阻塞 AI 主流程
    const playerScores = await scoreGame(g)

    aiState.value = 'attribution'

    try {
      await analyzeMatchDetailWithAIStream(
        g,
        {
          // 三个回调都先验代次：这次请求若已被放弃（换对局 / 已发起新分析），
          // 迟到的 chunk 不能污染当前面板
          onChunk: chunk => {
            if (token !== runToken) return
            if (aiState.value === 'attribution') aiState.value = 'critique'
            aiResult.value += chunk
          },
          onStructured: report => {
            if (token !== runToken) return
            // 结构化成功时清掉流式期累积的原始 JSON 碎片（若有），显示以报告为准
            aiResult.value = ''
            aiReport.value = report
          },
          onDone: () => {
            if (token !== runToken) return
            aiState.value = 'done'
            aiLoading.value = false
          },
          onError: error => {
            if (token !== runToken) return
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
        // 词库样本：每次发起分析现采样（好+坏词库跨类别 30-50 词），
        // 供 Stage 2 锐评【词库提示】采用；缓存命中时不再采样，无副作用
        // playerScores：确定性评分（17 分制）事实，供归因/锐评引用
        { profileMap, vocabSamples: sampleCritiqueVocab(), playerScores }
      )
    } catch (error: any) {
      if (token !== runToken) return
      aiState.value = 'error'
      message.error('AI 分析出错: ' + (error.message || '未知错误'))
      aiLoading.value = false
    }
  }

  /**
   * 面板里已经有东西可看吗？正在跑（回去看进度）或已有同目标的结果（回去看结果）
   * 都不该再烧一次 API 调用。
   */
  function hasSomethingToShow(): boolean {
    return (
      aiLoading.value ||
      (aiResult.value !== '' && resultKey.value === currentKey()) ||
      (aiReport.value !== null && resultKey.value === currentKey())
    )
  }

  async function openOverviewAnalysis(defaultParticipantId: number | null) {
    aiMode.value = 'overview'
    aiTargetParticipantId.value = defaultParticipantId
    showAiModal.value = true
    if (hasSomethingToShow()) return
    await runCurrentAiAnalysis()
  }

  async function openPlayerAnalysis(participantId: number) {
    aiMode.value = 'player'
    aiTargetParticipantId.value = participantId
    showAiModal.value = true
    if (hasSomethingToShow()) return
    await runCurrentAiAnalysis()
  }

  watch([aiMode, aiTargetParticipantId], ([mode, pid], [prevMode, prevPid]) => {
    if (!showAiModal.value || !toValue(game)) return
    if (mode === prevMode && pid === prevPid) return
    void runCurrentAiAnalysis()
  })

  function resetOnGameChange(defaultParticipantId: number | null) {
    // 作废在飞的旧请求：既复位 loading（否则换对局后触发按钮永远转圈），
    // 也让它迟到的 chunk 不会流进新对局的面板
    runToken++
    aiLoading.value = false
    aiResult.value = ''
    aiReport.value = null
    resultKey.value = null
    aiState.value = 'idle'
    aiMode.value = 'overview'
    aiTargetParticipantId.value = defaultParticipantId
  }

  return {
    showAiModal,
    aiLoading,
    aiResult,
    aiReport,
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
