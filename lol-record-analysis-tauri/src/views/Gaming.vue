<template>
    <template v-if="!sessionData.phase">
        <LoadingComponent>等待加入游戏...</LoadingComponent>
    </template>
    <template v-else>
        <div>
            <n-flex justify="space-between" style="height: 93vh;;">
                <!-- 左侧部分 -->

                <n-flex vertical justify="space-between" style="gap: 0; flex: 1; height: 100%;">
                    <PlayerCard v-for="(sessionSummoner, i) of sessionData.teamOne" :key="'teamOne' + i"
                        :session-summoner="sessionSummoner" :mode-type="sessionData.type" :type-cn="sessionData.typeCn"
                        :img-url="comImgTier.teamOne[i]?.imgUrl" :tier-cn="comImgTier.teamOne[i]?.tierCn"></PlayerCard>
                </n-flex>

                <!-- 右侧部分 -->
                <n-flex vertical justify="space-between" style="gap: 0; flex: 1; height: 100%;">
                    <n-flex vertical justify="space-between" style="gap: 0; flex: 1; height: 100%;">
                        <PlayerCard v-for="(sessionSummoner, i) of sessionData.teamTwo" :key="'teamTwo' + i"
                            :session-summoner="sessionSummoner" :mode-type="sessionData.type"
                            :type-cn="sessionData.typeCn" :img-url="comImgTier.teamTwo[i]?.imgUrl"
                            :tier-cn="comImgTier.teamTwo[i]?.tierCn"></PlayerCard>
                    </n-flex>
                </n-flex>
            </n-flex>
        </div>
    </template>
</template>

<script lang="ts" setup>

import { computed, onMounted, onUnmounted, reactive } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

import unranked from '../assets/imgs/tier/unranked.png';
import bronze from '../assets/imgs/tier/bronze.png';
import silver from '../assets/imgs/tier/silver.png';
import gold from '../assets/imgs/tier/gold.png';
import platinum from '../assets/imgs/tier/platinum.png';
import diamond from '../assets/imgs/tier/diamond.png';
import master from '../assets/imgs/tier/master.png';
import grandmaster from '../assets/imgs/tier/grandmaster.png';
import challenger from '../assets/imgs/tier/challenger.png';
import iron from '../assets/imgs/tier/iron.png';
import emerald from '../assets/imgs/tier/emerald.png';
import LoadingComponent from '../components/LoadingComponent.vue';
import PlayerCard from '../components/gaming/PlayerCard.vue';
import { SessionData } from '../components/gaming/type';
import { divisionOrPoint } from '../components/composition';
/**
* Returns the image path for the given rank tier.
* This function dynamically requires the image based on the provided tier string,
* converting it to lowercase to ensure correct file name matching.
*
* @param {string} tier - The rank tier to get the image for.
* @returns {string} - The path to the rank tier image.
*/
interface ComImgTier {
    teamOne: { imgUrl: string, tierCn: string }[];
    teamTwo: { imgUrl: string, tierCn: string }[];
}

const comImgTier = computed(() => {
    const comImgTier: ComImgTier = {
        teamOne: [],
        teamTwo: [],
    };


    const tierImages: { [key: string]: any } = {
        unranked: unranked,
        bronze: bronze,
        silver: silver,
        gold: gold,
        platinum: platinum,
        diamond: diamond,
        master: master,
        grandmaster: grandmaster,
        challenger: challenger,
        iron: iron,
        emerald: emerald,
    };

    // 处理 teamOne
    for (const sessionSummoner of sessionData.teamOne) {
        let tierNormalized = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier
            ? tierImages[sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase()]
            : unranked;

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier) {
            tierNormalized = tierImages[sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase()];
        }


        let tierCn = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn
            ? sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn.slice(-2) + " " + divisionOrPoint(sessionSummoner.rank.queueMap.RANKED_SOLO_5x5)
            : '无';

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn) {
            tierCn = sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn.slice(-2) + " " + divisionOrPoint(sessionSummoner.rank.queueMap.RANKED_FLEX_SR);
        }


        comImgTier.teamOne.push({
            imgUrl: tierNormalized,
            tierCn: tierCn,
        });
    }

    // 处理 teamTwo
    for (const sessionSummoner of sessionData.teamTwo) {
        let tierNormalized = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier
            ? tierImages[sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase()]
            : unranked;

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier) {
            tierNormalized = tierImages[sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tier.toLocaleLowerCase()];
        }


        let tierCn = sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn
            ? sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn.slice(-2) + " " + divisionOrPoint(sessionSummoner.rank.queueMap.RANKED_SOLO_5x5)
            : '无';

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn) {
            tierCn = sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn.slice(-2) + " " + divisionOrPoint(sessionSummoner.rank.queueMap.RANKED_FLEX_SR);
        }


        comImgTier.teamTwo.push({
            imgUrl: tierNormalized,
            tierCn: tierCn,
        });
    }

    return comImgTier;
});

