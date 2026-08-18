//! # 一键符文导入的数据聚合（M3 战场五，quick win 先行）
//!
//! 「一键导入」写进客户端的是一套**完整符文页**
//! （主系/副系风格 + 六个已选符文 + 三个小符文），PUGG 摘要聚合只统计
//! 风格/基石频率，没有完整页；而 `collected_games` 的 `game_detail` 详情带
//! 完整 `perks`（LCU/SGP 同构）。因此这里从本地历史聚合「本机该英雄最近
//! `LIMIT` 局里出现次数最多的完整符文页」——纯本地、无外部依赖、与
//! 数据飞轮同源（宁缺毋滥：凑不出一套完整页就返回 None，不编造）。
//!
//! 召唤师技能同理：取本机该英雄最常一起带的一对（spell1, spell2）。

use std::collections::HashMap;

use crate::lcu::api::match_history::Game;
use crate::lcu::api::model::Participant;

/// 聚合窗口：只看最近多少局（按 `games` 输入顺序的末尾 N 局）。
pub const AGGREGATE_LIMIT: usize = 20;

/// 一页可写进客户端的完整符文页。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RunePageBuild {
    pub primary_style_id: i32,
    pub sub_style_id: i32,
    pub selected_perk_ids: Vec<i32>,
    pub defense: i32,
    pub flex: i32,
    pub offense: i32,
}

/// 取「本机玩家」在该局的 participant（身份数组按 puuid 匹配）。
///
/// 与 samples.rs 同纪律：完整详情带身份，匹配不到说明本机不在局内
/// （收集的是别人的局）→ 该局跳过，**不回退** participants[0]（宁缺毋滥）。
fn my_participant<'a>(game: &'a Game, my_puuid: &str) -> Option<&'a Participant> {
    game.game_detail
        .participant_identities
        .iter()
        .position(|i| i.player.puuid == my_puuid)
        .and_then(|idx| game.game_detail.participants.get(idx))
}

/// 从一局的完整 perks 提取可写符文页；缺 styles/stat_perks → None（宁缺毋滥）。
fn build_from_participant(p: &Participant) -> Option<RunePageBuild> {
    let perks = p.perks.as_ref()?;
    let (primary, sub) = if perks.styles.len() >= 2 {
        (&perks.styles[0], &perks.styles[1])
    } else if perks.styles.len() == 1 {
        (&perks.styles[0], &perks.styles[0])
    } else {
        return None;
    };
    if primary.style <= 0 || sub.style <= 0 || primary.selections.is_empty() {
        return None;
    }
    let stat = perks.stat_perks.as_ref()?;
    let mut ids: Vec<i32> = primary.selections.iter().map(|s| s.perk).collect();
    ids.extend(sub.selections.iter().map(|s| s.perk));
    if ids.len() < 5 {
        return None;
    }
    Some(RunePageBuild {
        primary_style_id: primary.style,
        sub_style_id: sub.style,
        selected_perk_ids: ids,
        defense: stat.defense,
        flex: stat.flex,
        offense: stat.offense,
    })
}

/// 纯函数：本机该英雄最近 `limit` 局里最流行的完整符文页。
///
/// # 规则
/// - 只统计「本机玩家」且 `champion_id` 匹配的局；
/// - 只取输入尾部 `limit` 局（调用方传入已按时间序的列表）；
/// - 无完整 perks 的局跳过（宁缺毋滥）；平票取先出现的；
/// - 统计不到任何完整页 → `None`（调用方按"本地无该英雄完整符文记录"降级）。
pub fn most_common_perk_page(
    games: &[Game],
    my_puuid: &str,
    champion_id: i32,
    limit: usize,
) -> Option<RunePageBuild> {
    let window = games.iter().rev().take(limit).rev();
    let mut freq: HashMap<RunePageBuild, u32> = HashMap::new();
    for game in window {
        let p = my_participant(game, my_puuid)?;
        if p.champion_id != champion_id {
            continue;
        }
        if let Some(build) = build_from_participant(p) {
            *freq.entry(build).or_default() += 1;
        }
    }
    freq.into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(build, _)| build)
}

