/**
 * 入库的基准库与阈值（scripts/baseline 构建产物，随 app 打包）。
 * JSON 由构建脚本保证形状；这里只做类型标注。
 */
import baselineJson from '@renderer/data/baseline/baseline.json'
import thresholdsJson from '@renderer/data/baseline/thresholds.json'
import type { Baseline } from './baseline'
import type { Thresholds } from './thresholds'

export const BASELINE = baselineJson as unknown as Baseline
export const THRESHOLDS = thresholdsJson as unknown as Thresholds
