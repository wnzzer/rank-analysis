//! PUGG 聚合：把对局摘要窗口（默认 0..=49 共 50 场）聚合成英雄出装/符文统计。
//!
//! 纯函数层，输入 `&[Game]` 输出 `Option<BuildStats>`，不触任何 IO，命令层
//! 负责取数与缓存。过滤/分组/权重规则全部在这里，单测覆盖。

use crate::lcu::api::match_history::Game;
use serde::{Deserialize, Serialize};

/// 出装槽位数（`item0..item6`）。
pub const ITEM_SLOTS: usize = 7;

/// 样本数下限：少于该场次不输出（防小样本噪声）。
pub const MIN_SAMPLES: u32 = 5;

/// 不计入出装的饰品（守卫/眼类）物品 ID。
const WARD_ITEMS: [i32; 6] = [3330, 3340, 3341, 3363, 3364, 3513];

/// 单装备条目：`item_id` + 使用场次（胜场单独计数，供权重排序与展示）。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ItemStat {
    pub item_id: i32,
    /// 使用场次（含胜负）
    pub count: u32,
    /// 其中胜场数
    pub win_count: u32,
}

/// 单符文条目（主系/副系风格 id 或基石 perk id 的频率表通用）。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuneStat {
    /// 风格 id（如 8100=精密）或基石 perk id（如 8112）
    pub id: i32,
    pub count: u32,
    pub win_count: u32,
}

/// 单召唤师技能条目。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpellStat {
    pub spell_id: i32,
    pub count: u32,
    pub win_count: u32,
}

/// 某英雄在某一模式下的出装/符文聚合结果。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildStats {
    pub champion_id: i32,
    /// 分路（LCU 摘要无可靠 lane 字段，恒为空串；留给 OP.GG 合并层补齐）
    pub position: String,
    /// 模式（queue_id；0 = 未过滤的全模式）
    pub mode: i32,
    /// 样本场次
    pub samples: u32,
    /// 其中胜场数
    pub win_count: u32,
    /// 7 个出装槽位，每槽按胜场权重降序
    pub items: Vec<Vec<ItemStat>>,
    /// 主系风格频率表（按胜场权重降序）
    pub rune_main: Vec<RuneStat>,
    /// 副系风格频率表（按胜场权重降序）
    pub rune_sub: Vec<RuneStat>,
    /// 基石符文（perk0）频率表（按胜场权重降序）
    pub keystone: Vec<RuneStat>,
    /// 召唤师技能频率表（按胜场权重降序）
    pub spells: Vec<SpellStat>,
}

/// 胜场权重 2x 的排序键：`wins * 2 + (count - wins)`，再按 id 兜底保证稳定序。
fn weighted(wins: u32, count: u32) -> u32 {
    wins * 2 + (count - wins)
}

/// 从频率表剔除空值（id=0 表示缺失/未选）并排序。
///
/// # 参数
/// - `stats`: (id, 使用场次, 胜场数) 三元组数组
fn finalize_freq<T>(mut stats: Vec<(i32, u32, u32)>, map: impl Fn(i32, u32, u32) -> T) -> Vec<T> {
    stats.retain(|(id, count, _)| *id > 0 && *count > 0);
    stats.sort_by_key(|(id, count, wins)| (std::cmp::Reverse(weighted(*wins, *count)), *id));
    stats
        .into_iter()
        .map(|(id, count, wins)| map(id, count, wins))
        .collect()
}

