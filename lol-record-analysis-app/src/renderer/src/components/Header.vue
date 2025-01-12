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
        </div>
    </n-flex>
</template>
<script lang="ts" setup>
import router from '@renderer/router';
import { Search, LogoGithub } from '@vicons/ionicons5';
import { ref } from 'vue';

const openGithubLink = () => {
    (window.api as { OpenGithub: () => void }).OpenGithub(); // 类型断言
};

const value = ref('');
function onClinkSearch() {
    router.push({
        path: '/Record',
        query: { name: value.value, t: Date.now() }  // 添加动态时间戳作为查询参数
    }).then(() => {
        value.value = '';
    });
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
</style>