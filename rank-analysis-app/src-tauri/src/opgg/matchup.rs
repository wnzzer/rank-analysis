//! OP.GG 全球排位对位数据：白名单请求、统计归一化和有界缓存。
use moka::future::Cache;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    future::Future,
    sync::{Arc, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

/// 前端显式提供的统计上下文，只允许全球传统排位。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchupQuery {
    /// 本局敌方英雄的正整数 ID。
    pub enemy_id: i32,
    /// OP.GG 分路白名单值。
    pub position: String,
    /// 统计段位集合白名单值。
    pub tier: String,
    /// 列表可省略以发现版本，详情必填。
    pub version: Option<String>,
}
/// 列表用于排序的敌方视角统计。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchupCandidate {
    /// 候选英雄 ID。
    pub champion_id: i32,
    /// 敌方胜场除以敌方样本数，范围 0..1。
    pub enemy_win_rate: f64,
    /// 列表源样本局数。
    pub play: u64,
}
/// 完整位置候选列表及其来源上下文。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchupList {
    /// 查询的敌方英雄。
    pub enemy_id: i32,
    /// 实际查询分路。
    pub position: String,
    /// 实际查询段位集合。
    pub tier: String,
    /// 源数据实际版本。
    pub version: String,
    /// 源统计缓存时间，缺失时为空。
    pub cached_at: Option<String>,
    /// 本地成功抓取时间，unix 秒。
    pub fetched_at: i64,
    /// 是否为请求失败后返回的同键旧数据。
    pub stale: bool,
    /// 合法且有正样本数的候选集。
    pub candidates: Vec<MatchupCandidate>,
}
/// 候选自身视角的双方详情，缺失指标保持空值。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchupDetail {
    /// 查询的敌方英雄。
    pub enemy_id: i32,
    /// 查询的候选英雄。
    pub candidate_id: i32,
    /// 实际查询分路。
    pub position: String,
    /// 实际查询段位集合。
    pub tier: String,
    /// 源数据实际版本。
    pub version: String,
    /// 源统计缓存时间，缺失时为空。
    pub cached_at: Option<String>,
    /// 本地成功抓取时间，unix 秒。
    pub fetched_at: i64,
    /// 是否为请求失败后返回的同键旧数据。
    pub stale: bool,
    /// 候选自身胜场/样本数，不使用列表胜率的补数。
    pub candidate_win_rate: Option<f64>,
    /// 双方 lane_kill 归一化；打野和非法样本为空。
    pub lane_kill_rate: Option<f64>,
    /// 候选详情样本数；双方缺失或胜场非法时为空。
    pub play: Option<u64>,
}
/// 成功解析后才可进入缓存的原始响应及本地抓取时间。
#[derive(Clone)]
struct Stored {
    /// 原始源响应，保留源时间与实际版本。
    raw: Value,
    /// 成功抓取的 unix 秒。
    fetched_at: i64,
}
/// 两层缓存保留有限旧数据供失败回退，fresh 层负责同键请求合并。
struct MatchupCache {
    /// 30 分钟有效缓存，失败结果不会写入。
    fresh: Cache<String, Arc<Stored>>,
    /// 有界最后成功值，禁止跨键回退。
    old: Cache<String, Arc<Stored>>,
}
impl MatchupCache {
    /// 创建容量不超过 512 项的两层缓存，ttl 用于生产及过期测试。
    /// 返回独立缓存实例；ttl 是新鲜数据的有效时长。
    fn new(ttl: Duration) -> Self {
        Self {
            fresh: Cache::builder().max_capacity(512).time_to_live(ttl).build(),
            old: Cache::builder().max_capacity(512).build(),
        }
    }
    /// 获取 key 对应成功值；fetch 只对同键执行一次，失败回退同键旧值。
    /// 返回值的布尔标记表示失败降级；不存在旧值时返回原始错误。
    async fn get<F>(&self, key: String, fetch: F) -> Result<(Arc<Stored>, bool), String>
    where
        F: Future<Output = Result<Stored, String>>,
    {
        match self
            .fresh
            .try_get_with(key.clone(), async {
                let stored = Arc::new(fetch.await?);
                self.old.insert(key.clone(), stored.clone()).await;
                Ok::<_, String>(stored)
            })
            .await
        {
            Ok(value) => Ok((value, false)),
            Err(error) => self
                .old
                .get(&key)
                .await
                .map(|value| (value, true))
                .ok_or_else(|| error.to_string()),
        }
    }
}
/// 返回进程共享有界缓存，所有命令共用以合并重复请求。
fn cache() -> &'static MatchupCache {
    static CACHE: OnceLock<MatchupCache> = OnceLock::new();
    CACHE.get_or_init(|| MatchupCache::new(Duration::from_secs(1800)))
}
/// 返回 unix 秒；系统时间异常时为 0。
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs() as i64)
        .unwrap_or(0)
}
/// 校验 query 与可选 candidate 的白名单、正整数 ID 和版本格式。
/// 详情必须传版本；任何非法参数返回错误，不能参与 URL 构造。
fn validate(query: &MatchupQuery, candidate: Option<i32>) -> Result<(), String> {
    if query.enemy_id <= 0 || candidate.is_some_and(|id| id <= 0 || id == query.enemy_id) {
        return Err("invalid champion id".into());
    }
    if !["top", "jungle", "mid", "adc", "support"].contains(&query.position.as_str())
        || !super::api::VALID_TIERS.contains(&query.tier.as_str())
    {
        return Err("invalid matchup position or tier".into());
    }
    if candidate.is_some() && query.version.is_none() {
        return Err("matchup detail requires version".into());
    }
    if let Some(version) = &query.version {
        if !valid_version(version) {
            return Err("invalid matchup version".into());
        }
    }
    Ok(())
}
/// 验证 version 为两个有限长度的数字段，阻止路径和查询注入。
fn valid_version(version: &str) -> bool {
    let parts: Vec<_> = version.split('.').collect();
    parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 3 && part.bytes().all(|c| c.is_ascii_digit())
        })
}
/// 从 raw 校验实际版本并提取源更新时间；与 query 指定版本不同返回错误。
fn metadata(query: &MatchupQuery, raw: &Value) -> Result<(String, Option<String>), String> {
    let version = raw["meta"]["version"]
        .as_str()
        .filter(|v| valid_version(v))
        .ok_or("missing matchup version")?;
    if query
        .version
        .as_deref()
        .is_some_and(|requested| requested != version)
    {
        return Err("matchup version mismatch".into());
    }
    Ok((
        version.into(),
        raw["meta"]["cached_at"].as_str().map(str::to_owned),
    ))
}
/// 提取 row 的非负整数样本和胜场；零样本、超额胜场均无数据。
/// 返回样本数和 0..1 胜率，非法字段返回 None。
fn counts(row: &Value) -> Option<(u64, f64)> {
    let play = row["play"].as_u64()?;
    let win = row["win"].as_u64()?;
    (play > 0 && win <= play).then_some((play, win as f64 / play as f64))
}
/// 解析列表 raw，非法行不进入候选；fetched_at 是本地成功请求时间。
/// query 提供查询上下文，返回敌方视角列表；版本或顶层结构异常返回错误。
fn parse_list(query: &MatchupQuery, raw: &Value, fetched_at: i64) -> Result<MatchupList, String> {
    let (version, cached_at) = metadata(query, raw)?;
    let rows = raw["data"]
        .as_array()
        .ok_or("invalid matchup list schema")?;
    // 列表排序和固定版本详情不可混用；源行缺省版本时沿用 meta，显式冲突则拒绝缓存。
    if rows.iter().any(|row| {
        row.get("version")
            .is_some_and(|value| value.as_str() != Some(version.as_str()))
    }) {
        return Err("matchup row version mismatch".into());
    }
    let candidates = rows
        .iter()
        .filter_map(|row| {
            let id = i32::try_from(row["champion_id"].as_i64()?).ok()?;
            if id <= 0 || id == query.enemy_id {
                return None;
            }
            let (play, rate) = counts(row)?;
            Some(MatchupCandidate {
                champion_id: id,
                enemy_win_rate: rate,
                play,
            })
        })
        .collect();
    Ok(MatchupList {
        enemy_id: query.enemy_id,
        position: query.position.clone(),
        tier: query.tier.clone(),
        version,
        cached_at,
        fetched_at,
        stale: false,
        candidates,
    })
}
/// 解析双方 raw，candidate 是候选 ID；缺一方或非法字段返回空指标而非伪造数字。
/// query 指定上下文，fetched_at 是本地成功抓取的 unix 秒。
/// 返回候选详情；版本或顶层结构不符时返回错误。
fn parse_detail(
    query: &MatchupQuery,
    candidate: i32,
    raw: &Value,
    fetched_at: i64,
) -> Result<MatchupDetail, String> {
    let (version, cached_at) = metadata(query, raw)?;
    let rows = raw["data"]
        .as_array()
        .ok_or("invalid matchup detail schema")?;
    if rows.iter().any(|row| {
        row.get("version")
            .is_some_and(|v| v.as_str() != Some(version.as_str()))
    }) {
        return Err("matchup row version mismatch".into());
    }
    let enemy = rows
        .iter()
        .find(|r| r["champion_id"].as_i64() == Some(query.enemy_id as i64));
    let own = rows
        .iter()
        .find(|r| r["champion_id"].as_i64() == Some(candidate as i64));
    let mut detail = MatchupDetail {
        enemy_id: query.enemy_id,
        candidate_id: candidate,
        position: query.position.clone(),
        tier: query.tier.clone(),
        version,
        cached_at,
        fetched_at,
        stale: false,
        candidate_win_rate: None,
        lane_kill_rate: None,
        play: None,
    };
    if let (Some(enemy), Some(own)) = (enemy, own) {
        if let (Some(_), Some((play, rate))) = (counts(enemy), counts(own)) {
            detail.play = Some(play);
            detail.candidate_win_rate = Some(rate);
            if query.position != "jungle" {
                if let (Some(a), Some(b)) = (own["lane_kill"].as_f64(), enemy["lane_kill"].as_f64())
                {
                    let sum = a + b;
                    if a.is_finite()
                        && b.is_finite()
                        && a >= 0.0
                        && b >= 0.0
                        && sum.is_finite()
                        && sum > 0.0
                    {
                        detail.lane_kill_rate = Some(a / sum);
                    }
                }
            }
        }
    }
    Ok(detail)
}
/// 构造包含固定地区、模式、版本、段位、分路和双方 ID 的缓存键。
/// query 缺版本仅用于最新版本发现；它与任何指定版本键均不相同。
fn key(query: &MatchupQuery, candidate: Option<i32>) -> String {
    format!(
        "global|ranked|{}|{}|{}|{}|{}",
        query.version.as_deref().unwrap_or("latest"),
        query.tier,
        query.position,
        query.enemy_id,
        candidate
            .map(|id| id.to_string())
            .unwrap_or_else(|| "list".into())
    )
}
/// 从固定 HTTPS 域抓取 query 的列表或 candidate 详情，校验后才返回可缓存值。
/// candidate 为空时请求列表；返回带源响应和本地时间的成功值，网络/结构异常返回错误。
async fn fetch(query: &MatchupQuery, candidate: Option<i32>) -> Result<Stored, String> {
    let suffix = candidate.map(|id| format!("/{id}")).unwrap_or_default();
    let url = format!(
        "https://lol-api-champion.op.gg/api/global/champions/ranked/{}/{}/counters{}",
        query.enemy_id, query.position, suffix
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(super::api::USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut params = vec![("tier", query.tier.as_str())];
    if let Some(version) = &query.version {
        params.push(("version", version));
    }
    let raw: Value = client
        .get(url)
        .query(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let fetched_at = now();
    if let Some(id) = candidate {
        parse_detail(query, id, &raw, fetched_at)?;
    } else {
        parse_list(query, &raw, fetched_at)?;
    }
    Ok(Stored { raw, fetched_at })
}
/// 查询 query 的完整候选集；允许首次省略版本，失败仅使用同键旧数据。
/// 返回带实际版本、源时间与 stale 标记的列表；非法参数或无缓存的请求失败返回错误。
pub async fn get_list(query: MatchupQuery) -> Result<MatchupList, String> {
    validate(&query, None)?;
    let (stored, stale) = cache().get(key(&query, None), fetch(&query, None)).await?;
    let mut result = parse_list(&query, &stored.raw, stored.fetched_at)?;
    result.stale = stale;
    Ok(result)
}
/// 查询 query 与 candidate 的双方详情；版本必填且不跨版本回退。
/// 返回候选自身统计，缺失指标为空；非法参数或无缓存的请求失败返回错误。
pub async fn get_detail(query: MatchupQuery, candidate: i32) -> Result<MatchupDetail, String> {
    validate(&query, Some(candidate))?;
    let (stored, stale) = cache()
        .get(key(&query, Some(candidate)), fetch(&query, Some(candidate)))
        .await?;
    let mut result = parse_detail(&query, candidate, &stored.raw, stored.fetched_at)?;
    result.stale = stale;
    Ok(result)
}
#[cfg(test)]
#[path = "matchup_tests.rs"]
mod tests;
