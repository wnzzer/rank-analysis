//! 版本补丁英雄改动：拉取 LoL Wiki 的 `V{patch}` 页面 wikitext，
//! 解析 `== Champions ==` 段落得到每个英雄的官方改动条目与整体方向。
//!
//! # 数据流
//! 1. `get_or_fetch(patch)`：内存 → 磁盘 → 网络 三级取快照（补丁页发布后仍会被
//!    编辑补充，TTL 取 24h）
//! 2. `parse_patch_champions`：wikitext → 归一化英文名 → [`ChampionPatchNote`]
//! 3. 方向分类为启发式（见 [`classify_line`]）：识别 `increased/reduced to X from Y`
//!    句式 + 冷却/耗蓝类反向属性；无法判定时整体记 `Adjusted`，不硬猜
//!
//! # 已知限制
//! - 条目文本为 wiki 英文原文（清洗掉标记），暂无本地化
//! - wiki 页面结构变化会导致解析退化为空（有日志，不会 panic）

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 快照有效期：24 小时（补丁页发布初期常有编辑补充）。
pub const TTL_SECS: i64 = 24 * 60 * 60;

/// 改动整体方向。
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeDirection {
    /// 全部条目判定为加强
    Buff,
    /// 全部条目判定为削弱
    Nerf,
    /// 混合改动或无法判定
    Adjusted,
}

/// 单个英雄在某版本的改动。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChampionPatchNote {
    /// wiki 展示名（英文，如 "Aatrox"）
    pub champion: String,
    pub direction: ChangeDirection,
    /// 清洗后的改动条目（英文原文）
    pub lines: Vec<String>,
}

/// 一个版本的全部英雄改动快照。
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PatchNotesSnapshot {
    /// 版本号（如 "16.14"）
    pub patch: String,
    /// 拉取时刻（Unix 秒）
    pub fetched_at: i64,
    /// 归一化英文名（见 [`normalize_champion_name`]）→ 改动
    pub champions: HashMap<String, ChampionPatchNote>,
}

/// 归一化英雄名：小写 + 仅保留字母数字。
///
/// 让 wiki 展示名（"Kai'Sa" / "Miss Fortune"）与 LCU alias（"Kaisa" / "MissFortune"）
/// 落到同一键空间。个别展示名与 alias 完全不同的走 [`wiki_name_to_alias_key`] 特例表。
pub fn normalize_champion_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase()
}

/// wiki 展示名（归一化后）→ LCU alias（归一化后）的特例映射。
///
/// 仅收录归一化后仍对不上的名字；其余靠 normalize 天然一致。
pub fn wiki_name_to_alias_key(normalized_wiki: &str) -> &str {
    match normalized_wiki {
        "wukong" => "monkeyking",
        "nunuwillump" => "nunu",
        "renataglasc" => "renata",
        other => other,
    }
}

/// 冷却/消耗类「越低越好」的反向属性关键词（出现即反转加强/削弱判定）。
const INVERTED_STAT_WORDS: [&str; 7] = [
    "cooldown",
    "cost",
    "cast time",
    "delay",
    "recharge time",
    "channel time",
    "windup",
];

/// 判定单条改动方向。
///
/// # 返回值
/// - `Some(true)` 加强 / `Some(false)` 削弱 / `None` 无法判定（新效果、重做等）
pub fn classify_line(line: &str) -> Option<bool> {
    let l = line.to_ascii_lowercase();
    let up = l.contains("increased") || l.contains("increase");
    let down = l.contains("decreased")
        || l.contains("reduced")
        || l.contains("lowered")
        || l.contains("decrease");
    if up == down {
        // 同现或都没有：句式无法判定
        return None;
    }
    let inverted = INVERTED_STAT_WORDS.iter().any(|w| l.contains(w));
    Some(if inverted { down } else { up })
}

/// 按条目集合聚合整体方向。
fn aggregate_direction(lines: &[String]) -> ChangeDirection {
    let mut buffs = 0;
    let mut nerfs = 0;
    for line in lines {
        match classify_line(line) {
            Some(true) => buffs += 1,
            Some(false) => nerfs += 1,
            None => {}
        }
    }
    match (buffs, nerfs) {
        (b, 0) if b > 0 => ChangeDirection::Buff,
        (0, n) if n > 0 => ChangeDirection::Nerf,
        _ => ChangeDirection::Adjusted,
    }
}

