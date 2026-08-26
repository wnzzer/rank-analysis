//! # Mayhem 强化名 OCR 匹配层（A3.2 前置）
//!
//! 局内三选一的识别链路是「截屏 → OCR → 词表约束匹配」：OCR 引擎（PaddleOCR
//! ONNX / Windows OCR，后续轮次接入）吐出的原始文本噪声较大，本模块负责
//! **把文本可靠地映射回强化 id**——归一化 + 编辑距离容错，词表来自本地
//! augments.json（约 207 条中文名）。
//!
//! 独立于具体 OCR 引擎：引擎只产出 `Vec<String>` 文本候选，匹配策略集中在这里，
//! 便于用录屏样本做回归。

use serde::Serialize;
use serde_json::Value;

/// 词表条目。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LexiconEntry {
    pub id: i64,
    pub name: String,
    #[serde(skip)]
    pub norm_chars: Vec<char>,
}

impl LexiconEntry {
    pub fn new(id: i64, name: impl Into<String>) -> Self {
        let name = name.into();
        let norm_chars = normalize_name(&name).chars().collect();
        Self {
            id,
            name,
            norm_chars,
        }
    }
}

/// 匹配结果：id + 置信度（0.0~1.0，1 为精确命中）。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MatchHit {
    pub id: i64,
    pub confidence: f64,
}

/// 归一化 OCR/词表文本：
/// - 全角转半角、转小写
/// - 去除空白与常见标点（中英文），仅保留字母数字与 CJK
///
/// 强化中文名（如「连拨击锤」「升级：无尽之刃」）经此映射到稳定键位。
pub fn normalize_name(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        let c = match ch {
            '０'..='９' | 'Ａ'..='Ｚ' | 'ａ'..='ｚ' => {
                // 全角 ASCII 平移到半角
                char::from_u32(ch as u32 - 0xFEE0).unwrap_or(ch)
            }
            _ => ch,
        };
        if c.is_whitespace() {
            continue;
        }
        if c.is_ascii_alphanumeric() {
            out.extend(c.to_lowercase());
            continue;
        }
        // CJK 直接保留；标点/符号丢弃（含中文冒号顿号等）
        let is_cjk = matches!(c as u32,
            0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF);
        if is_cjk {
            out.push(c);
        }
    }
    out
}

