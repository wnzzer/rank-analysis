//! # SGP 对局时间线（match-v5 DETAILS）
//!
//! 本地 LCU `game-timelines` 只有击杀/野怪/推塔三类事件；SGP
//! `match-history-query/v1/products/lol/{PLATFORM}_{gameId}/DETAILS` 是完整 match-v5
//! 时间线（出装、加点、插眼、镀层、伤害明细……），单局 0.6~1.6MB。
//!
//! 本模块只声明用得到的字段（serde 自动丢弃其余），把它裁成 ≈30KB 的
//! [`SlimTimeline`] 交给前端做事实卡片。拉取时并发取单局 SUMMARY，把真实分路写进 participants。

use crate::constant;
use crate::lcu::util::http::{lcu_get, sgp_get};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

// ─────────────────────────── 原始结构（只声明要用的字段） ───────────────────────────

/// DETAILS 响应外壳：`{ metadata, json }`，只取 `json`。
#[derive(Deserialize)]
pub struct RawDetails {
    pub json: RawDetailsJson,
}

/// DETAILS 的 `json` 部分。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawDetailsJson {
    #[serde(default)]
    pub game_id: i64,
    #[serde(default)]
    pub frame_interval: i64,
    #[serde(default)]
    pub frames: Vec<RawFrame>,
    #[serde(default)]
    pub participants: Vec<RawParticipant>,
}

/// participantId ↔ puuid（用于和 LCU 对局对齐）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawParticipant {
    pub participant_id: i64,
    #[serde(default)]
    pub puuid: String,
}

/// 单局 SUMMARY 外壳 `{ metadata, json }`（只取每位玩家的分路）。
#[derive(Deserialize, Default)]
pub struct RawSummary {
    #[serde(default)]
    pub json: RawSummaryJson,
}

/// 单局 SUMMARY 的 `json` 部分。
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawSummaryJson {
    #[serde(default)]
    pub participants: Vec<RawSummaryParticipant>,
}

/// SUMMARY 里的一名玩家：本地 LCU 战绩没有可信分路，SGP 的 `teamPosition` 是真值。
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RawSummaryParticipant {
    pub participant_id: i64,
    pub puuid: String,
    pub team_position: String,
    pub vision_score: Option<i64>,
    pub damage_dealt_to_objectives: Option<i64>,
    #[serde(rename = "timeCCingOthers")]
    pub time_c_cing_others: Option<i64>,
}

/// 每分钟一帧。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawFrame {
    #[serde(default)]
    pub timestamp: i64,
    #[serde(default)]
    pub participant_frames: BTreeMap<String, RawParticipantFrame>,
    #[serde(default)]
    pub events: Vec<RawEvent>,
}

/// 地图坐标。
#[derive(Deserialize, Default, Clone, Copy)]
pub struct RawPosition {
    #[serde(default)]
    pub x: i64,
    #[serde(default)]
    pub y: i64,
}

/// 帧内累计伤害，只取对英雄总伤害。
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawDamageStats {
    #[serde(default)]
    pub total_damage_done_to_champions: i64,
}

/// 单个玩家在某帧的状态。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawParticipantFrame {
    pub participant_id: i64,
    #[serde(default)]
    pub total_gold: i64,
    #[serde(default)]
    pub xp: i64,
    #[serde(default)]
    pub level: i64,
    #[serde(default)]
    pub minions_killed: i64,
    #[serde(default)]
    pub jungle_minions_killed: i64,
    #[serde(default)]
    pub position: RawPosition,
    #[serde(default)]
    pub damage_stats: RawDamageStats,
}

/// 击杀事件里的一条伤害明细。
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RawDamage {
    pub participant_id: i64,
    pub magic_damage: i64,
    pub physical_damage: i64,
    pub true_damage: i64,
    pub spell_slot: i64,
}

/// 事件的扁平并集（不同 type 用到不同字段，缺省即默认值）。
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RawEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub timestamp: i64,
    pub participant_id: i64,
    pub killer_id: i64,
    pub victim_id: i64,
    pub assisting_participant_ids: Vec<i64>,
    pub position: Option<RawPosition>,
    pub bounty: i64,
    pub shutdown_bounty: i64,
    pub victim_damage_received: Vec<RawDamage>,
    pub item_id: i64,
    pub before_id: i64,
    pub after_id: i64,
    pub skill_slot: i64,
    pub level_up_type: String,
    pub creator_id: i64,
    pub ward_type: String,
    pub monster_type: String,
    pub monster_sub_type: String,
    pub killer_team_id: i64,
    pub building_type: String,
    pub tower_type: String,
    pub lane_type: String,
    pub team_id: i64,
    pub kill_type: String,
    pub winning_team: i64,
}

