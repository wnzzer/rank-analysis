//! 公共英雄资料与账号炫彩只读查询。
//!
//! 英雄目录、详情和对位数据来自构建期内置快照，完全不依赖 LCU。
//! 炫彩所有权只读取当前登录账号的 LCU inventory，不执行任何写操作。

use crate::cn_patch_notes;
use crate::game_data;
use crate::lcu::api::asset;
use crate::lcu::api::summoner::Summoner;
use crate::lcu::util::http::lcu_get;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionCollectionItem {
    pub id: i64,
    pub name: String,
    pub title: String,
    pub alias: String,
    pub portrait_url: Option<String>,
    pub lanes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchChangeItem {
    pub champion_id: i64,
    pub direction: crate::fandom::patch_notes::ChangeDirection,
    pub lines: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCollection {
    pub label: String,
    pub published_at: String,
    pub source_url: String,
    pub is_fresh: bool,
    pub changes: Vec<PatchChangeItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampionCollection {
    pub source: &'static str,
    pub data_patch: String,
    pub generated_at: String,
    pub champions: Vec<ChampionCollectionItem>,
    pub patch: Option<PatchCollection>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OwnedChroma {
    pub champion_id: i64,
    pub champion_name: String,
    pub skin_id: i64,
    pub skin_name: String,
    pub chroma_id: i64,
    pub chroma_name: String,
    pub colors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedChromaCollection {
    pub summoner_name: String,
    pub chromas: Vec<OwnedChroma>,
    pub is_partial: bool,
    pub warning: Option<String>,
}

#[derive(Default)]
struct ParsedChromas {
    chromas: Vec<OwnedChroma>,
    skin_paths: Vec<(i64, String)>,
    chroma_paths: Vec<(i64, String)>,
    saw_chroma_container: bool,
    observed_chroma_count: usize,
    inspected_skin_count: usize,
    chroma_container_count: usize,
}

async fn load_champions() -> Result<(&'static str, Vec<ChampionCollectionItem>), String> {
    // 公共英雄资料始终来自构建期校验过的内置快照。这里绝不探测 LCU，也不等待网络。
    let mut items = game_data::champions()
        .iter()
        .map(|champion| ChampionCollectionItem {
            id: champion.id,
            name: champion.name.clone(),
            title: champion.title.clone(),
            alias: champion.alias.clone(),
            portrait_url: Some(champion.portrait_url.clone()),
            lanes: champion.lanes.clone(),
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(("bundledSnapshot", items))
}

fn load_patch() -> Option<PatchCollection> {
    let data = cn_patch_notes::bundled_data()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    Some(PatchCollection {
        label: data.patch_label.clone(),
        published_at: data.published_at.clone(),
        source_url: data.source_url.clone(),
        is_fresh: cn_patch_notes::is_fresh(&data, now),
        changes: data
            .champions
            .iter()
            .map(|note| PatchChangeItem {
                champion_id: note.champion_id,
                direction: note.direction,
                lines: note.lines.clone(),
            })
            .collect(),
    })
}

/// 一次性返回英雄目录与当前国服版本改动，避免前端逐英雄调用。
#[tauri::command]
pub async fn get_champion_collection() -> Result<ChampionCollection, String> {
    let (source, champions) = load_champions().await?;
    Ok(ChampionCollection {
        source,
        data_patch: game_data::patch().to_string(),
        generated_at: game_data::generated_at().to_string(),
        champions,
        patch: load_patch(),
    })
}

/// 返回单英雄的公共版本档案。数据随安装包内置，不需要启动或登录 LCU。
#[tauri::command]
pub async fn get_champion_detail(champion_id: i64) -> Result<game_data::ChampionDetail, String> {
    game_data::champion_detail(champion_id)
        .ok_or_else(|| format!("champion {champion_id} not found in bundled snapshot"))
}

/// 返回构建期生成的全球服关键对位快照；不会在用户电脑上直连 OP.GG。
#[tauri::command]
pub async fn get_champion_matchups(
    champion_id: i64,
    tier: String,
    lane: String,
) -> Result<game_data::MatchupSnapshot, String> {
    game_data::champion_matchups(champion_id, &tier, &lane)
}

fn field_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|field| {
        field
            .as_i64()
            .or_else(|| field.as_u64().and_then(|number| i64::try_from(number).ok()))
            .or_else(|| field.as_str().and_then(|text| text.parse().ok()))
    })
}

fn field_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn is_owned(value: &Value) -> bool {
    ["owned", "isOwned", "unlocked"]
        .into_iter()
        .any(|key| value.get(key).and_then(Value::as_bool).unwrap_or(false))
        || value.get("ownership").is_some_and(|ownership| {
            ["owned", "isOwned", "unlocked"]
                .into_iter()
                .any(|key| ownership.get(key).and_then(Value::as_bool).unwrap_or(false))
        })
}

fn parse_skins(champion_id: i64, champion_name: &str, skins: &[Value], parsed: &mut ParsedChromas) {
    for skin in skins {
        parsed.inspected_skin_count += 1;
        let skin_id = field_i64(skin, "id").unwrap_or_default();
        let skin_name = field_text(skin, "name");
        let skin_path = ["tilePath", "splashPath", "uncenteredSplashPath"]
            .into_iter()
            .find_map(|key| skin.get(key).and_then(Value::as_str))
            .unwrap_or_default();
        if skin_id > 0 && !skin_path.is_empty() {
            parsed.skin_paths.push((skin_id, skin_path.to_string()));
        }
        let candidates = ["chromas", "childSkins"]
            .into_iter()
            .find_map(|key| skin.get(key).and_then(Value::as_array));
        let Some(candidates) = candidates else {
            continue;
        };
        parsed.saw_chroma_container = true;
        parsed.chroma_container_count += 1;
        parsed.observed_chroma_count += candidates.len();
        for chroma in candidates.iter().filter(|chroma| is_owned(chroma)) {
            let chroma_id = field_i64(chroma, "id").unwrap_or_default();
            if chroma_id <= 0 {
                continue;
            }
            let chroma_path = field_text(chroma, "chromaPath");
            if !chroma_path.is_empty() {
                parsed.chroma_paths.push((chroma_id, chroma_path));
            }
            let mut chroma_name = field_text(chroma, "name");
            if chroma_name.is_empty() {
                chroma_name = format!("炫彩 {}", chroma_id);
            }
            parsed.chromas.push(OwnedChroma {
                champion_id,
                champion_name: champion_name.to_string(),
                skin_id,
                skin_name: skin_name.clone(),
                chroma_id,
                chroma_name,
                colors: chroma
                    .get("colors")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect(),
            });
        }
    }
}

fn finish_parsed(mut parsed: ParsedChromas) -> ParsedChromas {
    let mut seen = HashSet::new();
    parsed
        .chromas
        .retain(|chroma| seen.insert(chroma.chroma_id));
    parsed.chromas.sort_by(|left, right| {
        (&left.champion_name, &left.skin_name, &left.chroma_name).cmp(&(
            &right.champion_name,
            &right.skin_name,
            &right.chroma_name,
        ))
    });
    parsed
}

fn parse_owned_chromas(payload: &Value) -> ParsedChromas {
    let mut parsed = ParsedChromas::default();
    for champion in payload.as_array().into_iter().flatten() {
        let champion_id = field_i64(champion, "id")
            .or_else(|| field_i64(champion, "championId"))
            .unwrap_or_default();
        let champion_name = field_text(champion, "name");
        let skins = champion
            .get("skins")
            .and_then(Value::as_array)
            .into_iter()
            .flatten();
        parse_skins(champion_id, &champion_name, skins, &mut parsed);
    }
    finish_parsed(parsed)
}

async fn load_chromas_by_champion(summoner_id: u64) -> Result<(ParsedChromas, usize), String> {
    let minimal_uri = format!("lol-champions/v1/inventories/{summoner_id}/skins-minimal");
    let minimal = lcu_get::<Value>(&minimal_uri).await?;
    let minimal = minimal
        .as_array()
        .ok_or_else(|| "客户端返回的 skins-minimal 不是数组".to_string())?;
    let champion_ids = minimal
        .iter()
        .filter_map(|skin| {
            field_i64(skin, "championId").or_else(|| field_i64(skin, "id").map(|id| id / 1_000))
        })
        .filter(|id| *id > 0)
        .collect::<HashSet<_>>();
    if champion_ids.is_empty() {
        return Err("客户端没有返回可查询的皮肤英雄列表".to_string());
    }

    asset::init().await;
    let champion_names = asset::CHAMPION_CACHE
        .read()
        .map_err(|error| error.to_string())?
        .iter()
        .map(|(id, champion)| {
            let name = if champion.description.is_empty() {
                champion.name.clone()
            } else {
                champion.description.clone()
            };
            (*id, name)
        })
        .collect::<HashMap<_, _>>();

    let mut parsed = ParsedChromas::default();
    let mut failed = 0;
    let champion_ids = champion_ids.into_iter().collect::<Vec<_>>();
    for chunk in champion_ids.chunks(8) {
        let mut tasks = tokio::task::JoinSet::new();
        for champion_id in chunk {
            let champion_id = *champion_id;
            tasks.spawn(async move {
                let uri = format!(
                    "lol-champions/v1/inventories/{summoner_id}/champions/{champion_id}/skins"
                );
                (champion_id, lcu_get::<Value>(&uri).await)
            });
        }
        while let Some(result) = tasks.join_next().await {
            match result {
                Ok((champion_id, Ok(value))) => {
                    if let Some(skins) = value.as_array() {
                        let champion_name = champion_names
                            .get(&champion_id)
                            .cloned()
                            .unwrap_or_else(|| format!("英雄 {champion_id}"));
                        parse_skins(champion_id, &champion_name, skins, &mut parsed);
                    } else {
                        failed += 1;
                    }
                }
                Ok((champion_id, Err(error))) => {
                    failed += 1;
                    log::warn!("读取英雄 {} 皮肤失败: {}", champion_id, error);
                }
                Err(error) => {
                    failed += 1;
                    log::warn!("读取英雄皮肤任务失败: {}", error);
                }
            }
        }
    }
    Ok((finish_parsed(parsed), failed))
}

/// 读取当前登录账号拥有的炫彩。接口全程只执行 GET。
#[tauri::command]
pub async fn get_owned_chromas() -> Result<OwnedChromaCollection, String> {
    let summoner = Summoner::get_my_summoner().await?;
    if summoner.summoner_id == 0 {
        return Err("客户端未返回当前账号的 summonerId".to_string());
    }
    let uri = format!(
        "lol-champions/v1/inventories/{}/champions",
        summoner.summoner_id
    );
    let fast = match lcu_get::<Value>(&uri).await {
        Ok(payload) => parse_owned_chromas(&payload),
        Err(error) => {
            log::warn!("全量英雄藏品读取失败，改用逐英雄皮肤接口: {}", error);
            ParsedChromas::default()
        }
    };
    let fast_is_complete = fast.saw_chroma_container
        && fast.observed_chroma_count > 0
        && fast.chroma_container_count == fast.inspected_skin_count;
    let (parsed, failed) = if fast_is_complete {
        (fast, 0)
    } else {
        load_chromas_by_champion(summoner.summoner_id).await?
    };
    if !parsed.saw_chroma_container || parsed.observed_chroma_count == 0 {
        return Err("客户端响应未包含可识别的炫彩列表，无法确认账号库存".to_string());
    }
    let schema_partial = parsed.chroma_container_count < parsed.inspected_skin_count;
    if (failed > 0 || schema_partial) && parsed.chromas.is_empty() {
        return Err(format!(
            "炫彩读取不完整（{failed} 个英雄请求失败），暂时无法确认账号是否拥有炫彩"
        ));
    }
    asset::register_collection_asset_paths(parsed.skin_paths, parsed.chroma_paths)?;
    Ok(OwnedChromaCollection {
        summoner_name: format!("{}#{}", summoner.game_name, summoner.tag_line),
        chromas: parsed.chromas,
        is_partial: failed > 0 || schema_partial,
        warning: (failed > 0 || schema_partial)
            .then(|| format!("有 {failed} 个英雄读取失败或字段不完整，当前结果可能不完整")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_owned_chromas_and_accepts_string_ids() {
        let payload = serde_json::json!([{
            "id": 1,
            "name": "安妮",
            "skins": [{
                "id": 1000,
                "name": "哥特萝莉",
                "tilePath": "/skin.png",
                "chromas": [
                    {"id": "1001", "name": "红宝石", "colors": ["#ef4444"], "ownership": {"owned": true}, "chromaPath": "/chroma.png"},
                    {"id": 1002, "name": "蓝宝石", "ownership": {"owned": false}}
                ]
            }]
        }]);
        let parsed = parse_owned_chromas(&payload);
        assert_eq!(parsed.chromas.len(), 1);
        assert_eq!(parsed.chromas[0].chroma_name, "红宝石");
        assert_eq!(parsed.skin_paths, vec![(1000, "/skin.png".to_string())]);
        assert_eq!(parsed.chroma_paths, vec![(1001, "/chroma.png".to_string())]);
        assert!(parsed.saw_chroma_container);
        assert_eq!(parsed.observed_chroma_count, 2);
    }

    #[test]
    fn accepts_child_skins_and_deduplicates_chromas() {
        let payload = serde_json::json!([{
            "championId": "103",
            "name": "阿狸",
            "skins": [{
                "id": 103027,
                "name": "灵魂莲华",
                "childSkins": [
                    {"id": 1030271, "name": "红宝石", "isOwned": true},
                    {"id": 1030271, "name": "红宝石", "unlocked": true}
                ]
            }]
        }]);
        let parsed = parse_owned_chromas(&payload);
        assert_eq!(parsed.chromas.len(), 1);
        assert_eq!(parsed.chromas[0].champion_id, 103);
    }
}
