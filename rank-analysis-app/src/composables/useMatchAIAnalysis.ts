/**
 * 战绩详情「复盘」标签页的 AI 点评流控制
 * 整局点评在标签打开时自动生成（ensureOverview），单人点评按需生成（requestPlayer）；
 * 管理 aiState 状态机、profile 预拉取、运行代次（作废迟到的旧请求）与时间线降级提示。
 * Stage 2 markdown 的会话缓存在 services/ai/matchDetail 门面里，同一目标重开不会重烧 API。
 */

import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { prewarmAi } from '@renderer/services/ai/modelConfig'
import { useMessage } from 'naive-ui'
import type { Game } from '@renderer/types/domain/match'
import {
  analyzeMatchDetailWithAIStream,
  type AttributionResult,
  type MatchDetailAnalysisMode,
  type MatchAIState
} from '@renderer/services/ai'
import { renderAnalysisReport } from '@renderer/services/ai/matchDetail/renderReport'
import type { MisattributionMaterial } from '@renderer/services/ai/matchDetail/misattribution'
import {
  fetchBatchProfiles,
  injectNoteBriefs
} from '@renderer/services/ai/shared/recentProfile.batch'
import type { TimelineCard, TimelineStatus } from '@renderer/services/ai/shared/timeline'
import type { RecentPlayerProfile, TeamPosition } from '@renderer/services/ai/shared/types'

