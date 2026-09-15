//! # 符文页写入
//!
//! 把推荐符文写成客户端的**临时符文页**：不占页位、不碰用户已有的任何符文页。
//!
//! ## 真机事实（2026-09-15，见 spec「待真机验证」）
//! - `isTemporary: true` 被接受，且页位已满（`canAddCustomPage: false`）时照样建成
//! - POST 建页 / PUT 改写后该页**自动成为当前页**，无需再 PUT `currentpage`
//! - 临时页**不会互相顶掉**：每次新建都会多一页，所以换人时原地改写自己建的那一页
//! - 删掉当前页后客户端处于「无当前页」——本模块任何分支都不 DELETE
//!
//! 「自己建的页」= `isTemporary && name 以 " (RA)" 结尾`。按名字认而不是记 page id：
//! 进程重启后照样认得出来；用户的持久页即使同名也因 `isTemporary=false` 不会被误认。

use crate::lcu::util::http::{lcu_get, lcu_post_no_retry, lcu_put, LcuWriteError};
use crate::opgg::detail::RuneBuild;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// 页名后缀：认领「自己建的页」的唯一标记
const PAGE_NAME_SUFFIX: &str = " (RA)";

/// 写入结果（前端据 `reason` 给出文案）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ApplyRuneResult {
    pub ok: bool,
    pub page_id: Option<i64>,
    /// `page_limit_full` | `lcu_rejected` | `lcu_unavailable`
    pub reason: Option<String>,
}

/// LCU 符文页（只解出认领所需的字段）
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerkPage {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_temporary: bool,
}

/// `POST /lol-perks/v1/pages` / `PUT /lol-perks/v1/pages/{id}` 的请求体
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageBody {
    pub name: String,
    pub is_temporary: bool,
    pub primary_style_id: i32,
    pub sub_style_id: i32,
    pub selected_perk_ids: Vec<i32>,
    /// 实测 POST / PUT 都会自动选中，这里只是如实表达意图
    pub current: bool,
}

/// 写入计划：原地改写自己的页，或新建
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WritePlan {
    Update(i64),
    Create,
}

/// 幂等键 = 本次要写入的内容（页名由英雄 + 分路决定，页内容由两个系 + 9 个符文决定）。
///
/// 模式 / 段位不单列：它们只通过 `perk_ids` 影响写入内容——换段位但构筑不变时再写一次
/// 毫无意义，只会让客户端多一次可见的切页。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct AppliedKey {
    pub champion_id: i32,
    pub position: String,
    pub primary_style_id: i32,
    pub sub_style_id: i32,
    pub perk_ids: Vec<i32>,
}

impl AppliedKey {
    pub fn of(champion_id: i32, position: &str, rune: &RuneBuild) -> Self {
        Self {
            champion_id,
            position: position.to_string(),
            primary_style_id: rune.primary_style_id,
            sub_style_id: rune.sub_style_id,
            perk_ids: rune.perk_ids(),
        }
    }
}

/// 最近一次成功写入的内容：手动与自动应用共用，自动任务据此跳过重复写入，
/// 前端据此显示「已应用」。
static LAST_APPLIED: Mutex<Option<AppliedKey>> = Mutex::new(None);

/// 记录一次成功写入
pub fn record_applied(key: AppliedKey) {
    *LAST_APPLIED.lock().unwrap_or_else(|p| p.into_inner()) = Some(key);
}

