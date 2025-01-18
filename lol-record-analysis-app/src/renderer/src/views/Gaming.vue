<template>
    <template v-if="!sessionData.phase">
        <div
            style="display: flex; justify-content: center; align-items: center; height: 80vh; width: 80vw; border: 1px solid black;">

            <div style="position: relative;">
                <span class="clip">等待加入对局 </span>
                <span> <!-- 渲染图标 -->
                    <n-icon size="20" class="rotating-icon" style="position: relative; top: 2px;;">
                        <Reload />
                    </n-icon></span>
            </div>

        </div>
    </template>
    <template v-else>
        <div>
            <n-flex justify="space-between" style="height: 93vh; overflow: hidden;">
                <!-- 左侧部分 -->

                <n-flex vertical justify="space-between" style="gap: 0; flex: 1; height: 100%;">
                    <n-card v-for="i in 5" :key="i" style="flex: 1; height: 100%;" content-style="padding: 0;">
                        <div v-if="!sessionData.teamOne || !sessionData.teamOne[i - 1] || !sessionData.teamOne[i - 1].championBase64"
                            style="position: relative; width: 100%; height: 100%;">
                            <n-spin size="small"
                                style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);" />
                        </div>

                        <n-flex v-else>
                            <!-- 左侧卡片内容 -->
                            <n-flex vertical justify="space-between" style="flex: 3; gap: 4px;">
                                <!-- 个人概览 -->
                                <n-card :bordered="false" content-style="padding: 0;">
                                    <n-flex>
                                        <div style="position: relative;">
                                            <img width="33px" height="33px"
                                                :src="sessionData.teamOne[i - 1]?.championBase64" />
                                            <div
                                                style="position: absolute; bottom: 12px; right: 0; font-size: 10px; width: 20px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
                                                {{ sessionData.teamOne[i - 1]?.summoner.summonerLevel }}
                                            </div>
                                        </div>
                                        <n-flex vertical style="gap: 0;">
                                            <n-flex>
                                                <n-button text>

                                                    <n-button text
                                                        @click="searchSummoner(sessionData.teamOne[i - 1]?.summoner.gameName + '#' + sessionData.teamOne[i - 1]?.summoner.tagLine)">
                                                        <n-ellipsis style="max-width: 88px">
                                                            <span style="font-size: 11px; font-weight: bold;">
                                                                {{ sessionData.teamOne[i - 1]?.summoner.gameName }}
                                                            </span> </n-ellipsis>

                                                    </n-button>
                                                </n-button>

                                            </n-flex>

                                            <n-flex style="gap: 5px;">
                                                <span style="color: #676768; font-size: 11px;">
                                                    #{{ sessionData.teamOne[i - 1]?.summoner.tagLine }}
                                                </span>
                                                <n-button text style="font-size: 12px; position: relative; bottom: 2px;"
                                                    @click="copy(sessionData.teamOne[i - 1].summoner.gameName + '#' + sessionData.teamOne[i - 1].summoner.tagLine)">
                                                    <n-icon>
                                                        <copy-outline></copy-outline>
                                                    </n-icon>
                                                </n-button>
                                                <span>
                                                    <img style="width: 16px;height: 16px;"
                                                        :src="comImgTier.teamOne[i - 1].imgUrl" />
                                                    <span style="font-size: 8px;">{{ comImgTier.teamOne[i - 1].tierCn
                                                        }}</span>
                                                </span>

                                            </n-flex>
                                        </n-flex>
                                    </n-flex>
                                </n-card>
                                <!-- 战绩 -->


                                <div>
                                    <n-card v-for="game in sessionData.teamOne[i - 1]?.matchHistory.games.games"
                                        content-style="padding: 0;" footer-style="padding:0">
                                        <n-flex justify="space-between" style="gap: 0px; align-items: center;">
                                            <span :style="{
                                                fontWeight: '600',
                                                color: game.participants[0].stats.win ? '#8BDFB7' : '#BA3F53',


                                            }"> {{ game.participants[0].stats.win ? '胜' : '负' }}

                                            </span>
                                            <img :src="game.participants[0]?.championBase64"
                                                style="width: auto; height: 24px;       vertical-align: middle;" />
                                            <span style=" font-size: 12px;">
                                                <span style="font-weight: 500; font-size: 12px;color: #8BDFB7">
                                                    {{ game.participants[0].stats?.kills }}
                                                </span>
                                                /
                                                <span style="font-weight: 500;font-size: 12px; color: #BA3F53">
                                                    {{ game.participants[0].stats?.deaths }}
                                                </span>
                                                /

                                                <span style="font-weight: 500;font-size: 12px; color: #D38B2A">
                                                    {{ game.participants[0].stats?.assists }}
                                                </span>

                                            </span>
                                            <span style="font-size: 8px;margin-right: 3px;">
                                                {{ game.queueName ? game.queueName : '其他' }}
                                            </span>

                                        </n-flex>
                                    </n-card>
                                </div>
                            </n-flex>

                            <!-- 中间部分 -->
                            <div style="flex: 5;">
                                <flex vertical style="gap: 0px;">
                                    <div style="margin-bottom: 2px; margin-top: 3px;">

                                        <n-flex>
                                            <span style="visibility: hidden;">
                                                s
                                            </span>
                                            <n-tooltip trigger="hover"
                                                v-for="tag in sessionData.teamOne[i - 1]?.userTag.tag">
                                                <template #trigger>
                                                    <n-button size="tiny" :type="tag.good ? 'primary' : 'error'">
                                                        {{ tag.tagName }}
                                                    </n-button> </template>
                                                <span>{{ tag.tagDesc }}</span>
                                            </n-tooltip>


                                        </n-flex>
                                    </div>
                                    <!-- 20场统计 -->
                                    <n-card class="recent-card" :bordered="false" content-style="padding:5px">
                                        <n-flex vertical style="position: relative; gap: 5px; ">

                                            <n-flex class="stats-item" justify="space-between">

                                                <span class="stats-label">
                                                    <n-flex style="gap: 5px;">
                                                        <n-progress
                                                            style=" width: 10px; position: relative; bottom: 5px; "
                                                            type="circle" :show-indicator="false" :percentage="70"
                                                            :height="24" status="success" color="bule" />

                                                        <span>KDA:</span>
                                                    </n-flex>
                                                </span>
                                                <span class="stats-value">
                                                    <n-flex>
                                                        <span
                                                            :style="{ color: kdaColor(sessionData.teamOne[i - 1]?.userTag.recentData.kda) }">{{
                                                                sessionData.teamOne[i - 1]?.userTag.recentData.kda
                                                            }}</span>
                                                        <span>
                                                            <span
                                                                :style="{ color: killsColor(sessionData.teamOne[i - 1]?.userTag.recentData.kills) }">
                                                                {{ sessionData.teamOne[i - 1]?.userTag.recentData.kills
                                                                }}
                                                            </span>/
                                                            <span
                                                                :style="{ color: deathsColor(sessionData.teamOne[i - 1]?.userTag.recentData.deaths) }">{{
                                                                    sessionData.teamOne[i - 1]?.userTag.recentData.deaths
                                                                }}</span>
                                                            /
                                                            <span
                                                                :style="{ color: assistsColor(sessionData.teamOne[i - 1]?.userTag.recentData.assists) }">{{
                                                                    sessionData.teamOne[i - 1]?.userTag.recentData.assists
                                                                }}</span>
                                                        </span>

                                                    </n-flex>
                                                </span>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 胜率（{{ sessionData.typeCn ?
                                                    sessionData.typeCn :
                                                    "单双排" }}）:</span>
                                                <n-flex>
                                                    <span style="width: 65px;"
                                                        :style="{ color: groupRateColor(sessionData.teamOne[i - 1]?.userTag.recentData.groupRate) }">
                                                        <n-progress type="line" :percentage="winRate(sessionData.teamOne[i -
                                                            1]?.userTag.recentData, sessionData.type)" :height="6"
                                                            :show-indicator="false" :color="winRateColor(winRate(sessionData.teamOne[i -
                                                                1]?.userTag.recentData, sessionData.type))" processing
                                                            :stroke-width="10"
                                                            style="position: relative; top: 7px;"></n-progress>
                                                    </span>
                                                    <span class="stats-value" :style="{
                                                        color: winRateColor(winRate(sessionData.teamOne[i -
                                                            1]?.userTag.recentData, sessionData.type))
                                                    }">
                                                        {{
                                                            winRate(sessionData.teamOne[i -
                                                                1]?.userTag.recentData, sessionData.type)
                                                        }}%
                                                    </span>

                                                </n-flex>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 参团率：</span>
                                                <n-flex>
                                                    <span style="width: 65px;"
                                                        :style="{ color: groupRateColor(sessionData.teamOne[i - 1]?.userTag.recentData.groupRate) }">
                                                        <n-progress type="line"
                                                            :percentage="sessionData.teamOne[i - 1]?.userTag.recentData.groupRate"
                                                            :height="6" :show-indicator="false"
                                                            :color="groupRateColor(sessionData.teamOne[i - 1]?.userTag.recentData.groupRate)"
                                                            processing :stroke-width="10"
                                                            style="position: relative; top: 7px;"></n-progress>
                                                    </span>
                                                    <span class="stats-value"
                                                        :style="{ color: groupRateColor(sessionData.teamOne[i - 1]?.userTag.recentData.groupRate) }">{{
                                                            sessionData.teamOne[i - 1]?.userTag.recentData.groupRate
                                                        }}%</span>

                                                </n-flex>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 伤害/占比：</span>
                                                <span class="stats-value">
                                                    <n-flex>
                                                        <span>
                                                            {{ sessionData.teamOne[i -
                                                                1]?.userTag.recentData.averageDamageDealtToChampions }}
                                                        </span>
                                                        <span style="width: 45px;"> <n-progress type="line"
                                                                :percentage="sessionData.teamOne[i - 1]?.userTag.recentData.damageDealtToChampionsRate"
                                                                :color="otherColor(sessionData.teamOne[i - 1]?.userTag.recentData.damageDealtToChampionsRate)"
                                                                :height="6" :show-indicator="false" processing
                                                                :stroke-width="13"
                                                                style="position: relative; top: 7px;"></n-progress>
                                                        </span>
                                                        <span class="stats-value"
                                                            :style="{ color: otherColor(sessionData.teamOne[i - 1]?.userTag.recentData.damageDealtToChampionsRate) }">
                                                            {{ sessionData.teamOne[i -
                                                                1]?.userTag.recentData.damageDealtToChampionsRate }}%

                                                        </span>
                                                    </n-flex>
                                                </span>
                                            </n-flex>





                                        </n-flex>
                                    </n-card>
                                </flex>
                            </div>
                        </n-flex>
                    </n-card>
                </n-flex>

                <!-- 右侧部分 -->
                <n-flex vertical justify="space-between" style="gap: 0; flex: 1; height: 100%;">
                    <n-card v-for="i in 5" :key="i" style="flex: 1; height: 100%;" content-style="padding: 0;">
                        <div v-if="!sessionData.teamTwo || !sessionData.teamTwo[i - 1] || !sessionData.teamTwo[i - 1].championBase64"
                            style="position: relative; width: 100%; height: 100%;">
                            <n-spin size="small"
                                style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);" />
                        </div>

                        <n-flex v-else>
                            <!-- 左侧卡片内容 -->
                            <n-flex vertical justify="space-between" style="flex: 3; gap: 4px;">
                                <!-- 个人概览 -->
                                <n-card :bordered="false" content-style="padding: 0;">
                                    <n-flex>
                                        <div style="position: relative;">
                                            <img width="33px" height="33px"
                                                :src="sessionData.teamTwo[i - 1]?.championBase64" />
                                            <div
                                                style="position: absolute; bottom: 12px; right: 0; font-size: 10px; width: 20px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
                                                {{ sessionData.teamTwo[i - 1]?.summoner.summonerLevel }}
                                            </div>
                                        </div>
                                        <n-flex vertical style="gap: 0;">
                                            <n-flex>
                                                <n-button text
                                                    @click="searchSummoner(sessionData.teamTwo[i - 1]?.summoner.gameName + '#' + sessionData.teamTwo[i - 1]?.summoner.tagLine)">
                                                    <n-ellipsis style="max-width: 88px">
                                                        <span style="font-size: 11px; font-weight: bold;">
                                                            {{ sessionData.teamTwo[i - 1]?.summoner.gameName }}
                                                        </span> </n-ellipsis>

                                                </n-button>
                                            </n-flex>

                                            <n-flex style="gap: 5px;">
                                                <span style="color: #676768; font-size: 11px;">
                                                    #{{ sessionData.teamTwo[i - 1]?.summoner.tagLine }}
                                                </span>
                                                <n-button text style="font-size: 12px; position: relative; bottom: 2px;"
                                                    @click="copy(sessionData.teamOne[i - 1].summoner.gameName + '#' + sessionData.teamOne[i - 1].summoner.tagLine)">
                                                    <n-icon>
                                                        <copy-outline></copy-outline>
                                                    </n-icon>
                                                </n-button>
                                                <span>
                                                    <img style="width: 16px;height: 16px;"
                                                        :src="comImgTier.teamTwo[i - 1]?.imgUrl" />
                                                    <span style="font-size: 8px;">{{ comImgTier.teamTwo[i -
                                                        1]?.tierCn }}</span>
                                                </span>
                                            </n-flex>
                                        </n-flex>
                                    </n-flex>
                                </n-card>
                                <!-- 战绩 -->


                                <div>
                                    <n-card v-for="game in sessionData.teamTwo[i - 1]?.matchHistory.games.games"
                                        content-style="padding: 0;" footer-style="padding:0">
                                        <n-flex justify="space-between" style="gap: 0px; align-items: center;">
                                            <span :style="{
                                                fontWeight: '600',
                                                color: game.participants[0].stats.win ? '#8BDFB7' : '#BA3F53',


                                            }"> {{ game.participants[0].stats.win ? '胜' : '负' }}

                                            </span>
                                            <img :src="game.participants[0]?.championBase64"
                                                style="width: auto; height: 24px;       vertical-align: middle;" />
                                            <span style=" font-size: 12px;">
                                                <span style="font-weight: 500; font-size: 12px;color: #8BDFB7">
                                                    {{ game.participants[0].stats?.kills }}
                                                </span>
                                                /
                                                <span style="font-weight: 500;font-size: 12px; color: #BA3F53">
                                                    {{ game.participants[0].stats?.deaths }}
                                                </span>
                                                /

                                                <span style="font-weight: 500;font-size: 12px; color: #D38B2A">
                                                    {{ game.participants[0].stats?.assists }}
                                                </span>

                                            </span>
                                            <span style="font-size: 8px;margin-right: 3px;">
                                                {{ game.queueName ? game.queueName : '其他' }}
                                            </span>

                                        </n-flex>
                                    </n-card>
                                </div>
                            </n-flex>

                            <!-- 中间部分 -->
                            <div style="flex: 5;">
                                <flex vertical style="gap: 0px;">
                                    <div style="margin-bottom: 2px; margin-top: 3px;">

                                        <n-flex>
                                            <!-- <n-tag type="success" size="small" round >
                                                <span>队伍 A</span>
                                            </n-tag> -->
                                            <n-tooltip trigger="hover"
                                                v-for="tag in sessionData.teamTwo[i - 1]?.userTag.tag">
                                                <template #trigger>
                                                    <n-button size="tiny" :type="tag.good ? 'primary' : 'error'">
                                                        {{ tag.tagName }}
                                                    </n-button> </template>
                                                <span>{{ tag.tagDesc }}</span>
                                            </n-tooltip>


                                        </n-flex>
                                    </div>
                                    <!-- 20场统计 -->
                                    <n-card class="recent-card" :bordered="false" content-style="padding:5px">
                                        <n-flex vertical style="position: relative; gap: 5px; ">

                                            <n-flex class="stats-item" justify="space-between">

                                                <span class="stats-label">
                                                    <n-flex style="gap: 5px;">
                                                        <n-progress
                                                            style=" width: 10px; position: relative; bottom: 5px; "
                                                            type="circle" :show-indicator="false" :percentage="70"
                                                            :height="24" status="success" color="bule" />

                                                        <span>KDA:</span>
                                                    </n-flex>
                                                </span>
                                                <span class="stats-value">
                                                    <n-flex>
                                                        <span
                                                            :style="{ color: kdaColor(sessionData.teamTwo[i - 1]?.userTag.recentData.kda) }">{{
                                                                sessionData.teamTwo[i - 1]?.userTag.recentData.kda
                                                            }}</span>
                                                        <span>
                                                            <span
                                                                :style="{ color: killsColor(sessionData.teamTwo[i - 1]?.userTag.recentData.kills) }">
                                                                {{ sessionData.teamTwo[i - 1]?.userTag.recentData.kills
                                                                }}
                                                            </span>/
                                                            <span
                                                                :style="{ color: deathsColor(sessionData.teamTwo[i - 1]?.userTag.recentData.deaths) }">{{
                                                                    sessionData.teamTwo[i - 1]?.userTag.recentData.deaths
                                                                }}</span>
                                                            /
                                                            <span
                                                                :style="{ color: assistsColor(sessionData.teamTwo[i - 1]?.userTag.recentData.assists) }">{{
                                                                    sessionData.teamTwo[i - 1]?.userTag.recentData.assists
                                                                }}</span>
                                                        </span>

                                                    </n-flex>
                                                </span>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 胜率（{{ sessionData.typeCn ?
                                                    sessionData.typeCn :
                                                    "单双排" }}）:</span>
                                                <n-flex>
                                                    <span style="width: 65px;"
                                                        :style="{ color: groupRateColor(sessionData.teamTwo[i - 1]?.userTag.recentData.groupRate) }">
                                                        <n-progress type="line" :percentage="winRate(sessionData.teamTwo[i -
                                                            1]?.userTag.recentData, sessionData.type)" :height="6"
                                                            :show-indicator="false" :color="winRateColor(winRate(sessionData.teamTwo[i -
                                                                1]?.userTag.recentData, sessionData.type))" processing
                                                            :stroke-width="10"
                                                            style="position: relative; top: 7px;"></n-progress>
                                                    </span>
                                                    <span class="stats-value" :style="{
                                                        color: winRateColor(winRate(sessionData.teamTwo[i -
                                                            1]?.userTag.recentData, sessionData.type))
                                                    }">
                                                        {{
                                                            winRate(sessionData.teamTwo[i -
                                                                1]?.userTag.recentData, sessionData.type)
                                                        }}%
                                                    </span>

                                                </n-flex>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 参团率：</span>
                                                <n-flex>
                                                    <span style="width: 65px;"
                                                        :style="{ color: groupRateColor(sessionData.teamTwo[i - 1]?.userTag.recentData.groupRate) }">
                                                        <n-progress type="line"
                                                            :percentage="sessionData.teamTwo[i - 1]?.userTag.recentData.groupRate"
                                                            :height="6" :show-indicator="false"
                                                            :color="groupRateColor(sessionData.teamTwo[i - 1]?.userTag.recentData.groupRate)"
                                                            processing :stroke-width="10"
                                                            style="position: relative; top: 7px;"></n-progress>
                                                    </span>
                                                    <span class="stats-value"
                                                        :style="{ color: groupRateColor(sessionData.teamTwo[i - 1]?.userTag.recentData.groupRate) }">{{
                                                            sessionData.teamTwo[i - 1]?.userTag.recentData.groupRate
                                                        }}%</span>

                                                </n-flex>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 伤害/占比：</span>
                                                <span class="stats-value">
                                                    <n-flex>
                                                        <span>
                                                            {{ sessionData.teamTwo[i -
                                                                1]?.userTag.recentData.averageDamageDealtToChampions }}
                                                        </span>
                                                        <span style="width: 45px;"> <n-progress type="line"
                                                                :percentage="sessionData.teamTwo[i - 1]?.userTag.recentData.damageDealtToChampionsRate"
                                                                :color="otherColor(sessionData.teamTwo[i - 1]?.userTag.recentData.damageDealtToChampionsRate)"
                                                                :height="6" :show-indicator="false" processing
                                                                :stroke-width="13"
                                                                style="position: relative; top: 7px;"></n-progress>
                                                        </span>
                                                        <span class="stats-value"
                                                            :style="{ color: otherColor(sessionData.teamTwo[i - 1]?.userTag.recentData.damageDealtToChampionsRate) }">
                                                            {{ sessionData.teamTwo[i -
                                                                1]?.userTag.recentData.damageDealtToChampionsRate }}%

                                                        </span>
                                                    </n-flex>
                                                </span>
                                            </n-flex>





                                        </n-flex>
                                    </n-card>
                                </flex>
                            </div>
                        </n-flex>
                    </n-card>
                </n-flex>
            </n-flex>
        </div>
    </template>
