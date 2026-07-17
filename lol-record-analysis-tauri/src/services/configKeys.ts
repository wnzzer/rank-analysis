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
  aiUsePlayerNotes: 'aiUsePlayerNotes',
  /** 云同步开关（默认关，开启需经风险告知弹窗） */
  cloudSyncEnabled: 'cloudSyncEnabled',
  /** 是否已向用户介绍过云同步功能（首次启动一次性弹窗用） */
  cloudSyncNoticeShown: 'cloudSyncNoticeShown',
  /** 本设备是否已完成过首次配置同步(首次确认弹窗只出现一次;设备级,不入备份) */
  configSyncedOnce: 'configSyncedOnce',
  /** 本设备上次推送/应用配置的时刻 ms(LWW 比较基准;设备级,不入备份) */
  configLastSyncAt: 'configLastSyncAt',
  /**
   * 游戏安装根目录（免 WeGame 一键启动用）。
   *
   * 由后端在客户端「已连接」时从运行进程反推并自动记忆（见 Rust `command::launcher`），
   * 前端一般无需读写；列在此处以收口该共享键名。
   */
  gameInstallPath: 'gameInstallPath',
  /** 页面缩放比例（Ctrl+滚轮调节，0.7~1.5；见 composables/useZoom） */
  zoomFactor: 'settings.ui.zoomFactor'
} as const
