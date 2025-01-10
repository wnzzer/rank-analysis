<template>
    <n-card content-style="padding: 2px;" class="win-class"
        :class="{ 'defeat-class': !games.participants[0].stats.win }">
        <n-flex style="height: 6.7vh;" justify="space-between">
            <n-flex vertical style="gap: 1px;">
                <span :style="{
                    fontWeight: '600',
                    color: games.participants[0].stats.win ? '#8BDFB7' : '#BA3F53',
                    marginLeft: '4px',
                    marginTop: '2px'
                }"> {{ games.participants[0].stats.win ? '胜利' : '失败' }}
                    <n-divider style="margin: 1px 0; line-height: 1px;" />

                </span>

                <span style="color: #676768; font-size: 10px;">
                    <n-icon style="margin-right: 1px;">
                        <Time></Time>
                    </n-icon>{{ Math.ceil(games.gameDuration / 60) }}分
                </span>
            </n-flex>
            <div style="height: 100%; position: relative;">

                <img style="height: 100%;" :src="games.participants[0].championBase64" />
                <template v-if="!!games.mvp">
                    <div style="position: absolute; left: 0; bottom: 0;" class="mvp-box" :style="{backgroundColor:games.mvp == 'MVP'?'#FFD700':'#FFFFFF'}">
                    {{ games.mvp == 'MVP'? 'MVP' : 'SVP' }}
                </div>
                </template>

            </div>

            <n-flex vertical>
                <span style="font-size: 12px;font-weight: 500;">{{ games.queueName }}</span>
                <span style="color: #676768; font-size: 10px;">{{ formattedDate }}</span>
            </n-flex>

            <n-flex justify="space-between" vertical style="gap: 0px; ">
                <n-flex justify="space-between">
                    <span>
                        <span style="font-weight: 500; font-size: 13px;color: #8BDFB7">
                            {{ games.participants[0].stats?.kills }}
                        </span>
                        /
                        <span style="font-weight: 500;font-size: 13px; color: #BA3F53">
                            {{ games.participants[0].stats?.deaths }}
                        </span>
                        /
                        <span style="font-weight: 500;font-size: 13px; color: #D38B2A">
                            {{ games.participants[0].stats?.assists }}
                        </span>
                    </span>
                    <span style="margin-left: 20px;">

                        <img :src="games.participants[0].spell1Base64 ? games.participants[0].spell1Base64 : itemNull"
                            style="width: 20px;" alt="item image" />
                        <img :src="games.participants[0].spell2Base64 ? games.participants[0].spell2Base64 : itemNull"
                            style="width: 20px;" alt="item image" />

                    </span>

                </n-flex>
                <n-flex style="gap: 2px;">
                    <img :src="games.participants[0].stats?.item0Base64 ? games.participants[0].stats.item0Base64 : itemNull"
                        style="width: 20px;" alt="item image" />
                    <img :src="games.participants[0].stats?.item1Base64 ? games.participants[0].stats.item1Base64 : itemNull"
                        style="width: 20px;" alt="item image" />
                    <img :src="games.participants[0].stats?.item2Base64 ? games.participants[0].stats.item2Base64 : itemNull"
                        style="width: 20px;" alt="item image" />
                    <img :src="games.participants[0].stats?.item3Base64 ? games.participants[0].stats.item3Base64 : itemNull"
                        style="width: 20px;" alt="item image" />
                    <img :src="games.participants[0].stats?.item4Base64 ? games.participants[0].stats.item4Base64 : itemNull"
                        style="width: 20px;" alt="item image" />
                    <img :src="games.participants[0].stats?.item5Base64 ? games.participants[0].stats.item5Base64 : itemNull"
                        style="width: 20px;" alt="item image" />
                    <img :src="games.participants[0].stats?.item6Base64 ? games.participants[0].stats.item6Base64 : itemNull"
                        style="width: 20px;" alt="item image" />
                </n-flex>


            </n-flex>
            <n-flex vertical justify="space-between" style="gap: 0px;">
                <span style="color: #676768; font-size: 9px;">输出：<span style="color: #D38B2A;">{{
                    (games.participants[0].stats.totalDamageDealtToChampions / 1000).toFixed(1) }}k</span></span>
                <span style="color: #676768; font-size: 9px;">承伤：<span style="color: #BA3F53;">{{
                    (games.participants[0].stats.totalDamageTaken / 1000).toFixed(1) }}k</span></span>
                <span style="color: #676768; font-size: 9px;">治疗：<span style="color: #8BDFB7;">{{
                    (games.participants[0].stats.totalHeal / 1000).toFixed(1) }}k</span></span>

            </n-flex>
            <n-flex vertical justify="space-between" style="gap: 0px; ">

                <n-tag :bordered="false" size="small">
                    <template #avatar>
                        <n-flex>
                            <n-popover v-for="i in 5" :key="i" trigger="hover">
                                <template #trigger>
                                    <n-button text
                                        @click="toNameRecord(games.gameDetail.participantIdentities[i - 1].player.gameName + '#' + games.gameDetail.participantIdentities[i - 1].player.tagLine)">
                                        <n-avatar :bordered="true"
                                            :src="games.gameDetail.participants[i - 1]?.championBase64"
                                            :style="{ borderColor: getIsMeBorderedColor(games.gameDetail.participantIdentities[i - 1]?.player.gameName + '#' + games.gameDetail.participantIdentities[i - 1]?.player.tagLine) }" />
                                    </n-button>
                                </template>
                                <span>{{ games.gameDetail.participantIdentities[i - 1].player.gameName + "#" +
                                    games.gameDetail.participantIdentities[i
                                    - 1].player.tagLine }}</span>
                            </n-popover>
                        </n-flex>
                    </template>
                </n-tag>

                <n-tag :bordered="false" size="small">
                    <template #avatar>
                        <n-flex>
                            <n-popover v-for="i in 5" :key="i + 5" trigger="hover">
                                <template #trigger>
                                    <n-button text
                                        @click="toNameRecord(games.gameDetail.participantIdentities[i + 4].player.gameName + '#' + games.gameDetail.participantIdentities[i + 4].player.tagLine)">
                                        <!-- 这里确保不会访问越界 -->
                                        <n-avatar :bordered="true"
                                            :src="games.gameDetail.participants[i + 4]?.championBase64"
                                            :style="{ borderColor: getIsMeBorderedColor(games.gameDetail.participantIdentities[i + 4]?.player.gameName + '#' + games.gameDetail.participantIdentities[i + 4]?.player.tagLine) }" />
                                    </n-button>
                                </template>
                                <span>{{ games.gameDetail.participantIdentities[i + 4].player.gameName + "#" +
                                    games.gameDetail.participantIdentities[i + 4].player.tagLine }}</span>
                            </n-popover>
                        </n-flex>
                    </template>
                </n-tag>


            </n-flex>
        </n-flex>
    </n-card>
