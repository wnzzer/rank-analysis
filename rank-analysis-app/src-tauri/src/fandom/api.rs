use crate::fandom::data::{AramBalanceData, FandomBalanceParams};
use mlua::prelude::*;
use reqwest::Client;
use std::collections::HashMap;

const DATA_URL: &str = "https://leagueoflegends.fandom.com/api.php?action=query&format=json&prop=revisions&titles=Module:ChampionData/data&rvprop=content&rvslots=main";

pub async fn fetch_aram_balance_data(
) -> Result<FandomBalanceParams, Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()?;

    log::info!("Fetching Fandom API: {}", DATA_URL);
    let resp = client
        .get(DATA_URL)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    // Extract content from JSON path: query -> pages -> {pageid} -> revisions -> [0] -> slots -> main -> *
    let query = resp.get("query").ok_or("No query field in response")?;
    let pages = query.get("pages").ok_or("No pages field in response")?;

    // keys are dynamic page IDs
    let page = if let Some(obj) = pages.as_object() {
        obj.values().next().ok_or("No page in pages object")?
    } else {
        return Err("Pages is not an object".into());
    };

    let revisions = page.get("revisions").ok_or("No revisions field")?;
    let first_rev = revisions.get(0).ok_or("No revisions found")?;
    let slots = first_rev.get("slots").ok_or("No slots field")?;
    let main_slot = slots.get("main").ok_or("No main slot")?;
    let content_val = main_slot.get("*").ok_or("No content in main slot")?;

    let lua_script = content_val
        .as_str()
        .ok_or("Content is not a string")?
        .to_string();

    log::info!(
        "Extracted Lua script from API, length: {}",
        lua_script.len()
    );

    if !lua_script.contains("return {") {
        return Err("Extracted content does not look like Lua script".into());
    }

    let lua = Lua::new();

    // The script is typically: return { ... }
    // We can eval it directly.
    let table: LuaTable = lua.load(&lua_script).eval()?;

    let mut results: FandomBalanceParams = HashMap::new();

    for pair in table.pairs::<String, LuaTable>() {
        match pair {
            Ok((_name, champ_data)) => {
                let id: Option<i32> = champ_data.get("id").ok();
                if let Some(champ_id) = id {
                    if let Ok(stats) = champ_data.get::<_, LuaTable>("stats") {
                        if let Ok(aram) = stats.get::<_, LuaTable>("aram") {
                            let balance = AramBalanceData {
                                dmg_dealt: aram.get("dmg_dealt").ok().or(Some(1.0)),
                                dmg_taken: aram.get("dmg_taken").ok().or(Some(1.0)),
                                healing: aram.get("healing").ok(),
                                shielding: aram.get("shielding").ok(),
                                ability_haste: aram.get("ability_haste").ok(),
                                mana_regen: aram.get("mana_regen").ok(),
                                energy_regen: aram.get("energy_regen").ok(),
                                attack_speed: aram.get("attack_speed").ok(),
                                movement_speed: aram.get("movement_speed").ok(),
                                tenacity: aram.get("tenacity").ok(),
                            };
                            results.insert(champ_id, balance);
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Error iterating Lua table: {:?}", e);
                continue;
            }
        }
    }

    log::info!("Total fetched ARAM balance entries: {}", results.len());
    Ok(results)
}
