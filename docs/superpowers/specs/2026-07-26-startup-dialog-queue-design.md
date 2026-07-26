# 启动弹窗队列:云同步告知优先于错误上报同意

**日期**: 2026-07-26
**状态**: 已批准(方案 A——抽出队列 composable)
**范围**: 纯前端。新增 `composables/useStartupDialogs.ts` + 同名 spec;改 `components/Framework.vue`、`components/common/ErrorReportingConsentDialog.vue`(prop 改单向)。Rust 侧零改动。

## 问题

启动期三个弹窗的编排散在 `Framework.vue` 里,靠布尔标志 + 互相否定条件维持互斥:

- 新用户首启只弹「错误上报同意」,「云同步告知」显式让位(`Framework.vue:197` 读到 `errorReportingConsentShown` 为 false 就 return),**要到第二次启动才知道有云同步功能**;
- `CloudConfigPullDialog` 的显示条件是 `pendingCloudConfig !== null && !showConsent && !showCloudNotice`——用「否定掉其它所有弹窗」排它,再加一个弹窗就得回头改所有既有弹窗的条件;
- 两个弹窗各有一套时机逻辑(consent 等 `isConnected` + 8s 兜底 + 500ms;notice 平坦 1.5s),重复且不一致;
- 整套编排零测试覆盖,而它已经踩过一次线上问题(`autoFocusDialogs.spec.ts` 记录的焦点环)。

目标:云同步告知提到首启第一位,错误上报同意紧随其后,同一次启动串行弹出。

## 设计决策

| 决策点 | 结论 |
|---|---|
| 排队方式 | 同一次启动串行:先云同步告知,关闭后接着错误上报同意 |
| 优先级 | `cloudSyncNotice` > `errorReportingConsent` > `cloudConfigPull` |
| 「去看看」分支 | 跳转数据与同步页后,**本次启动**不再弹错误上报同意,推到下次启动(`cloudSyncNoticeShown` 已置 true,下次自然轮到 consent,不会饥饿) |
| 时机门控 | 统一一道「首屏就绪闸门」:`lcuConnected` 为真(或 8s 兜底)后再等 500ms 打开,只开一次。云同步原来的 1.5s 平坦延时废弃 |
| 编排收敛 | 「现在该显示哪个」收敛成单个 computed,取代三处布尔与否定条件 |
| 读配置失败 | 统一按「已展示过」跳过本次启动(保守侧)——**有意的行为变更**,见下 |
| 不做 | 不下沉到 Rust(弹窗时机依赖 `isConnected` 与首屏动画,是纯前端 UX);不改三个弹窗的视觉与文案 |

## 队列模型

优先级列表(高→低),`active` 取第一个 `shouldShow` 为真的项:

| 顺序 | key | shouldShow |
|---|---|---|
| 1 | `cloudSyncNotice` | 门已开 && `!cloudSyncNoticeShown` && 本次未答 |
| 2 | `errorReportingConsent` | 门已开 && `!errorReportingConsentShown` && 本次未答 && 本次未被「去看看」抑制 |
| 3 | `cloudConfigPull` | 门已开 && `cloudStore.pendingCloudConfig !== null` |

第 3 项是响应式的(`pendingCloudConfig` 随云同步随时出现),不是启动期一次性项,因此**只参与排序、不参与「本次已答」记账**——它的收尾仍归 `pinia/cloudSync` store 所有,store 把 `pendingCloudConfig` 置空后 `active` 自然前进。

「去看看」的抑制范围**只含第 2 项**,不抑制第 3 项:第 3 项本身就是云同步弹窗,在数据与同步页弹出上下文贴合;且新用户刚点「去看看」时尚未开启云同步,不可能有 pending,实际撞不上。

## 模块边界

新建 `src/composables/useStartupDialogs.ts`:

```ts
export type StartupDialogKey = 'cloudSyncNotice' | 'errorReportingConsent' | 'cloudConfigPull'

export function useStartupDialogs(): {
  /** 当前应展示的弹窗;null = 都不展示 */
  active: Readonly<Ref<StartupDialogKey | null>>
  /** goto=true 表示用户点了「去看看」,本次启动不再弹错误上报同意 */
  resolveCloudSyncNotice(goto: boolean): Promise<void>
  /** 写失败会 reject,由调用方 toast */
  resolveErrorReportingConsent(enabled: boolean): Promise<void>
}
```

