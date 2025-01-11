<template>
    <div>
        <n-flex justify="space-between" style="height: 93vh; overflow: hidden;">
            <!-- 左侧部分 -->
             
            <n-flex vertical justify="space-between"
                style="height: 93vh;gap: 0; flex: 1; height: 100%; position: relative;">
                <n-card v-for="i in 5" :key="i" style="" content-style="padding: 0px;">
                    <div  v-if="!(sesssionData.teamTwo[i - 1]?.championBase64)" style="position: relative; width: 100%; height: 100%;">
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
                                            :src="sesssionData.teamOne[i - 1]?.championBase64" />
                                        <div
                                            style="position: absolute; bottom: 12px; right: 0; font-size: 10px; width: 20px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
                                            {{ sesssionData.teamOne[i - 1]?.summoner.summonerLevel }}
                                        </div>
                                    </div>
                                    <n-flex vertical style="gap: 0;">
                                        <n-flex>
                                            <span style="font-size: 12px; font-weight: bold;">
                                                {{ sesssionData.teamOne[i - 1]?.summoner.gameName }}
                                            </span>
                                        </n-flex>

                                        <n-flex style="gap: 5px;">
                                            <span style="color: #676768; font-size: 11px;">
                                                #{{ sesssionData.teamOne[i - 1]?.summoner.tagLine }}
                                            </span>
                                            <n-button text style="font-size: 12px"
                                                @click="copy(sesssionData.teamOne[i - 1].summoner.gameName + '#' + sesssionData.teamOne[i - 1].summoner.tagLine)">
                                                <n-icon>
                                                    <copy-outline></copy-outline>
                                                </n-icon>
                                            </n-button>
                                        </n-flex>
                                    </n-flex>
                                </n-flex>
                            </n-card>
                            <!-- 战绩 -->


                            <div>
                                <n-card v-for="game in sesssionData.teamOne[i - 1]?.matchHistory.games.games"
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
                                        <div>
                                            <span style="visibility: hidden;">
                                                s
                                            </span>
                                            <n-tooltip trigger="hover"
                                                v-for="tag in sesssionData.teamOne[i - 1]?.userTag.tag">
                                                <template #trigger>
                                                    <n-button size="tiny" :type="tag.good ? 'primary' : 'error'">
                                                        {{ tag.tagName }}
                                                    </n-button> </template>
                                                <span>{{ tag.tagDesc }}</span>
                                            </n-tooltip>


                                        </div>
                                    </n-flex>
                                </div>
                                <!-- 20场统计 -->
                                <n-card class="recent-card" :bordered="false" content-style="padding:5px">
                                    <n-flex vertical style="position: relative; gap: 5px; ">

                                        <n-flex class="stats-item" justify="space-between">

                                            <span class="stats-label">
                                                <n-flex style="gap: 5px;">
                                                    <n-progress style=" width: 10px; position: relative; bottom: 5px; "
                                                        type="circle" :show-indicator="false" :percentage="70"
                                                        :height="24" status="success" color="bule" />

                                                    <span>KDA:</span>
                                                </n-flex>
                                            </span>
                                            <span class="stats-value">
                                                <n-flex>
                                                    <span
                                                        :style="{ color: kdaColor(sesssionData.teamOne[i - 1]?.userTag.recentData.kda) }">{{
                                                            sesssionData.teamOne[i - 1]?.userTag.recentData.kda }}</span>
                                                    <span>
                                                        <span
                                                            :style="{ color: killsColor(sesssionData.teamOne[i - 1]?.userTag.recentData.kills) }">
                                                            {{ sesssionData.teamOne[i - 1]?.userTag.recentData.kills }}
                                                        </span>/
                                                        <span
                                                            :style="{ color: deathsColor(sesssionData.teamOne[i - 1]?.userTag.recentData.deaths) }">{{
                                                                sesssionData.teamOne[i - 1]?.userTag.recentData.deaths
                                                            }}</span>
                                                        /
                                                        <span
                                                            :style="{ color: assistsColor(sesssionData.teamOne[i - 1]?.userTag.recentData.assists) }">{{
                                                                sesssionData.teamOne[i - 1]?.userTag.recentData.assists
                                                            }}</span>
                                                    </span>

                                                </n-flex>
                                            </span>
                                        </n-flex>
                                        <n-flex class="stats-item" justify="space-between">
                                            <span class="stats-label"> 胜率（{{ sesssionData.typeCn ? sesssionData.typeCn :
                                                "单双排" }}）:</span>
                                            <n-flex>
                                                <span style="width: 65px;"
                                                    :style="{ color: groupRateColor(sesssionData.teamOne[i - 1]?.userTag.recentData.groupRate) }">
                                                    <n-progress type="line" :percentage="winRate(sesssionData.teamOne[i -
                                                        1]?.userTag.recentData, sesssionData.type)" :height="6"
                                                        :show-indicator="false" :color="winRateColor(winRate(sesssionData.teamOne[i -
                                                            1]?.userTag.recentData, sesssionData.type))" processing
                                                        :stroke-width="10"
                                                        style="position: relative; top: 7px;"></n-progress>
                                                </span>
                                                <span class="stats-value" :style="{
                                                    color: winRateColor(winRate(sesssionData.teamOne[i -
                                                        1]?.userTag.recentData, sesssionData.type))
                                                }">
                                                    {{
                                                        winRate(sesssionData.teamOne[i -
                                                            1]?.userTag.recentData, sesssionData.type)
                                                    }}%
                                                </span>

                                            </n-flex>
                                        </n-flex>
                                        <n-flex class="stats-item" justify="space-between">
                                            <span class="stats-label"> 参团率：</span>
                                            <n-flex>
                                                <span style="width: 65px;"
                                                    :style="{ color: groupRateColor(sesssionData.teamOne[i - 1]?.userTag.recentData.groupRate) }">
                                                    <n-progress type="line"
                                                        :percentage="sesssionData.teamOne[i - 1]?.userTag.recentData.groupRate"
                                                        :height="6" :show-indicator="false"
                                                        :color="groupRateColor(sesssionData.teamOne[i - 1]?.userTag.recentData.groupRate)"
                                                        processing :stroke-width="10"
                                                        style="position: relative; top: 7px;"></n-progress>
                                                </span>
                                                <span class="stats-value"
                                                    :style="{ color: groupRateColor(sesssionData.teamOne[i - 1]?.userTag.recentData.groupRate) }">{{
                                                        sesssionData.teamOne[i - 1]?.userTag.recentData.groupRate
                                                    }}%</span>

                                            </n-flex>
                                        </n-flex>
                                        <n-flex class="stats-item" justify="space-between">
                                            <span class="stats-label"> 伤害/占比：</span>
                                            <span class="stats-value">
                                                <n-flex>
                                                    <span>
                                                        {{ sesssionData.teamOne[i -
                                                            1]?.userTag.recentData.averageDamageDealtToChampions }}
                                                    </span>
                                                    <span style="width: 45px;"> <n-progress type="line"
                                                            :percentage="sesssionData.teamOne[i - 1]?.userTag.recentData.damageDealtToChampionsRate"
                                                            :color="otherColor(sesssionData.teamOne[i - 1]?.userTag.recentData.damageDealtToChampionsRate)"
                                                            :height="6" :show-indicator="false" processing
                                                            :stroke-width="13"
                                                            style="position: relative; top: 7px;"></n-progress>
                                                    </span>
                                                    <span class="stats-value"
                                                        :style="{ color: otherColor(sesssionData.teamOne[i - 1]?.userTag.recentData.damageDealtToChampionsRate) }">
                                                        {{ sesssionData.teamOne[i -
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
                        <div  v-if="!(sesssionData.teamTwo[i - 1]?.championBase64)" style="position: relative; width: 100%; height: 100%;">
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
                                                :src="sesssionData.teamTwo[i - 1]?.championBase64" />
                                            <div
                                                style="position: absolute; bottom: 12px; right: 0; font-size: 10px; width: 20px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
                                                {{ sesssionData.teamTwo[i - 1]?.summoner.summonerLevel }}
                                            </div>
                                        </div>
                                        <n-flex vertical style="gap: 0;">
                                            <n-flex>
                                                <span style="font-size: 12px; font-weight: bold;">
                                                    {{ sesssionData.teamTwo[i - 1]?.summoner.gameName }}
                                                </span>
                                            </n-flex>

                                            <n-flex style="gap: 5px;">
                                                <span style="color: #676768; font-size: 11px;">
                                                    #{{ sesssionData.teamTwo[i - 1]?.summoner.tagLine }}
                                                </span>
                                                <n-button text style="font-size: 12px"
                                                    @click="copy(sesssionData.teamTwo[i - 1].summoner.gameName + '#' + sesssionData.teamTwo[i - 1].summoner.tagLine)">
                                                    <n-icon>
                                                        <copy-outline></copy-outline>
                                                    </n-icon>
                                                </n-button>
                                            </n-flex>
                                        </n-flex>
                                    </n-flex>
                                </n-card>
                                <!-- 战绩 -->


                                <div>
                                    <n-card v-for="game in sesssionData.teamTwo[i - 1]?.matchHistory.games.games"
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
                                            <div>
                                                <span style="visibility: hidden;">
                                                    s
                                                </span>
                                                <n-tooltip trigger="hover"
                                                    v-for="tag in sesssionData.teamTwo[i - 1]?.userTag.tag">
                                                    <template #trigger>
                                                        <n-button size="tiny" :type="tag.good ? 'primary' : 'error'">
                                                            {{ tag.tagName }}
                                                        </n-button> </template>
                                                    <span>{{ tag.tagDesc }}</span>
                                                </n-tooltip>


                                            </div>
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
                                                            :style="{ color: kdaColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.kda) }">{{
                                                                sesssionData.teamTwo[i - 1]?.userTag.recentData.kda
                                                            }}</span>
                                                        <span>
                                                            <span
                                                                :style="{ color: killsColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.kills) }">
                                                                {{ sesssionData.teamTwo[i - 1]?.userTag.recentData.kills
                                                                }}
                                                            </span>/
                                                            <span
                                                                :style="{ color: deathsColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.deaths) }">{{
                                                                    sesssionData.teamTwo[i - 1]?.userTag.recentData.deaths
                                                                }}</span>
                                                            /
                                                            <span
                                                                :style="{ color: assistsColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.assists) }">{{
                                                                    sesssionData.teamTwo[i - 1]?.userTag.recentData.assists
                                                                }}</span>
                                                        </span>

                                                    </n-flex>
                                                </span>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 胜率（{{ sesssionData.typeCn ?
                                                    sesssionData.typeCn :
                                                    "单双排" }}）:</span>
                                                <n-flex>
                                                    <span style="width: 65px;"
                                                        :style="{ color: groupRateColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.groupRate) }">
                                                        <n-progress type="line" :percentage="winRate(sesssionData.teamTwo[i -
                                                            1]?.userTag.recentData, sesssionData.type)" :height="6"
                                                            :show-indicator="false" :color="winRateColor(winRate(sesssionData.teamTwo[i -
                                                                1]?.userTag.recentData, sesssionData.type))" processing
                                                            :stroke-width="10"
                                                            style="position: relative; top: 7px;"></n-progress>
                                                    </span>
                                                    <span class="stats-value" :style="{
                                                        color: winRateColor(winRate(sesssionData.teamTwo[i -
                                                            1]?.userTag.recentData, sesssionData.type))
                                                    }">
                                                        {{
                                                            winRate(sesssionData.teamTwo[i -
                                                                1]?.userTag.recentData, sesssionData.type)
                                                        }}%
                                                    </span>

                                                </n-flex>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 参团率：</span>
                                                <n-flex>
                                                    <span style="width: 65px;"
                                                        :style="{ color: groupRateColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.groupRate) }">
                                                        <n-progress type="line"
                                                            :percentage="sesssionData.teamTwo[i - 1]?.userTag.recentData.groupRate"
                                                            :height="6" :show-indicator="false"
                                                            :color="groupRateColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.groupRate)"
                                                            processing :stroke-width="10"
                                                            style="position: relative; top: 7px;"></n-progress>
                                                    </span>
                                                    <span class="stats-value"
                                                        :style="{ color: groupRateColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.groupRate) }">{{
                                                            sesssionData.teamTwo[i - 1]?.userTag.recentData.groupRate
                                                        }}%</span>

                                                </n-flex>
                                            </n-flex>
                                            <n-flex class="stats-item" justify="space-between">
                                                <span class="stats-label"> 伤害/占比：</span>
                                                <span class="stats-value">
                                                    <n-flex>
                                                        <span>
                                                            {{ sesssionData.teamTwo[i -
                                                                1]?.userTag.recentData.averageDamageDealtToChampions }}
                                                        </span>
                                                        <span style="width: 45px;"> <n-progress type="line"
                                                                :percentage="sesssionData.teamTwo[i - 1]?.userTag.recentData.damageDealtToChampionsRate"
                                                                :color="otherColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.damageDealtToChampionsRate)"
                                                                :height="6" :show-indicator="false" processing
                                                                :stroke-width="13"
                                                                style="position: relative; top: 7px;"></n-progress>
                                                        </span>
                                                        <span class="stats-value"
                                                            :style="{ color: otherColor(sesssionData.teamTwo[i - 1]?.userTag.recentData.damageDealtToChampionsRate) }">
                                                            {{ sesssionData.teamTwo[i -
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

<script lang="ts" setup>
import { CopyOutline } from '@vicons/ionicons5';
import { RecentData, Summoner, UserTag } from '@renderer/components/record/model';
import { MatchHistory } from '@renderer/components/record/MatchHistory.vue';
import http from '@renderer/services/http';
import { onMounted, reactive } from 'vue';
import { kdaColor, deathsColor, assistsColor, otherColor, groupRateColor, killsColor, winRateColor } from '../components/record/composition';
import { useMessage } from 'naive-ui';


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
}
const sesssionData = reactive<SessionData>(
    {
        phase: "",
        type: "",
        typeCn: "",
        teamOne: [],
        teamTwo: []
    }
);
onMounted(async () => {
    GetSessionData();
});
async function GetSessionData() {
    const res = await http.get("/GetSessionData");
    console.log(res.data);
    if (res.status === 200) {
        sesssionData.phase = res.data.phase;
        sesssionData.type = res.data.type;
        sesssionData.typeCn = res.data.typeCn;
        sesssionData.teamOne = res.data.teamOne;
        sesssionData.teamTwo = res.data.teamTwo;
    }
    console.log(sesssionData);
}
function winRate(rencentData: RecentData, type: string) {
    if (type == "") {
        return 0
    }
    if (type === "RANKED_FLEX_SR") {

        return Math.round((rencentData.flexWins) / (rencentData.flexWins + rencentData.flexLosses) * 100)
    } else {
        return Math.round(rencentData.wins / (rencentData.wins + rencentData.losses) * 100)
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
</style>