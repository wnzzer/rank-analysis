//! 无客户端英雄资料与对位快照。
//!
//! 所有 JSON 都由 `scripts/champion-library/sync.mjs` 在构建期规范化并校验。
//! 运行时只做一次内存解析，不把外部网络请求放在页面首屏关键路径。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

const BUNDLED_LIBRARY: &str = include_str!("../../../data/champion-library/cn-latest.json");
const MATCHUPS_ALL: &str = include_str!("../../../data/champion-library/matchups/all.json");
const MATCHUPS_GOLD: &str = include_str!("../../../data/champion-library/matchups/gold_plus.json");
const MATCHUPS_PLATINUM: &str =
    include_str!("../../../data/champion-library/matchups/platinum_plus.json");
const MATCHUPS_EMERALD: &str =
    include_str!("../../../data/champion-library/matchups/emerald_plus.json");
const MATCHUPS_DIAMOND: &str =
    include_str!("../../../data/champion-library/matchups/diamond_plus.json");
const MATCHUPS_MASTER: &str =
    include_str!("../../../data/champion-library/matchups/master_plus.json");

static LIBRARY: OnceLock<ChampionLibrarySnapshot> = OnceLock::new();
static MATCHUPS: OnceLock<HashMap<&'static str, MatchupDataSnapshot>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionLibrarySnapshot {
    pub schema_version: u32,
    pub patch: String,
    pub generated_at: String,
    pub champions: Vec<ChampionDetail>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionDetail {
    pub id: i64,
    pub name: String,
    pub title: String,
    pub alias: String,
    pub short_bio: String,
    pub roles: Vec<String>,
    pub lanes: Vec<String>,
    pub portrait_url: String,
    pub splash_url: String,
    pub difficulty: i32,
    #[serde(default)]
    pub attack_type: Option<String>,
    #[serde(default)]
    pub damage_type: Option<String>,
    pub stats: ChampionStats,
    pub abilities: Vec<ChampionAbility>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionStats {
    pub health: ChampionStatValue,
    pub health_regen: ChampionStatValue,
    pub resource_name: String,
    pub resource: ChampionStatValue,
    pub resource_regen: ChampionStatValue,
    pub attack_damage: ChampionStatValue,
    pub armor: ChampionStatValue,
    pub magic_resist: ChampionStatValue,
    pub attack_speed: ChampionAttackSpeed,
    pub move_speed: f64,
    pub attack_range: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionStatValue {
    pub base: f64,
    pub growth: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionAttackSpeed {
    pub base: f64,
    pub ratio: f64,
    pub growth: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionAbility {
    pub slot: String,
    pub name: String,
    pub description: String,
    pub icon_url: String,
    pub max_rank: usize,
    pub cooldowns: Vec<RankScalar>,
    pub costs: Vec<RankScalar>,
    pub ranges: Vec<RankScalar>,
    pub rank_values: Vec<AbilityRankValue>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbilityRankValue {
    pub label: String,
    pub values: Vec<RankScalar>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum RankScalar {
    Number(f64),
    Text(String),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MatchupDataSnapshot {
    schema_version: u32,
    patch: String,
    tier: String,
    region: String,
    generated_at: String,
    source: String,
    is_partial: bool,
    champions: HashMap<i64, HashMap<String, Vec<MatchupRow>>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchupRow {
    pub opponent_id: i64,
    pub win_rate: f64,
    pub games: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gold_diff_at15: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cs_diff_at15: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xp_diff_at15: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solo_kill_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchupSnapshot {
    pub patch: String,
    pub tier: String,
    pub lane: String,
    pub region: String,
    pub generated_at: String,
    pub source: String,
    pub is_partial: bool,
    pub rows: Vec<MatchupRow>,
}

fn library() -> &'static ChampionLibrarySnapshot {
    LIBRARY.get_or_init(|| {
        let snapshot: ChampionLibrarySnapshot = serde_json::from_str(BUNDLED_LIBRARY)
            .expect("validated bundled champion library must parse");
        assert_eq!(
            snapshot.schema_version, 1,
            "unsupported champion library schema"
        );
        snapshot
    })
}

fn matchup_snapshots() -> &'static HashMap<&'static str, MatchupDataSnapshot> {
    MATCHUPS.get_or_init(|| {
        [
            ("all", MATCHUPS_ALL),
            ("gold_plus", MATCHUPS_GOLD),
            ("platinum_plus", MATCHUPS_PLATINUM),
            ("emerald_plus", MATCHUPS_EMERALD),
            ("diamond_plus", MATCHUPS_DIAMOND),
            ("master_plus", MATCHUPS_MASTER),
        ]
        .into_iter()
        .map(|(tier, raw)| {
            let snapshot: MatchupDataSnapshot =
                serde_json::from_str(raw).expect("validated bundled matchup snapshot must parse");
            assert_eq!(snapshot.schema_version, 1, "unsupported matchup schema");
            assert_eq!(snapshot.tier, tier, "matchup tier/file mismatch");
            (tier, snapshot)
        })
        .collect()
    })
}

pub fn patch() -> &'static str {
    &library().patch
}

pub fn generated_at() -> &'static str {
    &library().generated_at
}

pub fn champions() -> &'static [ChampionDetail] {
    &library().champions
}

pub fn champion_detail(champion_id: i64) -> Option<ChampionDetail> {
    champions()
        .iter()
        .find(|champion| champion.id == champion_id)
        .cloned()
}

pub fn champion_matchups(
    champion_id: i64,
    tier: &str,
    lane: &str,
) -> Result<MatchupSnapshot, String> {
    const TIERS: [&str; 6] = [
        "all",
        "gold_plus",
        "platinum_plus",
        "emerald_plus",
        "diamond_plus",
        "master_plus",
    ];
    const LANES: [&str; 5] = ["top", "jungle", "middle", "bottom", "support"];
    if !TIERS.contains(&tier) {
        return Err(format!("unsupported matchup tier: {tier}"));
    }
    if !LANES.contains(&lane) {
        return Err(format!("unsupported matchup lane: {lane}"));
    }

    let snapshot = matchup_snapshots()
        .get(tier)
        .expect("validated matchup tier must exist");
    let rows = snapshot
        .champions
        .get(&champion_id)
        .and_then(|positions| positions.get(lane))
        .cloned()
        .unwrap_or_default();
    Ok(MatchupSnapshot {
        patch: snapshot.patch.clone(),
        tier: snapshot.tier.clone(),
        lane: lane.to_string(),
        region: snapshot.region.clone(),
        generated_at: snapshot.generated_at.clone(),
        source: snapshot.source.clone(),
        is_partial: snapshot.is_partial,
        rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_library_has_valid_catalog_and_details() {
        assert!(champions().len() >= 170);
        let ahri = champion_detail(103).expect("Ahri exists");
        assert_eq!(ahri.name, "阿狸");
        assert!(ahri.stats.attack_damage.growth > 0.0);
        assert_eq!(ahri.abilities.len(), 5);
    }

    #[test]
    fn matchup_query_is_bounded_and_returns_snapshot_context() {
        let result = champion_matchups(103, "emerald_plus", "middle").unwrap();
        assert_eq!(result.tier, "emerald_plus");
        assert_eq!(result.lane, "middle");
        assert!(result.is_partial);
        assert!(!result.rows.is_empty());
        assert!(champion_matchups(103, "invalid", "middle").is_err());
    }
}
