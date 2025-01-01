<template>
    <n-card content-style="padding: 1px;" class="some-class">
        <n-flex style="height: 100%;">
            <n-flex vertical>
                <span style="font-weight: 600; color: #8BDFB7; margin-left: 4px; margin-top: 2px;">胜利</span>

                <span style="color: #676768; font-size: 10px;">
                    <n-icon style="margin-right: 1px;">
                        <Time></Time>
                    </n-icon>46分</span>
            </n-flex>
            <n-image width="50" :src="championBase64" preview-disabled />
            <n-flex vertical>
                <span>单双排</span>
                <span style="color: #676768; font-size: 10px;">2025/1/2</span>
            </n-flex>
        </n-flex>
    </n-card>
</template>

<script lang="ts" setup>
import { Time } from '@vicons/ionicons5';

// 接收 props
const props = defineProps<{
    recordType?: true | false
    championBase64: string
}>();


</script>

<style scoped>
/* 默认背景颜色，避免没有 recordType 时出现空白 */
.record-card {
    background: linear-gradient(120deg, rgb(133, 133, 133) 30%, rgba(44, 44, 44, 0.5));
}

.win-font {
    color: #03c2f7;
    font-weight: 300;
    font-size: small;
}


.responsive-img {
    width: auto;
    /* 保持宽高比 */
    object-fit: contain;
    /* 根据需求可以选择 contain, cover 等 */
}

.red-border-card {
    border: 2px solid #4caf50;
    /* 成功绿色边框 */
    box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
    /* 绿色阴影效果 */
}

.some-class {
    /* 默认的边框颜色 */
    --n-border: 1px solid #63e2b7;
    /* 静态绿色边框 */
    --n-border-hover: 1px solid #7fe7c4;
    /* 悬停时的绿色边框 */
    --n-border-pressed: 1px solid #5acea7;
    /* 按下时的绿色边框 */
    --n-border-focus: 1px solid #7fe7c4;
    /* 聚焦时的绿色边框 */
    --n-border-disabled: 1px solid #63e2b7;
    /* 禁用状态下的绿色边框 */
    --n-text-color: #63e2b7;
    /* 绿色文本颜色 */
    --n-text-color-hover: #7fe7c4;
    /* 悬停时的文本颜色 */
    --n-text-color-pressed: #5acea7;
    /* 按下时的文本颜色 */
    --n-text-color-focus: #7fe7c4;
    /* 聚焦时的文本颜色 */
    --n-text-color-disabled: #63e2b7;
    /* 禁用状态下的文本颜色 */
    --n-ripple-color: #63e2b7;
    /* 涟漪效果的绿色 */

    /* 添加平滑过渡效果 */
    transition: border-color 0.3s ease, color 1s ease;
    /* 为边框颜色和文本颜色添加过渡 */
}

.some-class:hover {
    border: var(--n-border-hover);
}

.some-class:active {
    border: var(--n-border-pressed);
}

.some-class:focus {
    border: var(--n-border-focus);
}

.some-class:disabled {
    border: var(--n-border-disabled);
}
</style>