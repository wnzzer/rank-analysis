/**
 * 运行时特性开关（设计重构 v3 过渡期专用，P4 统一删除）。
 *
 * 约定：
 * - 默认值写死在代码里（新壳层默认开启）；
 * - 可用 localStorage 覆盖以便单版本内回退旧 UI：`localStorage.setItem('ra.flag.shellV2','0')`；
 * - P4 收尾时整文件删除，调用点收敛为无条件新实现。
 */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/** 新壳层（舰桥导航 + 顶栏 + 主页）：P1 引入，P4 移除本开关 */
export const SHELL_V2 = readFlag('ra.flag.shellV2', true)

/** 对局页情报舱改造（结论带/信号区/dock/AI 抽屉）：P2 引入，P4 移除本开关 */
export const GAMING_V2 = readFlag('ra.flag.gamingV2', true)