</template>

<script lang="ts" setup>
import { CopyOutline, Reload } from '@vicons/ionicons5';
import { Rank, RecentData, Summoner, UserTag } from '@renderer/components/record/model';
import { MatchHistory } from '@renderer/components/record/MatchHistory.vue';
import http from '@renderer/services/http';
import { computed, onMounted, onUnmounted, reactive } from 'vue';
import { kdaColor, deathsColor, assistsColor, otherColor, groupRateColor, killsColor, winRateColor } from '../components/record/composition';
import { useMessage } from 'naive-ui';
import { searchSummoner } from '@renderer/components/record/composition'
import unranked from '@renderer/assets/imgs/tier/unranked.png';
import bronzed from '@renderer/assets/imgs/tier/bronze.png';
import silver from '@renderer/assets/imgs/tier/silver.png';
import gold from '@renderer/assets/imgs/tier/gold.png';
import platinum from '@renderer/assets/imgs/tier/platinum.png';
import diamond from '@renderer/assets/imgs/tier/diamond.png';
import master from '@renderer/assets/imgs/tier/master.png';
import grandmaster from '@renderer/assets/imgs/tier/grandmaster.png';
import challenger from '@renderer/assets/imgs/tier/challenger.png';
import iron from '@renderer/assets/imgs/tier/iron.png';
import emerald from '@renderer/assets/imgs/tier/emerald.png';
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
        bronzed: bronzed,
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
            ? sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn.slice(-2)
            : '无';

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn) {
            tierCn = sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn.slice(-2);
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
            ? sessionSummoner.rank.queueMap.RANKED_SOLO_5x5.tierCn.slice(-2)
            : '无';

        if (sessionData.type === "RANKED_FLEX_SR" && sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn) {
            tierCn = sessionSummoner.rank.queueMap.RANKED_FLEX_SR.tierCn.slice(-2);
        }


        comImgTier.teamTwo.push({
            imgUrl: tierNormalized,
            tierCn: tierCn,
        });
    }

    return comImgTier;
});

