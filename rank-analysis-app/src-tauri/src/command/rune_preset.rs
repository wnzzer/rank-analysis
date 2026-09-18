//! # 符文方案（我的方案）
//!
//! 用户在推荐栏「★ 记住」的符文，按「英雄 + 分路」存进配置 `settings.auto.runePresets`，
//! 自动应用时优先写它；没有记住的英雄按 `settings.auto.runeFallback` 决定是否用 OP.GG
//! 推荐兜底。与 [`crate::command::rule_config`] 同类：只有数据与纯函数，无命令——
//! 读写走通用的 `get_config` / `put_config`，与 BP 规则同一套。
//!
//! 方案不依赖 OP.GG：OP.GG 拉不到时照样能写。

use crate::config::Value;
use crate::opgg::detail::{ChampionBuild, RuneBuild};
use serde::{Deserialize, Serialize};

/// 一条符文方案。唯一键 `(champion_id, position)`，记住即覆盖同键旧方案（前端负责）。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RunePreset {
    pub champion_id: i32,
    /// LCU 小写分路 top/jungle/middle/bottom/utility；大乱斗 "none"
    pub position: String,
    pub primary_style_id: i32,
    pub sub_style_id: i32,
    /// 主系 4 个（首个为基石）
    pub primary_perk_ids: Vec<i32>,
    /// 副系 2 个
    pub sub_perk_ids: Vec<i32>,
    /// 属性碎片 3 个
    pub stat_mod_ids: Vec<i32>,
    /// 保存时刻（unix 毫秒），设置页列表排序用
    #[serde(default)]
    pub saved_at: i64,
    /// 来源：本期恒为 "opgg"；预留 "client"（记住客户端当前页），加来源不改 schema
    #[serde(default)]
    pub source: String,
}

impl RunePreset {
    /// 三段数量必须是 4/2/3，否则拼不出合法的 9 个 `selectedPerkIds`
    pub fn is_valid(&self) -> bool {
        self.primary_perk_ids.len() == 4
            && self.sub_perk_ids.len() == 2
            && self.stat_mod_ids.len() == 3
    }

    /// 转成写入层用的 [`RuneBuild`]（方案没有样本数据，统计字段写 0）
    pub fn to_rune(&self) -> RuneBuild {
        RuneBuild {
            primary_style_id: self.primary_style_id,
            sub_style_id: self.sub_style_id,
            primary_perk_ids: self.primary_perk_ids.clone(),
            sub_perk_ids: self.sub_perk_ids.clone(),
            stat_mod_ids: self.stat_mod_ids.clone(),
            play: 0,
            win: 0,
            pick_rate: 0.0,
        }
    }
}

/// 没有记住方案的英雄用什么兜底
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fallback {
    /// 用 OP.GG 推荐（样本达标的第一套）
    Opgg,
    /// 不自动写
    None,
}

/// 把配置值剥掉 `{ "value": ... }` 包装，转成 JSON
fn unwrap_config(value: &Value) -> Option<serde_json::Value> {
    let json = serde_json::to_value(value).ok()?;
    Some(json.get("value").cloned().unwrap_or(json))
}

/// 解析 `settings.auto.runePresets`。
///
/// 容忍 `{value:[...]}` / 裸数组；未配置（空串占位 / Null）静默返回空；数组里形状不对
/// 或三段数量不对的条目丢弃（对齐 `automation.rs` 的 `parse_pick_rules_value` 口径）。
pub fn parse_presets(value: &Value) -> Vec<RunePreset> {
    let Some(serde_json::Value::Array(items)) = unwrap_config(value) else {
        return vec![];
    };
    items
        .into_iter()
        .filter_map(|item| match serde_json::from_value::<RunePreset>(item) {
            Ok(p) if p.is_valid() => Some(p),
            Ok(p) => {
                log::warn!("rune preset dropped (perk count): {:?}", p);
                None
            }
            Err(e) => {
                log::warn!("rune preset dropped (shape): {}", e);
                None
            }
        })
        .collect()
}

/// 解析 `settings.auto.runeFallback`：只有明确的 `"none"` 才是不写，其余（含未配置）用 OP.GG。
///
/// 用字符串而非 `*Switch` 布尔：`zero_value_for_key` 对 `*Switch` 键缺省读出 false，
/// 而本项默认要「用 OP.GG」。
pub fn parse_fallback(value: &Value) -> Fallback {
    match unwrap_config(value) {
        Some(serde_json::Value::String(s)) if s == "none" => Fallback::None,
        _ => Fallback::Opgg,
    }
}

/// 找「这个英雄这条路」的方案
pub fn find_preset<'a>(
    presets: &'a [RunePreset],
    champion_id: i32,
    position: &str,
) -> Option<&'a RunePreset> {
    presets
        .iter()
        .find(|p| p.champion_id == champion_id && p.position == position)
}

