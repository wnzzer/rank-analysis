import { defineStore } from "pinia"
import { ref } from "vue"
import { darkTheme, lightTheme } from 'naive-ui'

export const useSettingsStore = defineStore('settings', () => {
    const theme = ref(darkTheme)

    // 方法用于切换主题
    function toggleTheme() {
        if (theme.value.name == 'dark') {
            theme.value = lightTheme
        } else {
            theme.value = darkTheme
        }
    }

    return {
        theme,
        toggleTheme
    }
})