/// 把对局摘要聚合成指定英雄的 BuildStats。
///
/// # 规则
/// - 只统计「我」的对局：先按 `my_puuid` 匹配 identities，回退 `participants[0]`；
/// - `mode` 非 0 时只统计 `queue_id == mode` 的对局；
/// - 英雄不匹配的对局跳过；
/// - 胜场权重 2x（排序键 `wins*2 + (count-wins)`）；
/// - 样本 < [`MIN_SAMPLES`] 返回 `None`（调用方按"无推荐"降级）；
/// - 空槽与饰品（守卫类）不计入出装。
///
/// # 参数
/// - `games`: 对局摘要列表（取自战绩缓存窗口）
/// - `champion_id`: 目标英雄
/// - `my_puuid`: 「我」的 puuid，用于匹配身份
/// - `mode`: queue_id 过滤（0 = 全部）
///
/// # 返回值
/// 样本达标时 `Some(BuildStats)`，否则 `None`。
pub fn aggregate_build_stats(
    games: &[Game],
    champion_id: i32,
    my_puuid: &str,
    mode: i32,
) -> Option<BuildStats> {
    // 频率表原始累加：(id, count, win_count)
    let mut items: Vec<Vec<(i32, u32, u32)>> = vec![Vec::new(); ITEM_SLOTS];
    let mut rune_main: Vec<(i32, u32, u32)> = Vec::new();
    let mut rune_sub: Vec<(i32, u32, u32)> = Vec::new();
    let mut keystone: Vec<(i32, u32, u32)> = Vec::new();
    let mut spells: Vec<(i32, u32, u32)> = Vec::new();

    let mut samples: u32 = 0;
    let mut win_count: u32 = 0;

    for game in games {
        if mode != 0 && game.queue_id != mode {
            continue;
        }
        // 「我」的定位：身份数组按 puuid 匹配；无身份信息（异常数据）时
        // 回退参与者[0]（SGP 映射层与 LCU 摘要的既有约定）。身份数组存在
        // 但匹配不到我的 puuid → 本局没有我，跳过。
        let me_idx = if game.participant_identities.is_empty() {
            0
        } else {
            match game
                .participant_identities
                .iter()
                .position(|i| i.player.puuid == my_puuid)
            {
                Some(idx) => idx,
                None => continue,
            }
        };
        let Some(me) = game.participants.get(me_idx) else {
            continue;
        };
        if me.champion_id != champion_id {
            continue;
        }

        samples += 1;
        if me.stats.win {
            win_count += 1;
        }

        // 出装：7 槽位，跳过空槽与饰品
        let raw_items = [
            me.stats.item0,
            me.stats.item1,
            me.stats.item2,
            me.stats.item3,
            me.stats.item4,
            me.stats.item5,
            me.stats.item6,
        ];
        for (slot, item) in raw_items.iter().enumerate() {
            if *item <= 0 || WARD_ITEMS.contains(item) {
                continue;
            }
            bump(&mut items[slot], *item, me.stats.win);
        }

        bump(&mut rune_main, me.stats.perk_primary_style, me.stats.win);
        bump(&mut rune_sub, me.stats.perk_sub_style, me.stats.win);
        bump(&mut keystone, me.stats.perk0, me.stats.win);
        bump(&mut spells, me.spell1_id, me.stats.win);
        bump(&mut spells, me.spell2_id, me.stats.win);
    }

    if samples < MIN_SAMPLES {
        return None;
    }

    Some(BuildStats {
        champion_id,
        position: String::new(),
        mode,
        samples,
        win_count,
        items: items
            .into_iter()
            .map(|slot| {
                finalize_freq(slot, |id, count, wins| ItemStat {
                    item_id: id,
                    count,
                    win_count: wins,
                })
            })
            .collect(),
        rune_main: finalize_freq(rune_main, |id, count, wins| RuneStat {
            id,
            count,
            win_count: wins,
        }),
        rune_sub: finalize_freq(rune_sub, |id, count, wins| RuneStat {
            id,
            count,
            win_count: wins,
        }),
        keystone: finalize_freq(keystone, |id, count, wins| RuneStat {
            id,
            count,
            win_count: wins,
        }),
        spells: finalize_freq(spells, |id, count, wins| SpellStat {
            spell_id: id,
            count,
            win_count: wins,
        }),
    })
}

