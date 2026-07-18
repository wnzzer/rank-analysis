//! # LCU 通用数据模型
//!
//! 对局、参与者等共用的结构：Player、Participant、Stats、ParticipantIdentity 等。

use serde::{Deserialize, Serialize};

/// 玩家账号与身份信息（accountId、summonerName、gameName、tagLine、puuid 等）。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct Player {
    #[serde(rename = "accountId")]
    pub account_id: i64, // Use i64 for account IDs to be safe
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(rename = "summonerName")]
    pub summoner_name: String,
    #[serde(rename = "gameName")]
    pub game_name: String,
    #[serde(rename = "tagLine")]
    pub tag_line: String,
    #[serde(rename = "summonerId")]
    pub summoner_id: i64, // Use i64 for summoner IDs to be safe
    #[serde(rename = "puuid", default)]
    pub puuid: String,
}

/// 对局中单名参与者：队伍、英雄、召唤师技能、本局统计等。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct Participant {
    #[serde(rename = "participantId")]
    pub participant_id: i32,
    #[serde(rename = "teamId")]
    pub team_id: i32,
    #[serde(rename = "championId")]
    pub champion_id: i32,
    #[serde(rename = "spell1Id")]
    pub spell1_id: i32,
    #[serde(rename = "spell2Id")]
    pub spell2_id: i32,
    pub stats: Stats,
}

/// 单局统计：胜负、装备、符文、KDA 等。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct Stats {
    pub win: bool,
    #[serde(rename = "item0")]
    pub item0: i32,
    #[serde(rename = "item1")]
    pub item1: i32,
    #[serde(rename = "item2")]
    pub item2: i32,
    #[serde(rename = "item3")]
    pub item3: i32,
    #[serde(rename = "item4")]
    pub item4: i32,
    #[serde(rename = "item5")]
    pub item5: i32,
    #[serde(rename = "item6")]
    pub item6: i32,
    // default：SGP(match-v5) 的 participant 没有扁平 perkPrimaryStyle/perkSubStyle
    // （它们在嵌套的 perks.styles 里），加 default 让扁平 participant 可直接反序列化进
    // Stats，再由 SGP 映射层从 perks.styles 回填。LCU 仍提供这两个字段，不受影响。
    #[serde(rename = "perkPrimaryStyle", default)]
    pub perk_primary_style: i32,
    #[serde(rename = "perkSubStyle", default)]
    pub perk_sub_style: i32,
    #[serde(rename = "perk0", default)]
    pub perk0: i32,
    #[serde(rename = "playerAugment1", default)]
    pub player_augment1: i32,
    #[serde(rename = "playerAugment2", default)]
    pub player_augment2: i32,
    #[serde(rename = "playerAugment3", default)]
    pub player_augment3: i32,
    #[serde(rename = "playerAugment4", default)]
    pub player_augment4: i32,
    // 新斗魂(queueId 1750+ / 3v3 6 队) LCU 实测会返回 playerAugment5/6；
    // 旧斗魂(2v2v2v2)只到 4 个，未返回时 serde default = 0。
    #[serde(rename = "playerAugment5", default)]
    pub player_augment5: i32,
    #[serde(rename = "playerAugment6", default)]
    pub player_augment6: i32,
    pub kills: i32,
    pub deaths: i32,
    pub assists: i32,
    // 多杀次数（LCU 与 SGP match-v5 同名扁平字段）。default：旧缓存/残缺数据无此字段时为 0。
    // ⚠️ 曾因未声明被 serde 丢弃，导致前端详情页与 AI snapshot 的 multiKills 恒为 0。
    #[serde(rename = "doubleKills", default)]
    pub double_kills: i32,
    #[serde(rename = "tripleKills", default)]
    pub triple_kills: i32,
    #[serde(rename = "quadraKills", default)]
    pub quadra_kills: i32,
    #[serde(rename = "pentaKills", default)]
    pub penta_kills: i32,
    #[serde(rename = "goldEarned")]
    pub gold_earned: i32,
    #[serde(rename = "goldSpent")]
    pub gold_spent: i32,
    #[serde(rename = "totalDamageDealtToChampions")]
    pub total_damage_dealt_to_champions: i32,
    #[serde(rename = "totalDamageDealt")]
    pub total_damage_dealt: i32,
    #[serde(rename = "totalDamageTaken")]
    pub total_damage_taken: i32,
    #[serde(rename = "totalHeal")]
    pub total_heal: i32,
    #[serde(rename = "totalMinionsKilled")]
    pub total_minions_killed: i32,
    #[serde(rename = "neutralMinionsKilled", default)]
    pub neutral_minions_killed: i32,
    #[serde(rename = "damageDealtToTurrets", default)]
    pub damage_dealt_to_turrets: i32,

    // Calculated data - if these are derived and not directly in JSON,
    // you might not include them in the struct for deserialization,
    // or make them Option<i32> if they might be missing.
    // However, if they *are* in the JSON, keep them.
    #[serde(rename = "groupRate", default)]
    pub group_rate: i32,
    #[serde(rename = "goldEarnedRate", default)]
    pub gold_earned_rate: i32,
    #[serde(rename = "damageDealtToChampionsRate", default)]
    pub damage_dealt_to_champions_rate: i32,
    #[serde(rename = "damageTakenRate", default)]
    pub damage_taken_rate: i32,
    #[serde(rename = "healRate", default)]
    pub heal_rate: i32,
    /// CHERRY/斗魂模式：1~8 表示玩家所属小队 ID；非 CHERRY 局为 0
    #[serde(rename = "playerSubteamId", default)]
    pub player_subteam_id: i32,
    /// CHERRY/斗魂模式：1~8 表示该小队的最终名次（1=冠军）；非 CHERRY 局为 0
    #[serde(rename = "subteamPlacement", default)]
    pub subteam_placement: i32,
}

