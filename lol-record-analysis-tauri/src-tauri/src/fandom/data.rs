use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AramBalanceData {
    pub dmg_dealt: Option<f64>,
    pub dmg_taken: Option<f64>,
    pub healing: Option<f64>,
    pub shielding: Option<f64>,
    pub ability_haste: Option<f64>,
    pub mana_regen: Option<f64>,
    pub energy_regen: Option<f64>,
    pub attack_speed: Option<f64>,
    pub movement_speed: Option<f64>,
    pub tenacity: Option<f64>,
}

impl Default for AramBalanceData {
    fn default() -> Self {
        Self {
            dmg_dealt: Some(1.0),
            dmg_taken: Some(1.0),
            healing: None,
            shielding: None,
            ability_haste: None,
            mana_regen: None,
            energy_regen: None,
            attack_speed: None,
            movement_speed: None,
            tenacity: None,
        }
    }
}

// Map from Champion ID to their ARAM balance data
pub type FandomBalanceParams = std::collections::HashMap<i32, AramBalanceData>;
