/**
 * 递归结构相等比较:对象键序无关、数组按序、原始值全等。
 *
 * 用于"云端配置 vs 本地快照"内容比对(见 spec:不一致才弹首次确认窗)。
 * 不处理循环引用——配置快照来自 serde 序列化,必为树形。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aIsArr = Array.isArray(a)
  if (aIsArr !== Array.isArray(b)) return false
  if (aIsArr) {
    const arrA = a as unknown[]
    const arrB = b as unknown[]
    return arrA.length === arrB.length && arrA.every((v, i) => deepEqual(v, arrB[i]))
  }
  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const keysA = Object.keys(objA)
  if (keysA.length !== Object.keys(objB).length) return false
  return keysA.every(k => k in objB && deepEqual(objA[k], objB[k]))
}
