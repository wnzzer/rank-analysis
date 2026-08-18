import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getHabitTags,
  listHabitGoals,
  addHabitGoal,
  toggleHabitGoal,
  DIMENSION_LABELS,
  DIMENSION_FIX_HINTS,
  type HabitTag,
  type HabitGoal
} from './insight'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

const tag: HabitTag = {
  dimension: 'vision',
  avgVsPeer: -12.5,
  streak: 3,
  firstSeen: '2026-08-01T00:00:00Z',
  lastSeen: '2026-08-10T00:00:00Z'
}

describe('getHabitTags', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('调用后端并透传标签数组', async () => {
    invokeMock.mockResolvedValue([tag])
    await expect(getHabitTags()).resolves.toEqual([tag])
    expect(invokeMock).toHaveBeenCalledWith('get_habit_tags')
  })

  it('失败时抛出错误（如未连接客户端）', async () => {
    invokeMock.mockRejectedValue(new Error('拿不到本机召唤师'))
    await expect(getHabitTags()).rejects.toThrow('拿不到本机召唤师')
  })
})

describe('habit goals', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('listHabitGoals 转发并返回目标列表', async () => {
    const goal: HabitGoal = { id: 1, dimension: 'vision', title: '排眼数 +1', done: false }
    invokeMock.mockResolvedValue([goal])
    await expect(listHabitGoals()).resolves.toEqual([goal])
    expect(invokeMock).toHaveBeenCalledWith('list_habit_goals')
  })

  it('addHabitGoal 转发参数并返回新 id', async () => {
    invokeMock.mockResolvedValue(7)
    await expect(addHabitGoal('cs', '练补刀')).resolves.toBe(7)
    expect(invokeMock).toHaveBeenCalledWith('add_habit_goal_cmd', {
      dimension: 'cs',
      title: '练补刀'
    })
  })

  it('toggleHabitGoal 转发 id', async () => {
    invokeMock.mockResolvedValue(null)
    await toggleHabitGoal(3)
    expect(invokeMock).toHaveBeenCalledWith('toggle_habit_goal_cmd', { id: 3 })
  })
})

describe('dimension labels', () => {
  it('六个维度都有中文名与建议动作', () => {
    expect(Object.keys(DIMENSION_LABELS)).toHaveLength(6)
    expect(Object.keys(DIMENSION_FIX_HINTS)).toHaveLength(6)
    for (const hint of Object.values(DIMENSION_FIX_HINTS)) {
      expect(hint.length).toBeGreaterThan(4)
    }
  })
})