职责切分:

- **composable**:顺序、闸门、一次性标记(`cloudSyncNoticeShown` / `errorReportingConsentShown` / `errorReportingEnabled`)的读写;
- **`pinia/cloudSync` store**:云同步业务(`resolveCloudConfig`),不变;
- **`Framework.vue`**:渲染 + 用户可见反馈(toast、路由跳转)。

`lcuConnected` 直接 import——`composables/useGameState.ts:58` 正是为「非组件上下文 watch 连接时机」导出的,`pinia/cloudSync.ts:239` 是既有先例。

## Framework.vue 改动

```vue
<CloudSyncNoticeDialog :show="active === 'cloudSyncNotice'" @decide="onCloudNoticeDecide" />
<ErrorReportingConsentDialog :show="active === 'errorReportingConsent'" @decide="onConsentDecide" />
<!-- updated-at / decide 绑定不变,只替换 show 条件 -->
<CloudConfigPullDialog :show="active === 'cloudConfigPull'" :updated-at="..." @decide="..." />
```

删除 `showConsent` / `showCloudNotice` / `consentRevealed` / `maybeAskErrorReportingConsent` / `revealConsent` / `maybeShowCloudSyncNotice` 及那串否定条件(script 约减 90 行)。三个 `onXxxDecide` 保留,各缩成「调 resolve → toast / 跳转」。

`ErrorReportingConsentDialog` 的 `v-model:show` 改成单向 `:show`,与另外两个统一——它的 `update:show` 在 `:mask-closable="false"` + `:close-on-esc="false"` 下发不出来,是死代码。

## 错误处理与边界

- **写盘失败不卡队列**:`active` 的推进靠内存中的 `answered: Set<StartupDialogKey>`,`putConfigByIpc` 成功与否只影响下次启动还弹不弹。现状是先关弹窗再写配置,行为等价,但抽出后这条不变量需显式化并单测。
- **读配置失败统一按「已展示过」跳过本次启动**。这是有意的行为变更:现状 consent 读失败按"未问过"处理(会弹)、notice 读失败直接 return(不弹),两者不一致。统一到保守侧——读配置失败属异常态,宁可少弹一次也不重复打扰,下次启动自会重试。
- **详情子窗口**(窗口 label 前缀 `match-detail-`):`active` 恒为 `null`,守卫保留。
- **Rust 侧零改动**:`src-tauri/src/config.rs:368` 的 `BACKUP_BLACKLIST` 已含 `cloudSyncNoticeShown` 与 `errorReportingConsentShown`,不需要动。

## 测试

新增 `src/composables/useStartupDialogs.spec.ts`,沿用 `pinia/__tests__/cloudSync.spec.ts` 的 mock 骨架(mock `services/ipc`、把 `lcuConnected` mock 成可写 ref、mock `getCurrentWindow`、`vi.useFakeTimers`)。用例:

1. 新用户 → 门开后 `active === 'cloudSyncNotice'`;答「知道了」后 → `'errorReportingConsent'`
2. 答「去看看」→ `active === null`,且 `cloudSyncNoticeShown` 已写
3. 老用户(notice 已展示、consent 未问)→ 直接 `'errorReportingConsent'`
4. 两个都答过 + `pendingCloudConfig` 非空 → `'cloudConfigPull'`
5. 门控:未连接时 8s 兜底前恒 `null`;连接后满 500ms 才开门
6. `putConfigByIpc` reject 时 `active` 仍前进
7. `getConfigByIpc` reject → 该项跳过
8. 详情子窗口 → 恒 `null`

`components/common/__tests__/autoFocusDialogs.spec.ts` 不动。

## 验收

- 全新配置(两个标记均缺失)启动:首屏就绪后先看到云同步告知,点「知道了」接着看到错误上报同意,两者不叠放;
- 同上场景点「去看看」:跳到设置→数据与同步,本次启动不再弹错误上报;重启后弹错误上报;
- 老用户(两个标记均为 true)启动:无弹窗;有 `pendingCloudConfig` 时正常弹云端配置拉取;
- 未开游戏客户端时,8s 兜底后弹窗照常出现;
- `npm run check` + `npm run test` 全绿,新 spec 覆盖上述 8 条。
