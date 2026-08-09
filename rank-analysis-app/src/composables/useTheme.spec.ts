/**
 * useTheme composable 单元测试
 * @module composables/useTheme
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useTheme } from './useTheme'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '@renderer/pinia/setting'

describe('useTheme', () => {
  beforeEach(() => {
    // 每个测试前重置 Pinia 状态
    setActivePinia(createPinia())
  })

  describe('isDark', () => {
    /**
     * 测试：当主题为 'Dark' 时应返回 true
     */
    it('should return true when theme is Dark', () => {
      // Arrange
      const store = useSettingsStore()
      store.theme = { name: 'Dark' } as any

      // Act
      const { isDark } = useTheme()

      // Assert
      expect(isDark.value).toBe(true)
    })

    /**
     * 测试：当主题为 'dark'（小写）时应返回 true
     */
    it('should return true when theme is dark (lowercase)', () => {
      // Arrange
      const store = useSettingsStore()
      store.theme = { name: 'dark' } as any

      // Act
      const { isDark } = useTheme()

      // Assert
      expect(isDark.value).toBe(true)
    })

    /**
     * 测试：当主题为 'Light' 时应返回 false
     */
    it('should return false when theme is Light', () => {
      // Arrange
      const store = useSettingsStore()
      store.theme = { name: 'Light' } as any

      // Act
      const { isDark } = useTheme()

      // Assert
      expect(isDark.value).toBe(false)
    })

    /**
     * 测试：当主题未设置时应返回 false
     */
    it('should return false when theme is undefined', () => {
      // Arrange
      const store = useSettingsStore()
      store.theme = undefined as any

      // Act
      const { isDark } = useTheme()

      // Assert
      expect(isDark.value).toBe(false)
    })
  })

  describe('isLight', () => {
    /**
     * 测试：isLight 应与 isDark 相反
     */
    it('should be opposite of isDark', () => {
      // Arrange
      const store = useSettingsStore()
      store.theme = { name: 'Dark' } as any

      // Act
      const { isDark, isLight } = useTheme()

      // Assert
      expect(isLight.value).toBe(!isDark.value)
    })
  })

  describe('themeName', () => {
    /**
     * 测试：应返回当前主题名称
     */
    it('should return current theme name', () => {
      // Arrange
      const store = useSettingsStore()
      store.theme = { name: 'CustomTheme' } as any

      // Act
      const { themeName } = useTheme()

      // Assert
      expect(themeName.value).toBe('CustomTheme')
    })

    /**
     * 测试：主题未设置时应返回默认值 'dark'
     */
    it('should return default "dark" when theme is undefined', () => {
      // Arrange
      const store = useSettingsStore()
      store.theme = undefined as any

      // Act
      const { themeName } = useTheme()

      // Assert
      expect(themeName.value).toBe('dark')
    })
  })

  describe('reactivity', () => {
    /**
     * 测试：主题变化时 isDark 应自动更新
     */
    it('should react to theme changes', () => {
      // Arrange
      const store = useSettingsStore()
      store.theme = { name: 'Light' } as any
      const { isDark } = useTheme()

      // 初始状态
      expect(isDark.value).toBe(false)

      // Act: 改变主题
      store.theme = { name: 'Dark' } as any

      // Assert
      expect(isDark.value).toBe(true)
    })
  })
})
