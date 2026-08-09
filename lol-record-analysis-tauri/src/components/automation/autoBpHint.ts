/**
 * 自动 BP 配置的失效态判定。
 *
 * 抽成纯函数是为了可测：判定写在 .vue 的 computed 里就得挂载整个设置页才能测。
 */

/**
 * 判断自动 BP 是否「开着但没有任何可执行目标」。
 *
 * 三者同时成立才算失效：开关为开、没有任何启用中的规则、兜底池为空。
 * 只有规则没兜底池（只在特定局面动手）、或只有兜底池没规则，都是合理配置，
 * 不该报警——只有两者皆空才是确定的「开关是绿的但系统无事可做」。
 *
 * @param enabled - 自动选择/自动禁用的开关状态
 * @param rules - 该池对应的规则列表
 * @param pool - 该池的兜底英雄 id 列表
 * @returns true 表示应当向用户提示配置未完成
 * @example
 * ```ts
 * hasNoExecutableTarget(true, [], [])            // true
 * hasNoExecutableTarget(true, [], [64])          // false
 * hasNoExecutableTarget(true, [{ enabled: false }], []) // true
 * ```
 */
export function hasNoExecutableTarget(
  enabled: boolean,
  rules: ReadonlyArray<{ enabled: boolean }>,
  pool: ReadonlyArray<number>
): boolean {
  if (!enabled) return false
  return rules.every(r => !r.enabled) && pool.length === 0
}
