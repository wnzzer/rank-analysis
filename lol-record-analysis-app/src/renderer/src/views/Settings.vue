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
                    @update:value="selectedKey = $event"
                />
            </n-layout-sider>
            <n-layout-content content-style="padding: 24px;">
                <component :is="currentComponent"></component>
            </n-layout-content>
        </n-layout>
    </n-layout>
</template>

<script setup lang="ts">
import { h, ref, computed } from 'vue'
import { NIcon } from 'naive-ui'
import { 
    FlashOutline,
    BulbOutline
} from '@vicons/ionicons5'
import Automation from '../components/settings/Automation.vue'

const collapsed = ref(false)
const selectedKey = ref('automation')

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

const currentComponent = computed(() => {
    switch (selectedKey.value) {
        case 'automation':
            return Automation
        // case 'ai-capabilities':
        //     return AICapabilities
        default:
            return null
    }
})
</script>

<style scoped>

.n-layout {
    height: 100%;
}


</style>