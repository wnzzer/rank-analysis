//! # 对局标注（谁最关键 / 谁最犯罪）
//!
//! 复盘页让玩家标注本局「最关键」「最犯罪」的玩家，作为校准复盘评分的人工真值。
//! 本地先存（`match_labels.json`，与隐藏分同在数据目录），玩家同意分享时匿名 upsert 到
//! Supabase `match_labels` 表（建表与 RLS 见 `supabase/match_labels.sql`）。
//!
//! 上传体只含对局标识、所选玩家的位置与英雄、当时的模型快照，**不含任何 puuid / 召唤师名**；
//! `owner_id` 由服务端默认 `auth.uid()` 填（设备匿名账号）。
//!
//! 玩家写了理由且与模型有分歧时，AI 会回应一次（设计见
//! `docs/superpowers/specs/2026-11-21-label-rebuttal-design.md`）。回应随标注存在本地；
//! 上传时只带立场、类别、玩家态度与模型名，**回复正文不上传**。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::cloud_sync::post_rest;

/// 本地最多保留的标注条数（按更新时间保留最新的）
const MAX_LOCAL_LABELS: usize = 500;

/// 可选说明的最大字数（与表上 check 约束一致）
pub const MAX_NOTE_CHARS: usize = 200;

/// 被选中的一名玩家
///
/// - `slot`: participantId（1~10）
/// - `position`: teamPosition，无分路模式为空串
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub slot: u8,
    pub team_id: u16,
    pub champion_id: i64,
    pub position: String,
}

/// AI 对玩家理由的回应立场；`unknown` = 模型输出没通过校验，走了保底文案
pub const REBUTTAL_STANCES: [&str; 4] = ["concede", "partial", "hold", "unknown"];

/// 玩家理由所属的类别，用于统计评分最常漏算什么
pub const REBUTTAL_CATEGORIES: [&str; 7] = [
    "absence",
    "targeted",
    "empty_stats",
    "attitude",
    "draft",
    "teamwork",
    "other",
];

/// 玩家看完回应后的态度
pub const REBUTTAL_VERDICTS: [&str; 2] = ["convinced", "unconvinced"];

/// 模型名的最大长度（与表上 check 约束一致）
pub const MAX_REBUTTAL_MODEL_CHARS: usize = 64;

/// AI 对玩家理由的一次回应
///
/// - `stance`: 见 [`REBUTTAL_STANCES`]
/// - `category`: 见 [`REBUTTAL_CATEGORIES`]
/// - `reply`: 给玩家看的回复正文（只存本地，不上传）
/// - `verdict`: 玩家的态度，见 [`REBUTTAL_VERDICTS`]；没点为 None
/// - `model`: 生成这条回应的模型名
/// - `basis`: 回应针对的选择与说明的指纹，前端据此判断要不要重新调用
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rebuttal {
    pub stance: String,
    pub category: String,
    #[serde(default)]
    pub reply: String,
    #[serde(default)]
    pub verdict: Option<String>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub basis: String,
}

/// 枚举值在白名单内才保留，否则为 None。
fn allowed<'a>(value: &'a str, list: &[&str]) -> Option<&'a str> {
    list.contains(&value).then_some(value)
}

/// 回应里要上传的四个字段（立场、类别、态度、模型名）。
///
/// 立场或类别不在白名单内时四项全为 null：数据库上有 check 约束，带着非法值整行都会被拒，
/// 标注本身就传不上去了。
fn rebuttal_columns(rebuttal: Option<&Rebuttal>) -> [Value; 4] {
    let valid = rebuttal.and_then(|r| {
        let stance = allowed(&r.stance, &REBUTTAL_STANCES)?;
        let category = allowed(&r.category, &REBUTTAL_CATEGORIES)?;
        Some((r, stance, category))
    });
    let Some((r, stance, category)) = valid else {
        return [Value::Null, Value::Null, Value::Null, Value::Null];
    };
    let verdict = r
        .verdict
        .as_deref()
        .and_then(|v| allowed(v, &REBUTTAL_VERDICTS));
    let model: String = r.model.chars().take(MAX_REBUTTAL_MODEL_CHARS).collect();
    [
        json!(stance),
        json!(category),
        json!(verdict),
        if model.is_empty() {
            Value::Null
        } else {
            json!(model)
        },
    ]
}

