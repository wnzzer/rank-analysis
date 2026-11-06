//! # 隐藏分记录存储
//!
//! 每个召唤师一个 JSON 文件，按队列分组保存最近若干局的 LP 加减分。
//! 文件丢失或损坏只会让隐藏分重新开始累计，所以读失败一律按空记录处理。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// 每个队列最多保留的记录数。估算只用最近 10 条，多留一些便于将来调参回看。
pub const MAX_RECORDS_PER_QUEUE: usize = 50;

/// 记录来源：主路径（LP 变化通知）还是兜底（段位快照差值）。
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Notification,
    Snapshot,
}

/// 一局排位的 LP 变化记录。
///
/// - `delta`: 本局 LP 加减分，正数为赢
/// - `tier_after` / `division_after` / `lp_after`: 本局结算后的段位
/// - `timestamp`: 记录时间（Unix 毫秒）
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LpRecord {
    pub game_id: i64,
    pub queue_type: String,
    pub delta: i32,
    pub tier_after: String,
    pub division_after: String,
    pub lp_after: i32,
    pub timestamp: i64,
    pub source: Source,
}

/// 单个召唤师的记录文件：队列类型 → 记录（旧 → 新）。
#[derive(Serialize, Deserialize, Debug, Default, Clone, PartialEq)]
pub struct RecordFile {
    #[serde(default)]
    pub queues: HashMap<String, Vec<LpRecord>>,
}

impl RecordFile {
    /// 某队列的记录（旧 → 新）；没有时返回空切片。
    pub fn records(&self, queue_type: &str) -> &[LpRecord] {
        self.queues
            .get(queue_type)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    /// 追加一条记录并截断到 [`MAX_RECORDS_PER_QUEUE`]。
    ///
    /// # 返回值
    /// 同队列已有相同 `game_id` 时不写入，返回 `false`。
    pub fn push(&mut self, record: LpRecord) -> bool {
        let list = self.queues.entry(record.queue_type.clone()).or_default();
        if list.iter().any(|r| r.game_id == record.game_id) {
            return false;
        }
        list.push(record);
        if list.len() > MAX_RECORDS_PER_QUEUE {
            let excess = list.len() - MAX_RECORDS_PER_QUEUE;
            list.drain(..excess);
        }
        true
    }
}

/// 记录文件所在目录：配置目录下的 `hidden_mmr/`，需要跨重启保留。
pub fn default_dir() -> PathBuf {
    crate::paths::data_file("hidden_mmr")
}

/// 某召唤师的记录文件路径；puuid 只保留字母数字和 `-`，防止拼出目录穿越。
fn file_path(dir: &Path, puuid: &str) -> PathBuf {
    let safe: String = puuid
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    dir.join(format!("{}.json", safe))
}

/// 读取记录文件；不存在、读失败或内容损坏时返回空记录（损坏时打 warn）。
pub fn load(dir: &Path, puuid: &str) -> RecordFile {
    let path = file_path(dir, puuid);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            log::warn!("隐藏分记录损坏，按空记录处理: {} ({})", path.display(), e);
            RecordFile::default()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => RecordFile::default(),
        Err(e) => {
            log::warn!(
                "读取隐藏分记录失败，按空记录处理: {} ({})",
                path.display(),
                e
            );
            RecordFile::default()
        }
    }
}

/// 写入记录文件：先写 `.tmp` 再 rename，避免写到一半崩溃留下半截 JSON。
pub fn save(dir: &Path, puuid: &str, file: &RecordFile) -> std::io::Result<()> {
    let path = file_path(dir, puuid);
    crate::paths::ensure_parent_dir(&path)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(file)?)?;
    std::fs::rename(&tmp, &path)
}

/// 读取 → 追加 → 写回。
///
/// # 返回值
/// 是否真的新增了记录（重复 `game_id` 返回 `Ok(false)` 且不写盘）。
pub fn append(dir: &Path, puuid: &str, record: LpRecord) -> std::io::Result<bool> {
    let mut file = load(dir, puuid);
    if !file.push(record) {
        return Ok(false);
    }
    save(dir, puuid, &file)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(game_id: i64, delta: i32) -> LpRecord {
        LpRecord {
            game_id,
            queue_type: "RANKED_SOLO_5x5".to_string(),
            delta,
            tier_after: "EMERALD".to_string(),
            division_after: "III".to_string(),
            lp_after: 5,
            timestamp: 1_793_978_941_201,
            source: Source::Notification,
        }
    }

    /// 每个用例独立目录，避免并行测试互相覆盖。
    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rank-analysis-hidden-mmr-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn should_reject_duplicate_game_id() {
        let mut file = RecordFile::default();
        assert!(file.push(rec(1, 19)));
        assert!(!file.push(rec(1, 19)));
        assert_eq!(file.records("RANKED_SOLO_5x5").len(), 1);
    }

    #[test]
    fn should_keep_only_latest_records() {
        let mut file = RecordFile::default();
        for id in 0..(MAX_RECORDS_PER_QUEUE as i64 + 5) {
            file.push(rec(id, 10));
        }
        let records = file.records("RANKED_SOLO_5x5");
        assert_eq!(records.len(), MAX_RECORDS_PER_QUEUE);
        assert_eq!(records[0].game_id, 5);
    }

    #[test]
    fn should_return_empty_slice_for_unknown_queue() {
        assert!(RecordFile::default().records("RANKED_FLEX_SR").is_empty());
    }

    #[test]
    fn should_roundtrip_through_disk() {
        let dir = test_dir("roundtrip");
        assert!(append(&dir, "abc-123", rec(7, -14)).unwrap());
        assert!(!append(&dir, "abc-123", rec(7, -14)).unwrap());
        let loaded = load(&dir, "abc-123");
        assert_eq!(loaded.records("RANKED_SOLO_5x5"), &[rec(7, -14)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn should_treat_missing_file_as_empty() {
        let dir = test_dir("missing");
        assert_eq!(load(&dir, "nobody"), RecordFile::default());
    }

    #[test]
    fn should_treat_corrupt_file_as_empty() {
        let dir = test_dir("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bad.json"), "{not json").unwrap();
        assert_eq!(load(&dir, "bad"), RecordFile::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn should_serialize_camel_case_and_lowercase_source() {
        let json = serde_json::to_value(rec(1, 19)).unwrap();
        assert_eq!(json["gameId"], 1);
        assert_eq!(json["lpAfter"], 5);
        assert_eq!(json["source"], "notification");
    }

    #[test]
    fn should_strip_path_characters_from_puuid() {
        let dir = PathBuf::from("base");
        assert_eq!(file_path(&dir, "../evil"), dir.join("evil.json"));
    }
}