export function useMatchAIAnalysis(game: MaybeRefOrGetter<Game | null>) {
  const message = useMessage()

  // 打开含 AI 入口的页面即预热 Claude 中转连接（选了 DeepSeek 时不做事）
  prewarmAi()

  const aiLoading = ref(false)
  const aiResult = ref('')
  const aiState = ref<MatchAIState>('idle')
  /** 本次分析的归因名册,供渲染层按 label 确定性重排人物章节 */
  const aiAttribution = ref<AttributionResult | null>(null)
  /** Stage 2 材料数字白名单,供渲染层剔除模型编造数字的句子 */
  const aiMaterialNumbers = ref<Set<number> | null>(null)
  const aiTimelineCards = ref<TimelineCard[] | null>(null)
  const aiTimelineStatus = ref<TimelineStatus | null>(null)
  const aiEntityFacts = ref<MisattributionMaterial | null>(null)
  const aiMode = ref<MatchDetailAnalysisMode>('overview')
  const aiTargetParticipantId = ref<number | null>(null)
  /** 最近一次生成失败的原因；新一轮分析开始时清空 */
  const aiError = ref<string | null>(null)

  /**
   * 当前 aiResult / 在飞请求对应的「模式 + 目标」。同一目标直接看已有结果（或等在飞的那次），
   * 换了目标才重新分析。
   */
  const resultKey = ref<string | null>(null)
  const currentKey = (): string =>
    `${aiMode.value}:${aiMode.value === 'player' ? aiTargetParticipantId.value : ''}`

  /**
   * 运行代次。换对局 / 发起新分析时自增，旧请求的回调靠它自我作废——
   * 否则被放弃的那次请求流回来的 chunk 会追加进新目标的点评里。
   */
  let runToken = 0

  const renderedAiResult = computed(() => {
    const raw = aiResult.value
    // 时间线拉取失败时在点评顶部提示已降级（开关关闭不提示）
    const markdown =
      raw && aiTimelineStatus.value === 'unavailable'
        ? `> 本局时间线不可用，已按终局数据复盘

${raw}`
        : raw
    return renderAnalysisReport(
      markdown,
      // 仅整局锐评有人物章节;单人复盘是另一套模板,不参与重排
      aiMode.value === 'overview' ? (aiAttribution.value?.verdicts ?? undefined) : undefined,
      // 两模式都做数字接地过滤:整局锐评同样会编数字(真机 301041798766)
      aiMaterialNumbers.value ?? undefined,
      aiTimelineCards.value ?? undefined,
      // 两种模式都过张冠李戴过滤(数字属于别人却写在点名对象头上)
      aiEntityFacts.value ?? undefined
    )
  })
  const aiStateLabel = computed(() => {
    switch (aiState.value) {
      case 'profiles':
        return '正在加载玩家近期数据...'
      case 'attribution':
        return 'AI 正在归因...'
      case 'critique':
        return '正在生成锐评...'
      case 'error':
        return aiError.value ? `AI 分析失败：${aiError.value}` : 'AI 分析失败'
      default:
        return ''
    }
  })

  // Per-game profile cache so re-opening doesn't re-fetch.
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

  /**
   * 按当前模式与目标发起一次分析（显式重跑也走这里）。
   * 同一目标正在跑时不重复发起；换了目标则作废在飞的旧请求、重新开始。
   */
  async function runCurrentAiAnalysis() {
    const g = toValue(game)
    if (!g) return
    if (aiLoading.value && resultKey.value === currentKey()) return

    if (aiMode.value === 'player' && !aiTargetParticipantId.value) {
      message.warning('请选择要分析的玩家')
      return
    }

    const token = ++runToken
    aiLoading.value = true
    aiResult.value = ''
    aiAttribution.value = null
    aiMaterialNumbers.value = null
    aiTimelineCards.value = null
    aiTimelineStatus.value = null
    aiError.value = null
    aiEntityFacts.value = null
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
    if (token !== runToken) return

    aiState.value = 'attribution'

    try {
      await analyzeMatchDetailWithAIStream(
        g,
        {
          // 三个回调都先验代次：这次请求若已被放弃（换对局 / 换目标），
          // 迟到的 chunk 不能污染当前点评
          onChunk: chunk => {
            if (token !== runToken) return
            if (aiState.value === 'attribution') aiState.value = 'critique'
            aiResult.value += chunk
          },
          onDone: () => {
            if (token !== runToken) return
            aiState.value = 'done'
            aiLoading.value = false
          },
          onError: error => {
            if (token !== runToken) return
            aiState.value = 'error'
            aiError.value = error
            message.error('AI 分析出错: ' + error)
            aiLoading.value = false
          }
        },
        {
          mode: aiMode.value,
          participantId:
            aiMode.value === 'player' ? (aiTargetParticipantId.value ?? undefined) : undefined
        },
        {
          profileMap,
          onAttribution: attribution => {
            if (token !== runToken) return
            aiAttribution.value = attribution
          },
          onStage2Material: allowedNumbers => {
            if (token !== runToken) return
            aiMaterialNumbers.value = allowedNumbers
          },
          onTimelineCards: cards => {
            if (token !== runToken) return
            aiTimelineCards.value = cards
          },
          onTimelineStatus: status => {
            if (token !== runToken) return
            aiTimelineStatus.value = status
          },
          onEntityFacts: material => {
            if (token !== runToken) return
            aiEntityFacts.value = material
          }
        }
      )
    } catch (error: any) {
      if (token !== runToken) return
      aiState.value = 'error'
      aiError.value = error.message || '未知错误'
      message.error('AI 分析出错: ' + aiError.value)
      aiLoading.value = false
    }
  }

  /**
   * 已经有东西可看吗？同一目标正在跑（等它）或已有结果（直接看）都不该再烧一次 API 调用。
   */
  function hasSomethingToShow(): boolean {
    return resultKey.value === currentKey() && (aiLoading.value || aiResult.value !== '')
  }

  /** 整局点评：标签页打开时调用；已有/在飞则不重跑 */
  async function ensureOverview() {
    aiMode.value = 'overview'
    aiTargetParticipantId.value = null
    if (hasSomethingToShow()) return
    // 刚失败过：不自动重试（切标签/回到整局都不该反复烧 API），只有显式「重新生成」才重跑
    if (resultKey.value === currentKey() && (aiState.value === 'error' || aiError.value)) return
    await runCurrentAiAnalysis()
  }

  /** 单人点评：用户点「生成该玩家点评」时调用；同一玩家已有/在飞则不重跑 */
  async function requestPlayer(participantId: number) {
    aiMode.value = 'player'
    aiTargetParticipantId.value = participantId
    if (hasSomethingToShow()) return
    await runCurrentAiAnalysis()
  }

  function resetOnGameChange() {
    // 作废在飞的旧请求：既复位 loading（否则换对局后按钮永远转圈），
    // 也让它迟到的 chunk 不会流进新对局的点评
    runToken++
    aiLoading.value = false
    aiResult.value = ''
    resultKey.value = null
    aiState.value = 'idle'
    aiError.value = null
    aiAttribution.value = null
    aiMaterialNumbers.value = null
    aiTimelineCards.value = null
    aiTimelineStatus.value = null
    aiEntityFacts.value = null
    aiMode.value = 'overview'
    aiTargetParticipantId.value = null
  }

  return {
    aiLoading,
    aiResult,
    aiState,
    aiStateLabel,
    aiMode,
    aiTargetParticipantId,
    aiError,
    aiTimelineStatus,
    aiTimelineCards,
    aiAttribution,
    aiMaterialNumbers,
    aiEntityFacts,
    renderedAiResult,
    runCurrentAiAnalysis,
    ensureOverview,
    requestPlayer,
    resetOnGameChange
  }
}