/// 一局的标注（本地存储与前端交互的形状）
///
/// - `labeler_side`: 标注人所在方 `win` / `lose`；观战他人对局等拿不到时为 None
/// - `key_is_self` / `blame_is_self`: 所选的是不是标注人自己，用来剔除自评偏差；
///   只存布尔、不存标注人槽位（槽位配 gameId 能反查到人）。没选该项或拿不到本人为 None
/// - `note`: 玩家可选填写的说明（如「下路被克制」），最多 [`MAX_NOTE_CHARS`] 字
/// - `model`: 提交时的模型快照（10 人总分 / 标签与模型选择）；时间线未就绪时为 None
/// - `rebuttal`: AI 对玩家理由的回应；没触发过为 None（旧版本存下的标注也没有）
/// - `uploaded`: 是否已成功上传（本地字段，不上传）
/// - `updated_at`: 本地最后修改时间（unix 毫秒，本地字段）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchLabel {
    pub game_id: i64,
    pub platform: String,
    pub queue_id: i32,
    #[serde(default)]
    pub key_pick: Option<Pick>,
    #[serde(default)]
    pub blame_pick: Option<Pick>,
    #[serde(default)]
    pub labeler_side: Option<String>,
    #[serde(default)]
    pub key_is_self: Option<bool>,
    #[serde(default)]
    pub blame_is_self: Option<bool>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub model: Option<Value>,
    pub model_version: String,
    #[serde(default)]
    pub rebuttal: Option<Rebuttal>,
    #[serde(default)]
    pub uploaded: bool,
    #[serde(default)]
    pub updated_at: i64,
}

/// 本地标注文件
#[derive(Serialize, Deserialize, Debug, Default, Clone, PartialEq)]
pub struct LabelFile {
    #[serde(default)]
    pub labels: Vec<MatchLabel>,
}

impl LabelFile {
    /// 同 gameId 覆盖、否则追加；超过上限时丢掉最旧的（按 `updated_at`）
    pub fn upsert(&mut self, label: MatchLabel) {
        self.labels.retain(|l| l.game_id != label.game_id);
        self.labels.push(label);
        if self.labels.len() > MAX_LOCAL_LABELS {
            self.labels.sort_by_key(|l| l.updated_at);
            let drop = self.labels.len() - MAX_LOCAL_LABELS;
            self.labels.drain(..drop);
        }
    }

    pub fn get(&self, game_id: i64) -> Option<&MatchLabel> {
        self.labels.iter().find(|l| l.game_id == game_id)
    }
}

/// 保存结果
///
/// - `uploaded`: 本次是否已上传成功（未同意分享时恒为 false）
/// - `error`: 上传失败原因；未尝试上传或成功时为 None
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub uploaded: bool,
    pub error: Option<String>,
}

fn default_path() -> PathBuf {
    crate::paths::data_file("match_labels.json")
}

/// 读取本地标注；不存在、读失败或损坏时返回空（损坏时打 warn）
pub fn load(path: &Path) -> LabelFile {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            log::warn!("对局标注文件损坏，按空处理: {} ({})", path.display(), e);
            LabelFile::default()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => LabelFile::default(),
        Err(e) => {
            log::warn!("读取对局标注失败，按空处理: {} ({})", path.display(), e);
            LabelFile::default()
        }
    }
}

/// 写入本地标注：先写 `.tmp` 再 rename，避免写一半留下半截 JSON
pub fn save(path: &Path, file: &LabelFile) -> std::io::Result<()> {
    crate::paths::ensure_parent_dir(path)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(file)?)?;
    std::fs::rename(&tmp, path)
}

