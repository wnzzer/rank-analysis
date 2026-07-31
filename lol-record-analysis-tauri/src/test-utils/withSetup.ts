import { createApp, type App } from 'vue'

/**
 * 在一个真实的 Vue 应用实例里执行 composable，使 onMounted / onUnmounted 生效。
 * 返回 [composable 返回值, app]——测试结束时调用 app.unmount() 触发清理。
 */
export function withSetup<T>(composable: () => T): [T, App] {
  let result!: T
  const app = createApp({
    setup() {
      result = composable()
      return () => null
    }
  })
  app.mount(document.createElement('div'))
  return [result, app]
}
