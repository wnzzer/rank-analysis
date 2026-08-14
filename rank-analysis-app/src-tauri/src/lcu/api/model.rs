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
    /// 完整符文页：主/副系 styles（各含 3/2 个 selections）+ statPerks。
    /// LCU match-details 提供；SGP match-v5 同构（map_participant 透传）。
    /// 旧缓存/缺失时为 None，前端回退扁平 perk0/perkPrimaryStyle/perkSubStyle。
    #[serde(rename = "perks", default)]
    pub perks: Option<Perks>,
    pub stats: Stats,
}

/// 完整符文页：LCU match-details `participants[].perks`（SGP match-v5 同构）。
/// 主系 styles[0]（基石 + 3 符文）、副系 styles[1]（2 符文）、statPerks 三个固定槽。
#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Perks {
    #[serde(default)]
    pub stat_perks: Option<PerkStatPerks>,
    #[serde(default)]
    pub styles: Vec<PerkStyle>,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerkStatPerks {
    #[serde(default)]
    pub defense: i32,
    #[serde(default)]
    pub flex: i32,
    #[serde(default)]
    pub offense: i32,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerkStyle {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub style: i32,
    #[serde(default)]
    pub selections: Vec<PerkSelection>,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerkSelection {
    #[serde(default)]
    pub perk: i32,
    #[serde(default)]
    pub var1: i32,
    #[serde(default)]
    pub var2: i32,
    #[serde(default)]
    pub var3: i32,
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
    // D3-1 用户画像基础字段：LCU match-details(V4) 提供、此前未解析。
    // 全部带 default——缺失/旧缓存时按 0 降级，不阻塞反序列化。
    #[serde(rename = "visionScore", default)]
    pub vision_score: i32,
    #[serde(rename = "wardsPlaced", default)]
    pub wards_placed: i32,
    #[serde(rename = "wardsKilled", default)]
    pub wards_killed: i32,
    #[serde(rename = "visionWardsBoughtInGame", default)]
    pub vision_wards_bought_in_game: i32,
    #[serde(rename = "sightWardsBoughtInGame", default)]
    pub sight_wards_bought_in_game: i32,
    #[serde(rename = "longestTimeSpentLiving", default)]
    pub longest_time_spent_living: i32,
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
            "subteamPlacement": 5,
            "visionScore": 42,
            "wardsPlaced": 21,
            "wardsKilled": 2,
            "visionWardsBoughtInGame": 8,
            "sightWardsBoughtInGame": 12,
            "longestTimeSpentLiving": 431
        }"#;
        let stats: Stats = serde_json::from_str(json).unwrap();
        assert_eq!(stats.player_subteam_id, 3);
        assert_eq!(stats.subteam_placement, 5);
        assert_eq!(stats.vision_score, 42);
        assert_eq!(stats.wards_placed, 21);
        assert_eq!(stats.wards_killed, 2);
        assert_eq!(stats.vision_wards_bought_in_game, 8);
        assert_eq!(stats.sight_wards_bought_in_game, 12);
        assert_eq!(stats.longest_time_spent_living, 431);
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
        assert_eq!(stats.vision_score, 0);
        assert_eq!(stats.wards_placed, 0);
        assert_eq!(stats.wards_killed, 0);
        assert_eq!(stats.vision_wards_bought_in_game, 0);
        assert_eq!(stats.sight_wards_bought_in_game, 0);
        assert_eq!(stats.longest_time_spent_living, 0);
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

    /// LCU match-details 的完整符文页必须解析透传：styles 全量（基石+3/2 符文）与 statPerks。
    #[test]
    fn should_parse_full_perks_from_lcu_detail() {
        let json = r#"{
            "participantId": 1, "teamId": 100, "championId": 897, "spell1Id": 14, "spell2Id": 4,
            "perks": {
                "statPerks": { "defense": 5008, "flex": 5008, "offense": 5008 },
                "styles": [
                    { "description": "primaryStyle", "style": 8100,
                      "selections": [
                        { "perk": 8112, "var1": 1, "var2": 2, "var3": 3 },
                        { "perk": 9111, "var1": 0, "var2": 0, "var3": 0 },
                        { "perk": 9112, "var1": 0, "var2": 0, "var3": 0 }
                      ] },
                    { "description": "subStyle", "style": 8000,
                      "selections": [
                        { "perk": 8275, "var1": 0, "var2": 0, "var3": 0 },
                        { "perk": 8347, "var1": 0, "var2": 0, "var3": 0 }
                      ] }
                ]
            },
            "win": true,
            "item0": 0, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 0,
            "perkPrimaryStyle": 8100, "perkSubStyle": 8000,
            "kills": 8, "deaths": 2, "assists": 5,
            "goldEarned": 13200, "goldSpent": 13000,
            "totalDamageDealtToChampions": 28660, "totalDamageDealt": 100000,
            "totalDamageTaken": 47327, "totalHeal": 8485,
            "totalMinionsKilled": 167
        }"#;
        let p: Participant = serde_json::from_str(json).unwrap();
        let perks = p.perks.as_ref().expect("perks 应解析");
        assert_eq!(perks.styles.len(), 2);
        assert_eq!(perks.styles[0].style, 8100);
        assert_eq!(perks.styles[0].selections.len(), 3);
        assert_eq!(perks.styles[0].selections[0].perk, 8112);
        assert_eq!(perks.styles[1].selections.len(), 2);
        let stat = perks.stat_perks.as_ref().unwrap();
        assert_eq!(stat.defense, 5008);
        assert_eq!(stat.flex, 5008);
        assert_eq!(stat.offense, 5008);
        // 序列化回 camelCase 供前端消费
        let out = serde_json::to_string(&p).unwrap();
        assert!(out.contains("\"statPerks\""));
        assert!(out.contains("\"styles\""));
        assert!(out.contains("\"perk\":8112"));
    }

    /// 无 perks 字段的旧数据：None 降级，不阻塞反序列化。
    #[test]
    fn should_tolerate_missing_perks() {
        let json = r#"{
            "participantId": 1, "teamId": 100, "championId": 897, "spell1Id": 14, "spell2Id": 4,
            "win": true,
            "item0": 0, "item1": 0, "item2": 0, "item3": 0, "item4": 0, "item5": 0, "item6": 0,
            "perkPrimaryStyle": 0, "perkSubStyle": 0,
            "kills": 0, "deaths": 0, "assists": 0,
            "goldEarned": 0, "goldSpent": 0,
            "totalDamageDealtToChampions": 0, "totalDamageDealt": 0,
            "totalDamageTaken": 0, "totalHeal": 0,
            "totalMinionsKilled": 0
        }"#;
        let p: Participant = serde_json::from_str(json).unwrap();
        assert!(p.perks.is_none());
        assert_eq!(p.champion_id, 897);
    }
}
