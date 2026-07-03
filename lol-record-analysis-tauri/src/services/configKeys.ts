/**
 * config 持久化键名（前端共享常量）
 *
 * 收口散落在多个组件里的裸字符串 key，避免改名时漏改一处。
 * 与 `getConfigByIpc` / `putConfigByIpc`（{@link ./ipc}）配套使用。
 *
 * @module services/configKeys
 */

/**
 * 错误上报（Sentry）相关配置键。
 *
 * `errorReportingEnabled` 与后端 `observability::REPORTING_KEY` 对应——改这里也要同步 Rust。
 */
export const CONFIG_KEYS = {
  /** 是否开启 Sentry 错误上报 / 日志转发（opt-in，release 默认关、debug 默认开） */
  errorReportingEnabled: 'errorReportingEnabled',
  /** 是否已就错误上报询问过用户（首次同意弹窗用，问过即不再弹） */
  errorReportingConsentShown: 'errorReportingConsentShown',
  /** 用户自定义 DashScope API Key（留空用内置打包 key） */
  dashscopeApiKey: 'dashscopeApiKey',
  /** 玩家备注是否随 AI 分析请求发送到云端模型（默认开） */
  aiUsePlayerNotes: 'aiUsePlayerNotes'
} as const
