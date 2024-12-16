<template>
    <n-flex justify="space-between" style="width: 100%; ">
        <div style="width: 33%; text-align: left;">
            <img src="../assets/logo.png" alt="Logo"
                style="margin-left: 10px;margin-top: 5px; height: 25px; display: inline-block;">
        </div>
        <div style="flex: 1;width: 33%;; text-align: center;">
            <n-input class="input-lolid" type="text" size="tiny" placeholder="输入召唤师">
                <template #suffix>
                    <n-icon :component="Search" />
                </template>
            </n-input>
        </div>
        <div style="width: 33%; ">


            <n-tooltip trigger="hover">
                <template #trigger>
                    <n-button @click="openGithubLink" text style="-webkit-app-region: no-drag;font-size: 20px;transform: translateY(4px);">
                        <n-icon >
                            <logo-github></logo-github>
                        </n-icon>
                    </n-button> </template>
                访问 wnzzer 的项目主页
            </n-tooltip>
            <n-divider vertical />
        </div>
    </n-flex>
</template>
<script lang="ts" setup>
import { Search, LogoGithub } from '@vicons/ionicons5';

const openGithubLink = () => {
    window.api.OpenGithub();  // 调用暴露的 OpenGithub 方法
}
</script>
<style lang="css">
.input-lolid {
    -webkit-app-region: no-drag;
    pointer-events: auto;
}
</style>