/// 最近一次成功写入的内容
pub fn last_applied() -> Option<AppliedKey> {
    LAST_APPLIED
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

/// 本次选人期被用户手动接管的 `(champion_id, position)`。
///
/// 自动任务按「写入内容」判重：用户手动写了别的方案后，自动方案与 `LAST_APPLIED` 不同，
/// 下一 tick 就会把页写回去——与用户抢方向盘。手动应用成功即记下，自动任务对同一英雄
/// 同一分路不再写入（沿用 BP「你已接管，本阶段不再自动」的先例）。
static MANUAL_OVERRIDE: Mutex<Option<(i32, String)>> = Mutex::new(None);

/// 记录一次手动接管（仅手动应用路径调用）
pub fn mark_manual_override(champion_id: i32, position: &str) {
    *MANUAL_OVERRIDE.lock().unwrap_or_else(|p| p.into_inner()) =
        Some((champion_id, position.to_string()));
}

/// 该英雄该分路本次选人期是否已被手动接管
pub fn is_manual_override(champion_id: i32, position: &str) -> bool {
    override_matches(
        &MANUAL_OVERRIDE.lock().unwrap_or_else(|p| p.into_inner()),
        champion_id,
        position,
    )
}

fn override_matches(stored: &Option<(i32, String)>, champion_id: i32, position: &str) -> bool {
    stored
        .as_ref()
        .is_some_and(|(c, p)| *c == champion_id && p == position)
}

/// 清空写入记录与手动接管（离开选人期时调用：两者的生命周期都是一次选人期）
pub fn clear_applied() {
    *LAST_APPLIED.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *MANUAL_OVERRIDE.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// `get_last_applied_rune` 的返回：写入内容（扁平展开，前端沿用原字段）+ 是否已被手动接管
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LastAppliedRune {
    #[serde(flatten)]
    pub key: AppliedKey,
    /// 该写入的英雄 + 分路是否已被手动接管——前端据此不再显示「自动应用中…」
    pub manual_override: bool,
}

fn last_applied_view(
    last: Option<AppliedKey>,
    manual: Option<(i32, String)>,
) -> Option<LastAppliedRune> {
    last.map(|key| LastAppliedRune {
        manual_override: override_matches(&manual, key.champion_id, &key.position),
        key,
    })
}

/// LCU 分路 → 页名里的中文位置；大乱斗 / 未知返回 None（页名省略位置段）
fn position_label(position: &str) -> Option<&'static str> {
    match position {
        "top" => Some("上单"),
        "jungle" => Some("打野"),
        "middle" => Some("中单"),
        "bottom" => Some("下路"),
        "utility" => Some("辅助"),
        _ => None,
    }
}

/// 页名：`{英雄中文名} · {位置中文名} (RA)`，无位置时 `{英雄中文名} (RA)`
pub fn page_name(champion_name: &str, position: &str) -> String {
    match position_label(position) {
        Some(label) => format!("{} · {}{}", champion_name, label, PAGE_NAME_SUFFIX),
        None => format!("{}{}", champion_name, PAGE_NAME_SUFFIX),
    }
}

/// 构造写入请求体：`selectedPerkIds` = 主系 4 ++ 副系 2 ++ 属性 3
pub fn page_body(name: String, rune: &RuneBuild) -> PageBody {
    PageBody {
        name,
        is_temporary: true,
        primary_style_id: rune.primary_style_id,
        sub_style_id: rune.sub_style_id,
        selected_perk_ids: rune.perk_ids(),
        current: true,
    }
}

/// 找到自己建的临时页就原地改写，否则新建
pub fn plan_write(pages: &[PerkPage]) -> WritePlan {
    pages
        .iter()
        .find(|p| p.is_temporary && p.name.ends_with(PAGE_NAME_SUFFIX))
        .map_or(WritePlan::Create, |p| WritePlan::Update(p.id))
}

/// 失败分类（前端据此给文案）。页数上限的判定依据是真机原始响应
/// `{"errorCode":"RPC_ERROR","httpStatus":400,"message":"Max pages reached"}`。
pub fn classify_failure(err: &LcuWriteError) -> &'static str {
    match err {
        LcuWriteError::Rejected { body, .. } if body.to_lowercase().contains("max pages") => {
            "page_limit_full"
        }
        LcuWriteError::Rejected { .. } | LcuWriteError::Decode(_) => "lcu_rejected",
        LcuWriteError::Transport(_) => "lcu_unavailable",
    }
}

/// 英雄中文名（「亚索」而非称号「疾风剑豪」），资源未就绪时退回「英雄{id}」
fn champion_display_name(champion_id: i32) -> String {
    let cache = crate::lcu::api::asset::CHAMPION_CACHE
        .read()
        .unwrap_or_else(|p| p.into_inner());
    cache
        .get(&(champion_id as i64))
        .map(|c| {
            if c.description.is_empty() {
                c.name.clone()
            } else {
                c.description.clone()
            }
        })
        .unwrap_or_else(|| format!("英雄{}", champion_id))
}

fn failed(reason: &str) -> ApplyRuneResult {
    ApplyRuneResult {
        ok: false,
        page_id: None,
        reason: Some(reason.to_string()),
    }
}

