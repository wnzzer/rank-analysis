//! # Mayhem 命令模块
//!
//! 海克斯大乱斗（queueId 2400）数据的前端入口：
//! 同步（[`mayhem_sync`]）、状态查询（[`mayhem_status`]）、榜单读取
//! （[`mayhem_get_champions`] / [`mayhem_get_augments`]）、单英雄详情
//! （[`mayhem_get_champion_detail`]）。
//!
//! 数据契约与磁盘布局见 [`crate::mayhem`] 模块文档。
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! // 前端：首次进入大乱斗页时同步数据
//! let report = mayhem_sync(Some(false)).await?; // force=false，版本一致则跳过
//!
//! // 读取英雄榜（本地激活版本）
//! let champions = mayhem_get_champions().await?;
//! ```

use serde::Serialize;
use serde_json::Value;

use crate::lcu::api::match_history::MatchHistory;
use crate::lcu::api::summoner::Summoner;
use crate::mayhem::client::SyncReport;
use crate::mayhem::db::{self, AugmentAgg, ChampionAgg, ImportReport};
use crate::mayhem::MAYHEM_QUEUE_ID;

/// 全局同步互斥锁：防止前端重复触发导致并发下载同一版本。
static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 本地数据状态（供页面首屏渲染，不发网络请求）。
#[derive(Debug, Serialize)]
pub struct MayhemStatus {
    /// 当前激活的数据版本；未同步过为 null。
    pub active_version: Option<String>,
    /// 激活时间（Unix 秒）；未同步过为 null。
    pub synced_at: Option<i64>,
    /// 关键文件是否齐备（champions/augments/index 任一缺失视为不可用）。
    pub ready: bool,
}

/// 同步海克斯大乱斗数据到本地。
///
/// # 参数
///
/// - `force`: 强制重新下载（默认 false——远端版本一致时直接跳过）
///
/// # 返回值
///
/// - `Ok(None)` 序列化为 `null`：本地已是最新
/// - `Ok(Some(report))`：完成了一次新版本下载
#[tauri::command]
pub async fn mayhem_sync(force: Option<bool>) -> Result<Option<SyncReport>, String> {
    let _guard = SYNC_LOCK.lock().await;
    crate::mayhem::store::sync(force.unwrap_or(false)).await
}

/// 查询本地数据状态（纯磁盘读取，离线可用）。
#[tauri::command]
pub fn mayhem_status() -> Result<MayhemStatus, String> {
    let ptr = crate::mayhem::store::read_pointer();
    let (version, synced_at) = match ptr {
        Some(p) => (Some(p.data_version.clone()), Some(p.synced_at)),
        None => (None, None),
    };
    let ready = version.is_some()
        && crate::mayhem::store::read_local_json("champions.json").is_ok()
        && crate::mayhem::store::read_local_json("augments.json").is_ok()
        && crate::mayhem::store::read_local_json("champion-shards/index.json").is_ok();
    Ok(MayhemStatus {
        active_version: version,
        synced_at,
        ready,
    })
}

/// 读取英雄榜（champions.json 原始 JSON，含 T 级/胜率/选取率/职业标签）。
#[tauri::command]
pub fn mayhem_get_champions() -> Result<serde_json::Value, String> {
    crate::mayhem::store::read_local_json("champions.json")
}

/// 读取强化榜（augments.json 原始 JSON）。
#[tauri::command]
pub fn mayhem_get_augments() -> Result<serde_json::Value, String> {
    crate::mayhem::store::read_local_json("augments.json")
}

/// 读取单个英雄的大乱斗详情（强化胜率列表/TOP 组合/出装/加点/召唤师技能）。
///
/// # 返回值
///
/// - `Ok(null)`: 未同步或该英雄无数据（调用方按无数据处理）
#[tauri::command]
pub fn mayhem_get_champion_detail(champion_id: i64) -> Result<Option<serde_json::Value>, String> {
    crate::mayhem::store::champion_detail(champion_id)
}