/// LCU `lol-game-data/assets/v1/items.json` 的一项（只取分类所需字段）。
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RawItem {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub price_total: i64,
    #[serde(default)]
    pub to: Vec<i64>,
    #[serde(default)]
    pub categories: Vec<String>,
}

// ─────────────────────────── 裁剪结构（交给前端） ───────────────────────────

/// 裁剪后的时间线（≈30KB/局）。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlimTimeline {
    pub game_id: i64,
    pub frame_interval_ms: i64,
    pub participants: Vec<SlimParticipant>,
    pub frames: Vec<SlimFrame>,
    /// 全部保留事件，按 timestamp 升序（从各帧拍平）
    pub events: Vec<SlimEvent>,
    /// 仅本局被购买过的物品元数据（键为 itemId，JSON 中为字符串键）
    pub items: BTreeMap<i64, ItemMeta>,
}

/// participantId ↔ puuid。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlimParticipant {
    pub participant_id: i64,
    pub puuid: String,
    /// SGP SUMMARY 的真实分路（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY）；取不到为空串
    #[serde(default)]
    pub team_position: String,
    /// SGP SUMMARY 的终局指标（国服 LCU 不下发）；取不到为 None（JSON null）
    #[serde(default)]
    pub vision_score: Option<i64>,
    #[serde(default)]
    pub damage_dealt_to_objectives: Option<i64>,
    #[serde(default, rename = "timeCCingOthers")]
    pub time_c_cing_others: Option<i64>,
}

/// 裁剪后的一帧。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlimFrame {
    pub timestamp: i64,
    /// 按 participantId 升序
    pub players: Vec<SlimPlayerFrame>,
}

/// 裁剪后的玩家帧。`cs` = 小兵 + 野怪。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlimPlayerFrame {
    pub participant_id: i64,
    pub total_gold: i64,
    pub xp: i64,
    pub level: i64,
    pub cs: i64,
    pub jungle_cs: i64,
    pub x: i64,
    pub y: i64,
    pub damage_to_champions: i64,
}

/// 击杀时受害者承受伤害的来源聚合。`top_slot`：0-3=QWER，4/5=召唤师技能，63=被动，64=普攻，-1=未知。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DamageSource {
    pub participant_id: i64,
    pub total: i64,
    pub top_slot: i64,
}

/// 物品分类：传说装 / 成型鞋 / 其他（组件、消耗品、饰品等）。
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Legendary,
    Boots,
    Other,
}

/// 物品元数据。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ItemMeta {
    pub name: String,
    pub price_total: i64,
    pub kind: ItemKind,
}

/// 保留的事件类型。丢弃 ITEM_DESTROYED（合成/消耗噪声）、LEVEL_UP（帧可推）、
/// PAUSE_END、OBJECTIVE_BOUNTY_PRESTART、DRAGON_SOUL_GIVEN（国服 teamId 恒 0，无用）。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum SlimEvent {
    ChampionKill {
        timestamp: i64,
        killer_id: i64,
        victim_id: i64,
        assisting: Vec<i64>,
        x: i64,
        y: i64,
        bounty: i64,
        shutdown_bounty: i64,
        damage_received: Vec<DamageSource>,
    },
    ChampionSpecialKill {
        timestamp: i64,
        killer_id: i64,
        kill_type: String,
    },
    EliteMonsterKill {
        timestamp: i64,
        killer_id: i64,
        killer_team_id: i64,
        monster_type: String,
        monster_sub_type: String,
        x: i64,
        y: i64,
    },
    /// `team_id` = 被推建筑的所属队伍
    BuildingKill {
        timestamp: i64,
        killer_id: i64,
        team_id: i64,
        building_type: String,
        tower_type: String,
        lane_type: String,
    },
    /// `team_id` = 被打掉镀层的塔所属队伍
    TurretPlateDestroyed {
        timestamp: i64,
        killer_id: i64,
        team_id: i64,
        lane_type: String,
    },
    ItemPurchased {
        timestamp: i64,
        participant_id: i64,
        item_id: i64,
    },
    ItemSold {
        timestamp: i64,
        participant_id: i64,
        item_id: i64,
    },
    ItemUndo {
        timestamp: i64,
        participant_id: i64,
        before_id: i64,
        after_id: i64,
    },
    SkillLevelUp {
        timestamp: i64,
        participant_id: i64,
        skill_slot: i64,
        level_up_type: String,
    },
    WardPlaced {
        timestamp: i64,
        creator_id: i64,
        ward_type: String,
    },
    WardKill {
        timestamp: i64,
        killer_id: i64,
        ward_type: String,
    },
    GameEnd {
        timestamp: i64,
        winning_team: i64,
    },
}

