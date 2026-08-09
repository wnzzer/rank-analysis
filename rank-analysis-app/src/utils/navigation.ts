/**
 * 路由跳转快捷方法
 */

import router from '@renderer/router'

export function searchSummoner(nameId: string) {
  router.push({
    path: '/Record',
    query: { name: nameId, t: Date.now() }
  })
}