/// 去除 wikitext 行内标记：模板、内链、加粗斜体。
///
/// 模板处理策略：`{{ai|技能名|英雄}}` / `{{ci|英雄}}` 等取第一个参数（即人眼要看的
/// 文本），未知模板整体丢弃——宁缺勿乱。嵌套模板做一层展开即可满足补丁页实际结构。
pub fn strip_wiki_markup(raw: &str) -> String {
    let mut s = raw.to_string();
    // 模板：最多迭代几轮处理一层嵌套
    for _ in 0..3 {
        let Some(start) = s.find("{{") else { break };
        let Some(rel_end) = s[start..].find("}}") else {
            break;
        };
        let end = start + rel_end + 2;
        let inner = &s[start + 2..end - 2];
        let mut parts = inner.split('|');
        let name = parts.next().unwrap_or("").trim().to_ascii_lowercase();
        let keep = matches!(
            name.as_str(),
            "ai" | "ci" | "cai" | "ii" | "si" | "sti" | "tip" | "pp" | "as" | "ap" | "ad"
        );
        let replacement = if keep {
            parts.next().unwrap_or("").trim().to_string()
        } else {
            String::new()
        };
        s.replace_range(start..end, &replacement);
    }
    // 内链 [[a|b]] → b、[[a]] → a
    while let (Some(start), Some(rel_end)) = (s.find("[["), s.find("]]")) {
        if rel_end < start {
            break;
        }
        let inner = s[start + 2..rel_end].to_string();
        let text = inner.rsplit('|').next().unwrap_or("").trim().to_string();
        s.replace_range(start..rel_end + 2, &text);
    }
    s.replace("'''", "").replace("''", "").trim().to_string()
}