/// 平台标识只允许大写字母和数字（2~8 位），与表上的 check 约束一致
fn valid_platform(p: &str) -> bool {
    (2..=8).contains(&p.len())
        && p.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

/// 说明去首尾空白、截到 [`MAX_NOTE_CHARS`] 字；空串视为没填
pub fn clean_note(note: Option<&str>) -> Option<String> {
    let t = note?.trim();
    if t.is_empty() {
        return None;
    }
    Some(t.chars().take(MAX_NOTE_CHARS).collect())
}

/// 校验并生成上传行（列名与 `match_labels` 表一致）。
///
/// # 错误
/// - 平台标识非法
/// - 两项都没选
pub fn upload_body(label: &MatchLabel) -> Result<Value, String> {
    if !valid_platform(&label.platform) {
        return Err("平台标识非法".to_string());
    }
    if label.key_pick.is_none() && label.blame_pick.is_none() {
        return Err("至少选择一项".to_string());
    }
    let [stance, category, verdict, rebuttal_model] = rebuttal_columns(label.rebuttal.as_ref());
    Ok(json!({
        "game_id": label.game_id,
        "platform": label.platform,
        "queue_id": label.queue_id,
        "key_pick": label.key_pick,
        "blame_pick": label.blame_pick,
        "labeler_side": label.labeler_side,
        // 没选的那项一律传 null：防前端旧状态残留
        "key_is_self": label.key_pick.as_ref().and(label.key_is_self),
        "blame_is_self": label.blame_pick.as_ref().and(label.blame_is_self),
        "note": clean_note(label.note.as_deref()),
        "model": label.model,
        "model_version": label.model_version,
        "rebuttal_stance": stance,
        "rebuttal_category": category,
        "rebuttal_verdict": verdict,
        "rebuttal_model": rebuttal_model,
    }))
}

async fn upload(label: &MatchLabel) -> Result<(), String> {
    let body = upload_body(label)?;
    post_rest("match_labels?on_conflict=owner_id,game_id", json!([body])).await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 本地写入标注；`share` 为 true 时同步上传并记录结果。
///
/// # 参数
/// - `label`: 前端组好的标注（`uploaded` / `updated_at` 由本函数覆盖）
/// - `share`: 玩家是否同意分享
///
/// # 返回值
/// 上传是否成功及失败原因；本地写失败时返回 Err
#[tauri::command]
pub async fn save_match_label(mut label: MatchLabel, share: bool) -> Result<SaveResult, String> {
    if label.key_pick.is_none() && label.blame_pick.is_none() {
        return Err("至少选择一项".to_string());
    }
    label.note = clean_note(label.note.as_deref());
    label.updated_at = now_ms();
    label.uploaded = false;
    let mut result = SaveResult {
        uploaded: false,
        error: None,
    };
    if share {
        match upload(&label).await {
            Ok(()) => {
                label.uploaded = true;
                result.uploaded = true;
            }
            Err(e) => {
                log::warn!("对局标注上传失败（已存本地）: {}", e);
                result.error = Some(e);
            }
        }
    }
    let path = default_path();
    let mut file = load(&path);
    file.upsert(label);
    save(&path, &file).map_err(|e| format!("保存对局标注失败: {e}"))?;
    Ok(result)
}

/// 刚结束的那局（结算页）
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EndedGame {
    pub game_id: i64,
    pub queue_type: String,
}

/// 赛后战报用：取结算页对应的 gameId（与隐藏分采集同一识别逻辑）。
///
/// 结算页停留几分钟后客户端会清掉统计端点，此时返回 Err，前端按「拿不到」处理。
#[tauri::command]
pub async fn get_ended_game() -> Result<EndedGame, String> {
    let (game_id, queue_type, _) = crate::hidden_mmr::collector::fetch_current_game().await?;
    Ok(EndedGame {
        game_id,
        queue_type,
    })
}

/// 读取某局的本地标注
#[tauri::command]
pub async fn get_match_label(game_id: i64) -> Result<Option<MatchLabel>, String> {
    Ok(load(&default_path()).get(game_id).cloned())
}

/// 补传本地未上传的标注（前端只在玩家同意分享时调用）
///
/// # 返回值
/// 本次成功补传的条数；遇到第一个失败即停止（多半是断网，后面的也会失败）
#[tauri::command]
pub async fn retry_match_label_uploads() -> Result<usize, String> {
    let path = default_path();
    let mut file = load(&path);
    let mut done = 0;
    for label in file.labels.iter_mut().filter(|l| !l.uploaded) {
        if let Err(e) = upload(label).await {
            log::info!("对局标注补传中断: {}", e);
            break;
        }
        label.uploaded = true;
        done += 1;
    }
    if done > 0 {
        save(&path, &file).map_err(|e| format!("保存对局标注失败: {e}"))?;
    }
    Ok(done)
}

/// 战报图打点：前端动作名 → 静态功能名
///
/// `track_feature` 只收 `&'static str`（不让任意字符串进 Sentry），这里用白名单映射；
/// 未知动作返回 None，不上报。
pub fn share_card_feature(action: &str) -> Option<&'static str> {
    match action {
        "shown" => Some("share_card_shown"),
        "copied" => Some("share_card_copied"),
        "angle" => Some("share_card_angle"),
        "self_roast" => Some("share_card_self_roast"),
        _ => None,
    }
}

/// 战报图用量打点（展示 / 复制 / 换角度 / 打开自嘲版），漏斗看分享率
///
/// # 参数
/// - `action`: `shown` | `copied` | `angle` | `self_roast`，其余忽略
#[tauri::command]
pub fn track_share_card(action: String) {
    if let Some(feature) = share_card_feature(&action) {
        crate::observability::track_feature(feature);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_map_only_whitelisted_share_card_actions() {
        assert_eq!(share_card_feature("copied"), Some("share_card_copied"));
        assert_eq!(share_card_feature("shown"), Some("share_card_shown"));
        assert_eq!(share_card_feature("angle"), Some("share_card_angle"));
        assert_eq!(
            share_card_feature("self_roast"),
            Some("share_card_self_roast")
        );
        assert_eq!(share_card_feature("anything else"), None);
    }

    fn pick(slot: u8) -> Pick {
        Pick {
            slot,
            team_id: if slot <= 5 { 100 } else { 200 },
            champion_id: 777,
            position: "MIDDLE".to_string(),
        }
    }

    fn label(game_id: i64, updated_at: i64) -> MatchLabel {
        MatchLabel {
            game_id,
            platform: "TJ100".to_string(),
            queue_id: 420,
            key_pick: Some(pick(1)),
            blame_pick: None,
            labeler_side: Some("win".to_string()),
            key_is_self: Some(true),
            blame_is_self: None,
            note: None,
            model: None,
            model_version: "test".to_string(),
            rebuttal: None,
            uploaded: false,
            updated_at,
        }
    }

    fn rebuttal(stance: &str, category: &str) -> Rebuttal {
        Rebuttal {
            stance: stance.to_string(),
            category: category.to_string(),
            reply: "你说的单带不参团，目前的评分确实没算进去。".to_string(),
            verdict: Some("unconvinced".to_string()),
            model: "deepseek-v4.1-flash-1017".to_string(),
            basis: "1|6|他一直单带".to_string(),
        }
    }

    #[test]
    fn should_load_labels_saved_before_rebuttal_existed() {
        let raw = r#"{"gameId":1,"platform":"TJ100","queueId":420,
            "keyPick":{"slot":1,"teamId":100,"championId":103,"position":"MIDDLE"},
            "modelVersion":"old"}"#;

        let parsed: MatchLabel = serde_json::from_str(raw).unwrap();

        assert_eq!(parsed.rebuttal, None);
    }

    #[test]
    fn should_round_trip_rebuttal_in_camel_case() {
        let mut l = label(1, 1);
        l.rebuttal = Some(rebuttal("concede", "absence"));

        let text = serde_json::to_string(&l).unwrap();
        let back: MatchLabel = serde_json::from_str(&text).unwrap();

        assert!(text.contains("\"rebuttal\":{\"stance\":\"concede\""));
        assert_eq!(back, l);
    }

    #[test]
    fn should_upload_rebuttal_summary_but_never_the_reply_text() {
        let mut l = label(1, 1);
        l.rebuttal = Some(rebuttal("concede", "absence"));

        let body = upload_body(&l).unwrap();

        assert_eq!(body["rebuttal_stance"], "concede");
        assert_eq!(body["rebuttal_category"], "absence");
        assert_eq!(body["rebuttal_verdict"], "unconvinced");
        assert_eq!(body["rebuttal_model"], "deepseek-v4.1-flash-1017");
        let text = body.to_string();
        assert!(!text.contains("单带不参团"));
        assert!(!text.contains("basis"));
    }

    #[test]
    fn should_upload_null_rebuttal_columns_without_a_rebuttal() {
        let body = upload_body(&label(1, 1)).unwrap();

        // 键必须存在：upsert 时用 null 覆盖掉上一次的回应（玩家改判后与模型一致了）
        for key in [
            "rebuttal_stance",
            "rebuttal_category",
            "rebuttal_verdict",
            "rebuttal_model",
        ] {
            assert!(body.get(key).is_some_and(Value::is_null), "{key}");
        }
    }

    #[test]
    fn should_drop_rebuttal_columns_with_values_outside_the_whitelist() {
        // 数据库有 check 约束：带着非法枚举值整行会被拒，连标注都传不上去
        for (stance, category) in [("angry", "absence"), ("concede", "cheating")] {
            let mut l = label(1, 1);
            l.rebuttal = Some(rebuttal(stance, category));

            let body = upload_body(&l).unwrap();

            assert!(body["rebuttal_stance"].is_null());
            assert!(body["rebuttal_category"].is_null());
            assert!(body["rebuttal_verdict"].is_null());
            assert!(body["rebuttal_model"].is_null());
        }
    }

    #[test]
    fn should_null_an_unknown_verdict_and_truncate_the_model_name() {
        let mut r = rebuttal("hold", "other");
        r.verdict = Some("maybe".to_string());
        r.model = "m".repeat(200);
        let mut l = label(1, 1);
        l.rebuttal = Some(r);

        let body = upload_body(&l).unwrap();

        assert_eq!(body["rebuttal_stance"], "hold");
        assert!(body["rebuttal_verdict"].is_null());
        assert_eq!(
            body["rebuttal_model"].as_str().unwrap().chars().count(),
            MAX_REBUTTAL_MODEL_CHARS
        );
    }

    #[test]
    fn should_overwrite_same_game_on_upsert() {
        let mut f = LabelFile::default();
        f.upsert(label(1, 1));
        let mut changed = label(1, 2);
        changed.blame_pick = Some(pick(6));
        f.upsert(changed.clone());
        assert_eq!(f.labels.len(), 1);
        assert_eq!(f.get(1), Some(&changed));
    }

    #[test]
    fn should_keep_newest_when_over_limit() {
        let mut f = LabelFile::default();
        for i in 0..(MAX_LOCAL_LABELS as i64 + 3) {
            f.upsert(label(i, i));
        }
        assert_eq!(f.labels.len(), MAX_LOCAL_LABELS);
        assert!(f.get(0).is_none() && f.get(2).is_none());
        assert!(f.get(MAX_LOCAL_LABELS as i64 + 2).is_some());
    }

    #[test]
    fn should_treat_corrupt_or_missing_file_as_empty() {
        let dir = std::env::temp_dir().join(format!("match-label-test-{}", now_ms()));
        let path = dir.join("match_labels.json");
        assert_eq!(load(&path), LabelFile::default());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "{ not json").unwrap();
        assert_eq!(load(&path), LabelFile::default());
        let mut f = LabelFile::default();
        f.upsert(label(9, 1));
        save(&path, &f).unwrap();
        assert_eq!(load(&path), f);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn should_upload_only_table_columns_without_personal_data() {
        let body = upload_body(&label(1, 1)).unwrap();
        let mut keys: Vec<&str> = body
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "blame_is_self",
                "blame_pick",
                "game_id",
                "key_is_self",
                "key_pick",
                "labeler_side",
                "model",
                "model_version",
                "note",
                "platform",
                "queue_id",
                "rebuttal_category",
                "rebuttal_model",
                "rebuttal_stance",
                "rebuttal_verdict"
            ]
        );
        let text = body.to_string();
        assert!(!text.contains("puuid") && !text.contains("uploaded"));
        assert_eq!(body["key_pick"]["teamId"], 100);
    }

    #[test]
    fn should_upload_self_flags_only_for_chosen_picks() {
        let mut l = label(1, 1);
        l.blame_is_self = Some(false); // 没选最犯罪却带了标记：不应上传
        let body = upload_body(&l).unwrap();
        assert_eq!(body["key_is_self"], true);
        assert!(body["blame_is_self"].is_null());
    }

    #[test]
    fn should_load_old_labels_without_self_flags() {
        let old = r#"{"labels":[{"gameId":1,"platform":"TJ100","queueId":420,
            "keyPick":null,"blamePick":null,"modelVersion":"v"}]}"#;
        let f: LabelFile = serde_json::from_str(old).unwrap();
        assert_eq!(f.labels[0].key_is_self, None);
        assert_eq!(f.labels[0].blame_is_self, None);
    }

    #[test]
    fn should_trim_and_cap_note() {
        assert_eq!(clean_note(None), None);
        assert_eq!(clean_note(Some("   ")), None);
        assert_eq!(
            clean_note(Some("  下路被克制 ")),
            Some("下路被克制".to_string())
        );
        let long = "字".repeat(MAX_NOTE_CHARS + 30);
        assert_eq!(
            clean_note(Some(&long)).unwrap().chars().count(),
            MAX_NOTE_CHARS
        );
        let mut l = label(1, 1);
        l.note = Some(" 打野没来 ".to_string());
        assert_eq!(upload_body(&l).unwrap()["note"], "打野没来");
    }

    #[test]
    fn should_reject_bad_platform_or_empty_picks() {
        let mut bad = label(1, 1);
        bad.platform = "tj100'".to_string();
        assert!(upload_body(&bad).is_err());
        let mut empty = label(1, 1);
        empty.key_pick = None;
        assert!(upload_body(&empty).is_err());
    }
}
