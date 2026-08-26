//! # A3.3 三选一打分引擎
//!
//! 输入三个候选强化（词表匹配结果），输出每卡的综合分、档位与模板化理由，
//! 最终组装成 overlay `mayhem-augments` 面板负载（契约见
//! `src/features/overlay/panels.ts` 的 `MayhemAugmentCandidate`）。
//!
//! ## 打分维度（v1）
//!
//! ```text
//! score = W_GLOBAL × norm(全服胜率)
//!       + W_CHAMP  × norm(该英雄历史胜率)      // 无样本回退全局口径
//!       + W_SYNERGY× synergy                  // 属 TOP 组合成员与否
//! ```
//!
//! 归一化采用**当轮候选内 min-max**：自校准、免调参，避免绝对胜率量纲漂移。
//! 权重与档位阈值是显式常数——后续 backtest 调权只改这里（§A3.3 计划）。
//!
//! 全部为纯函数：查表数据由调用方注入，单测无需磁盘。

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::ocr::MatchHit;
use super::store::read_local_json;

/// 维度权重（和为 1）。
const W_GLOBAL: f64 = 0.45;
const W_CHAMP: f64 = 0.40;
const W_SYNERGY: f64 = 0.15;

/// 该英雄历史胜率参与归一化的最小样本门槛。
const CHAMP_MIN_GAMES: i64 = 30;

/// 单个强化的全局统计（来自 augments.json stats）。
#[derive(Debug, Clone, Default)]
pub struct GlobalStats {
    pub wr: Option<f64>,
}

/// 该英雄历史使用某强化的统计（来自 champion-shards）。
#[derive(Debug, Clone, Copy)]
pub struct ChampAugStat {
    pub wr: f64,
    pub games: i64,
}

/// 打分所需的全部查表数据。
#[derive(Debug, Clone, Default)]
pub struct ScoreTables {
    pub global: HashMap<i64, GlobalStats>,
    /// 该英雄的强化历史（无则整体回退全局）
    pub champ_wr: HashMap<i64, ChampAugStat>,
    /// TOP 组合覆盖的强化 id
    pub trio_members: HashSet<i64>,
    pub trio_best_wr: HashMap<i64, f64>,
}

/// 候选展示元数据。
#[derive(Debug, Clone)]
pub struct CandidateMeta {
    pub name: String,
    pub rarity_name: String,
}

impl CandidateMeta {
    /// 从本地 augments.json 构建全部元数据映射（id → 名称/稀有度）。
    ///
    /// 替代早期 preview 命令里硬编码 "silver" 的占位做法；缺行跳过。
    pub fn map_from_augments(augments: &serde_json::Value) -> HashMap<i64, CandidateMeta> {
        let mut out = HashMap::new();
        if let Some(items) = augments["data"].as_array() {
            for it in items {
                let Some(id) = it["id"].as_i64() else { continue };
                let Some(name) = it["name"].as_str() else { continue };
                let name = name.trim();
                if name.is_empty() {
                    continue;
                }
                out.insert(
                    id,
                    CandidateMeta {
                        name: name.to_string(),
                        rarity_name: it["rarityName"].as_str().unwrap_or("silver").to_string(),
                    },
                );
            }
        }
        out
    }
}

/// 打分后的单卡。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredCandidate {
    pub slot: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub augment_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rarity_name: Option<String>,
    /// 综合分 0-100（未知候选为 null）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grade: Option<String>,
    pub best: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasons: Option<Vec<String>>,
}

fn min_max_norm(values: &[f64]) -> Vec<f64> {
    let Some(&min) = values.iter().min_by(|a, b| a.total_cmp(b)) else {
        return Vec::new();
    };
    let Some(&max) = values.iter().max_by(|a, b| a.total_cmp(b)) else {
        return Vec::new();
    };
    if (max - min).abs() < f64::EPSILON {
        return vec![0.5; values.len()];
    }
    values.iter().map(|v| ((v - min) / (max - min)).clamp(0.0, 1.0)).collect()
}

