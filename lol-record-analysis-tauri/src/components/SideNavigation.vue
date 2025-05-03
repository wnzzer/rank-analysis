<template>
    <n-flex justify="space-between" style="height: 90vh;" vertical>

        <n-menu :collapsed="true" :collapsed-width="60" :collapsed-icon-size="20" @update:value="handleMenuClick"
            :value="getFirstPath(router.currentRoute.value.path)" :options="menuOptions" />
        <div class="loadingIcon" style="margin-left: 13px;">

            <n-popover trigger="hover">
                <template #trigger>
                    <n-button circle @click="toMe">

                        <n-image width="20px" :src="assetPrefix + mySummoner?.profileIconKey" preview-disabled>

                            <template #error>
                                <n-icon size="20" class="rotating-icon">
                                    <Reload />
                                </n-icon>
                            </template>
                        </n-image>
                    </n-button> </template>
                <template v-if="!mySummoner || mySummoner?.tagLine == ''">
                    等待连接服务器
                </template>
                <template v-else>
                    <n-card :bordered="false" content-style="padding : 0px">
                        <n-flex>
                            <div style="position: relative;">
                                <img width="35px" height="35px" :src="assetPrefix + mySummoner?.profileIconKey">
                                <div
                                    style="position: absolute; bottom: 4px; right: 0; font-size: 10px; width: 20px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
                                    {{ mySummoner?.summonerLevel }}
                                </div>
                            </div>
                            <n-flex vertical style="gap: 0px;">
                                <n-flex>
                                    <span style="font-size: medium;font-size: 14px; font-weight: 1000;">{{
                                        mySummoner?.gameName
                                    }}</span>
                                    <n-button text style="font-size: 12px" @click="copy">
                                        <n-icon>
                                            <copy-outline></copy-outline>
                                        </n-icon>
                                    </n-button>

                                </n-flex>

                                <n-flex>
                                    <span style="color: #676768; font-size: small;">#{{ mySummoner?.tagLine
                                    }}</span>
                                    <n-icon :depth="3" color="dark" style="position: relative; top: 2px;">
                                        <server></server>
                                    </n-icon><span>{{ mySummoner?.platformIdCn }} </span>
                                </n-flex>
                            </n-flex>
                        </n-flex>
                    </n-card>
                </template>

            </n-popover>
        </div>
    </n-flex>
</template>

<script setup lang="ts">
import router from '../router';
import { getFirstPath } from '../router';
import http from '../services/http';
import { assetPrefix } from '../services/http';
import { Reload, BarChart, Server, CopyOutline, SettingsOutline } from '@vicons/ionicons5'
import { NIcon, useMessage } from 'naive-ui';
import { Component, computed, h, onMounted, ref } from 'vue';
import { defaultSummoner, Summoner } from './record/type';

onMounted(() => {
    getGetMySummoner().then(() => {
        setInterval(() => {
            getGetMySummoner();
        }, 10000);
    })
});


const mySummoner = ref<Summoner>()
async function getGetMySummoner() {
    console.log(router.currentRoute.value.path);
    try {
        const res = await http.get<Summoner>("/GetSummoner"); // 包裹在 try 中
        if (res.status === 200) {
            mySummoner.value = res.data;
            if (router.currentRoute.value.path == "/Loading") {
                router.push({
                    path: '/Record',
                });
            }
        }

    } catch (error) {
        mySummoner.value = defaultSummoner();

        // 捕获 http 请求失败的情况
        console.error("请求失败或网络异常", error);
        if (router.currentRoute.value.path != "/Loading") {
            router.push({
                path: '/Loading',
            });
        }
    }
}

function renderIcon(icon: Component) {
    return () => h(NIcon, null, { default: () => h(icon) })
}
function handleMenuClick(key: string) {
    // 跳转到对应路由
    router.push({ name: key });
}

const menuOptions = computed(() => [
    {
        label: '战绩',
        key: 'Record',
        icon: renderIcon(BarChart),
        show: !!mySummoner.value?.gameName,
    },
    {
        label: '对局',
        key: 'Gaming',
        icon: renderIcon(Reload),
        show: !!mySummoner.value?.gameName,
    },
    {
        label: '设置',
        key: 'Settings',
        icon: renderIcon(SettingsOutline),
        show: !!mySummoner.value?.gameName,
    },

]);
const toMe = () => {
    router.push({
        path: '/Record',
        query: { t: Date.now() }  // 添加动态时间戳作为查询参数
    });
}
const message = useMessage();
const copy = () => {
    navigator.clipboard.writeText(mySummoner.value?.gameName + "#" + mySummoner.value?.tagLine)
        .then(() => {
            message.success("复制成功");
        })
        .catch(() => {
            message.error("复制失败");
        });
}

</script>

<style lang="css" scoped>
.left-container {
    width: 60px;
    height: 100%;
}

@keyframes rotate {
    0% {
        transform: rotate(0deg);
    }

    100% {
        transform: rotate(360deg);
    }
}



.rotating-icon {
    animation: rotate 2s linear infinite;
}
</style>