/// 经典 Levenshtein 距离（两行 DP，词表规模小、文本短，性能足够）。
fn levenshtein(a: &[char], b: &[char]) -> usize {
    let (rows, cols) = (a.len() + 1, b.len() + 1);
    let mut prev: Vec<usize> = (0..cols).collect();
    let mut cur = vec![0usize; cols];
    for i in 1..rows {
        cur[0] = i;
        for j in 1..cols {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[cols - 1]
}

/// 在词表中匹配一段 OCR 文本。
///
/// 策略：归一化后精确命中直接返回；否则取编辑距离最小且 ≤ `max_distance`
/// 的条目，置信度 = 1 − dist/max(len(text), len(name))。
///
/// `max_distance` 建议按文本长度取 1~2：OCR 中文错字通常单字级别，
/// 过大的容差会把「灵巧」误配到「灵活应变」这类近义词上。
pub fn match_text(text: &str, lexicon: &[LexiconEntry], max_distance: usize) -> Option<MatchHit> {
    let norm = normalize_name(text);
    if norm.is_empty() || lexicon.is_empty() {
        return None;
    }
    let norm_chars: Vec<char> = norm.chars().collect();

    let mut best: Option<(i64, usize, usize)> = None; // (id, dist, name_len)
    for entry in lexicon {
        let fallback;
        let name_chars: &[char] = if entry.norm_chars.is_empty() {
            fallback = normalize_name(&entry.name).chars().collect::<Vec<_>>();
            &fallback
        } else {
            &entry.norm_chars
        };
        // 长度差超过容差必然超距，跳过省一次 DP
        if name_chars.len().abs_diff(norm_chars.len()) > max_distance {
            continue;
        }
        let dist = levenshtein(&norm_chars, name_chars);
        if dist == 0 {
            return Some(MatchHit {
                id: entry.id,
                confidence: 1.0,
            });
        }
        if dist <= max_distance && best.map(|(_, bd, _)| dist < bd).unwrap_or(true) {
            best = Some((entry.id, dist, name_chars.len()));
        }
    }

    best.map(|(id, dist, name_len)| MatchHit {
        id,
        confidence: 1.0 - dist as f64 / name_len.max(norm_chars.len()) as f64,
    })
}

/// 从本地 augments.json 构建词表（`data[]` 的 `{id, name}`）。
pub fn build_lexicon(augments: &Value) -> Vec<LexiconEntry> {
    augments["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    let id = it["id"].as_i64()?;
                    if id <= 0 {
                        return None;
                    }
                    let name = it["name"].as_str()?.trim();
                    (!name.is_empty()).then(|| LexiconEntry::new(id, name))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 三卡槽位批量匹配：`texts[i]` 对应第 i 个卡位（None = 该槽 OCR 无产出）。
///
/// 空槽原则：识别失败的槽保留 None，绝不用其他槽的结果顶替
/// （卡位顺序必须与屏幕左/中/右一致，见 capture::slot_band_rects）。
pub fn match_slots(
    texts: &[Option<String>; 3],
    lexicon: &[LexiconEntry],
    max_distance: usize,
) -> [Option<MatchHit>; 3] {
    let mut out: [Option<MatchHit>; 3] = [None, None, None];
    for (i, text) in texts.iter().enumerate() {
        if let Some(t) = text {
            out[i] = match_text(t, lexicon, max_distance);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lexicon() -> Vec<LexiconEntry> {
        vec![
            LexiconEntry::new(1220, "连拨击锤"),
            LexiconEntry::new(1336, "升级：无尽之刃"),
            LexiconEntry::new(1022, "灵巧"),
            LexiconEntry::new(2010, "双发快射"),
        ]
    }

    #[test]
    fn normalize_should_fold_width_case_and_strip_punct() {
        assert_eq!(normalize_name("升级：无尽之刃"), "升级无尽之刃");
        assert_eq!(normalize_name(" ＡＢＣ abc "), "abcabc");
        assert_eq!(normalize_name("双发·快射！"), "双发快射");
    }

    #[test]
    fn exact_match_should_short_circuit_with_full_confidence() {
        let hit = match_text(" 连拨击锤 ", &lexicon(), 2).expect("hit");
        assert_eq!(hit.id, 1220);
        assert_eq!(hit.confidence, 1.0);
    }

    #[test]
    fn single_char_typo_should_match_within_distance() {
        // 「锤」被 OCR 成「锺」（形近字）
        let hit = match_text("连拨击锺", &lexicon(), 2).expect("hit");
        assert_eq!(hit.id, 1220);
        assert!(hit.confidence > 0.7 && hit.confidence < 1.0);
    }

    #[test]
    fn beyond_tolerance_should_reject_instead_of_guessing() {
        assert!(match_text("完全无关的文本", &lexicon(), 2).is_none());
        assert!(match_text("", &lexicon(), 2).is_none());
    }

    #[test]
    fn length_gap_over_tolerance_should_skip_dp() {
        // 「灵巧」两字 vs 六字文本：长度差 4 > 2，必须拒绝
        assert!(match_text("升级无尽之刃大杀器", &lexicon(), 2).is_none());
    }

    #[test]
    fn lexicon_should_parse_upstream_shape_and_skip_bad_rows() {
        let json: Value = serde_json::from_str(
            r#"{"data":[
                {"id":1220,"name":"连拨击锤","rarityName":"prismatic"},
                {"id":1336,"name":" 升级：无尽之刃 ","rarityName":"gold"},
                {"id":0,"name":"坏行"},
                {"name":"缺id"}
            ]}"#,
        )
        .unwrap();
        let lx = build_lexicon(&json);
        assert_eq!(lx.len(), 2);
        assert_eq!(lx[1].name, "升级：无尽之刃");
    }

    #[test]
    fn match_slots_should_keep_empty_slots_and_map_by_position() {
        let lx = lexicon();
        let texts = [
            Some("连拨击锺".into()), // 错字命中
            None,                    // 中槽无文本 → 保持空
            Some("双发快射".into()),
        ];
        let hits = match_slots(&texts, &lx, 2);
        assert_eq!(hits[0].as_ref().map(|h| h.id), Some(1220));
        assert!(hits[1].is_none(), "空槽不得被顶替");
        assert_eq!(hits[2].as_ref().map(|h| h.id), Some(2010));
        // 全部失败也不 panic
        let none_texts = [None, None, None];
        assert!(match_slots(&none_texts, &lx, 2).iter().all(|h| h.is_none()));
    }
}