/// 档位映射（分数 0-100）。
pub fn grade_of(score01: f64) -> String {
    let s = score01 * 100.0;
    if s >= 80.0 {
        "S+"
    } else if s >= 70.0 {
        "A"
    } else if s >= 55.0 {
        "B"
    } else {
        "C"
    }
    .to_string()
}

/// 组装查表数据（从本地激活版本读取；未同步返回 Err）。
pub fn load_tables(champion_id: i64) -> Result<ScoreTables, String> {
    let aug_json = read_local_json("augments.json")?;
    let mut global = HashMap::new();
    if let Some(items) = aug_json["data"].as_array() {
        for it in items {
            let Some(id) = it["id"].as_i64() else { continue };
            global.insert(id, GlobalStats { wr: it["stats"]["winRate"].as_f64() });
        }
    }

    let mut tables = ScoreTables {
        global,
        ..Default::default()
    };

    // 英雄历史与组合：shard 缺失时静默降级为纯全局口径
    if let Ok(Some(detail)) = super::store::champion_detail(champion_id) {
        for a in detail["augments"].as_array().into_iter().flatten() {
            let Some(id) = a["id"].as_i64() else { continue };
            if let (Some(wr), Some(games)) =
                (a["stats"]["winRate"].as_f64(), a["stats"]["games"].as_i64())
            {
                tables.champ_wr.insert(id, ChampAugStat { wr, games });
            }
        }
        for t in detail["augmentTrios"].as_array().into_iter().flatten() {
            let wr = t["stats"]["winRate"].as_f64();
            for id in t["augmentIds"].as_array().into_iter().flatten() {
                let Some(id) = id.as_i64() else { continue };
                tables.trio_members.insert(id);
                if let Some(wr) = wr {
                    let e = tables.trio_best_wr.entry(id).or_insert(wr);
                    if *e < wr {
                        *e = wr;
                    }
                }
            }
        }
    }
    Ok(tables)
}