/// 参与者身份：关联到 Player（账号/召唤师信息）。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct ParticipantIdentity {
    pub player: Player,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_deserialize_arena_subteam_fields() {
        let json = r#"{
            "win": true,
            "item0": 0, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 0,
            "perkPrimaryStyle": 0, "perkSubStyle": 0,
            "kills": 5, "deaths": 2, "assists": 8,
            "goldEarned": 12000, "goldSpent": 11000,
            "totalDamageDealtToChampions": 30000, "totalDamageDealt": 100000,
            "totalDamageTaken": 20000, "totalHeal": 7000,
            "totalMinionsKilled": 0,
            "playerSubteamId": 3,
            "subteamPlacement": 5
        }"#;
        let stats: Stats = serde_json::from_str(json).unwrap();
        assert_eq!(stats.player_subteam_id, 3);
        assert_eq!(stats.subteam_placement, 5);
    }

    #[test]
    fn should_default_subteam_fields_when_absent() {
        let json = r#"{
            "win": true,
            "item0": 0, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 0,
            "perkPrimaryStyle": 0, "perkSubStyle": 0,
            "kills": 0, "deaths": 0, "assists": 0,
            "goldEarned": 0, "goldSpent": 0,
            "totalDamageDealtToChampions": 0, "totalDamageDealt": 0,
            "totalDamageTaken": 0, "totalHeal": 0,
            "totalMinionsKilled": 0
        }"#;
        let stats: Stats = serde_json::from_str(json).unwrap();
        assert_eq!(stats.player_subteam_id, 0);
        assert_eq!(stats.subteam_placement, 0);
    }

    /// 多杀字段必须透传——曾因 Stats 未声明这些字段被 serde 丢弃，
    /// 前端详情页与 AI 复盘 snapshot 的 multiKills 一直拿到 0。
    #[test]
    fn should_deserialize_multi_kill_fields() {
        let json = r#"{
            "win": true,
            "item0": 0, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 0,
            "perkPrimaryStyle": 0, "perkSubStyle": 0,
            "kills": 19, "deaths": 3, "assists": 21,
            "goldEarned": 25500, "goldSpent": 24000,
            "totalDamageDealtToChampions": 82700, "totalDamageDealt": 200000,
            "totalDamageTaken": 35200, "totalHeal": 10300,
            "totalMinionsKilled": 200,
            "doubleKills": 3, "tripleKills": 2, "quadraKills": 1, "pentaKills": 1
        }"#;
        let stats: Stats = serde_json::from_str(json).unwrap();
        assert_eq!(stats.double_kills, 3);
        assert_eq!(stats.triple_kills, 2);
        assert_eq!(stats.quadra_kills, 1);
        assert_eq!(stats.penta_kills, 1);
    }

    /// 旧缓存/SGP 缺字段时默认 0，且序列化输出 camelCase 供前端消费。
    #[test]
    fn should_default_and_serialize_multi_kill_fields() {
        let stats = Stats {
            penta_kills: 1,
            ..Default::default()
        };
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("\"pentaKills\":1"));
        assert!(json.contains("\"tripleKills\":0"));
    }
}