/// 从 `=== 标题 ===` 行提取英雄名。
fn heading_champion_name(line: &str) -> Option<String> {
    let inner = line.trim().trim_matches('=').trim();
    let name = strip_wiki_markup(inner);
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// 解析补丁页 wikitext 的 Champions 段。
///
/// # 返回值
/// 归一化英文名 → [`ChampionPatchNote`]；页面无 Champions 段返回空表
pub fn parse_patch_champions(wikitext: &str) -> HashMap<String, ChampionPatchNote> {
    let mut result = HashMap::new();
    let mut in_champions = false;
    let mut current: Option<(String, Vec<String>)> = None;

    let flush = |current: &mut Option<(String, Vec<String>)>,
                 result: &mut HashMap<String, ChampionPatchNote>| {
        if let Some((name, lines)) = current.take() {
            if !lines.is_empty() {
                result.insert(
                    normalize_champion_name(&name),
                    ChampionPatchNote {
                        champion: name,
                        direction: aggregate_direction(&lines),
                        lines,
                    },
                );
            }
        }
    };

    for line in wikitext.lines() {
        let trimmed = line.trim();
        // 二级标题：进入/离开 Champions 段
        if trimmed.starts_with("==") && !trimmed.starts_with("===") {
            flush(&mut current, &mut result);
            let title = trimmed.trim_matches('=').trim().to_ascii_lowercase();
            in_champions = title == "champions";
            continue;
        }
        if !in_champions {
            continue;
        }
        if trimmed.starts_with("===") {
            flush(&mut current, &mut result);
            current = heading_champion_name(trimmed).map(|n| (n, Vec::new()));
            continue;
        }
        if let Some((_, lines)) = current.as_mut() {
            if let Some(item) = trimmed.strip_prefix('*') {
                let text = strip_wiki_markup(item.trim_start_matches('*').trim());
                if !text.is_empty() {
                    lines.push(text);
                }
            }
        }
    }
    flush(&mut current, &mut result);
    result
}

/// 磁盘缓存路径（工作目录相对，与 opgg 缓存同约定；单文件存最近一个 patch）。
pub fn default_path() -> PathBuf {
    PathBuf::from("patch_notes_cache.json")
}

/// 快照是否命中给定 patch 且未过期。
pub fn is_valid(snapshot: &PatchNotesSnapshot, patch: &str, now: i64) -> bool {
    snapshot.patch == patch && now - snapshot.fetched_at < TTL_SECS
}

/// 从磁盘读取快照；缺失/损坏返回 None。
pub fn load_from_path(path: &Path) -> Option<PatchNotesSnapshot> {
    let content = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str(&content) {
        Ok(snap) => Some(snap),
        Err(e) => {
            log::warn!("patch notes cache corrupt at {}: {}", path.display(), e);
            None
        }
    }
}

/// 快照写盘（失败仅告警，不阻塞主流程）。
pub fn save_to_path(snapshot: &PatchNotesSnapshot, path: &Path) {
    match serde_json::to_string(snapshot) {
        Ok(json) => {
            if let Err(e) = std::fs::write(path, json) {
                log::warn!("patch notes cache write {}: {}", path.display(), e);
            }
        }
        Err(e) => log::warn!("patch notes cache serialize: {}", e),
    }
}

/// 拉取 `V{patch}` 页 wikitext；页面不存在返回 `Ok(None)`。
async fn fetch_patch_wikitext(
    patch: &str,
) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!(
        "https://leagueoflegends.fandom.com/api.php?action=query&format=json&prop=revisions&titles=V{}&rvprop=content&rvslots=main",
        patch
    );
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()?;
    log::info!("Fetching patch notes: {}", url);
    // 尽量贴近真实浏览器请求头：Fandom 前面有 Cloudflare，请求特征太"裸"容易吃挑战页
    let resp = client
        .get(&url)
        .header("Accept", "application/json, text/plain, */*")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://leagueoflegends.fandom.com/")
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;
    let pages = resp
        .get("query")
        .and_then(|q| q.get("pages"))
        .and_then(|p| p.as_object())
        .ok_or("no pages in response")?;
    let page = pages.values().next().ok_or("empty pages")?;
    if page.get("missing").is_some() {
        return Ok(None);
    }
    let content = page
        .get("revisions")
        .and_then(|r| r.get(0))
        .and_then(|r| r.get("slots"))
        .and_then(|s| s.get("main"))
        .and_then(|m| m.get("*"))
        .and_then(|c| c.as_str())
        .ok_or("no content in revision")?;
    Ok(Some(content.to_string()))
}

/// 内存缓存 + 单飞锁：同一时间只有一个网络拉取。
static SNAPSHOT: tokio::sync::Mutex<Option<Arc<PatchNotesSnapshot>>> =
    tokio::sync::Mutex::const_new(None);

