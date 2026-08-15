//! # LCU 符文 API（P1-3）
//!
//! 封装 `lol-perks/v1` 的符文页读取与切换：按名字匹配到目标符文页后，
//! 通过 `currentpage` 端点把客户端的「当前使用页」切过去。
//!
//! 设计选择：**不做**外部符文数据抓取（查无稳定的国服符文数据源），而是让
//! 用户在设置页配置「英雄 → 符文页名」映射，选人阶段英雄锁定后自动切页。
//! 这样既没有数据时效性问题，也不依赖 OP.GG 之类的第三方。

use serde::Deserialize;

/// 一页符文页（LCU `PerkPageResource`）。
///
/// 字段取宽松子集：切换只需 `id` 与 `name`；其余字段缺失不影响反序列化
/// （不同版本 LCU 字段有增删，宽松处理避免整页解析失败）。
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerkPage {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    /// 当前生效页标记；LCU 在 `pages` 里推送，但切换依据以 `currentpage` 为准，
    /// 此字段仅作日志参考，缺失时默认 false。
    #[serde(default)]
    pub is_current: bool,
}

/// 读取全部符文页。
///
/// 游戏未登录/未进客户端时 LCU 可能 404 或返回空，一律视为「无页面」而非错误。
pub async fn get_perk_pages() -> Result<Vec<PerkPage>, String> {
    crate::lcu::util::http::lcu_get("lol-perks/v1/pages").await
}

/// 直接命中 LCU 当前使用的符文页 id（未同步时可能为 0）。
pub async fn get_current_perk_page_id() -> Result<i64, String> {
    crate::lcu::util::http::lcu_get("lol-perks/v1/currentpage").await
}

/// 把客户端的「当前使用页」切换到 `page_id`。
///
/// LCU 端点 `PUT lol-perks/v1/currentpage/{id}`，body 为空。
pub async fn set_current_perk_page(page_id: i64) -> Result<(), String> {
    let uri = format!("lol-perks/v1/currentpage/{}", page_id);
    crate::lcu::util::http::lcu_put::<(), &()>(&uri, &()).await?;
    Ok(())
}

/// 纯函数：按名字（忽略首尾空白）在页面列表里找目标页。
///
/// 返回 `None` 时表示客户端里不存在这个名字的符文页，调用方打日志提示。
pub fn find_page_by_name<'a>(pages: &'a [PerkPage], name: &str) -> Option<&'a PerkPage> {
    let want = name.trim();
    if want.is_empty() {
        return None;
    }
    pages.iter().find(|p| p.name.trim() == want)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_page_by_name_matches_trimmed_exact_name() {
        let pages = vec![
            PerkPage {
                id: 1,
                name: " 精确-通用 ".into(),
                is_current: false,
            },
            PerkPage {
                id: 2,
                name: "征服-战士".into(),
                is_current: true,
            },
        ];
        assert_eq!(find_page_by_name(&pages, "精确-通用").unwrap().id, 1);
        assert_eq!(find_page_by_name(&pages, "  精确-通用  ").unwrap().id, 1);
        assert_eq!(find_page_by_name(&pages, "征服-战士").unwrap().id, 2);
    }

    #[test]
    fn find_page_by_name_missing_or_empty_returns_none() {
        let pages = vec![PerkPage {
            id: 1,
            name: "通用".into(),
            is_current: true,
        }];
        assert!(find_page_by_name(&pages, "不存在的页").is_none());
        assert!(find_page_by_name(&pages, "  ").is_none());
        assert!(find_page_by_name(&pages, "").is_none());
    }

    #[test]
    fn perk_page_parses_minimal_json() {
        let raw = r#"{"id": 42, "name": "凯莎-常规"}"#;
        let p: PerkPage = serde_json::from_str(raw).unwrap();
        assert_eq!(p.id, 42);
        assert_eq!(p.name, "凯莎-常规");
        assert!(!p.is_current);
    }

    #[test]
    fn perk_page_parses_full_json_with_extra_fields() {
        let raw = r#"{
            "id": 7,
            "name": "阿狸-炽热",
            "primaryStyleId": 8100,
            "subStyleId": 8300,
            "selectedPerkIds": [8112, 8122, 8135, 8139, 8304, 8316],
            "current": true,
            "isActive": false,
            "isDeletable": true,
            "isEditable": true,
            "isValid": true,
            "isTemporary": false,
            "lastModified": 1746318800000,
            "order": 0
        }"#;
        let p: PerkPage = serde_json::from_str(raw).unwrap();
        assert_eq!(p.id, 7);
        assert_eq!(p.name, "阿狸-炽热");
    }
}