impl SlimEvent {
    /// 事件时间戳（ms，相对开局）。
    pub fn timestamp(&self) -> i64 {
        match self {
            SlimEvent::ChampionKill { timestamp, .. }
            | SlimEvent::ChampionSpecialKill { timestamp, .. }
            | SlimEvent::EliteMonsterKill { timestamp, .. }
            | SlimEvent::BuildingKill { timestamp, .. }
            | SlimEvent::TurretPlateDestroyed { timestamp, .. }
            | SlimEvent::ItemPurchased { timestamp, .. }
            | SlimEvent::ItemSold { timestamp, .. }
            | SlimEvent::ItemUndo { timestamp, .. }
            | SlimEvent::SkillLevelUp { timestamp, .. }
            | SlimEvent::WardPlaced { timestamp, .. }
            | SlimEvent::WardKill { timestamp, .. }
            | SlimEvent::GameEnd { timestamp, .. } => *timestamp,
        }
    }
}

// ─────────────────────────── 转换 ───────────────────────────

/// 传说装价格下限：组件最贵约 1300 且 `to` 非空；成型传说装 ≥ 2000。
const LEGENDARY_MIN_PRICE: i64 = 2000;
/// 基础鞋 300，成型鞋（二级及以上）都更贵。
const BASIC_BOOTS_PRICE: i64 = 300;

/// 按 LCU 物品列表构建分类表。
///
/// # 规则
/// - `categories` 含 `Boots` 且总价 > 300 → 成型鞋
/// - `to` 为空、总价 ≥ 2000、非消耗品/饰品 → 传说装
/// - 其余 → 其他
pub fn build_item_meta(list: &[RawItem]) -> HashMap<i64, ItemMeta> {
    list.iter()
        .map(|it| {
            let has = |c: &str| it.categories.iter().any(|x| x == c);
            let kind = if has("Boots") && it.price_total > BASIC_BOOTS_PRICE {
                ItemKind::Boots
            } else if it.to.is_empty()
                && it.price_total >= LEGENDARY_MIN_PRICE
                && !has("Consumable")
                && !has("Trinket")
            {
                ItemKind::Legendary
            } else {
                ItemKind::Other
            };
            (
                it.id,
                ItemMeta {
                    name: it.name.clone(),
                    price_total: it.price_total,
                    kind,
                },
            )
        })
        .collect()
}

/// 把受害者承受的逐条伤害按来源玩家聚合（剔除 participantId ≤ 0 的小兵/塔），按总伤害降序。
fn aggregate_damage(list: &[RawDamage]) -> Vec<DamageSource> {
    let mut by: BTreeMap<i64, (i64, BTreeMap<i64, i64>)> = BTreeMap::new();
    for d in list {
        if d.participant_id <= 0 {
            continue;
        }
        let total = d.magic_damage + d.physical_damage + d.true_damage;
        let entry = by.entry(d.participant_id).or_default();
        entry.0 += total;
        *entry.1.entry(d.spell_slot).or_default() += total;
    }
    let mut out: Vec<DamageSource> = by
        .into_iter()
        .map(|(participant_id, (total, slots))| DamageSource {
            participant_id,
            total,
            top_slot: slots
                .into_iter()
                .max_by_key(|(_, v)| *v)
                .map(|(k, _)| k)
                .unwrap_or(-1),
        })
        .collect();
    out.sort_by_key(|d| std::cmp::Reverse(d.total));
    out
}

