/**
 * 路由跳转快捷方法与 query 参数规范化
 */

import router from '@renderer/router'
import type { LocationQueryValue } from 'vue-router'

/**
 * 把路由 query 值规范化为单个 string。
 * vue-router 在参数重复时(?aiq=a&aiq=b)给出数组,直接 `as string` 会把数组
 * 透传进模板/逻辑;统一取第一个有效值,缺失返回空串。
 */
export function firstQueryValue(v: LocationQueryValue | LocationQueryValue[]): string {
  if (Array.isArray(v)) return v.find(x => typeof x === 'string') ?? ''
  return v ?? ''
}

export function searchSummoner(nameId: string) {
  router.push({
    path: '/Record',
    query: { name: nameId, t: Date.now() }
  })
}
