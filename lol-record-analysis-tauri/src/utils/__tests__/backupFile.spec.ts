import { describe, it, expect } from 'vitest'
import { isBackupFileV2 } from '../backupFile'

const valid = {
  version: 2,
  type: 'rank-analysis-backup',
  exportedAt: 1783700000000,
  playerNotes: {},
  appConfig: { theme: { value: 'dark' } }
}

describe('isBackupFileV2', () => {
  it('合法 v2 文件通过', () => {
    expect(isBackupFileV2(valid)).toBe(true)
  })

  it('v1(无 appConfig)拒绝——未发版,无兼容分支', () => {
    expect(isBackupFileV2({ version: 1, type: 'rank-analysis-backup', playerNotes: {} })).toBe(
      false
    )
    expect(isBackupFileV2({ ...valid, version: 1 })).toBe(false)
  })

  it('容器形状不对拒绝(null/数组/原始值字段)', () => {
    expect(isBackupFileV2(null)).toBe(false)
    expect(isBackupFileV2([valid])).toBe(false)
    expect(isBackupFileV2({ ...valid, playerNotes: [1] })).toBe(false)
    expect(isBackupFileV2({ ...valid, appConfig: null })).toBe(false)
    expect(isBackupFileV2({ ...valid, type: 'other' })).toBe(false)
    expect(isBackupFileV2({ ...valid, exportedAt: 'abc' })).toBe(false)
    expect(isBackupFileV2({ ...valid, exportedAt: undefined })).toBe(false)
  })
})