interface SessionData {
    phase: string;
    type: string;
    typeCn: string;
    teamOne: SessionSummoner[];
    teamTwo: SessionSummoner[];

}
interface SessionSummoner {
    championId: number
    championBase64: string
    summoner: Summoner
    matchHistory: MatchHistory
    userTag: UserTag
    rank: Rank

}
const sessionData = reactive<SessionData>(
    {
        phase: "",
        type: "",
        typeCn: "",
        teamOne: [],
        teamTwo: [],

    },

);
let timer: ReturnType<typeof setInterval> | null = null;
var isRequesting = false;

onMounted(async () => {
    // 第一次请求
    await GetSessionData();

    // 启动定时器
    timer = setInterval(async () => {
        if (!isRequesting) {
            try {
                isRequesting = true; // 设置为请求中
                await GetSessionData(); // 等待请求完成
            } catch (error) {
                console.error('请求失败', error);
                // 错误处理，例如重试机制等
            } finally {
                isRequesting = false; // 请求完成，允许下一个请求
            }
        }
    }, 5000);
});

onUnmounted(() => {
    if (timer) {
        clearInterval(timer); // 在组件卸载时清理定时器
    }
});
async function GetSessionData() {

    const res = await http.get<SessionData>("/GetSessionData");
    if (res.status == 200) {
        if (res.data.phase != "") {
            sessionData.phase = res.data.phase;
            sessionData.type = res.data.type;
            sessionData.typeCn = res.data.typeCn;
            if (Array.isArray(res.data.teamOne)) {
                sessionData.teamOne = res.data.teamOne;
            } else {
                sessionData.teamOne = [];
            }
            if (Array.isArray(res.data.teamTwo)) {
                sessionData.teamTwo = res.data.teamTwo;
            } else {
                sessionData.teamTwo = [];
            }
        }
    }
}
function winRate(rencentData: RecentData, type: string) {
    if (type === "") {
        return 0;
    }

    if (type === "RANKED_FLEX_SR") {
        // 处理分母为 0 的情况
        const totalFlexGames = rencentData.flexWins + rencentData.flexLosses;
        if (totalFlexGames === 0) {
            return 0; // 或者可以选择返回 null、-1、或者其他你认为合适的值
        }
        return Math.round((rencentData.flexWins) / totalFlexGames * 100);
    } else {
        // 处理分母为 0 的情况
        const totalGames = rencentData.wins + rencentData.losses;
        if (totalGames === 0) {
            return 0; // 同样可以根据需求返回其他值
        }
        return Math.round(rencentData.wins / totalGames * 100);
    }
}

const message = useMessage();
const copy = (nameId) => {
    navigator.clipboard.writeText(nameId)
        .then(() => {
            message.success("复制成功");
        })
        .catch(() => {
            message.error("复制失败");
        });
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

.clip {
    background: linear-gradient(120deg, hwb(189 2% 6%) 30%, hsl(30deg, 100%, 50%));
    color: transparent;
    background-clip: text;
    font-weight: 600;
    font-size: 16px;
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