const sessionData = reactive<SessionData>(
    {
        phase: "",
        type: "",
        typeCn: "",
        teamOne: [],
        teamTwo: [],

    },

);

let unlistenSessionComplete: (() => void) | null = null;
let unlistenPlayerUpdateTeamOne: (() => void) | null = null;
let unlistenPlayerUpdateTeamTwo: (() => void) | null = null;
let unlistenSessionError: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
    // 监听 session 完成事件
    unlistenSessionComplete = await listen<SessionData>('session-complete', (event) => {
        const data = event.payload;
        console.log('📦 Session complete:', data);
        
        if (data.phase) {
            sessionData.phase = data.phase;
            sessionData.type = data.type;
            sessionData.typeCn = data.typeCn;
            sessionData.teamOne = Array.isArray(data.teamOne) ? data.teamOne : [];
            sessionData.teamTwo = Array.isArray(data.teamTwo) ? data.teamTwo : [];
        }
    });

    // 监听玩家更新事件（队伍一）
    unlistenPlayerUpdateTeamOne = await listen('session-player-update-team-one', (event: any) => {
        const { index, total, player } = event.payload;
        console.log(`✅ Player ${index + 1}/${total} (Team One) loaded:`, player.summoner.gameName);
    });

    // 监听玩家更新事件（队伍二）
    unlistenPlayerUpdateTeamTwo = await listen('session-player-update-team-two', (event: any) => {
        const { index, total, player } = event.payload;
        console.log(`✅ Player ${index + 1}/${total} (Team Two) loaded:`, player.summoner.gameName);
    });

    // 监听错误事件
    unlistenSessionError = await listen<string>('session-error', (event) => {
        console.error('❌ Session error:', event.payload);
    });

    // 第一次请求
    await requestSessionData();

    // 启动定时器，每5秒刷新一次
    refreshTimer = setInterval(async () => {
        await requestSessionData();
    }, 5000);

    console.log('✅ Gaming page mounted, event listeners registered');
});

onUnmounted(() => {
    // 清理所有事件监听器
    if (unlistenSessionComplete) {
        unlistenSessionComplete();
    }
    if (unlistenPlayerUpdateTeamOne) {
        unlistenPlayerUpdateTeamOne();
    }
    if (unlistenPlayerUpdateTeamTwo) {
        unlistenPlayerUpdateTeamTwo();
    }
    if (unlistenSessionError) {
        unlistenSessionError();
    }

    // 清理定时器
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    console.log('🧹 Gaming page unmounted, cleaned up listeners');
});

async function requestSessionData() {
    try {
        // 调用 Tauri 命令，后端会通过事件推送数据
        await invoke('get_session_data');
    } catch (error) {
        console.error('Failed to request session data:', error);
    }
}


</script>
<style lang="css" scoped>
.champion-img {
    width: 100%;
    ;
    /* 限制图片宽度不超过容器 */
    height: 100%;
    /* 限制图片高度不超过容器 */
    object-fit: cover;
    /* 保持图片的比例并裁剪溢出的部分 */
    display: inline-block;

}

.stats-title {
    font-weight: bold;
}

.stats-item {
    display: flex;
    justify-content: space-between;
}

.stats-label {
    font-size: 10px;

    color: #ccc;
}

.stats-value {
    font-size: 10px;
    color: #ffffff;
    /* 绿色表示积极数据 */
}

.recent-card {
    background: #28282B;
    /* 半透明背景 */
    border-radius: 8px;
    /* 圆角边框 */
    color: #fff;
    /* 白色字体 */
}
</style>
