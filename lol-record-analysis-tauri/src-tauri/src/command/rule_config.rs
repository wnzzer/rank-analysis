//! 规则引擎使用的数据类型：位置、条件、动作、规则。
//!
//! 与前端 `src/types/rules.ts` 保持同构。

use serde::{Deserialize, Serialize};

// 顺序与 LCU assignedPosition 字符串顺序一致：top/jungle/middle/bottom/utility
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Position {
    Top,
    Jungle,
    Middle,
    Bottom,
    Utility,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RuleCondition {
    Position { value: Position },
    AllyChampionsContains { ids: Vec<i32> },
    AllyChampionsNotContains { ids: Vec<i32> },
    EnemyChampionsContains { ids: Vec<i32> },
    EnemyChampionsNotContains { ids: Vec<i32> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_round_trip() {
        let p = Position::Middle;
        let s = serde_json::to_string(&p).unwrap();
        assert_eq!(s, r#""middle""#);
        let back: Position = serde_json::from_str(&s).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn condition_position_round_trip() {
        let c = RuleCondition::Position { value: Position::Top };
        let s = serde_json::to_string(&c).unwrap();
        assert!(s.contains(r#""type":"Position""#));
        let back: RuleCondition = serde_json::from_str(&s).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn condition_ally_contains_round_trip() {
        let c = RuleCondition::AllyChampionsContains { ids: vec![157, 99] };
        let back: RuleCondition = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }

    #[test]
    fn condition_enemy_not_contains_round_trip() {
        let c = RuleCondition::EnemyChampionsNotContains { ids: vec![89] };
        let back: RuleCondition = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }
}