/// 单个原始事件 → 裁剪事件；不保留的类型返回 None。
fn convert_event(e: RawEvent) -> Option<SlimEvent> {
    let pos = e.position.unwrap_or_default();
    Some(match e.kind.as_str() {
        "CHAMPION_KILL" => SlimEvent::ChampionKill {
            timestamp: e.timestamp,
            killer_id: e.killer_id,
            victim_id: e.victim_id,
            assisting: e.assisting_participant_ids,
            x: pos.x,
            y: pos.y,
            bounty: e.bounty,
            shutdown_bounty: e.shutdown_bounty,
            damage_received: aggregate_damage(&e.victim_damage_received),
        },
        "CHAMPION_SPECIAL_KILL" => SlimEvent::ChampionSpecialKill {
            timestamp: e.timestamp,
            killer_id: e.killer_id,
            kill_type: e.kill_type,
        },
        "ELITE_MONSTER_KILL" => SlimEvent::EliteMonsterKill {
            timestamp: e.timestamp,
            killer_id: e.killer_id,
            killer_team_id: e.killer_team_id,
            monster_type: e.monster_type,
            monster_sub_type: e.monster_sub_type,
            x: pos.x,
            y: pos.y,
        },
        "BUILDING_KILL" => SlimEvent::BuildingKill {
            timestamp: e.timestamp,
            killer_id: e.killer_id,
            team_id: e.team_id,
            building_type: e.building_type,
            tower_type: e.tower_type,
            lane_type: e.lane_type,
        },
        "TURRET_PLATE_DESTROYED" => SlimEvent::TurretPlateDestroyed {
            timestamp: e.timestamp,
            killer_id: e.killer_id,
            team_id: e.team_id,
            lane_type: e.lane_type,
        },
        "ITEM_PURCHASED" => SlimEvent::ItemPurchased {
            timestamp: e.timestamp,
            participant_id: e.participant_id,
            item_id: e.item_id,
        },
        "ITEM_SOLD" => SlimEvent::ItemSold {
            timestamp: e.timestamp,
            participant_id: e.participant_id,
            item_id: e.item_id,
        },
        "ITEM_UNDO" => SlimEvent::ItemUndo {
            timestamp: e.timestamp,
            participant_id: e.participant_id,
            before_id: e.before_id,
            after_id: e.after_id,
        },
        "SKILL_LEVEL_UP" => SlimEvent::SkillLevelUp {
            timestamp: e.timestamp,
            participant_id: e.participant_id,
            skill_slot: e.skill_slot,
            level_up_type: e.level_up_type,
        },
        "WARD_PLACED" => SlimEvent::WardPlaced {
            timestamp: e.timestamp,
            creator_id: e.creator_id,
            ward_type: e.ward_type,
        },
        "WARD_KILL" => SlimEvent::WardKill {
            timestamp: e.timestamp,
            killer_id: e.killer_id,
            ward_type: e.ward_type,
        },
        "GAME_END" => SlimEvent::GameEnd {
            timestamp: e.timestamp,
            winning_team: e.winning_team,
        },
        _ => return None,
    })
}

/// 原始 DETAILS → 裁剪时间线。
///
/// # 参数
/// - `raw`: DETAILS 的 `json` 部分
/// - `items`: 全量物品分类表（[`build_item_meta`]）；只把本局被购买过的条目带出去
pub fn slim_from_raw(raw: RawDetailsJson, items: &HashMap<i64, ItemMeta>) -> SlimTimeline {
    let mut frames = Vec::with_capacity(raw.frames.len());
    let mut events = Vec::new();
    for f in raw.frames {
        let mut players: Vec<SlimPlayerFrame> = f
            .participant_frames
            .into_values()
            .map(|p| SlimPlayerFrame {
                participant_id: p.participant_id,
                total_gold: p.total_gold,
                xp: p.xp,
                level: p.level,
                cs: p.minions_killed + p.jungle_minions_killed,
                jungle_cs: p.jungle_minions_killed,
                x: p.position.x,
                y: p.position.y,
                damage_to_champions: p.damage_stats.total_damage_done_to_champions,
            })
            .collect();
        players.sort_by_key(|p| p.participant_id);
        frames.push(SlimFrame {
            timestamp: f.timestamp,
            players,
        });
        events.extend(f.events.into_iter().filter_map(convert_event));
    }
    events.sort_by_key(|e| e.timestamp());

    let purchased: HashSet<i64> = events
        .iter()
        .filter_map(|e| match e {
            SlimEvent::ItemPurchased { item_id, .. } | SlimEvent::ItemSold { item_id, .. } => {
                Some(*item_id)
            }
            _ => None,
        })
        .collect();
    let items = purchased
        .into_iter()
        .filter_map(|id| items.get(&id).map(|m| (id, m.clone())))
        .collect();

    SlimTimeline {
        game_id: raw.game_id,
        frame_interval_ms: raw.frame_interval,
        participants: raw
            .participants
            .into_iter()
            .map(|p| SlimParticipant {
                participant_id: p.participant_id,
                puuid: p.puuid,
                team_position: String::new(),
                vision_score: None,
                damage_dealt_to_objectives: None,
                time_c_cing_others: None,
            })
            .collect(),
        frames,
        events,
        items,
    }
}