// ---------------------------------------------------------------------------
// 个人自采（mayhem.db，数据不出设备）
// ---------------------------------------------------------------------------

/// 从本机 LCU 战绩导入最近的海克斯大乱斗对局。
///
/// 单次 LCU 请求（0..=49 场窗口）即可拿到完整摘要（含 playerAugment1..6），
/// 无需逐场拉详情；写入按 game_id 幂等。需要客户端在线。
#[tauri::command]
pub async fn mayhem_import_recent() -> Result<ImportReport, String> {
    let me = Summoner::get_my_summoner().await?;
    let history = MatchHistory::get_match_history_by_puuid(&me.puuid, 0, 49).await?;

    let mayhem_games: Vec<_> = history
        .games
        .games
        .iter()
        .filter(|g| g.queue_id == MAYHEM_QUEUE_ID)
        .collect();

    let mut report = ImportReport {
        scanned: mayhem_games.len() as i64,
        ..Default::default()
    };
    for g in &mayhem_games {
        match db::import_game(g, &me.puuid) {
            Some(true) => report.imported += 1,
            Some(false) => report.skipped_existing += 1,
            // 连接未就绪或写库失败：计入失败，继续处理其余对局
            None => report.failed += 1,
        }
    }
    Ok(report)
}

/// 本人英雄维度聚合（games/wins/KDA 求和），按场次降序。
#[tauri::command]
pub fn mayhem_personal_champion_stats() -> Result<Vec<ChampionAgg>, String> {
    Ok(db::personal_champion_stats())
}

/// 本人强化维度聚合；`champion_id` 提供时只统计该英雄的对局。
#[tauri::command]
pub fn mayhem_personal_augment_stats(champion_id: Option<i32>) -> Result<Vec<AugmentAgg>, String> {
    Ok(db::personal_augment_stats(champion_id))
}

/// 版本变动日志（新 → 旧）；首次同步前为空表。
#[tauri::command]
pub fn mayhem_version_changes() -> Result<Vec<crate::mayhem::store::VersionChange>, String> {
    Ok(crate::mayhem::store::version_changes())
}

// ---------------------------------------------------------------------------
// A3 局内三选一：探测 / OCR 匹配层
// ---------------------------------------------------------------------------

/// LCU 强化暴露度探测（A3.0）。
///
/// 在真实 2400 对局中调用：扫描候选端点 JSON 里键名含 "augment" 的路径。
/// 全部为空即维持 OCR 主路径；一旦出现可用状态字段，A3 可升级为事件订阅。
#[tauri::command]
pub async fn mayhem_probe_lcu() -> Result<Vec<crate::mayhem::probe::ProbeResult>, String> {
    Ok(crate::mayhem::probe::run_probe().await)
}

/// 当前本地数据构建的强化名词表（OCR 词表约束用）。
#[tauri::command]
pub fn mayhem_ocr_lexicon() -> Result<Vec<crate::mayhem::ocr::LexiconEntry>, String> {
    let augments = crate::mayhem::store::read_local_json("augments.json")?;
    Ok(crate::mayhem::ocr::build_lexicon(&augments))
}

/// 用样例文本试跑词表匹配（调试用：验证归一化/容差手感，无需截屏）。
#[tauri::command]
pub fn mayhem_ocr_match_sample(
    text: String,
    max_distance: Option<usize>,
) -> Result<Option<crate::mayhem::ocr::MatchHit>, String> {
    let lexicon = mayhem_ocr_lexicon()?;
    Ok(crate::mayhem::ocr::match_text(
        &text,
        &lexicon,
        max_distance.unwrap_or(2),
    ))
}

// ---------------------------------------------------------------------------
// A3.1 屏幕捕获几何
// ---------------------------------------------------------------------------

/// 主显示器信息。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    pub width: i32,
    pub height: i32,
}

