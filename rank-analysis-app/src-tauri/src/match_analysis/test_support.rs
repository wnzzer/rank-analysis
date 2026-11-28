//! # 测试共用构造器
//!
//! - TS `src/services/ai/shared/__tests__/scoringFixtures.ts` 的 `makeScoringGame` / `makeScoringTimeline`
//! - 入库匿名回归局 A / B（`src/services/ai/shared/scoring/__tests__/fixtures/regression-{a,b}.json`）

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::input::LcuGame;
use crate::lcu::api::timeline::{SlimEvent, SlimFrame, SlimPlayerFrame, SlimTimeline};

const POS: [&str; 5] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

/// 浅合并（TS 对象展开 `{ ...base, ...overrides }`）；`null` 值表示 TS 的 `undefined`
#[allow(dead_code)] // 后续任务（snapshot 测试）才使用
pub(crate) fn merge_shallow(base: &mut Value, overrides: Value) {
    if let (Some(b), Value::Object(o)) = (base.as_object_mut(), overrides) {
        for (k, v) in o {
            b.insert(k, v);
        }
    }
}

/// 10 人：1-5 蓝方胜、6-10 红方，按上野中下辅（TS `makeScoringGame`）
pub(crate) fn make_scoring_game() -> Value {
    let participants: Vec<Value> = (1..=10_i64)
        .map(|id| {
            let pos = POS[((id - 1) % 5) as usize];
            json!({
                "participantId": id,
                "teamId": if id <= 5 { 100 } else { 200 },
                "championId": id,
                "spell1Id": 4,
                "spell2Id": if id % 5 == 2 { 11 } else { 14 },
                "teamPosition": pos,
                "stats": {
                    "win": id <= 5,
                    "kills": id,
                    "deaths": 11 - id,
                    "assists": 5,
                    "totalDamageDealtToChampions": 10000 + id * 1000,
                    "totalDamageTaken": 15000,
                    "goldEarned": 9000 + id * 300,
                    "totalMinionsKilled": 150,
                    "neutralMinionsKilled": if id % 5 == 2 { 120 } else { 5 },
                    "totalHeal": 500,
                    "damageDealtToTurrets": 1000,
                    "damageDealtToObjectives": id * 1000,
                    "timeCCingOthers": id * 2,
                    "visionScore": 20,
                    "item6": 3340
                },
                "timeline": { "lane": pos, "role": "NONE" }
            })
        })
        .collect();
    let identities: Vec<Value> = (1..=10_i64)
        .map(|id| {
            json!({
                "participantId": id,
                "player": { "gameName": format!("玩家{id}"), "tagLine": "0000", "puuid": format!("puuid-{id}") }
            })
        })
        .collect();
    json!({
        "gameId": 7,
        "queueId": 420,
        "queueName": "单双排",
        "gameMode": "CLASSIC",
        "mapId": 11,
        "gameDuration": 1800,
        "participants": participants,
        "participantIdentities": identities
    })
}

/// 一条单杀时间线：两帧、1 号在 5 分钟击杀 6 号（TS `makeScoringTimeline`）
pub(crate) fn make_scoring_timeline() -> SlimTimeline {
    let players = |t: i64| -> Vec<SlimPlayerFrame> {
        (1..=10)
            .map(|pid| SlimPlayerFrame {
                participant_id: pid,
                total_gold: 500 + t,
                xp: 0,
                level: 1,
                cs: 0,
                jungle_cs: 0,
                x: 7000,
                y: 7000,
                damage_to_champions: 0,
            })
            .collect()
    };
    SlimTimeline {
        game_id: 7,
        frame_interval_ms: 60000,
        participants: vec![],
        frames: vec![
            SlimFrame {
                timestamp: 0,
                players: players(0),
            },
            SlimFrame {
                timestamp: 600_000,
                players: players(1),
            },
        ],
        events: vec![SlimEvent::ChampionKill {
            timestamp: 300_000,
            killer_id: 1,
            victim_id: 6,
            assisting: vec![],
            x: 1000,
            y: 10000,
            bounty: 300,
            shutdown_bounty: 0,
            damage_received: vec![],
        }],
        items: BTreeMap::new(),
    }
}

/// 读入库回归局：`'a'` 或 `'b'` → (LCU 对局, 未 remap 的时间线)
pub(crate) fn regression_fixture(which: char) -> (LcuGame, SlimTimeline) {
    let text = match which {
        'a' => include_str!(
            "../../../src/services/ai/shared/scoring/__tests__/fixtures/regression-a.json"
        ),
        'b' => include_str!(
            "../../../src/services/ai/shared/scoring/__tests__/fixtures/regression-b.json"
        ),
        other => panic!("没有回归局 {other}"),
    };
    let v: Value = serde_json::from_str(text).expect("fixture 是合法 JSON");
    (
        serde_json::from_value(v["game"].clone()).expect("fixture game 可解析为 LcuGame"),
        serde_json::from_value(v["slim"].clone()).expect("fixture slim 可解析为 SlimTimeline"),
    )
}