/// 把一套符文写成临时符文页（手动命令与 `apply_runes` 自动化共用）。
///
/// 流程：GET 全部页 → 有自己的页则 PUT 原地改写，否则 POST 新建（不重试）→ 成功记录幂等键。
/// **任何分支都不发起 DELETE**；失败只返回分类，不做补救性写操作。
pub async fn apply_rune_page_core(
    champion_id: i32,
    position: &str,
    rune: &RuneBuild,
) -> ApplyRuneResult {
    let body = page_body(
        page_name(&champion_display_name(champion_id), position),
        rune,
    );

    let pages = match lcu_get::<Vec<PerkPage>>("lol-perks/v1/pages").await {
        Ok(p) => p,
        Err(e) => {
            log::warn!("apply rune page: list pages failed: {}", e);
            return failed("lcu_unavailable");
        }
    };

    let result = match plan_write(&pages) {
        WritePlan::Update(id) => {
            lcu_put::<serde_json::Value, _>(&format!("lol-perks/v1/pages/{}", id), &body)
                .await
                .map(|_| id)
        }
        WritePlan::Create => lcu_post_no_retry::<PerkPage, _>("lol-perks/v1/pages", &body)
            .await
            .map(|p| p.id),
    };

    match result {
        Ok(page_id) => {
            log::info!(
                "rune page applied: {} (page {}, champion {})",
                body.name,
                page_id,
                champion_id
            );
            record_applied(AppliedKey::of(champion_id, position, rune));
            ApplyRuneResult {
                ok: true,
                page_id: Some(page_id),
                reason: None,
            }
        }
        Err(e) => {
            log::warn!("apply rune page failed: {}", e);
            failed(classify_failure(&e))
        }
    }
}

/// 把推荐符文写成客户端的临时符文页。
///
/// # 参数
/// - `champion_id`: 英雄 ID（决定页名）
/// - `position`: 构筑的分路（LCU 小写，大乱斗 "none"）
/// - `rune`: 要写入的那套符文
///
/// # 返回值
/// 业务失败（页满 / 被拒 / 客户端未连接）走 `ok=false` + `reason`，不是 `Err`。
///
/// 这是**手动**路径：成功后记下手动接管，本次选人期自动任务不再为这个英雄这条路写入。
#[tauri::command]
pub async fn apply_rune_page(
    champion_id: i32,
    position: String,
    rune: RuneBuild,
) -> Result<ApplyRuneResult, String> {
    let result = apply_rune_page_core(champion_id, &position, &rune).await;
    if result.ok {
        mark_manual_override(champion_id, &position);
    }
    Ok(result)
}

