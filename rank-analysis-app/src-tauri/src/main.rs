// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use log::info;
use rank_analysis_lib::command;
use rank_analysis_lib::lcu::api::asset as asset_api;
use rank_analysis_lib::score;
use rank_analysis_lib::state::AppState;

// NOTE: main is no longer async
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 必须是第一条语句：下面的 reporting_enabled() 会直读 config.yaml，
    // observability::init() 会在 device_id 缺失时生成并写盘。
    // 迁移晚于任一处，老用户的配置或匿名设备 ID 就会被新生成的空数据挤掉。
    // logger 此刻尚未安装，结论先带回来，等 set_boxed_logger 之后再补打。
    let migration = rank_analysis_lib::migrate::migrate_legacy_data();

    // 初始化日志，默认 info 级别，可通过 RUST_LOG 环境变量覆盖
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }

    // 配置日志格式，显示时间、级别、文件名、行号和消息。先 build 不 init，
    // 之后按是否开启上报决定是否用 SentryLogger 包一层转发到 Sentry Logs。
    let console_logger = env_logger::Builder::from_default_env()
        .format_timestamp_millis()
        .format(|buf, record| {
            use std::io::Write;
            // 提取文件名（不含路径）
            let file = record.file().unwrap_or("unknown");
            let file_name = file.split(['/', '\\']).next_back().unwrap_or(file);

            writeln!(
                buf,
                "[{} {} {}:{}] {}",
                buf.timestamp_millis(),
                record.level(),
                file_name,
                record.line().unwrap_or(0),
                record.args()
            )
        })
        .build();
    let max_level = console_logger.filter();
    log::set_max_level(max_level);

    // 是否开启错误上报（debug 默认开 / release 需用户在设置中 opt-in）。
    let reporting_on = rank_analysis_lib::observability::reporting_enabled();

    // 安装全局 logger：上报开启时用 SentryLogger 包住控制台 logger，把所有 `log`
    // 记录在打印到控制台的同时转发为 Sentry Structured Logs（全级别 → Log）。
    // 转发前由 observability::scrub_log（before_send_log）脱敏，避免 LCU 令牌 / puuid
    // 外传。上报关闭时只走控制台，行为同从前。
    if reporting_on {
        use sentry::integrations::log::{LogFilter, SentryLogger};
        let logger = SentryLogger::with_dest(console_logger).filter(|_| LogFilter::Log);
        let _ = log::set_boxed_logger(Box::new(logger));
    } else {
        let _ = log::set_boxed_logger(Box::new(console_logger));
    }

    info!("========================================");
    info!("Starting Tauri application with Asset Protocol");
    // CWD 仅作参考：数据落点已不依赖它（见 `paths` 模块），但排障时知道进程被谁以什么
    // 姿势拉起仍然有用。
    info!("Current working directory: {:?}", std::env::current_dir());
    info!(
        "Config file path: {}",
        rank_analysis_lib::paths::config_file().display()
    );
    info!("========================================");

    // 迁移结论补打（迁移本身跑在 logger 之前）。这是线上排查
    // 「老用户升级后配置丢了吗」的唯一证据源。
    if !migration.migrated.is_empty() {
        info!("已从旧安装目录迁移: {}", migration.migrated.join(", "));
    }
    for err in &migration.errors {
        log::warn!("迁移失败(已忽略，不阻断启动): {}", err);
    }

    // 初始化错误上报（创建 Sentry client + guard）。
    // guard 必须存活到 .run() 返回，否则事件 / 日志无法 flush。
    let _sentry_guard = rank_analysis_lib::observability::init();

    let mut app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("asset", move |_ctx, request, responder| {
            let path = request.uri().path();
            // path is like /champion/123
            let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();

            if parts.len() < 2 {
                responder.respond(
                    tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap(),
                );
                return;
            }

            let kind = parts[0].to_string();
            let id = match parts[1].parse::<i64>() {
                Ok(i) => i,
                Err(_) => {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(400)
                            .body(Vec::new())
                            .unwrap(),
                    );
                    return;
                }
            };

            // 异步处理：绝不阻塞 webview 资源加载线程。缓存未就绪（启动竞态）时，
            // get_asset_binary 内部会后台自愈一次 init（见 asset::ensure_caches_ready），
            // 就绪后再通过 responder 回包——首屏冷启动也能自动补上图标，无需手动刷新。
            //
            // Cache-Control: no-store —— 成功响应命中 Rust 端 BINARY_CACHE 是 O(1)，
            // 重新请求成本可忽略；失败响应不被浏览器负缓存，cache 就绪后下次请求即恢复。
            tauri::async_runtime::spawn(async move {
                let response = match asset_api::get_asset_binary(kind, id).await {
                    Ok((bytes, mime)) => tauri::http::Response::builder()
                        .header("Content-Type", mime)
                        .header("Cache-Control", "no-store")
                        .body(bytes)
                        .unwrap(),
                    Err(e) => tauri::http::Response::builder()
                        .status(404)
                        .header("Cache-Control", "no-store")
                        .body(e.into_bytes())
                        .unwrap(),
                };
                responder.respond(response);
            });
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            command::ai::stream_ai_analysis,
            command::ai::test_ai_provider_connection,
            command::ai_cache::ai_cache_get,
            command::ai_cache::ai_cache_put,
            command::asset::get_asset_details,
            command::bp::get_bp_decision,
            command::bp_suggest::get_bp_suggest,
            command::build_stats::get_build_stats,
            command::config::put_config,
            command::config::get_config,
            // command::config::get_http_server_port,
            command::config::get_champion_options,
            command::config::get_game_modes,
            command::get_summoner_by_puuid,
            command::get_summoner_by_name,
            command::get_my_summoner,
            command::get_live_game_data,
            command::rank::get_rank_by_name,
            command::rank::get_rank_by_puuid,
            command::rank::get_ranks_by_puuids,
            command::rank::get_win_rate_by_name_mode,
            command::rank::get_win_rate_by_puuid_mode,
            command::match_history::get_match_history_by_puuid,
            command::match_history::get_match_history_by_name,
            command::match_history::get_game_by_id,
            command::owned::get_owned_champions,
            command::meet::query_meet_summary,
            command::meet::save_collected_games,
            command::meet::load_collected_games,
            command::meet::clear_collected_games,
            command::user_tag::get_user_tag_by_puuid,
            command::user_tag::get_user_tag_by_name,
            command::user_tag_config::get_all_tag_configs,
            command::user_tag_config::save_tag_configs,
            command::info::get_platform_name_by_name,
            command::session::get_session_data,
            command::fandom::update_fandom_data,
            command::fandom::get_aram_balance,
            command::fandom::get_champion_patch_note,
            command::gank_pattern::get_jungle_gank_pattern,
            command::score::get_player_scores,
            command::score::compute_player_scores,
            score::get_score_drilldown,
            command::backtest::get_decision_backtest,
            command::backtest::get_adoption_stats,
            command::opgg::update_opgg_data,
            command::opgg::get_champion_meta,
            command::opgg::get_lane_counters,
            command::opgg::get_opgg_status,
            command::opgg::get_champion_intel,
            command::knowledge::update_knowledge,
            command::knowledge::get_knowledge,
            command::knowledge::get_knowledge_status,
            command::system::relaunch_as_admin,
            command::system::get_device_id,
            command::system::get_asset_prefix,
            command::system::get_platform,
            command::launcher::launch_league,
            command::launcher::close_league,
            command::replay::get_replay_availability,
            command::replay::start_replay_download,
            command::replay::is_replay_ready,
            command::replay::watch_replay,
            command::sgp::get_sgp_regions,
            command::sgp::get_current_sgp_region,
            command::sgp::get_sgp_match_history_by_name,
            command::sgp::get_sgp_match_detail,
            command::sgp::get_sgp_rank_by_name,
            command::sgp::get_sgp_ranks_by_puuids,
            command::cloud_sync::cloud_pull_notes,
            command::cloud_sync::cloud_push_notes,
            command::cloud_sync::read_text_file,
            command::cloud_sync::cloud_pull_config,
            command::cloud_sync::cloud_push_config,
            command::cloud_sync::get_cloud_config_snapshot,
            command::cloud_sync::apply_config_snapshot,
            command::cloud_sync::export_backup,
        ]);

    #[cfg(debug_assertions)]
    {
        app_builder = app_builder.plugin(
            tauri_plugin_mcp_bridge::Builder::new()
                .bind_address("127.0.0.1")
                .build(),
        );
    }

    // 仅在错误上报开启时注册 Sentry 插件（插件会向 webview 注入 @sentry/browser，
    // 使前端事件也经 Rust SDK 统一发送）。
    if let Some(ref client) = _sentry_guard {
        app_builder = app_builder.plugin(tauri_plugin_sentry::init(client));
    }

    app_builder = app_builder.setup(move |app| {
        // 配置变更 → 通知前端调度防抖云推送。只发云同步口径内的键:
        // 黑名单键(含 configLastSyncAt 这类同步自身写的标记)不发,否则
        // 每次同步落盘标记又触发下一轮同步,永不收敛。
        // 覆盖两条写路径:前端 putConfigByIpc 与 Rust 直写(如 save_tag_configs)。
        let config_event_handle = app.handle().clone();
        rank_analysis_lib::config::register_on_change_callback(move |key, _| {
            if rank_analysis_lib::config::allowed_in_cloud(key) {
                use tauri::Emitter;
                let _ = config_event_handle.emit("config-changed", key);
            }
        });

        // 启动期后台任务统一收编到 shard 管理器（P1-4 生命周期：on_init/on_dispose）。
        // 注册顺序即初始化顺序：startup（自动化+资源预热）→ 游戏状态监听 → Fandom 循环。
        rank_analysis_lib::shard::register(rank_analysis_lib::shard::StartupShard::new());
        rank_analysis_lib::shard::register(rank_analysis_lib::shard::GameStateShard::new());
        rank_analysis_lib::shard::register(rank_analysis_lib::shard::FandomShard::new());

        let shard_app = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            rank_analysis_lib::shard::init_all(&shard_app).await;
        });

        Ok(())
    });

    // debug 构建启动时发一条冒烟事件，便于在 Sentry 面板确认链路打通（release 不发）。
    #[cfg(debug_assertions)]
    if _sentry_guard.is_some() {
        sentry::capture_message(
            "Sentry integration smoke test (debug startup)",
            sentry::Level::Info,
        );
    }

    app_builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // 进程退出前逆序 dispose 所有 shard（Fandom 循环等长驻任务收敛停止）
            if let tauri::RunEvent::Exit = event {
                info!("Shutting down: disposing shards...");
                rank_analysis_lib::shard::dispose_all();
            }
        });

    Ok(())
}
