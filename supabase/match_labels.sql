-- 玩家对局判断标注（谁最关键 / 谁最犯罪），匿名收集，用于校准复盘评分。
-- 设计见 docs/superpowers/specs/2026-11-14-match-label-design.md
-- 2026-11-14 经 Supabase Management API 在项目 agutdvbhkhxzngscdlsh 上执行。
-- 可重复执行（if not exists / drop if exists / create or replace）。

create table if not exists public.match_labels (
  -- 设备的 Supabase 匿名账号，与召唤师账号无关
  owner_id      uuid        not null default auth.uid()
                            references auth.users (id) on delete cascade,
  game_id       bigint      not null,
  platform      text        not null check (platform ~ '^[A-Z0-9]{2,8}$'),
  queue_id      integer     not null,
  -- 选中的玩家：{"slot":1-10,"teamId":100|200,"championId":..,"position":".."}，可为空
  key_pick      jsonb,
  blame_pick    jsonb,
  -- 标注人自己在胜方还是败方
  labeler_side  text        check (labeler_side in ('win', 'lose')),
  -- 当时模型的 10 人总分/标签与模型认定的最关键/最犯罪；时间线未就绪时为 null
  model         jsonb,
  -- 基准构建时间 + app 版本，区分评分口径
  model_version text        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (owner_id, game_id),
  check (key_pick is not null or blame_pick is not null),
  check (model is null or pg_column_size(model) < 16384)
);

-- 2026-11-14 追加：玩家可选填写的说明（如「下路被克制」「打野没来」），最多 200 字
alter table public.match_labels
  add column if not exists note text check (note is null or char_length(note) <= 200);

-- 2026-11-21 追加：AI 对玩家理由的回应（设计见 docs/superpowers/specs/2026-11-21-label-rebuttal-design.md）。
-- 只收立场、类别、玩家态度与模型名，用来统计评分最常漏算什么；回复正文不上传。
alter table public.match_labels
  add column if not exists rebuttal_stance text
    check (rebuttal_stance is null
           or rebuttal_stance in ('concede', 'partial', 'hold', 'unknown')),
  add column if not exists rebuttal_category text
    check (rebuttal_category is null
           or rebuttal_category in ('absence', 'targeted', 'empty_stats', 'attitude',
                                    'draft', 'teamwork', 'other')),
  add column if not exists rebuttal_verdict text
    check (rebuttal_verdict is null or rebuttal_verdict in ('convinced', 'unconvinced')),
  add column if not exists rebuttal_model text
    check (rebuttal_model is null or char_length(rebuttal_model) <= 64);

-- 2026-11-28 追加：所选的是不是标注人自己，消融时用来剔除自评偏差。
-- 只存布尔、不存标注人槽位：槽位配 game_id 就能反查到是谁。没选该项或拿不到本人为 null。
-- 必须先于发版执行：新客户端会带上这两列，列不存在时整行上传会被 PostgREST 拒绝。
alter table public.match_labels
  add column if not exists key_is_self boolean,
  add column if not exists blame_is_self boolean;

-- 改判时刷新 updated_at
create or replace function public.match_labels_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists match_labels_touch on public.match_labels;
create trigger match_labels_touch before update on public.match_labels
  for each row execute function public.match_labels_touch();

-- 行级安全：只能写/改自己的行；读也只能读自己的
-- （upsert 的 ON CONFLICT DO UPDATE 需要能看到自己那行；别人的行永远不可见）
alter table public.match_labels enable row level security;

drop policy if exists match_labels_insert_own on public.match_labels;
create policy match_labels_insert_own on public.match_labels
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists match_labels_update_own on public.match_labels;
create policy match_labels_update_own on public.match_labels
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists match_labels_select_own on public.match_labels;
create policy match_labels_select_own on public.match_labels
  for select to authenticated using (owner_id = auth.uid());

-- 只给 authenticated（含匿名账号）读写权限；anon（未登录）不给任何权限。
-- 先收回 Supabase 默认授予的全部权限（含不受 RLS 约束的 TRUNCATE），再只授需要的三项
revoke all on public.match_labels from anon, authenticated;
grant select, insert, update on public.match_labels to authenticated;