/// 对一轮三选一打分并组装面板负载。
///
/// - `hits`: 词表匹配结果（按卡位）；None 卡位保留空槽占位
/// - `metas`: id → 展示元数据（名称/稀有度，来自词表）
/// - `rerolls_left`: 重随剩余次数（v1 仅透传展示）
pub fn score_round(
    hits: [Option<&MatchHit>; 3],
    metas: &HashMap<i64, CandidateMeta>,
    tables: &ScoreTables,
    rerolls_left: Option<u8>,
) -> serde_json::Value {
    let known: Vec<(&MatchHit, &GlobalStats)> = hits
        .iter()
        .copied()
        .flatten()
        .filter_map(|h| tables.global.get(&h.id).map(|g| (h, g)))
        .collect();

    let global_norms = min_max_norm(
        &known
            .iter()
            .map(|(_, g)| g.wr.unwrap_or(0.5))
            .collect::<Vec<_>>(),
    );
    let champ_norms = min_max_norm(
        &known
            .iter()
            .map(|(h, _)| {
                tables
                    .champ_wr
                    .get(&h.id)
                    .filter(|s| s.games >= CHAMP_MIN_GAMES)
                    .map(|s| s.wr)
                    .unwrap_or(tables.global.get(&h.id).and_then(|g| g.wr).unwrap_or(0.5))
            })
            .collect::<Vec<_>>(),
    );

    let mut scored: Vec<(u8, ScoredCandidate)> = Vec::with_capacity(3);

    let mut ki = 0usize;
    for (slot, hit) in hits.iter().enumerate() {
        let Some(hit) = hit else {
            scored.push((
                slot as u8,
                ScoredCandidate {
                    slot: slot as u8,
                    augment_id: None,
                    name: None,
                    rarity_name: None,
                    score: None,
                    grade: None,
                    best: false,
                    reasons: None,
                },
            ));
            continue;
        };

        let g_norm = global_norms.get(ki).copied().unwrap_or(0.5);
        let c_norm = champ_norms.get(ki).copied().unwrap_or(0.5);
        ki += 1;

        let mut reasons: Vec<String> = Vec::new();
        let global_wr = tables.global.get(&hit.id).and_then(|g| g.wr);
        match global_wr {
            Some(wr) => reasons.push(format!("全服胜率 {:.1}%", wr * 100.0)),
            None => reasons.push("暂无全局数据".into()),
        }

        // 英雄维度：样本达标才引用具体数字
        match tables.champ_wr.get(&hit.id) {
            Some(s) if s.games >= CHAMP_MIN_GAMES => {
                reasons.push(format!("该英雄历史 {:.1}%（{} 场）", s.wr * 100.0, s.games));
            }
            Some(s) => reasons.push(format!("该英雄样本不足（{} 场）", s.games)),
            None => {}
        }

        // 协同维度
        let synergy = if tables.trio_members.contains(&hit.id) {
            if let Some(wr) = tables.trio_best_wr.get(&hit.id) {
                reasons.push(format!("属 TOP 组合成员（组合胜率 {:.1}%）", wr * 100.0));
            } else {
                reasons.push("属 TOP 组合成员".into());
            }
            0.8
        } else {
            0.2
        };

        let score01 = W_GLOBAL * g_norm + W_CHAMP * c_norm + W_SYNERGY * synergy;

        let meta = metas.get(&hit.id);
        scored.push((
            slot as u8,
            ScoredCandidate {
                slot: slot as u8,
                augment_id: Some(hit.id),
                name: meta.map(|m| m.name.clone()),
                rarity_name: meta.map(|m| m.rarity_name.clone()),
                score: Some((score01 * 100.0 * 10.0).round() / 10.0),
                grade: Some(grade_of(score01)),
                best: false,
                reasons: Some(reasons),
            },
        ));
    }

    // 最优卡高亮：仅在有分数的卡里取最高
    let best_slot = scored
        .iter()
        .filter(|(_, c)| c.score.is_some())
        .max_by(|a, b| a.1.score.partial_cmp(&b.1.score).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(slot, _)| *slot);
    for (slot, c) in scored.iter_mut() {
        if Some(*slot) == best_slot {
            c.best = true;
        }
    }

    let mut out = scored;
    out.sort_by_key(|(slot, _)| *slot);
    serde_json::json!({
        "candidates": out.into_iter().map(|(_, c)| c).collect::<Vec<_>>(),
        "rerollsLeft": rerolls_left,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(id: i64, conf: f64) -> MatchHit {
        MatchHit { id, confidence: conf }
    }

    fn tables_with(
        global: &[(i64, f64)],
        champ: &[(i64, f64, i64)],
        trios: &[(i64, f64)],
    ) -> ScoreTables {
        let mut t = ScoreTables::default();
        for (id, wr) in global {
            t.global.insert(*id, GlobalStats { wr: Some(*wr) });
        }
        for (id, wr, games) in champ {
            t.champ_wr.insert(*id, ChampAugStat { wr: *wr, games: *games });
        }
        for (id, wr) in trios {
            t.trio_members.insert(*id);
            t.trio_best_wr.insert(*id, *wr);
        }
        t
    }

    fn meta_map(ids: &[i64]) -> HashMap<i64, CandidateMeta> {
        ids.iter()
            .map(|id| (*id, CandidateMeta { name: format!("强化{id}"), rarity_name: "gold".into() }))
            .collect()
    }

    #[test]
    fn grade_boundaries_should_hold() {
        assert_eq!(grade_of(0.80), "S+");
        assert_eq!(grade_of(0.795), "A");
        assert_eq!(grade_of(0.70), "A");
        assert_eq!(grade_of(0.56), "B");
        assert_eq!(grade_of(0.54), "C");
    }

    #[test]
    fn higher_global_wr_should_win_when_other_dims_equal() {
        let t = tables_with(&[(1, 0.60), (2, 0.50)], &[], &[]);
        let m = meta_map(&[1, 2]);
        let payload = score_round([Some(&hit(1, 1.0)), None, Some(&hit(2, 1.0))], &m, &t, Some(2));

        let cands = payload["candidates"].as_array().expect("candidates");
        assert_eq!(cands.len(), 3, "空槽也要占位");
        assert!(cands[1]["score"].is_null(), "空槽不得有分数");

        let s1 = cands[0]["score"].as_f64().unwrap();
        let s2 = cands[2]["score"].as_f64().unwrap();
        assert!(s1 > s2, "高胜率应得高分: {s1} vs {s2}");
        assert_eq!(cands[0]["best"], serde_json::Value::Bool(true));
        assert_eq!(cands[2]["best"], serde_json::Value::Bool(false));
        assert_eq!(payload["rerollsLeft"], serde_json::json!(2));
    }

    #[test]
    fn champ_history_should_override_global_when_sample_enough() {
        // 全局 1 号更高；但英雄历史上 2 号显著更强且样本充足
        let t = tables_with(&[(1, 0.62), (2, 0.50)], &[(2, 0.66, 400)], &[]);
        let m = meta_map(&[1, 2]);
        let hits = [Some(&hit(1, 1.0)), Some(&hit(2, 1.0)), None];
        let payload = score_round(hits, &m, &t, None);
        let cands = payload["candidates"].as_array().unwrap();
        assert!(
            cands[1]["score"].as_f64().unwrap() > cands[0]["score"].as_f64().unwrap(),
            "英雄维度权重应足以翻转全局劣势"
        );
        let reasons = cands[1]["reasons"].as_array().unwrap();
        assert!(reasons.iter().any(|r| r.as_str().unwrap().contains("该英雄历史")));
    }

    #[test]
    fn low_sample_champ_history_should_not_be_cited_as_evidence() {
        let t = tables_with(&[(1, 0.60)], &[(1, 0.90, 10)], &[]);
        let m = meta_map(&[1]);
        let payload = score_round([Some(&hit(1, 1.0)), None, None], &m, &t, None);
        let reasons = payload["candidates"][0]["reasons"].as_array().unwrap();
        assert!(reasons.iter().any(|r| r.as_str().unwrap().contains("样本不足")));
    }

    #[test]
    fn trio_membership_should_add_synergy_reason_and_boost() {
        let t = tables_with(&[(1, 0.55), (2, 0.55)], &[], &[(1, 0.73)]);
        let m = meta_map(&[1, 2]);
        let payload = score_round([Some(&hit(1, 1.0)), Some(&hit(2, 1.0)), None], &m, &t, None);
        let cands = payload["candidates"].as_array().unwrap();
        // 其余维度归一化相同（min==max 时各 0.5），协同差异直接决定排序
        assert!(cands[0]["score"].as_f64().unwrap() > cands[1]["score"].as_f64().unwrap());
        assert!(cands[0]["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r.as_str().unwrap().contains("TOP 组合")));
    }

    #[test]
    fn unknown_candidates_should_keep_placeholder_shape() {
        let t = ScoreTables::default();
        let payload = score_round([None, None, None], &HashMap::new(), &t, None);
        let cands = payload["candidates"].as_array().unwrap();
        assert_eq!(cands.len(), 3);
        for c in cands {
            assert!(c["score"].is_null());
            assert_eq!(c["best"], serde_json::Value::Bool(false));
        }
    }

    #[test]
    fn meta_map_should_read_real_rarity_and_skip_bad_rows() {
        let json: serde_json::Value = serde_json::from_str(
            r#"{"data":[
                {"id":1220,"name":"连拨击锤","rarityName":"prismatic"},
                {"id":1336,"name":" 升级：无尽之刃 ","rarityName":"gold"},
                {"name":"缺id"}
            ]}"#,
        )
        .unwrap();
        let m = CandidateMeta::map_from_augments(&json);
        assert_eq!(m.len(), 2);
        assert_eq!(m[&1220].rarity_name, "prismatic");
        assert_eq!(m[&1336].name, "升级：无尽之刃");
    }
}
