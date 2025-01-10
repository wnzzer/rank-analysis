<template>
    <div>
        <n-flex justify="space-between">
            <n-flex vertical justify="space-between" style="gap: 0px; flex: 1; height: 90vh;">
                <n-card v-for="i in 5" key="i" style="flex:  1;" content-style="padding:1px">
                    <n-flex vertical>
                        <n-card :bordered="false" content-style="padding : 0px">
                            <n-flex>
                                <div style="position: relative;">
                                    <img width="35px" height="35px" :src="sesssionData.teamOne[0]?.championBase64">
                                    <div
                                        style="position: absolute; bottom: 4px; right: 0; font-size: 10px; width: 20px; height: 10px; text-align: center; line-height: 20px; border-radius: 50%; color: white;">
                                        {{ sesssionData.teamOne[0]?.summoner.summonerLevel }}
                                    </div>
                                </div>
                                <n-flex vertical style="gap: 0px;">
                                    <n-flex>
                                        <span style="font-size: medium;font-size: 14px; font-weight: 1000;">{{
                                            sesssionData.teamOne[0]?.summoner.gameName }}</span>


                                    </n-flex>

                                    <n-flex>
                                        <span style="color: #676768; font-size: small;">#{{
                                            sesssionData.teamOne[0]?.summoner.tagLine }}</span>
                                        <n-button text style="font-size: 12px" @click="">
                                            <n-icon>
                                                <copy-outline></copy-outline>
                                            </n-icon>
                                        </n-button>

                                    </n-flex>
                                </n-flex>
                            </n-flex>
                        </n-card>
                        <!-- <div style="position: relative;">

                            <n-card :bordered="false">
                                <div style="position: absolute; left: 0;top: 0;">

                                    <span>
                                        单双排
                                    </span>
                                </div>
                                <n-flex>
                                    <div>
                                        <img width="70px" height="70px"
                                            :src="requireImg(summoner.rank.queueMap.RANKED_SOLO_5x5.tier.toLocaleLowerCase())" />
                                    </div>
                                    <div style="position: absolute; bottom: 10px; left: 25px;">
                                        <span style="font-size: 12px;">
                                            {{ summoner.rank.queueMap.RANKED_SOLO_5x5.tierCn }} {{
                                                summoner.rank.queueMap.RANKED_SOLO_5x5.division }}
                                        </span>
                                    </div>
                                    <div style="width: 60%;">
                                        <n-flex vertical>
                                            <RecordButton
                                                :record-type="getRecordType(summoner.rank.queueMap.RANKED_SOLO_5x5.wins, summoner.rank.queueMap.RANKED_SOLO_5x5.losses)">
                                                胜率：{{ getWinRate(summoner.rank.queueMap.RANKED_SOLO_5x5.wins,
                                                    summoner.rank.queueMap.RANKED_SOLO_5x5.losses) }}
                                            </RecordButton>
                                            <n-button size="tiny">胜场：{{ summoner.rank.queueMap.RANKED_SOLO_5x5.wins
                                                }}</n-button>
                                            <n-button size="tiny">负场：{{ summoner.rank.queueMap.RANKED_SOLO_5x5.losses
                                                }}</n-button>
                                        </n-flex>
                                    </div>
                                </n-flex>

                            </n-card>
                        </div> -->
                    </n-flex>
                </n-card>
            </n-flex>
            <n-flex vertical justify="space-between" style="gap: 0px; flex: 1;">
                <n-card v-for="i in 5" key="i" style="flex:  1;">

                </n-card>
            </n-flex>

        </n-flex>
    </div>
</template>
<script lang="ts" setup>
import { CopyOutline } from '@vicons/ionicons5';
import { Summoner } from '@renderer/components/record/model';
import { UserTag } from '@renderer/components/record/UserRecord.vue';
import { MatchHistory } from '@renderer/components/record/MatchHistory.vue';
import http from '@renderer/services/http';
import { onMounted, reactive } from 'vue';

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
</script>