/// 取指定 patch 的快照：内存 → 磁盘 → 网络。
///
/// 网络失败时若有同 patch 的过期缓存则降级使用；完全失败返回空快照（负缓存，
/// 由内存持有避免每次选人反复打请求）。
pub async fn get_or_fetch(patch: &str) -> Arc<PatchNotesSnapshot> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut guard = SNAPSHOT.lock().await;

    if let Some(snap) = guard.as_ref() {
        if is_valid(snap, patch, now) {
            return snap.clone();
        }
    }
    if let Some(disk) = load_from_path(&default_path()) {
        if is_valid(&disk, patch, now) {
            let arc = Arc::new(disk);
            *guard = Some(arc.clone());
            return arc;
        }
    }

    let snapshot = match fetch_patch_wikitext(patch).await {
        Ok(Some(wikitext)) => {
            let champions = parse_patch_champions(&wikitext);
            log::info!(
                "patch notes V{}: parsed {} champions",
                patch,
                champions.len()
            );
            PatchNotesSnapshot {
                patch: patch.to_string(),
                fetched_at: now,
                champions,
            }
        }
        Ok(None) => {
            log::warn!("patch notes page V{} missing", patch);
            PatchNotesSnapshot {
                patch: patch.to_string(),
                fetched_at: now,
                champions: HashMap::new(),
            }
        }
        Err(e) => {
            log::warn!("patch notes fetch V{} failed: {}", patch, e);
            // 降级：同 patch 过期缓存仍可用
            if let Some(stale) = load_from_path(&default_path()).filter(|s| s.patch == patch) {
                let arc = Arc::new(stale);
                *guard = Some(arc.clone());
                return arc;
            }
            // 拉取失败只做内存负缓存（本次会话不再重试），不写盘——
            // 否则一次瞬时网络故障会把空快照钉死 24h
            let arc = Arc::new(PatchNotesSnapshot {
                patch: patch.to_string(),
                fetched_at: now,
                champions: HashMap::new(),
            });
            *guard = Some(arc.clone());
            return arc;
        }
    };
    save_to_path(&snapshot, &default_path());
    let arc = Arc::new(snapshot);
    *guard = Some(arc.clone());
    arc
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"
== Items ==
=== [[Infinity Edge]] ===
* Damage increased.
== Champions ==
=== {{ci|Aatrox}} ===
* {{ai|The Darkin Blade|Aatrox}}
** Damage increased to 70 from 60.
** Cooldown reduced to 12 seconds from 14.
=== {{ci|Miss Fortune}} ===
* Base stats
** Base armor reduced to 28 from 30.
=== {{ci|Wukong}} ===
* {{ai|Cyclone|Wukong}}
** New Effect: Now knocks up enemies twice.
== Runes ==
=== Lethal Tempo ===
* Attack speed reduced.
"#;

    #[test]
    fn should_parse_champions_section_only() {
        let map = parse_patch_champions(FIXTURE);
        assert_eq!(map.len(), 3);
        assert!(map.contains_key("aatrox"));
        assert!(map.contains_key("missfortune"));
        assert!(map.contains_key("wukong"));
        // Items/Runes 段不进结果
        assert!(!map.contains_key("infinityedge"));
        assert!(!map.contains_key("lethaltempo"));
    }

    #[test]
    fn should_aggregate_direction_per_champion() {
        let map = parse_patch_champions(FIXTURE);
        // 伤害提高 + 冷却降低 → 全加强
        assert_eq!(map["aatrox"].direction, ChangeDirection::Buff);
        // 护甲降低 → 削弱
        assert_eq!(map["missfortune"].direction, ChangeDirection::Nerf);
        // 新效果无法判定 → 调整
        assert_eq!(map["wukong"].direction, ChangeDirection::Adjusted);
    }

    #[test]
    fn should_strip_wiki_markup_in_lines() {
        let map = parse_patch_champions(FIXTURE);
        let lines = &map["aatrox"].lines;
        assert_eq!(lines[0], "The Darkin Blade");
        assert_eq!(lines[1], "Damage increased to 70 from 60.");
    }

    #[test]
    fn classify_should_invert_cooldown_like_stats() {
        assert_eq!(classify_line("Damage increased to 70 from 60."), Some(true));
        assert_eq!(
            classify_line("Base armor reduced to 28 from 30."),
            Some(false)
        );
        assert_eq!(
            classify_line("Cooldown reduced to 12 seconds from 14."),
            Some(true)
        );
        assert_eq!(
            classify_line("Mana cost increased to 60 from 40."),
            Some(false)
        );
        assert_eq!(classify_line("New Effect: Now knocks up twice."), None);
    }

    #[test]
    fn should_map_wiki_special_names_to_alias_keys() {
        assert_eq!(wiki_name_to_alias_key("wukong"), "monkeyking");
        assert_eq!(wiki_name_to_alias_key("nunuwillump"), "nunu");
        assert_eq!(wiki_name_to_alias_key("renataglasc"), "renata");
        assert_eq!(wiki_name_to_alias_key("aatrox"), "aatrox");
        assert_eq!(normalize_champion_name("Kai'Sa"), "kaisa");
        assert_eq!(normalize_champion_name("Miss Fortune"), "missfortune");
    }

    #[test]
    fn snapshot_validity_should_check_patch_and_ttl() {
        let snap = PatchNotesSnapshot {
            patch: "16.14".into(),
            fetched_at: 1_000,
            champions: HashMap::new(),
        };
        assert!(is_valid(&snap, "16.14", 1_000 + TTL_SECS - 1));
        assert!(!is_valid(&snap, "16.14", 1_000 + TTL_SECS));
        assert!(!is_valid(&snap, "16.15", 1_000));
    }
}
