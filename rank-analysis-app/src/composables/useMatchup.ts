/** 对位内页查询编排：上下文失效、分路修正、分页和有界详情并发。 */
import { computed, onScopeDispose, ref, watch } from 'vue'
import type { OpggTier } from '@renderer/services/opgg'
import type {
  MatchupApi,
  MatchupCandidate,
  MatchupGroup,
  MatchupList,
  MatchupPosition,
  MatchupQuery,
  MatchupRow,
  MatchupSource
} from '@renderer/types/matchup'

/** 每次最多展示八个候选，避免对完整英雄集发起详情风暴。 */
export const MATCHUP_PAGE_SIZE = 8
/** 本项目小样本提示阈值，不是 OP.GG 官方置信度规则。 */
export const MATCHUP_SMALL_SAMPLE = 200

/** 按敌方胜率分组，样本不足放尾部。
 * @param candidates 原始列表，原数组保持不变。
 * @param group 推荐应对或谨慎选择。
 * @returns 稳定排序后的候选。
 */
export function sortCandidates(
  candidates: MatchupCandidate[],
  group: MatchupGroup
): MatchupCandidate[] {
  return candidates
    .filter(row => (group === 'good' ? row.enemyWinRate < 0.5 : row.enemyWinRate > 0.5))
    .sort(
      (a, b) =>
        Number(a.play < MATCHUP_SMALL_SAMPLE) - Number(b.play < MATCHUP_SMALL_SAMPLE) ||
        (group === 'good' ? a.enemyWinRate - b.enemyWinRate : b.enemyWinRate - a.enemyWinRate) ||
        a.championId - b.championId
    )
}

/** 检查返回值是否属于请求上下文，防止源异常或缓存错配。
 * @param source 返回的源标识。
 * @param query 实际请求条件。
 * @returns 所有已固定字段均一致时为 true。
 */
function matches(source: MatchupSource, query: MatchupQuery): boolean {
  return (
    source.enemyId === query.enemyId &&
    source.position === query.position &&
    source.tier === query.tier &&
    !!source.version &&
    (!query.version || source.version === query.version)
  )
}

/** 外层公开状态；关闭内页时不再接收异步渲染。 */
export interface MatchupContext {
  /** 当前敌方槽位；测试单目标时可省略。 */
  slot?: number
  /** 当前敌方英雄，0 表示尚未选择。 */
  enemyId: number
  /** 已确认成功切换的统计段位。 */
  tier: OpggTier
  /** 内页可见且段位未切换时为 true。 */
  active: boolean
}

/** 建立内页查询模型。
 * @param context 响应式上下文读取函数。
 * @param api 真实或演示数据提供器。
 * @returns 列表、筛选状态与只读查询动作，随当前 effect scope 释放。
 */