/// 主显示器分辨率（A3.1 布局与调试用；非 Windows 返回 Err）。
#[tauri::command]
pub fn mayhem_screen_info() -> Result<ScreenInfo, String> {
    #[cfg(windows)]
    {
        let (width, height) = crate::mayhem::capture::gdi::primary_screen_size();
        Ok(ScreenInfo { width, height })
    }
    #[cfg(not(windows))]
    Err("屏幕捕获仅支持 Windows".to_string())
}

/// 当前主显示器下三张强化卡的标题带矩形（左/中/右）。
///
/// 非平台相关：纯几何计算；非 Windows 以 1080p 为基准返回，便于前端开发预览。
#[tauri::command]
pub fn mayhem_slot_band_rects() -> Result<Vec<crate::mayhem::capture::Rect>, String> {
    let screen = {
        #[cfg(windows)]
        {
            crate::mayhem::capture::gdi::primary_screen_size()
        }
        #[cfg(not(windows))]
        {
            (1920, 1080)
        }
    };
    let rects = crate::mayhem::capture::slot_band_rects(screen);
    Ok(rects.to_vec())
}

/// 抓取三张卡的标题带并计算亮度标准差（A3 触发时机启发式）。
///
/// 纯色画面 stddev≈0；出现强化卡文字/图标后显著升高。OCR 引擎接入前，
/// 这是判断「三选一是否出现」的唯一信号源（阈值由前端 trigger 层持有）。
#[tauri::command]
pub async fn mayhem_capture_band_stats() -> Result<Vec<crate::mayhem::capture::BandStat>, String> {
    #[cfg(windows)]
    {
        let screen = crate::mayhem::capture::gdi::primary_screen_size();
        crate::mayhem::capture::analyze_bands(screen, &|x, y, w, h| {
            crate::mayhem::capture::gdi::capture_region_rgba(x, y, w, h).map(|rg| rg.rgba)
        })
    }
    #[cfg(not(windows))]
    Err("屏幕捕获仅支持 Windows".to_string())
}

/// 选人期上下文（A2）：队列 ID + 我方阵容 + bench 候选。
///
/// 不在选人阶段 / LCU 未连接时返回 null——前端按「无数据」隐藏面板。
#[tauri::command]
pub async fn mayhem_draft_context() -> Result<Option<Value>, String> {
    let session = match crate::lcu::api::champion_select::get_champion_select_session().await {
        Ok(s) => s,
        // 非选人阶段是该命令的正常失败路径，静默转 None
        Err(_) => return Ok(None),
    };
    // Session 结构体不含 queue 字段：直接读原始 gameflow JSON 取队列 ID
    let gf: Value = crate::lcu::util::http::lcu_get("lol-gameflow/v1/session")
        .await
        .unwrap_or(Value::Null);
    let queue_id = gf["queue"]["id"].as_i64().map(|x| x as i32);

    let v = serde_json::to_value(&session).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::json!({
        "queueId": queue_id,
        "localCellId": v["localPlayerCellId"],
        "myTeam": v["myTeam"],
        "bench": v["benchChampions"],
    })))
}

/// 手动三选一：用户自行输入卡面文字，走完整「词表匹配→打分→组装」链路。
///
/// 这是 OCR 引擎就位前的可用兜底（对标 aramgg_client 的 F1 手动流程）：
/// 截屏识别失败时用户把三张卡名称敲进来，同样得到带分数的推荐面板。
/// 超过 3 个的文本忽略；不足 3 个按空槽处理。
#[tauri::command]
pub async fn mayhem_assist_manual(
    texts: Vec<String>,
    champion_id: Option<i64>,
    rerolls_left: Option<u8>,
) -> Result<Value, String> {
    let mut slots: [Option<String>; 3] = [None, None, None];
    for (i, t) in texts.iter().take(3).enumerate() {
        let t = t.trim();
        if !t.is_empty() {
            slots[i] = Some(t.to_string());
        }
    }
    crate::mayhem::pipeline::run_augment_round(slots, champion_id.unwrap_or(67), rerolls_left)
}

