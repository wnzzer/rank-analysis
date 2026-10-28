//! 对位统计测试：固定原始数据验证统计方向与缓存边界。
use super::*;
use serde_json::json;
/// 构造固定版本的查询，避免测试依赖在线数据。
fn query() -> MatchupQuery {
    MatchupQuery {
        enemy_id: 103,
        position: "mid".into(),
        tier: "emerald_plus".into(),
        version: Some("16.21".into()),
    }
}
/// 构造双方样本数不同的原始响应。
fn sample() -> serde_json::Value {
    json!({"meta":{"version":"16.21","cached_at":"source-time"},"data":[{"champion_id":103,"play":100,"win":60,"lane_kill":30},{"champion_id":517,"play":80,"win":20,"lane_kill":70}]})
}
/// 候选胜率必须来自自身样本，线杀率使用双方 lane_kill。
#[test]
fn matchup_direction_and_zero() {
    let q = query();
    let mut raw = sample();
    let d = parse_detail(&q, 517, &raw, 12).unwrap();
    assert_eq!(d.candidate_win_rate, Some(0.25));
    assert_eq!(d.lane_kill_rate, Some(0.7));
    raw["data"][1]["win"] = json!(0);
    assert_eq!(
        parse_detail(&q, 517, &raw, 12).unwrap().candidate_win_rate,
        Some(0.0)
    );
}
/// 非法计数、缺少双方和零分母不能伪造百分比。
#[test]
fn matchup_invalid_counts_and_missing() {
    for value in [json!(-1), json!(81), json!(null)] {
        let mut raw = sample();
        raw["data"][1]["win"] = value;
        assert_eq!(
            parse_detail(&query(), 517, &raw, 0)
                .unwrap()
                .candidate_win_rate,
            None
        );
    }
    let mut raw = sample();
    raw["data"][1]["play"] = json!(0);
    assert_eq!(
        parse_detail(&query(), 517, &raw, 0)
            .unwrap()
            .candidate_win_rate,
        None
    );
    raw["data"].as_array_mut().unwrap().pop();
    let missing = parse_detail(&query(), 517, &raw, 0).unwrap();
    assert_eq!(missing.candidate_win_rate, None);
    assert_eq!(missing.lane_kill_rate, None);
    assert_eq!(missing.play, None);
    raw["data"] = json!([]);
    let d = parse_detail(&query(), 517, &raw, 0).unwrap();
    assert_eq!(d.lane_kill_rate, None);
    assert_eq!(d.play, None);
}
/// 打野线杀率始终不适用，版本不一致必须拒绝。
#[test]
fn matchup_jungle_version_validation() {
    let mut q = query();
    q.position = "jungle".into();
    assert_eq!(
        parse_detail(&q, 517, &sample(), 0).unwrap().lane_kill_rate,
        None
    );
    q.version = Some("16.20".into());
    assert!(parse_detail(&q, 517, &sample(), 0).is_err());
    q.position = "../../".into();
    assert!(validate(&q, Some(517)).is_err());
    q = query();
    q.tier = "evil".into();
    assert!(validate(&q, None).is_err());
    q = query();
    q.version = None;
    assert!(validate(&q, Some(517)).is_err());
}
/// 列表的胜率保持敌方方向，丢弃非法样本但保留零胜场。
#[test]
fn matchup_list_direction() {
    let raw = json!({"meta":{"version":"16.21"},"data":[{"champion_id":517,"play":100,"win":60},{"champion_id":1,"play":4,"win":0},{"champion_id":2,"play":0,"win":0}]});
    let list = parse_list(&query(), &raw, 42).unwrap();
    assert_eq!(list.candidates.len(), 2);
    assert_eq!(list.candidates[0].enemy_win_rate, 0.6);
    assert_eq!(list.candidates[1].enemy_win_rate, 0.0);
    assert_eq!(list.cached_at, None);
}
/// 双方线杀均为零或负数时不得补成 50%。
#[test]
fn matchup_lane_zero_and_negative() {
    for value in [0, -1] {
        let mut raw = sample();
        raw["data"][0]["lane_kill"] = json!(0);
        raw["data"][1]["lane_kill"] = json!(value);
        assert_eq!(
            parse_detail(&query(), 517, &raw, 0).unwrap().lane_kill_rate,
            None
        );
    }
}
/// 缓存键包含段位、版本、位置、敌方与候选，禁止跨上下文命中。
#[test]
fn matchup_cache_key_isolation() {
    let base = query();
    for changed in [
        MatchupQuery {
            tier: "gold_plus".into(),
            ..base.clone()
        },
        MatchupQuery {
            version: Some("16.20".into()),
            ..base.clone()
        },
        MatchupQuery {
            position: "top".into(),
            ..base.clone()
        },
        MatchupQuery {
            enemy_id: 1,
            ..base.clone()
        },
    ] {
        assert_ne!(key(&base, Some(517)), key(&changed, Some(517)));
    }
    assert_ne!(key(&base, None), key(&base, Some(517)));
}
/// 同键并发只执行一个抓取，过期失败仅回退同键旧值并保留抓取时间。
#[tokio::test]
async fn matchup_cache_merge_and_stale() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let cache = MatchupCache::new(Duration::from_millis(20));
    let calls = AtomicUsize::new(0);
    let load = || async {
        calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(5)).await;
        Ok(Stored {
            raw: sample(),
            fetched_at: 10,
        })
    };
    let (a, b) = tokio::join!(
        cache.get("same".into(), load()),
        cache.get("same".into(), load())
    );
    assert!(!a.unwrap().1);
    assert!(!b.unwrap().1);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    tokio::time::sleep(Duration::from_millis(40)).await;
    let (old, stale) = cache
        .get("same".into(), async { Err("network down".into()) })
        .await
        .unwrap();
    assert!(stale);
    assert_eq!(old.fetched_at, 10);
    assert!(cache
        .get("other-tier".into(), async { Err("network down".into()) })
        .await
        .is_err());
    let (_, stale) = cache
        .get("same".into(), async {
            Ok(Stored {
                raw: sample(),
                fetched_at: 20,
            })
        })
        .await
        .unwrap();
    assert!(!stale);
}
/// 旧数据容量有界，超过容量后维护任务完成时不无限累积。
#[tokio::test]
async fn matchup_cache_capacity() {
    let cache = MatchupCache::new(Duration::from_secs(1));
    for i in 0..600 {
        cache
            .get(i.to_string(), async {
                Ok(Stored {
                    raw: sample(),
                    fetched_at: 1,
                })
            })
            .await
            .unwrap();
    }
    cache.old.run_pending_tasks().await;
    assert!(cache.old.entry_count() <= 512);
}
/// 2026-10-28 实际 OP.GG 响应的必要字段，验证适配与真实计数一致。
#[test]
fn matchup_actual_source_sample() {
    let raw = json!({"meta":{"version":"16.21","cached_at":"2026-10-28 17:15:50"},"data":[{"version":"16.21","champion_id":103,"play":4780,"win":2527,"lane_kill":10443},{"version":"16.21","champion_id":517,"play":4780,"win":2252,"lane_kill":9725}]});
    let detail = parse_detail(&query(), 517, &raw, 100).unwrap();
    assert_eq!(detail.candidate_win_rate, Some(2252.0 / 4780.0));
    assert_eq!(detail.lane_kill_rate, Some(9725.0 / (9725.0 + 10443.0)));
    assert_eq!(detail.cached_at.as_deref(), Some("2026-10-28 17:15:50"));
}
/// 详情行版本也必须一致，非法英雄 ID 和注入形式版本均被拒绝。
#[test]
fn matchup_row_version_and_invalid_ids() {
    let mut raw = sample();
    raw["data"][1]["version"] = json!("16.20");
    assert!(parse_detail(&query(), 517, &raw, 0).is_err());
    let mut q = query();
    q.enemy_id = 0;
    assert!(validate(&q, None).is_err());
    q = query();
    assert!(validate(&q, Some(-1)).is_err());
    assert!(validate(&q, Some(103)).is_err());
    for version in ["", "16.21&x=1", "../16", "16.21.1", "abc"] {
        q.version = Some(version.into());
        assert!(validate(&q, None).is_err());
    }
}
/// 列表行可缺省版本；若显式携带版本则必须与 meta 和查询版本一致。
#[test]
fn matchup_list_rejects_mismatched_row_version() {
    let mut raw =
        json!({"meta":{"version":"16.21"},"data":[{"champion_id":517,"play":100,"win":60}]});
    assert!(parse_list(&query(), &raw, 0).is_ok());
    raw["data"][0]["version"] = json!("16.21");
    assert!(parse_list(&query(), &raw, 0).is_ok());
    raw["data"][0]["version"] = json!("16.20");
    assert!(parse_list(&query(), &raw, 0).is_err());
}
