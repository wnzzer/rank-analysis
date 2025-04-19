<template>
    <n-flex justify="space-between" style="width: 100%; ">
        <div style="width: 33%; text-align: left;">
            <img src="../assets/logo.png" alt="Logo"
                style="margin-left: 10px;margin-top: 5px; height: 25px; display: inline-block;">
            <span class="clip" style="margin-left: 10px; margin-top:10px; vertical-align: top;">Rank Analysis</span>
        </div>
        <div style="flex: 1;width: 33%;; text-align: center;">
            <n-input class="input-lolid" type="text" size="tiny" placeholder="输入召唤师" v-model:value="value"
                @keyup.enter="onClinkSearch">
                <template #suffix>
                    <n-button text @click="onClinkSearch">
                        <n-icon :component="Search" />
                    </n-button>
                </template>
            </n-input>
        </div>
        <div style="width: 33%; ">

            <n-tooltip trigger="hover">
                <template #trigger>
                    <n-button @click="openGithubLink" text
                        style="-webkit-app-region: no-drag;font-size: 20px;transform: translateY(4px);">
                        <n-icon>
                            <logo-github></logo-github>
                        </n-icon>
                    </n-button> </template>
                访问 wnzzer 的项目主页
            </n-tooltip>
            <n-divider vertical />
            <n-switch :value="themeSwitch" @click="settingsStore.toggleTheme()" size="small"
                style="margin-right: 10px;">
                <template #checked>
                    <n-icon>
                        <sunny-outline />

                    </n-icon>
                </template>
                <template #unchecked>
                    <n-icon>
                        <moon-outline />


                    </n-icon>
                </template>
            </n-switch>
            <div class="window-controls">
                <n-button text @click="minimizeWindow" class="window-control-btn">
                    <n-icon><remove-outline /></n-icon>
                </n-button>
                <n-button text @click="maximizeWindow" class="window-control-btn">
                    <n-icon><square-outline /></n-icon>
                </n-button>
                <n-button text @click="closeWindow" class="window-control-btn close-btn">
                    <n-icon><close-outline /></n-icon>
                </n-button>
            </div>
        </div>
    </n-flex>
</template>
<script lang="ts" setup>
import router from '../router';
import { Search, LogoGithub, RemoveOutline, SquareOutline, CloseOutline, SunnyOutline, MoonOutline } from '@vicons/ionicons5';
import { computed, ref } from 'vue';
import { Window } from '@tauri-apps/api/window';
import { useSettingsStore } from '@renderer/pinia/setting';
import { darkTheme } from 'naive-ui';
const currentWindow = Window.getCurrent();

const openGithubLink = () => {
    window.open('https://github.com/wnzzer/rank-analysis', '_blank')
}

const value = ref('');
const settingsStore = useSettingsStore()
const themeSwitch = computed(() => {
    return settingsStore.theme.name !== darkTheme.name
})

function onClinkSearch() {
    router.push({
        path: '/Record',
        query: { name: value.value, t: Date.now() }  // 添加动态时间戳作为查询参数
    }).then(() => {
        value.value = '';
    });
}

const minimizeWindow = () => {
    currentWindow.minimize();
}

const maximizeWindow = () => {
    currentWindow.toggleMaximize();
}

const closeWindow = () => {
    currentWindow.close();
}
</script>
<style lang="css">
.input-lolid {
    -webkit-app-region: no-drag;
    pointer-events: auto;
}

.clip {
    background: linear-gradient(120deg, hwb(189 2% 6%) 30%, hsl(30deg, 100%, 50%));
    color: transparent;
    background-clip: text;
    font-weight: 900;
}

.window-controls {
    display: inline-flex;
    align-items: center;
    -webkit-app-region: no-drag;
    float: right;
    margin-right: 8px;
}

.window-control-btn {
    padding: 8px 12px;
    font-size: 16px;
    color: #666;
    border-radius: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    position: relative;
}

.window-control-btn:hover {
    background-color: rgba(0, 0, 0, 0.1);
}

.close-btn:hover {
    background-color: #ff4d4f;
    color: white;
}

/* 增加按钮的点击区域 */
.window-control-btn::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
}
</style>