export function useMatchup(context: () => MatchupContext, api: MatchupApi) {
  const position = ref<MatchupPosition | null>(null)
  const manual = ref(false)
  const tab = ref<MatchupGroup>('good')
  const page = ref(1)
  const list = ref<MatchupList | null>(null)
  const loading = ref(false)
  const error = ref('')
  const details = ref<Record<number, MatchupRow>>({})
  let generation = 0
  let detailGeneration = 0
  let inFlight = 0
  const waiting: Array<() => void> = []
  let lastTarget = ''
  /** 每个槽位只记住当前英雄的手动修正，换英雄即使旧记录失效。 */
  const positions = new Map<
    number,
    { enemyId: number; position: MatchupPosition; manual: boolean }
  >()
  const sorted = computed(() => sortCandidates(list.value?.candidates ?? [], tab.value))
  const totalPages = computed(() => Math.max(1, Math.ceil(sorted.value.length / MATCHUP_PAGE_SIZE)))
  const visible = computed(() =>
    sorted.value.slice((page.value - 1) * MATCHUP_PAGE_SIZE, page.value * MATCHUP_PAGE_SIZE)
  )
  const rows = computed<MatchupRow[]>(() =>
    visible.value.map(row => details.value[row.championId] ?? { ...row, loading: true })
  )

  /** 跨查询代次共享并发槽，旧请求仍占位直到完成。
   * @param operation 获得槽位后执行的异步动作。
   * @returns 动作结果；异常原样传递。
   * @typeParam T 异步动作返回类型。
   */
  async function withDetailSlot<T>(operation: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => {
      const enter = () => {
        inFlight++
        resolve()
      }
      if (inFlight < 3) enter()
      else waiting.push(enter)
    })
    try {
      return await operation()
    } finally {
      inFlight--
      waiting.shift()?.()
    }
  }

  /** 获取当前页详情，三个 worker 共同消费队列；失效后不再启动后续请求。 */
  async function loadDetails(): Promise<void> {
    const token = ++detailGeneration
    details.value = {}
    const snapshot = list.value
    if (!snapshot || !context().active) return
    const queue = [...visible.value]
    const query: MatchupQuery = {
      enemyId: snapshot.enemyId,
      tier: snapshot.tier,
      position: snapshot.position,
      version: snapshot.version
    }
    /** 消费一份有界队列；每个 await 后核对查询代次。 */
    async function worker(): Promise<void> {
      while (queue.length && token === detailGeneration) {
        const row = queue.shift()!
        details.value[row.championId] = { ...row, loading: true }
        try {
          const data = await withDetailSlot(() =>
            token === detailGeneration
              ? api.getDetail(query, row.championId)
              : Promise.resolve(undefined)
          )
          if (token !== detailGeneration) return
          if (!data) return
          if (!matches(data, query) || data.candidateId !== row.championId)
            throw new Error('context mismatch')
          details.value[row.championId] = { ...row, loading: false, data }
        } catch {
          if (token === detailGeneration)
            details.value[row.championId] = { ...row, loading: false, error: '暂时无法获取' }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
  }

  /** 刷新目标列表；推测失败时要求手动选择，不凭队伍顺序猜分路。 */
  async function reload(): Promise<void> {
    const token = ++generation
    ++detailGeneration
    const current = { ...context() }
    list.value = null
    details.value = {}
    error.value = ''
    page.value = 1
    loading.value = current.active && current.enemyId > 0
    const slot = current.slot ?? current.enemyId
    const target = `${slot}:${current.enemyId}`
    if (target !== lastTarget) {
      lastTarget = target
      const remembered = positions.get(slot)
      const valid = remembered?.enemyId === current.enemyId ? remembered : undefined
      if (!valid) positions.delete(slot)
      position.value = valid?.position ?? null
      manual.value = valid?.manual ?? false
    }
    if (!loading.value) return
    try {
      if (!position.value) {
        const inferred = await api.getPosition(current.enemyId)
        if (token !== generation) return
        position.value = inferred
        if (inferred)
          positions.set(slot, { enemyId: current.enemyId, position: inferred, manual: false })
      }
      if (!position.value) return
      const query: MatchupQuery = {
        enemyId: current.enemyId,
        tier: current.tier,
        position: position.value
      }
      const result = await api.getList(query)
      if (token !== generation) return
      if (!matches(result, query)) throw new Error('context mismatch')
      list.value = result
    } catch {
      if (token === generation) error.value = '暂时无法获取 OP.GG 数据，请重试。'
    } finally {
      if (token === generation) loading.value = false
    }
  }

  /** 修正分路并刷新。
   * @param value 用户明确选择的分路。
   */
  function setPosition(value: MatchupPosition): void {
    position.value = value
    manual.value = true
    const current = context()
    positions.set(current.slot ?? current.enemyId, {
      enemyId: current.enemyId,
      position: value,
      manual: true
    })
    void reload()
  }

  watch(
    () => [context().slot, context().enemyId, context().tier, context().active],
    () => void reload(),
    { immediate: true }
  )
  watch(tab, () => {
    page.value = 1
  })
  watch([list, tab, page], () => void loadDetails())
  onScopeDispose(() => {
    ++generation
    ++detailGeneration
  })
  return {
    position,
    manual,
    tab,
    page,
    list,
    loading,
    error,
    rows,
    sorted,
    totalPages,
    reload,
    loadDetails,
    setPosition
  }
}
