<template>
    <n-layout>
        <n-layout has-sider >
            
            <n-layout-sider
                bordered
                collapse-mode="width"
                :collapsed-width="64"
                :width="240"
                :show-trigger="false"
                :collapsed="collapsed"
            >
                <n-menu
                    :collapsed="collapsed"
                    :collapsed-width="64"
                    :collapsed-icon-size="22"
                    :options="menuOptions"
                />
            </n-layout-sider>
            <n-layout-content content-style="padding: 24px;">
                <router-view></router-view>
            </n-layout-content>
        </n-layout>
    </n-layout>
</template>

<script setup lang="ts">
import { h, ref } from 'vue'
import { NIcon } from 'naive-ui'
import { 
    FlashOutline,
    BulbOutline
} from '@vicons/ionicons5'

const collapsed = ref(false)

function renderIcon(icon: any) {
    return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions = [
    {
        label: '自动化',
        key: 'automation',
        icon: renderIcon(FlashOutline)
    },
    {
        label: 'AI能力',
        key: 'ai-capabilities',
        icon: renderIcon(BulbOutline)
    }
]
</script>

<style scoped>
.n-layout {
    height: 100%;
}


</style>