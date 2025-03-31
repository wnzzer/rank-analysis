<template>
    <n-layout>
        <n-layout has-sider>

            <n-layout-sider bordered collapse-mode="width" :collapsed-width="64" :width="240" :show-trigger="false"
                :collapsed="collapsed">
                <n-menu :value="router.currentRoute.value.name" :collapsed="collapsed" :collapsed-width="64"
                    :collapsed-icon-size="22" :options="menuOptions" @update:value="handleMenuSelect" />
            </n-layout-sider>
            <n-layout-content content-style="padding: 24px;">
                <n-notification-provider>

                <router-view></router-view>
                </n-notification-provider>
            </n-layout-content>
        </n-layout>
    </n-layout>
</template>

<script setup lang="ts">
import { h, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NIcon } from 'naive-ui'
import {
    FlashOutline,
    // BulbOutline
    AlertCircleOutline
} from '@vicons/ionicons5'

const collapsed = ref(false)
const router = useRouter()

function renderIcon(icon: any) {
    return () => h(NIcon, null, { default: () => h(icon) })
}

function handleMenuSelect(key: string) {
    router.push({ name: key })
}

const menuOptions = [
    {
        label: '自动化',
        key: 'Automation',
        icon: renderIcon(FlashOutline)
    },
    // {
    //     label: 'AI能力',
    //     key: 'ai-capabilities',
    //     icon: renderIcon(BulbOutline)
    // }
    {
        label: '关于我们',
        key: 'About',
        icon: renderIcon(AlertCircleOutline)
    }
]
</script>

<style scoped>
.n-layout {
    height: 100%;
}
</style>