/// 把 SUMMARY 的真实分路写进裁剪时间线：按 puuid 匹配（DETAILS 侧 puuid 为空时按 participantId）。
pub fn apply_positions(slim: &mut SlimTimeline, summary: &RawSummaryJson) {
    for p in &mut slim.participants {
        let hit = summary.participants.iter().find(|s| {
            if p.puuid.is_empty() {
                s.participant_id == p.participant_id
            } else {
                s.puuid == p.puuid
            }
        });
        if let Some(s) = hit {
            p.team_position = s.team_position.clone();
            p.vision_score = s.vision_score;
            p.damage_dealt_to_objectives = s.damage_dealt_to_objectives;
            p.time_c_cing_others = s.time_c_cing_others;
        }
    }
}

// ─────────────────────────── 拉取与缓存 ───────────────────────────

/// SGP 时间线请求超时（DETAILS 体积大，但正常 1~2s 返回）。
const FETCH_TIMEOUT: Duration = Duration::from_secs(8);
/// 磁盘缓存文件数上限（每个 ≈30KB），超出按修改时间淘汰最旧的。
const CACHE_MAX_FILES: usize = 300;

/// 物品分类表进程内缓存（只缓存非空结果，客户端未就绪时下次重试）。
static ITEM_META: std::sync::OnceLock<HashMap<i64, ItemMeta>> = std::sync::OnceLock::new();

/// platformId 只允许 ASCII 字母数字（会拼进缓存文件名，防路径穿越）。
fn validate_platform_id(platform_id: &str) -> Result<(), String> {
    if !platform_id.is_empty() && platform_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        Ok(())
    } else {
        Err(format!("非法大区标识 {platform_id:?}"))
    }
}

/// 缓存格式版本：v2 起 participants 带 teamPosition，v3 起带 visionScore/damageDealtToObjectives/timeCCingOthers。旧版文件名不同，自然失效，由容量淘汰清掉。
const CACHE_VERSION: &str = "v3";

fn cache_path_in(dir: &Path, platform_id: &str, game_id: i64) -> PathBuf {
    dir.join(format!("{platform_id}_{game_id}_{CACHE_VERSION}.json"))
}

/// 读缓存；未命中或内容损坏返回 None。对局结束后数据不变，故无 TTL。
fn read_cache_in(dir: &Path, platform_id: &str, game_id: i64) -> Option<SlimTimeline> {
    let bytes = std::fs::read(cache_path_in(dir, platform_id, game_id)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// 写缓存并做容量淘汰；任何 IO 失败只记日志（缓存是优化，不影响主流程）。
fn write_cache_in(dir: &Path, platform_id: &str, game_id: i64, slim: &SlimTimeline) {
    if let Err(e) = std::fs::create_dir_all(dir) {
        log::warn!("时间线缓存目录创建失败: {e}");
        return;
    }
    match serde_json::to_vec(slim) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(cache_path_in(dir, platform_id, game_id), bytes) {
                log::warn!("时间线缓存写入失败: {e}");
            }
        }
        Err(e) => log::warn!("时间线序列化失败: {e}"),
    }
    prune_cache_in(dir, CACHE_MAX_FILES);
}

/// 保留最新的 `max` 个 `.json` 文件，其余按修改时间从旧到新删除。
fn prune_cache_in(dir: &Path, max: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
        .filter_map(|p| {
            let t = std::fs::metadata(&p).and_then(|m| m.modified()).ok()?;
            Some((t, p))
        })
        .collect();
    if files.len() <= max {
        return;
    }
    files.sort_by_key(|(t, _)| *t);
    let excess = files.len() - max;
    for (_, p) in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(p);
    }
}

fn cache_dir() -> PathBuf {
    crate::paths::cache_subdir("timelines")
}