</template>


<script lang="ts" setup>
import { Time } from '@vicons/ionicons5';
import itemNull from '@renderer/assets/imgs/item/null.png';
import { computed } from 'vue';
import { Game, MatchHistory } from './MatchHistory.vue';
import { useRouter } from 'vue-router';

const router = useRouter();
// 接收 props
const props = defineProps<{
    recordType?: boolean; // 确保这里是 boolean 类型
    games: Game;
}>();


const formattedDate = computed(() => {
    const date = new Date(props.games.gameCreationDate);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');  // 月份从0开始，所以加1
    const day = date.getDate().toString().padStart(2, '0');  // 确保两位数格式
    return `${year}/${month}/${day}`;
});

function getIsMeBorderedColor(name: string) {
    if (name == props.games.participantIdentities[0].player.gameName + "#" + props.games.participantIdentities[0].player.tagLine) {
        return '#63e2b7';
    } else {
        return '#000000'
    }
}
function toNameRecord(name: string) {
    return router.push({
        path: '/Record',
        query: { name, t: Date.now() }
    })  // 添加动态时间戳作为查询参数
}

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



.win-class {
    /* 默认的边框颜色 */
    --n-border: 1px solid #63e2b7;
    /* 静态绿色边框 */
    --n-border-hover: 1px solid #7fe7c4;
    /* 悬停时的绿色边框 */
    --n-border-pressed: 1px solid #5acea7;

    /* 添加平滑过渡效果 */
    transition: border-color 0.3s ease, color 0.3s ease;
    /* 为边框颜色和文本颜色添加过渡 */
}

.defeat-class {
    /* 默认的边框颜色 */
    --n-border: 1px solid #BA3F53;
    /* 静态绿色边框 */
    --n-border-hover: 1px solid #BA3F53;
    /* 悬停时的绿色边框 */
    --n-border-pressed: 1px solid #BA3F53;

    /* 添加平滑过渡效果 */
    transition: border-color 0.3s ease, color 0.3s ease;
    /* 为边框颜色和文本颜色添加过渡 */
}

.bordered {
    border: red;
    /* 边框宽度2px，实线，红色 */

}


.win-class:hover {
    border: var(--n-border-hover);
}

.win-class:active {
    border: var(--n-border-pressed);
}

.win-class:focus {
    border: var(--n-border-focus);
}

.win-class:disabled {
    border: var(--n-border-disabled);
}
.mvp-box {
  display: inline-block;
  width: 20px; /* 调整宽度 */
  height: 10px; /* 调整高度 */
  color: #000; /* 黑色字体 */
  font-weight: bold; /* 字体加粗 */
  font-size: 8px; /* 小字体 */
  line-height: 10px; /* 垂直居中 */
  text-align: center; /* 水平居中 */
  border-radius: 2px; /* 圆角 */
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2); /* 添加阴影效果 */
}
</style>