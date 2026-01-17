use crate::fandom::data::{AramBalanceData, FandomBalanceParams};
use mlua::prelude::*;
use reqwest::Client;
use scraper::{Html, Selector};
use std::collections::HashMap;

const DATA_URL: &str = "https://leagueoflegends.fandom.com/wiki/Module:ChampionData/data";

pub async fn fetch_aram_balance_data(
) -> Result<FandomBalanceParams, Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::new();
    // Headers might be needed to avoid blocking? simple get is usually fine for fandom/wiki.
    let resp = client.get(DATA_URL).send().await?.text().await?;

    let document = Html::parse_document(&resp);
    // finding <pre class="mw-code mw-script" dir="ltr">
    let selector =
        Selector::parse("pre.mw-code.mw-script").map_err(|e| format!("Selector error: {:?}", e))?;

    let lua_script = if let Some(element) = document.select(&selector).next() {
        element.text().collect::<String>()
    } else {
        return Err("Could not find Lua script in Fandom page".into());
    };

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
            Err(_) => continue,
        }
    }

    Ok(results)
}