/// 校准截图（A3.1）：抓取三张卡标题带并导出 BMP（base64）。
///
/// 前端把三张图直接展示给用户，据此调整 capture.rs 的标定常数，
/// 使矩形精确对准游戏内的强化名称文本。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BandDump {
    pub slot: u8,
    pub bmp_base64: String,
}

#[tauri::command]
pub fn mayhem_capture_band_dump() -> Result<Vec<BandDump>, String> {
    #[cfg(windows)]
    {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine as _;

        let screen = crate::mayhem::capture::gdi::primary_screen_size();
        let rects = crate::mayhem::capture::slot_band_rects(screen);
        let mut out = Vec::with_capacity(3);
        for r in &rects {
            let region = crate::mayhem::capture::gdi::capture_region_rgba(r.x, r.y, r.w, r.h)?;
            out.push(BandDump {
                slot: out.len() as u8,
                bmp_base64: STANDARD.encode(crate::mayhem::capture::encode_bmp_rgba(
                    &region.rgba,
                    r.w,
                    r.h,
                )),
            });
        }
        Ok(out)
    }
    #[cfg(not(windows))]
    Err("屏幕捕获仅支持 Windows".to_string())
}

/// 当前 gameflow 阶段（大乱斗助手触发调度用）。
#[tauri::command]
pub async fn mayhem_gameflow_phase() -> Result<String, String> {
    crate::lcu::api::phase::get_phase().await
}

/// 大乱斗助手单次 tick（A3 触发→识别→打分→推送 的编排入口）。
///
/// 流程：阶段过滤 → 抓三卡标题带活跃度 → 检测判定 → 识别文本（`ocr-win`
/// feature 启用时走 Windows.Media.Ocr，否则如实返回 `ocr-not-configured`）
/// → 词表匹配打分 → 组装面板负载。
#[tauri::command]
pub async fn mayhem_assist_tick(
    champion_id: Option<i64>,
    rerolls_left: Option<u8>,
) -> Result<Value, String> {
    let phase = crate::lcu::api::phase::get_phase()
        .await
        .unwrap_or_default();
    if phase != "InProgress" {
        return Ok(serde_json::json!({
            "phase": phase, "pushed": false, "reason": "not-in-game", "activeSlots": 0
        }));
    }

    // 三路 cfg 臂各自产出 Result 后统一返回（避免 cfg 组合下的 needless_return）
    // 三路 cfg 臂各自产出 Result 绑定到 `out`，函数尾部统一返回——
    // 避免 cfg 剥离后块尾值被丢弃或触发 needless_return
    #[cfg(all(windows, feature = "ocr-win"))]
    let out: Result<Value, String> = {
        use crate::mayhem::capture::{luma_stddev, slot_band_rects};

        let screen = crate::mayhem::capture::gdi::primary_screen_size();
        let rects = slot_band_rects(screen);
        let mut texts: [Option<String>; 3] = [None, None, None];
        let mut active_slots = 0usize;

        for (i, r) in rects.iter().enumerate() {
            let region = crate::mayhem::capture::gdi::capture_region_rgba(r.x, r.y, r.w, r.h)?;
            if luma_stddev(&region.rgba) >= crate::mayhem::pipeline::BAND_ACTIVE_THRESHOLD {
                active_slots += 1;
            }
            match crate::mayhem::engine_win::recognize_bgra(&region.rgba, r.w, r.h).await {
                Ok(lines) => {
                    let joined = lines.join(" ");
                    if !joined.trim().is_empty() {
                        texts[i] = Some(joined);
                    }
                }
                Err(e) => log::warn!("[assist] 卡位 {i} OCR 失败: {e}"),
            }
        }

        if active_slots < crate::mayhem::pipeline::ACTIVE_SLOTS_REQUIRED {
            return Ok(serde_json::json!({
                "phase": phase, "pushed": false,
                "reason": "no-augment-ui", "activeSlots": active_slots
            }));
        }

        let payload = crate::mayhem::pipeline::run_augment_round(
            texts,
            champion_id.unwrap_or(67),
            rerolls_left,
        )?;
        Ok(serde_json::json!({
            "phase": phase, "pushed": true, "payload": payload
        }))
    };

    #[cfg(all(windows, not(feature = "ocr-win")))]
    let out: Result<Value, String> = {
        // 参数仅在 ocr-win 全管线里消费；该降级臂显式吞掉避免 -Dwarnings
        let _ = (champion_id, rerolls_left);
        let screen = crate::mayhem::capture::gdi::primary_screen_size();
        let stats = crate::mayhem::capture::analyze_bands(screen, &|x, y, w, h| {
            crate::mayhem::capture::gdi::capture_region_rgba(x, y, w, h).map(|rg| rg.rgba)
        })?;
        let active_slots = stats
            .iter()
            .filter(|s| s.stddev >= crate::mayhem::pipeline::BAND_ACTIVE_THRESHOLD)
            .count();
        if !crate::mayhem::pipeline::detect_from_stats(&stats) {
            return Ok(serde_json::json!({
                "phase": phase, "pushed": false,
                "reason": "no-augment-ui", "activeSlots": active_slots
            }));
        }
        // OCR 引擎未编译（--features ocr-win）：检测已通过但拿不到卡位文本，
        // 如实告知前端而非伪造空面板；手动三选一不受影响。
        Ok(serde_json::json!({
            "phase": phase, "pushed": false, "reason": "ocr-not-configured",
            "activeSlots": active_slots
        }))
    };

    #[cfg(not(windows))]
    let out: Result<Value, String> = {
        let _ = (champion_id, rerolls_left);
        Err("屏幕捕获仅支持 Windows".to_string())
    };

    out
}