/// 纯函数：本机该英雄最近 `limit` 局里最常一起带的一对召唤师技能。
///
/// 无有效对 → `None`。单局取 (spell1, spell2) 有序对（相同技能对去重）。
pub fn most_common_spells(
    games: &[Game],
    my_puuid: &str,
    champion_id: i32,
    limit: usize,
) -> Option<(i32, i32)> {
    let window = games.iter().rev().take(limit).rev();
    let mut freq: HashMap<(i32, i32), u32> = HashMap::new();
    for game in window {
        let p = my_participant(game, my_puuid)?;
        if p.champion_id != champion_id {
            continue;
        }
        let (s1, s2) = (p.spell1_id, p.spell2_id);
        if s1 > 0 && s2 > 0 && s1 != s2 {
            *freq.entry((s1, s2)).or_default() += 1;
        }
    }
    freq.into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(pair, _)| pair)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lcu::api::game_detail::GameDetail;
    use crate::lcu::api::model::{
        Participant, ParticipantIdentity, PerkSelection, PerkStatPerks, PerkStyle, Perks, Player,
    };

    fn identity(puuid: &str) -> ParticipantIdentity {
        ParticipantIdentity {
            player: Player {
                puuid: puuid.to_string(),
                ..Default::default()
            },
        }
    }

    fn participant(
        id: i32,
        champ: i32,
        puuid: &str,
        build: Option<&RunePageBuild>,
        spells: (i32, i32),
    ) -> Participant {
        Participant {
            participant_id: id,
            champion_id: champ,
            spell1_id: spells.0,
            spell2_id: spells.1,
            perks: build.map(|b| Perks {
                styles: vec![
                    PerkStyle {
                        description: None,
                        style: b.primary_style_id,
                        selections: b
                            .selected_perk_ids
                            .iter()
                            .take(3)
                            .map(|perk| PerkSelection {
                                perk: *perk,
                                ..Default::default()
                            })
                            .collect(),
                    },
                    PerkStyle {
                        description: None,
                        style: b.sub_style_id,
                        selections: b
                            .selected_perk_ids
                            .iter()
                            .skip(3)
                            .take(2)
                            .map(|perk| PerkSelection {
                                perk: *perk,
                                ..Default::default()
                            })
                            .collect(),
                    },
                ],
                stat_perks: Some(PerkStatPerks {
                    defense: b.defense,
                    flex: b.flex,
                    offense: b.offense,
                }),
            }),
            ..Default::default()
        }
    }

    fn game(
        game_id: i64,
        my_puuid: &str,
        champ: i32,
        build: Option<&RunePageBuild>,
        spells: (i32, i32),
    ) -> Game {
        Game {
            game_id,
            game_detail: GameDetail {
                participants: vec![participant(1, champ, my_puuid, build, spells)],
                participant_identities: vec![identity(my_puuid)],
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn build(primary: i32, sub: i32, ids: &[i32]) -> RunePageBuild {
        RunePageBuild {
            primary_style_id: primary,
            sub_style_id: sub,
            selected_perk_ids: ids.to_vec(),
            defense: 5001,
            flex: 5008,
            offense: 5008,
        }
    }

    #[test]
    fn picks_most_common_full_page() {
        let a = build(8100, 8300, &[8112, 8122, 8135, 8139, 8304, 8316]);
        let b = build(8200, 8400, &[8212, 8222, 8235, 8239, 8404, 8416]);
        let games = vec![
            game(1, "p", 64, Some(&a), (4, 14)),
            game(2, "p", 64, Some(&a), (4, 14)),
            game(3, "p", 64, Some(&b), (4, 14)),
            game(4, "p", 64, Some(&a), (4, 14)),
        ];
        assert_eq!(
            most_common_perk_page(&games, "p", 64, AGGREGATE_LIMIT).unwrap(),
            a
        );
    }

    #[test]
    fn skips_games_without_full_perks() {
        let a = build(8100, 8300, &[8112, 8122, 8135, 8139, 8304, 8316]);
        let games = vec![
            game(1, "p", 64, None, (4, 14)),
            game(2, "p", 64, Some(&a), (4, 14)),
        ];
        assert_eq!(
            most_common_perk_page(&games, "p", 64, AGGREGATE_LIMIT).unwrap(),
            a,
            "无 perks 的局应跳过而非拉低统计"
        );
    }

    #[test]
    fn empty_or_wrong_champion_returns_none() {
        assert!(most_common_perk_page(&[], "p", 64, AGGREGATE_LIMIT).is_none());
        let a = build(8100, 8300, &[8112, 8122, 8135, 8139, 8304, 8316]);
        let games = vec![game(1, "p", 65, Some(&a), (4, 14))];
        assert!(
            most_common_perk_page(&games, "p", 64, AGGREGATE_LIMIT).is_none(),
            "英雄不匹配不产出"
        );
        assert!(
            most_common_perk_page(&games, "ghost", 65, AGGREGATE_LIMIT).is_none(),
            "本机不在局内不产出"
        );
    }

    #[test]
    fn limit_windows_to_recent_games() {
        let a = build(8100, 8300, &[8112, 8122, 8135, 8139, 8304, 8316]);
        let b = build(8200, 8400, &[8212, 8222, 8235, 8239, 8404, 8416]);
        let games = vec![
            game(1, "p", 64, Some(&b), (4, 14)),
            game(2, "p", 64, Some(&b), (4, 14)),
            game(3, "p", 64, Some(&a), (4, 14)),
        ];
        // 窗口=2：只看最近两局（a 两局）→ a；窗口=3 → b 两局胜出
        assert_eq!(most_common_perk_page(&games, "p", 64, 2).unwrap(), a);
        assert_eq!(most_common_perk_page(&games, "p", 64, 3).unwrap(), b);
    }

    #[test]
    fn picks_most_common_spell_pair() {
        let a = build(8100, 8300, &[8112, 8122, 8135, 8139, 8304, 8316]);
        let games = vec![
            game(1, "p", 64, Some(&a), (4, 14)),
            game(2, "p", 64, Some(&a), (4, 14)),
            game(3, "p", 64, Some(&a), (4, 7)),
        ];
        assert_eq!(
            most_common_spells(&games, "p", 64, AGGREGATE_LIMIT),
            Some((4, 14))
        );
        assert_eq!(
            most_common_spells(&games, "ghost", 64, AGGREGATE_LIMIT),
            None
        );
    }
}