/// 物品分类表：首次从 LCU 拉取，成功后进程内常驻。失败返回空表（出装卡片随之跳过）。
async fn item_meta() -> HashMap<i64, ItemMeta> {
    if let Some(m) = ITEM_META.get() {
        return m.clone();
    }
    match lcu_get::<Vec<RawItem>>(constant::api::ITEM_URI).await {
        Ok(list) if !list.is_empty() => {
            let m = build_item_meta(&list);
            let _ = ITEM_META.set(m.clone());
            m
        }
        Ok(_) => HashMap::new(),
        Err(e) => {
            log::warn!("物品列表获取失败，时间线不带出装分类: {e}");
            HashMap::new()
        }
    }
}

/// 拉取并裁剪某局时间线（带磁盘缓存）。
///
/// # 参数
/// - `platform_id`: 对局所在大区（LCU `Game.platformId`，如 `TJ100`）
/// - `game_id`: 对局 ID
///
/// # 错误
/// 未知大区、token 不可用、SGP 非 2xx（含超保留期 404）、超时、反序列化失败。
/// 调用方应降级为无时间线复盘。
pub async fn fetch_game_timeline(platform_id: &str, game_id: i64) -> Result<SlimTimeline, String> {
    validate_platform_id(platform_id)?;
    let dir = cache_dir();
    if let Some(hit) = read_cache_in(&dir, platform_id, game_id) {
        return Ok(hit);
    }
    let host = constant::game::get_sgp_host(platform_id)
        .ok_or_else(|| format!("未知大区 {platform_id}，无对应 SGP 主机"))?;
    let token = super::sgp::get_entitlements_access_token().await?;
    let details_uri =
        format!("match-history-query/v1/products/lol/{platform_id}_{game_id}/DETAILS");
    let summary_uri =
        format!("match-history-query/v1/products/lol/{platform_id}_{game_id}/SUMMARY");
    // 两个请求同主机同 token 并发；SUMMARY 只为取分路，失败不影响时间线
    let (raw, summary) = tokio::join!(
        tokio::time::timeout(
            FETCH_TIMEOUT,
            sgp_get::<RawDetails>(host, &details_uri, &token)
        ),
        tokio::time::timeout(
            FETCH_TIMEOUT,
            sgp_get::<RawSummary>(host, &summary_uri, &token)
        )
    );
    let raw = raw.map_err(|_| format!("SGP 时间线请求超时（{}s）", FETCH_TIMEOUT.as_secs()))??;
    let items = item_meta().await;
    let mut slim = slim_from_raw(raw.json, &items);
    let positions_ok = match summary {
        Ok(Ok(s)) => {
            apply_positions(&mut slim, &s.json);
            true
        }
        Ok(Err(e)) => {
            log::warn!("SGP 单局 SUMMARY 获取失败，分路留空: {e}");
            false
        }
        Err(_) => {
            log::warn!("SGP 单局 SUMMARY 超时，分路留空");
            false
        }
    };
    // 物品表或分路不可用时不缓存：否则该局出装分类/分路将永久缺失
    if !items.is_empty() && positions_ok {
        write_cache_in(&dir, platform_id, game_id, &slim);
    }
    Ok(slim)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("../../../tests/fixtures/sgp_details_sample.json");

    fn sample() -> RawDetailsJson {
        serde_json::from_str::<RawDetails>(SAMPLE)
            .expect("fixture 可解析")
            .json
    }

    #[test]
    fn should_keep_frames_and_flatten_events_sorted() {
        let slim = slim_from_raw(sample(), &HashMap::new());
        assert_eq!(slim.frames.len(), 8);
        assert_eq!(slim.participants.len(), 10);
        assert!(slim.frames.iter().all(|f| f.players.len() == 10));
        assert!(slim
            .events
            .windows(2)
            .all(|w| w[0].timestamp() <= w[1].timestamp()));
    }

    #[test]
    fn should_drop_noise_events() {
        let slim = slim_from_raw(sample(), &HashMap::new());
        let json = serde_json::to_string(&slim).unwrap();
        assert!(!json.contains("ITEM_DESTROYED"));
        assert!(!json.contains("\"type\":\"LEVEL_UP\""));
        assert!(!json.contains("PAUSE_END"));
        assert!(json.contains("\"type\":\"SKILL_LEVEL_UP\""));
        assert!(json.contains("\"type\":\"ITEM_PURCHASED\""));
    }

    #[test]
    fn should_shrink_payload_by_an_order_of_magnitude() {
        let slim = slim_from_raw(sample(), &HashMap::new());
        let out = serde_json::to_string(&slim).unwrap();
        assert!(
            out.len() * 5 < SAMPLE.len(),
            "slim={} raw={}",
            out.len(),
            SAMPLE.len()
        );
    }

    #[test]
    fn should_aggregate_damage_by_source_desc() {
        let list = vec![
            RawDamage {
                participant_id: 7,
                magic_damage: 100,
                physical_damage: 0,
                true_damage: 0,
                spell_slot: 3,
            },
            RawDamage {
                participant_id: 7,
                magic_damage: 0,
                physical_damage: 50,
                true_damage: 0,
                spell_slot: 64,
            },
            RawDamage {
                participant_id: 8,
                magic_damage: 0,
                physical_damage: 200,
                true_damage: 0,
                spell_slot: 0,
            },
            RawDamage {
                participant_id: 0,
                magic_damage: 999,
                physical_damage: 0,
                true_damage: 0,
                spell_slot: 0,
            },
        ];
        let out = aggregate_damage(&list);
        assert_eq!(
            out,
            vec![
                DamageSource {
                    participant_id: 8,
                    total: 200,
                    top_slot: 0
                },
                DamageSource {
                    participant_id: 7,
                    total: 150,
                    top_slot: 3
                },
            ]
        );
    }

    #[test]
    fn should_classify_items() {
        let mk = |id, price, to: Vec<i64>, cats: &[&str]| RawItem {
            id,
            name: format!("item{id}"),
            price_total: price,
            to,
            categories: cats.iter().map(|s| s.to_string()).collect(),
        };
        let meta = build_item_meta(&[
            mk(3031, 3450, vec![], &["CriticalStrike"]),
            mk(3006, 1100, vec![], &["Boots"]),
            mk(1001, 300, vec![3006], &["Boots"]),
            mk(1038, 1300, vec![3031], &[]),
            mk(2003, 50, vec![], &["Consumable"]),
        ]);
        assert_eq!(meta[&3031].kind, ItemKind::Legendary);
        assert_eq!(meta[&3006].kind, ItemKind::Boots);
        assert_eq!(meta[&1001].kind, ItemKind::Other);
        assert_eq!(meta[&1038].kind, ItemKind::Other);
        assert_eq!(meta[&2003].kind, ItemKind::Other);
    }

    #[test]
    fn should_only_ship_item_meta_for_purchased_items() {
        let mut all = HashMap::new();
        all.insert(
            999_999,
            ItemMeta {
                name: "没人买".into(),
                price_total: 1,
                kind: ItemKind::Other,
            },
        );
        let slim = slim_from_raw(sample(), &all);
        assert!(!slim.items.contains_key(&999_999));
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!("tl-test-{tag}-{nanos}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn should_roundtrip_cache() {
        let dir = temp_dir("rt");
        let slim = slim_from_raw(sample(), &HashMap::new());
        write_cache_in(&dir, "TJ100", 42, &slim);
        assert_eq!(read_cache_in(&dir, "TJ100", 42), Some(slim));
        assert_eq!(read_cache_in(&dir, "TJ100", 43), None);
    }

    #[test]
    fn should_prune_oldest_files_beyond_cap() {
        let dir = temp_dir("prune");
        for i in 0..5 {
            std::fs::write(dir.join(format!("TJ100_{i}.json")), b"{}").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        prune_cache_in(&dir, 3);
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, vec!["TJ100_2.json", "TJ100_3.json", "TJ100_4.json"]);
    }

    #[test]
    fn should_reject_unsafe_platform_id() {
        assert!(validate_platform_id("TJ100").is_ok());
        assert!(validate_platform_id("../x").is_err());
        assert!(validate_platform_id("").is_err());
    }

    #[test]
    fn should_apply_summary_positions_by_puuid() {
        let mut slim = slim_from_raw(sample(), &HashMap::new());
        assert!(slim.participants.iter().all(|p| p.team_position.is_empty()));
        let summary: RawSummary = serde_json::from_str(
            r#"{"metadata":{},"json":{"participants":[
                {"participantId":8,"puuid":"puuid-1","teamPosition":"TOP"},
                {"participantId":2,"puuid":"puuid-2","teamPosition":"JUNGLE"}]}}"#,
        )
        .unwrap();
        apply_positions(&mut slim, &summary.json);
        let pos = |id: i64| {
            slim.participants
                .iter()
                .find(|p| p.participant_id == id)
                .unwrap()
                .team_position
                .clone()
        };
        // 按 puuid 匹配，不看 participantId
        assert_eq!(pos(1), "TOP");
        assert_eq!(pos(2), "JUNGLE");
        assert_eq!(pos(3), "");
    }

    #[test]
    fn should_apply_summary_scoring_metrics() {
        let mut slim = slim_from_raw(sample(), &HashMap::new());
        let summary: RawSummary = serde_json::from_str(
            r#"{"json":{"participants":[
                {"participantId":1,"puuid":"puuid-1","visionScore":31,
                 "damageDealtToObjectives":12345,"timeCCingOthers":17}]}}"#,
        )
        .unwrap();
        apply_positions(&mut slim, &summary.json);
        let p1 = &slim.participants[0];
        assert_eq!(p1.vision_score, Some(31));
        assert_eq!(p1.damage_dealt_to_objectives, Some(12345));
        assert_eq!(p1.time_c_cing_others, Some(17));
        let v = serde_json::to_value(p1).unwrap();
        assert_eq!(v["visionScore"], 31);
        assert_eq!(v["damageDealtToObjectives"], 12345);
        assert_eq!(v["timeCCingOthers"], 17);
        // 未命中的玩家保持 None（null），不是 0
        assert_eq!(slim.participants[1].vision_score, None);
    }

    #[test]
    fn should_tolerate_summary_without_positions() {
        let s: RawSummary =
            serde_json::from_str(r#"{"json":{"participants":[{"participantId":1}]}}"#).unwrap();
        assert_eq!(s.json.participants[0].team_position, "");
        let empty: RawSummary = serde_json::from_str("{}").unwrap();
        assert!(empty.json.participants.is_empty());
    }

    #[test]
    fn should_not_read_pre_v3_cache_files() {
        let dir = temp_dir("ver");
        let slim = slim_from_raw(sample(), &HashMap::new());
        std::fs::write(
            dir.join("TJ100_42.json"),
            serde_json::to_vec(&slim).unwrap(),
        )
        .unwrap();
        std::fs::write(
            dir.join("TJ100_42_v2.json"),
            serde_json::to_vec(&slim).unwrap(),
        )
        .unwrap();
        assert_eq!(read_cache_in(&dir, "TJ100", 42), None);
        write_cache_in(&dir, "TJ100", 42, &slim);
        assert!(dir.join("TJ100_42_v3.json").exists());
    }

    /// 手动工具：把采集到的原始 DETAILS 批量裁剪成 TS 侧 fixture。
    ///
    /// ```text
    /// RAW_DIR=../scripts/ai-eval/fixtures/games SLIM_OUT_DIR=../scripts/ai-eval/fixtures/slim \
    /// ITEMS_JSON=../scripts/ai-eval/fixtures/items.json ANON=0 \
    /// cargo test dump_slim_fixtures -- --ignored
    /// ```
    /// `ANON=1` 时把 puuid 替换成 `puuid-<participantId>`、gameId 置 1（入库用）。
    #[test]
    #[ignore]
    fn dump_slim_fixtures() {
        let raw_dir = std::env::var("RAW_DIR").expect("RAW_DIR");
        let out_dir = std::env::var("SLIM_OUT_DIR").expect("SLIM_OUT_DIR");
        let anon = std::env::var("ANON").map(|v| v == "1").unwrap_or(false);
        let items: HashMap<i64, ItemMeta> = match std::env::var("ITEMS_JSON") {
            Ok(p) => build_item_meta(
                &serde_json::from_str::<Vec<RawItem>>(&std::fs::read_to_string(p).unwrap())
                    .unwrap(),
            ),
            Err(_) => HashMap::new(),
        };
        std::fs::create_dir_all(&out_dir).unwrap();
        for entry in std::fs::read_dir(&raw_dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let v: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let details = v.get("details").cloned().unwrap_or(v);
            let raw: RawDetails = serde_json::from_value(details).unwrap();
            let mut slim = slim_from_raw(raw.json, &items);
            if anon {
                slim.game_id = 1;
                for p in &mut slim.participants {
                    p.puuid = format!("puuid-{}", p.participant_id);
                }
            }
            let name = path.file_name().unwrap();
            std::fs::write(
                std::path::Path::new(&out_dir).join(name),
                serde_json::to_string(&slim).unwrap(),
            )
            .unwrap();
        }
    }
}