/// 端到端预览（A3 调试）：用本地真实数据对样例候选打分并组装面板负载。
///
/// 候选取英雄 67（薇恩）分片里前两个有全局数据的强化 + 一个空槽，
/// 走完整 score_round 链路；OCR/截屏层就位后由 pipeline 替换输入源。
#[tauri::command]
pub fn mayhem_score_preview(champion_id: Option<i64>) -> Result<serde_json::Value, String> {
    use std::collections::HashMap;

    let champ_id = champion_id.unwrap_or(67);
    let tables = crate::mayhem::score::load_tables(champ_id)?;

    // 从词表取元数据 + 挑两个有全局胜率样本的候选
    let augments = crate::mayhem::store::read_local_json("augments.json")?;
    let lexicon = crate::mayhem::ocr::build_lexicon(&augments);
    let mut metas: HashMap<i64, crate::mayhem::score::CandidateMeta> = HashMap::new();
    for e in &lexicon {
        metas.insert(
            e.id,
            crate::mayhem::score::CandidateMeta {
                name: e.name.clone(),
                rarity_name: "silver".into(),
            },
        );
    }

    let mut picks: Vec<i64> = Vec::new();
    for (id, g) in &tables.global {
        if g.wr.is_some() && tables.trio_members.contains(id) {
            picks.push(*id);
            if picks.len() == 2 {
                break;
            }
        }
    }
    if picks.len() < 2 {
        for id in tables.global.keys() {
            if !picks.contains(id) && tables.global.get(id).and_then(|g| g.wr).is_some() {
                picks.push(*id);
                if picks.len() == 2 {
                    break;
                }
            }
        }
    }
    if picks.len() < 2 {
        return Err("本地数据不足，无法预览（请先在数据页同步）".to_string());
    }

    let hits = [
        Some(crate::mayhem::ocr::MatchHit {
            id: picks[0],
            confidence: 1.0,
        }),
        None,
        Some(crate::mayhem::ocr::MatchHit {
            id: picks[1],
            confidence: 1.0,
        }),
    ];
    Ok(crate::mayhem::score::score_round(
        [hits[0].as_ref(), hits[1].as_ref(), hits[2].as_ref()],
        &metas,
        &tables,
        Some(2),
    ))
}