/// 自动应用该写哪套：我的方案 → 兜底为 OP.GG 时样本达标的第一套 → 不写。
pub fn choose_auto_rune(
    preset: Option<&RunePreset>,
    build: Option<&ChampionBuild>,
    fallback: Fallback,
) -> Option<RuneBuild> {
    if let Some(p) = preset {
        return Some(p.to_rune());
    }
    match fallback {
        Fallback::Opgg => build.and_then(|b| b.auto_rune()).cloned(),
        Fallback::None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opgg::detail::{ChampionBuild, RuneBuild, BUILD_SCHEMA_VERSION};
    use std::collections::HashMap;

    fn preset_json(champion_id: i32, position: &str, keystone: i32) -> serde_json::Value {
        serde_json::json!({
            "champion_id": champion_id,
            "position": position,
            "primary_style_id": 8000,
            "sub_style_id": 8400,
            "primary_perk_ids": [keystone, 9101, 9104, 8299],
            "sub_perk_ids": [8444, 8451],
            "stat_mod_ids": [5005, 5008, 5001],
            "saved_at": 1_789_000_000_000_i64,
            "source": "opgg"
        })
    }

    fn to_value(json: serde_json::Value) -> Value {
        serde_json::from_value(json).unwrap()
    }

    fn opgg_rune(keystone: i32, play: i32) -> RuneBuild {
        RuneBuild {
            primary_style_id: 8000,
            sub_style_id: 8400,
            primary_perk_ids: vec![keystone, 9101, 9104, 8299],
            sub_perk_ids: vec![8444, 8451],
            stat_mod_ids: vec![5005, 5008, 5001],
            play,
            win: play / 2,
            pick_rate: 0.3,
        }
    }

    fn build(runes: Vec<RuneBuild>) -> ChampionBuild {
        ChampionBuild {
            schema_version: BUILD_SCHEMA_VERSION,
            champion_id: 157,
            position: "middle".into(),
            mode: "ranked".into(),
            tier: "emerald_plus".into(),
            patch: "16.18".into(),
            fetched_at: 0,
            play: 1000,
            win_rate: 0.5,
            runes,
            spells: vec![],
            starter_items: vec![],
            boots: vec![],
            core_items: vec![],
            last_items: vec![],
            skills: vec![],
            stale: false,
        }
    }

    // ---- 解析 ----

    #[test]
    fn parse_presets_should_accept_value_envelope_and_bare_list() {
        // 前端 putConfigByIpc 的形态：{ "value": [...] }
        let mut map = HashMap::new();
        map.insert(
            "value".to_string(),
            to_value(serde_json::json!([preset_json(157, "middle", 8008)])),
        );
        let got = parse_presets(&Value::Map(map));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].champion_id, 157);

        let bare = to_value(serde_json::json!([preset_json(86, "top", 8010)]));
        assert_eq!(parse_presets(&bare)[0].position, "top");
    }

    #[test]
    fn parse_presets_should_treat_unset_or_garbage_as_empty() {
        // zero_value_for_key 对未配置的键给空串
        assert!(parse_presets(&Value::String(String::new())).is_empty());
        assert!(parse_presets(&Value::Null).is_empty());
        assert!(parse_presets(&to_value(serde_json::json!([{"foo": 1}]))).is_empty());
    }

    #[test]
    fn parse_presets_should_drop_entries_that_cannot_form_a_page() {
        let mut broken = preset_json(157, "middle", 8008);
        broken["primary_perk_ids"] = serde_json::json!([8008, 9101, 9104]);
        let list = to_value(serde_json::json!([broken, preset_json(86, "top", 8010)]));
        let got = parse_presets(&list);
        assert_eq!(
            got.len(),
            1,
            "主系只有 3 个的方案拼不出 9 个 selectedPerkIds"
        );
        assert_eq!(got[0].champion_id, 86);
    }

    #[test]
    fn parse_fallback_should_default_to_opgg() {
        assert_eq!(
            parse_fallback(&Value::String(String::new())),
            Fallback::Opgg
        );
        assert_eq!(parse_fallback(&Value::Null), Fallback::Opgg);
        assert_eq!(
            parse_fallback(&Value::String("opgg".into())),
            Fallback::Opgg
        );
        assert_eq!(
            parse_fallback(&Value::String("none".into())),
            Fallback::None
        );
        let mut map = HashMap::new();
        map.insert("value".to_string(), Value::String("none".into()));
        assert_eq!(parse_fallback(&Value::Map(map)), Fallback::None);
    }

    // ---- 匹配与选择 ----

    #[test]
    fn find_preset_should_match_champion_and_position() {
        let list = parse_presets(&to_value(serde_json::json!([
            preset_json(157, "middle", 8008),
            preset_json(157, "none", 8010)
        ])));
        assert_eq!(
            find_preset(&list, 157, "none").unwrap().primary_perk_ids[0],
            8010,
            "大乱斗与中单各记各的"
        );
        assert_eq!(
            find_preset(&list, 157, "middle").unwrap().primary_perk_ids[0],
            8008
        );
        assert!(find_preset(&list, 157, "top").is_none());
        assert!(find_preset(&list, 86, "middle").is_none());
    }

    #[test]
    fn to_rune_should_round_trip_perk_order() {
        let list = parse_presets(&to_value(serde_json::json!([preset_json(
            157, "middle", 8008
        )])));
        assert_eq!(list[0].to_rune().perk_ids(), opgg_rune(8008, 0).perk_ids());
    }

    #[test]
    fn choose_should_prefer_preset_over_opgg() {
        let list = parse_presets(&to_value(serde_json::json!([preset_json(
            157, "middle", 8010
        )])));
        let b = build(vec![opgg_rune(8008, 5000)]);
        let got = choose_auto_rune(list.first(), Some(&b), Fallback::Opgg).unwrap();
        assert_eq!(got.primary_perk_ids[0], 8010);
        // 方案不依赖 OP.GG：数据拉不到照样写
        let got = choose_auto_rune(list.first(), None, Fallback::None).unwrap();
        assert_eq!(got.primary_perk_ids[0], 8010);
    }

    #[test]
    fn choose_should_fall_back_to_opgg_only_when_allowed() {
        let b = build(vec![opgg_rune(8021, 50), opgg_rune(8008, 5000)]);
        let got = choose_auto_rune(None, Some(&b), Fallback::Opgg).unwrap();
        assert_eq!(got.primary_perk_ids[0], 8008, "兜底仍按样本阈值取");
        assert!(choose_auto_rune(None, Some(&b), Fallback::None).is_none());
        assert!(choose_auto_rune(None, None, Fallback::Opgg).is_none());
    }
}