/// 累加 (id, count, win_count) 频率表。
fn bump(freq: &mut Vec<(i32, u32, u32)>, id: i32, win: bool) {
    if id <= 0 {
        return;
    }
    match freq.iter_mut().find(|(existing, _, _)| *existing == id) {
        Some((_, count, win_count)) => {
            *count += 1;
            if win {
                *win_count += 1;
            }
        }
        None => freq.push((id, 1, u32::from(win))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::match_history::{Game, GamesWrapper, MatchHistory};
    use crate::lcu::api::model::{Participant, ParticipantIdentity, Player, Stats};

    const MY_PUUID: &str = "me-puuid";

    fn participant(champion_id: i32, raw_items: &[i32; ITEM_SLOTS], win: bool) -> Participant {
        Participant {
            participant_id: 1,
            team_id: 100,
            champion_id,
            spell1_id: 4,
            spell2_id: 7,
            stats: Stats {
                win,
                item0: raw_items[0],
                item1: raw_items[1],
                item2: raw_items[2],
                item3: raw_items[3],
                item4: raw_items[4],
                item5: raw_items[5],
                item6: raw_items[6],
                perk_primary_style: 8100,
                perk_sub_style: 8400,
                perk0: 8112,
                ..Default::default()
            },
        }
    }

    fn game_with(
        game_id: i64,
        champion_id: i32,
        queue_id: i32,
        raw_items: &[i32; ITEM_SLOTS],
        win: bool,
        identity_puuid: &str,
    ) -> Game {
        Game {
            game_id,
            queue_id,
            participants: vec![participant(champion_id, raw_items, win)],
            participant_identities: vec![ParticipantIdentity {
                player: Player {
                    puuid: identity_puuid.to_string(),
                    ..Default::default()
                },
            }],
            ..Default::default()
        }
    }

    /// 便捷：对局窗口 → 聚合；样本里每场都是「我」且英雄一致。
    fn history_of(games: Vec<Game>) -> MatchHistory {
        MatchHistory {
            platform_id: "TJ100".to_string(),
            games: GamesWrapper { games },
            ..Default::default()
        }
    }

    /// 满编 7 件套（无饰品无空槽）。
    fn full_items() -> [i32; ITEM_SLOTS] {
        [1054, 3020, 3508, 3157, 3135, 3040, 1054]
    }

    #[test]
    fn returns_none_below_min_samples() {
        let g = game_with(1, 86, 420, &full_items(), true, MY_PUUID);
        let mh = history_of(vec![g; 4]);
        // 4 场 < 5 → None（即使全是同一英雄同一出装）
        let got = aggregate_build_stats(&mh.games.games, 86, MY_PUUID, 0);
        assert!(got.is_none(), "样本不足应返回 None");
    }

    #[test]
    fn aggregates_items_keystone_and_spells() {
        let games: Vec<Game> = (0..6)
            .map(|i| game_with(i, 86, 420, &full_items(), i % 2 == 0, MY_PUUID))
            .collect();
        let got = aggregate_build_stats(&games, 86, MY_PUUID, 0).expect("样本 6 ≥ 5");

        assert_eq!(got.samples, 6);
        assert_eq!(got.win_count, 3);
        assert_eq!(got.position, "");
        // 每槽单品 6 次：item 槽 0 是 1054
        assert_eq!(got.items[0].len(), 1);
        assert_eq!(got.items[0][0].item_id, 1054);
        assert_eq!(got.items[0][0].count, 6);
        assert_eq!(got.items[0][0].win_count, 3);
        // 主系/副系/基石
        assert_eq!(got.rune_main[0].id, 8100);
        assert_eq!(got.rune_main[0].count, 6);
        assert_eq!(got.rune_sub[0].id, 8400);
        assert_eq!(got.keystone[0].id, 8112);
        // 召唤师技能各 6 次
        assert_eq!(got.spells.len(), 2);
        assert!(got.spells.iter().any(|s| s.spell_id == 4 && s.count == 6));
        assert!(got.spells.iter().any(|s| s.spell_id == 7 && s.count == 6));
    }

    #[test]
    fn win_weight_puts_winning_loadout_first() {
        // 槽 0：两套出装——3020 在 3 场胜局出现，3508 在 3 场败局出现
        // 权重：3020 = 3*2 + 0 = 6；3508 = 0*2 + 3 = 3 → 3020 在前
        let mut items_a = full_items();
        items_a[0] = 3020;
        let mut items_b = full_items();
        items_b[0] = 3508;

        let g1: Vec<Game> = (0..3)
            .map(|i| game_with(i, 86, 420, &items_a, true, MY_PUUID))
            .collect();
        let g2: Vec<Game> = (3..6)
            .map(|i| game_with(i, 86, 420, &items_b, false, MY_PUUID))
            .collect();
        let mut games = g1;
        games.extend(g2);

        let got = aggregate_build_stats(&games, 86, MY_PUUID, 0).unwrap();
        assert_eq!(got.win_count, 3);
        assert_eq!(got.items[0].len(), 2);
        assert_eq!(
            got.items[0][0].item_id, 3020,
            "胜场权重 2x：3 胜 3020 应排在 3 败 3508 之前"
        );
        assert_eq!(got.items[0][1].item_id, 3508);
    }

    #[test]
    fn skips_empty_slots_and_wards() {
        let mut items = full_items();
        items[1] = 0; // 空槽
        items[2] = 3340; // 饰品
        let games: Vec<Game> = (0..6)
            .map(|i| game_with(i, 86, 420, &items, true, MY_PUUID))
            .collect();
        let got = aggregate_build_stats(&games, 86, MY_PUUID, 0).unwrap();
        assert!(got.items[1].is_empty(), "空槽不应计入");
        assert!(got.items[2].is_empty(), "饰品不应计入");
        assert_eq!(got.items[0].len(), 1);
    }

    #[test]
    fn filters_by_champion_and_mode() {
        let g_me = game_with(1, 86, 420, &full_items(), true, MY_PUUID);
        let g_other_champ = game_with(2, 200, 420, &full_items(), true, MY_PUUID);
        let g_aram = game_with(3, 86, 450, &full_items(), true, MY_PUUID);
        // 86 的样本需 ≥ MIN_SAMPLES=5：4 场峡谷 + 5 场大乱斗
        let mut games = vec![g_me; 4];
        games.push(g_other_champ);
        games.extend(vec![g_aram; 5]);

        // 全部：只统计 86 的九场
        let got = aggregate_build_stats(&games, 86, MY_PUUID, 0).unwrap();
        assert_eq!(got.samples, 9, "英雄过滤：其他英雄的对局不计入");

        // 模式过滤 450：只留大乱斗五场
        let got = aggregate_build_stats(&games, 86, MY_PUUID, 450).unwrap();
        assert_eq!(got.samples, 5);
        assert_eq!(got.mode, 450);
    }

    #[test]
    fn ignores_games_where_query_player_absent() {
        // 身份数组里没有我的 puuid：participants[0] 回退也拿不到匹配英雄
        let g = game_with(1, 86, 420, &full_items(), true, "someone-else");
        let games = vec![g; 6];
        let got = aggregate_build_stats(&games, 86, MY_PUUID, 0);
        assert!(got.is_none(), "非我参与的对局应全部跳过（样本 0）");
    }
}
