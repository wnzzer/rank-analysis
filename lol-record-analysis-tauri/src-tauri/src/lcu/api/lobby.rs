use serde::{Deserialize, Serialize};
use serde_json::Value; // Needed for 'any' types

// Lobby struct
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Lobby {
    pub can_start_activity: bool,
    pub game_config: GameConfig,
    pub invitations: Vec<Value>, // []any -> Vec<serde_json::Value>
    pub local_member: Member,
    pub members: Vec<Member>,
    pub muc_jwt_dto: Value, // Assuming MucJwtDto is a generic JSON object, otherwise define a struct for it
    pub multi_user_chat_id: String,
    pub multi_user_chat_password: String,
    pub party_id: String,
    pub party_type: String,
    pub popular_champions: Vec<Value>, // []any -> Vec<serde_json::Value>
    pub restrictions: Value,           // any -> serde_json::Value
    pub scarce_positions: Vec<Value>,  // []any -> Vec<serde_json::Value>
    pub warnings: Value,               // any -> serde_json::Value
}

// GameConfig struct
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameConfig {
    pub allowable_premade_sizes: Vec<Value>, // []any -> Vec<serde_json::Value>
    pub custom_lobby_name: String,
    pub custom_mutator_name: String,
    pub custom_rewards_disabled_reasons: Vec<Value>, // []any -> Vec<serde_json::Value>
    pub custom_spectator_policy: String,
    pub custom_spectators: Vec<Value>, // []any -> Vec<serde_json::Value>
    pub custom_team100: Vec<Member>,
    pub custom_team200: Vec<Member>,
    pub game_mode: String,
    pub is_custom: bool,
    pub is_lobby_full: bool,
    pub is_team_builder_managed: bool,
    pub map_id: i32,
    pub max_human_players: i32,
    pub max_lobby_size: i32,
    pub max_team_size: i32,
    pub pick_type: String,
    pub premade_size_allowed: bool,
    pub queue_id: i32,
    pub should_force_scarce_position_selection: bool,
    pub show_position_selector: bool,
    pub show_quick_play_slot_selection: bool,
}

// PlayerSlot struct
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSlot {
    pub champion_id: i32,
    pub perks: String,
    pub position_preference: String,
    pub skin_id: i32,
    pub spell1: i32,
    pub spell2: i32,
}

// Member struct
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub allowed_change_activity: bool,
    pub allowed_invite_others: bool,
    pub allowed_kick_others: bool,
    pub allowed_start_activity: bool,
    pub allowed_toggle_invite: bool,
    pub auto_fill_eligible: bool,
    pub auto_fill_protected_for_promos: bool,
    pub auto_fill_protected_for_remedy: bool,
    pub auto_fill_protected_for_soloing: bool,
    pub auto_fill_protected_for_streaking: bool,
    pub bot_champion_id: i32,
    pub bot_difficulty: String,
    pub bot_id: String,
    pub bot_position: String,
    pub bot_uuid: String,
    pub first_position_preference: String,
    pub intra_subteam_position: Value, // any -> serde_json::Value
    pub is_bot: bool,
    pub is_leader: bool,
    pub is_spectator: bool,
    pub member_data: Value, // any -> serde_json::Value
    pub player_slots: Vec<PlayerSlot>,
    pub puuid: String,
    pub ready: bool,
    pub second_position_preference: String,
    pub show_ghosted_banner: bool,
    pub strawberry_map_id: Value, // any -> serde_json::Value
    pub subteam_index: Value,     // any -> serde_json::Value
    pub summoner_icon_id: i32,
    pub summoner_id: i64, // Go's int64 maps to Rust's i64
    pub summoner_internal_name: String,
    pub summoner_level: i32,
    pub summoner_name: String,
    pub team_id: i32,
}
#[derive(Serialize)]
struct EmptyJsonBody {} // 一个空的结构体
impl Lobby {
    pub async fn get_lobby() -> Result<Self, String> {
        let uri = "lol-lobby/v2/lobby";
        let lobby: Self = crate::lcu::util::http::lcu_get(uri).await?;
        Ok(lobby)
    }

    pub async fn post_match_search() -> Result<(), String> {
        let uri = "lol-lobby/v2/lobby/matchmaking/search";
        let empty_json_body = EmptyJsonBody {};
        crate::lcu::util::http::lcu_post::<(), _>(uri, &empty_json_body).await?;
        Ok(())
    }
}
