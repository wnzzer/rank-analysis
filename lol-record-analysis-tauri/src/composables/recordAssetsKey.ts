/**
 * 父级（MatchHistory）批量预加载的战绩资源，通过 provide/inject 分发给子级 RecordCard
 * 避免每张卡片各自发 3 次 IPC
 */

import type { InjectionKey } from 'vue'
import type { useRecordAssets } from './useRecordAssets'

export type RecordAssetsApi = ReturnType<typeof useRecordAssets>

export const recordAssetsKey: InjectionKey<RecordAssetsApi> = Symbol('recordAssets')