/// 本次选人期最近一次成功写入的内容与是否已被手动接管（推荐栏挂载时据此恢复状态）。
///
/// 记录的生命周期 = 一次选人期：`game_state_monitor` 与 `apply_runes` 任务在离开
/// 选人期时都会清空，不会把上一局的写入误报成本局已应用。
#[tauri::command]
pub fn get_last_applied_rune() -> Option<LastAppliedRune> {
    let manual = MANUAL_OVERRIDE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    last_applied_view(last_applied(), manual)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::util::http::LcuWriteError;

    fn rune() -> RuneBuild {
        RuneBuild {
            primary_style_id: 8000,
            sub_style_id: 8400,
            primary_perk_ids: vec![8008, 9101, 9104, 8299],
            sub_perk_ids: vec![8444, 8451],
            stat_mod_ids: vec![5005, 5008, 5001],
            play: 24385,
            win: 11314,
            pick_rate: 0.3229,
        }
    }

    fn page(id: i64, name: &str, is_temporary: bool) -> PerkPage {
        PerkPage {
            id,
            name: name.into(),
            is_temporary,
        }
    }

    #[test]
    fn page_body_should_concat_perks_in_lcu_order() {
        let body = page_body("亚索 · 中单 (RA)".into(), &rune());
        assert_eq!(
            body.selected_perk_ids,
            vec![8008, 9101, 9104, 8299, 8444, 8451, 5005, 5008, 5001]
        );
        assert!(body.is_temporary, "必须是临时页：不占页位、不碰用户的页");
    }

    #[test]
    fn page_body_should_serialize_with_lcu_field_names() {
        let json = serde_json::to_value(page_body("n (RA)".into(), &rune())).unwrap();
        assert_eq!(json["isTemporary"], true);
        assert_eq!(json["primaryStyleId"], 8000);
        assert_eq!(json["subStyleId"], 8400);
        assert_eq!(json["selectedPerkIds"].as_array().unwrap().len(), 9);
        assert_eq!(json["name"], "n (RA)");
    }

    #[test]
    fn page_name_should_include_position_label() {
        assert_eq!(page_name("亚索", "middle"), "亚索 · 中单 (RA)");
        assert_eq!(page_name("锤石", "utility"), "锤石 · 辅助 (RA)");
    }

    #[test]
    fn page_name_should_omit_position_for_aram() {
        assert_eq!(page_name("亚索", "none"), "亚索 (RA)");
        assert_eq!(page_name("亚索", ""), "亚索 (RA)");
    }

    #[test]
    fn plan_should_update_own_temporary_page_in_place() {
        // 实测临时页不会互相顶掉：每次都新建会让符文页下拉越堆越长
        let pages = vec![
            page(1, "卡莎丛刃", false),
            page(2, "亚索 · 中单 (RA)", true),
        ];
        assert_eq!(plan_write(&pages), WritePlan::Update(2));
    }

    #[test]
    fn plan_should_never_touch_user_or_client_pages() {
        // 用户自己的持久页即使同名也不认；客户端推荐符文建的临时页没有我们的后缀
        let pages = vec![page(1, "我的页 (RA)", false), page(2, "推荐符文", true)];
        assert_eq!(plan_write(&pages), WritePlan::Create);
        assert_eq!(plan_write(&[]), WritePlan::Create);
    }

    #[test]
    fn classify_should_detect_page_limit_from_real_lcu_body() {
        // 2026-09-15 真机：页位 2/2 时建持久页的原始响应
        let err = LcuWriteError::Rejected {
            status: 400,
            body: r#"{"errorCode":"RPC_ERROR","httpStatus":400,"implementationDetails":{},"message":"Max pages reached"}"#.into(),
        };
        assert_eq!(classify_failure(&err), "page_limit_full");
    }

    #[test]
    fn classify_should_separate_rejection_from_unreachable_client() {
        let rejected = LcuWriteError::Rejected {
            status: 400,
            body: r#"{"message":"Invalid perk"}"#.into(),
        };
        assert_eq!(classify_failure(&rejected), "lcu_rejected");
        assert_eq!(
            classify_failure(&LcuWriteError::Transport("refused".into())),
            "lcu_unavailable"
        );
    }

    #[test]
    fn override_should_match_same_champion_and_position_only() {
        let stored = Some((157, "middle".to_string()));
        assert!(override_matches(&stored, 157, "middle"));
        assert!(
            !override_matches(&stored, 86, "middle"),
            "换了英雄就不再算接管"
        );
        assert!(!override_matches(&stored, 157, "top"));
        assert!(!override_matches(&None, 157, "middle"));
    }

    #[test]
    fn last_applied_view_should_flatten_key_and_flag_override() {
        let key = AppliedKey::of(157, "middle", &rune());
        let view = last_applied_view(Some(key.clone()), Some((157, "middle".into()))).unwrap();
        assert!(view.manual_override);
        let json = serde_json::to_value(&view).unwrap();
        // 前端沿用原来的扁平字段（champion_id / perk_ids ...），只多一个 manual_override
        assert_eq!(json["champion_id"], 157);
        assert_eq!(json["perk_ids"].as_array().unwrap().len(), 9);
        assert_eq!(json["manual_override"], true);

        let other = last_applied_view(Some(key), Some((86, "middle".into()))).unwrap();
        assert!(!other.manual_override);
        assert!(last_applied_view(None, Some((157, "middle".into()))).is_none());
    }

    #[test]
    fn applied_key_should_equal_only_for_identical_write_content() {
        let a = AppliedKey::of(157, "middle", &rune());
        assert_eq!(a, AppliedKey::of(157, "middle", &rune()));

        assert_ne!(a, AppliedKey::of(86, "middle", &rune()), "换人");
        assert_ne!(a, AppliedKey::of(157, "top", &rune()), "换分路（页名变了）");
        let mut other = rune();
        other.stat_mod_ids[2] = 5011;
        assert_ne!(a, AppliedKey::of(157, "middle", &other), "构筑内容变了");
    }
}
