---
name: shipping-changes
description: Use when src files in the rank-analysis repo (lol-record-analysis-tauri/**/*.ts, .vue, .rs) have just been edited via Edit/Write/MultiEdit, OR before any `git commit`, `git push`, or `gh pr create` in this repo. Symptoms include "I'm done with that change", "实现完了", a finished logical chunk of work, or about to invoke any commit/push/PR command.
---

# Shipping Changes (rank-analysis)

## Overview

Single source of truth for "the code changed — now what?" in this repo. Two trigger moments funnel into one skill:

- **A. Just edited code** → run the quality gate, fix anything red, then continue editing or move to ship.
- **B. About to `git commit` / `git push` / `gh pr create`** → run the full ship workflow (branch → gate → commit → push → PR).

**Rule of thumb:** never commit on `main`, never skip `npm run check`, never `git add -A` without reading `git status` first.

## When to Use

**Trigger A — code just edited (lightweight gate):**
- Edit / Write / MultiEdit just finished on files under `lol-record-analysis-tauri/src/` or `lol-record-analysis-tauri/src-tauri/src/`
- A logical chunk of work is done ("我改完这块了" / "feature 实现完了")
- → Run §A. Stop there if not ready to commit yet.

**Trigger B — about to commit / push / PR (full ship):**
- Next planned action is `git commit`, `git push`, or `gh pr create`
- Returning to a dirty working tree and wrapping it up
- → Run §1 → §4 (full workflow). §A is a subset of §2, so don't double-run.

**Skip when:**
- WIP / experiment you don't intend to merge.
- Doc-only edits outside `lol-record-analysis-tauri/` (still commit, but quality steps are no-ops).

**Direct push to `main` is acceptable for** (skip §1 branch step, still run §2 gate):
- Trivial typo / link fix in root docs (`README*.md`, `CLAUDE.md`) — no PR review value
- Config-only changes under `.claude/`, `.github/` where the maintainer is sole stakeholder
- Single-line urgent hot-fix where every minute counts

For everything else — branch + PR + squash merge.

## §A. Quick gate after edits

Run from `lol-record-analysis-tauri/`:

```bash
npm run check        # canonical gate: prettier + eslint + vue-tsc + cargo fmt --check + cargo clippy -Dwarnings
npm run test         # vitest — if you touched code that has (or should have) tests
cd src-tauri && cargo test && cd ..   # if Rust logic changed
```

If anything is red, **fix the root cause** — no `--no-verify`, no `// eslint-disable`, no `#[allow(clippy::...)]` unless the rule is genuinely wrong for the case. Re-run until clean.

Then either:
- Continue editing (re-run §A after the next chunk), or
- Move to §1 to ship.

## Workflow

### 1. Snapshot the working tree

```bash
git status
git diff
git log --oneline -5
```

Decide the commit type from the diff (see §3). If still on `main`, branch first:

```bash
git switch -c <type>/<short-kebab-summary>
```

Branch name examples: `feat/match-export`, `fix/lcu-reconnect`, `refactor/automation-manager`.

### 2. Quality gate — CODE_QUALITY.md

Run from `lol-record-analysis-tauri/`:

```bash
npm run check        # = format + lint + typecheck + cargo fmt --check + cargo clippy -Dwarnings
npm run test         # vitest
cd src-tauri && cargo test && cd ..
```

`npm run check` is the canonical gate. If it fails:
- **Fix the root cause.** Don't disable the rule, don't `--no-verify`, don't add `// eslint-disable` unless the rule is genuinely wrong for the case.
- Re-run `npm run check` until clean. Then re-run `git status` — formatters may have rewritten files.

For UI changes, also `npm run tauri dev` and exercise the feature in the app. Type-check passing ≠ feature works.

### 3. Commit — Conventional Commits

> ⚠️ **This repo is squash-merge-only.** All commits on a PR collapse into **one** commit on `main`, and that commit's message defaults to the **PR title** (see §4). So:
> - Intermediate commits on the branch can be looser (`wip`, `address review`, `fix typo` are fine).
> - The **PR title** is the canonical entry — it's what lands in `main`, what `cliff.toml` parses, and what shows up in the next release's changelog.
> - Still prefer conventional format for branch commits — easier review, safer fallback if squash is ever bypassed.

Format: `<type>: <short imperative summary>` (Chinese summary OK; matches existing log).

| type | use for |
|------|---------|
| `feat` | new user-visible capability |
| `fix` | bug fix |
| `refactor` | internal change, no behavior change |
| `perf` | performance improvement |
| `style` | formatting only (prettier/cargo fmt) |
| `docs` | docs / comments |
| `test` | tests only |
| `chore` | build, deps, tooling, version bumps |

Stage files **explicitly by name** (never `git add -A` — it sweeps in `.env`, screenshots, untracked agent dirs):

```bash
git add lol-record-analysis-tauri/src/components/Foo.vue \
        lol-record-analysis-tauri/src-tauri/src/command/foo.rs
git commit -m "$(cat <<'EOF'
feat: 一句话说明做了什么以及为什么

可选的正文，解释非显然的取舍。
EOF
)"
```

Never `--amend` a pushed commit. Never `--no-verify`. If a hook fails, fix the underlying issue and create a NEW commit.

### 4. Push and open PR

> 🎯 **PR title = squash commit message = changelog entry.** This repo is configured to:
> - Squash-merge only (no merge commits, no rebase merge)
> - Default squash commit message = PR title (no commit-bullet noise)
> - Auto-delete remote branch on merge
>
> So the PR title must be a **valid conventional commit**: `<type>(<scope>): <summary>`. Vague titles like `update stuff` / `修了一下` get **skipped by `cliff.toml`** and disappear from the release notes.

**Before `gh pr create`, verify the proposed title** (this becomes the squash commit + the only line `cliff.toml` parses):
1. Does it parse as `<type>(<scope>)?: <imperative summary>`?
2. Is the `<type>` one of: `feat | fix | refactor | perf | style | docs | test | chore`? (other types get **skipped** by `.github/cliff.toml`)
3. Is the summary specific (`feat(record): viewport 自适应`) not vague (`update record`)?

If any answer is uncertain, **propose 2 alternative titles to the user** before pushing. A bad title silently disappears from the next release's changelog.

If `git status` shows the branch is far behind `origin/main` (10+ commits), rebase first to avoid merge conflicts in the PR:

```bash
git fetch origin main
git rebase origin/main
# resolve conflicts → re-run §2 quality gate → continue
```

```bash
git push -u origin HEAD
gh pr create --title "<type>(<scope>): <summary>" --body "$(cat <<'EOF'
## Summary
- bullet 1
- bullet 2

## Test plan
- [ ] `npm run check` passes
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Manual: <what you exercised in the app>
EOF
)"
```

Print the returned PR URL back to the user. After merge, no need to clean up — the remote branch auto-deletes.

## Quick Reference

| Step | Command |
|------|---------|
| Quality gate | `cd lol-record-analysis-tauri && npm run check` |
| Frontend tests | `npm run test` |
| Rust tests | `cd src-tauri && cargo test` |
| Branch | `git switch -c <type>/<slug>` |
| Commit | `git commit -m "<type>: ..."` (HEREDOC for body) |
| Push | `git push -u origin HEAD` |
| PR | `gh pr create --title "<type>(<scope>): ..." --body ...` |
| After merge | Nothing — remote branch auto-deletes, only `main` stays |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Committing on `main` | `git switch -c <branch>`; `git reset --soft origin/main` only if nothing pushed |
| `git add -A` sweeping `.claude/`, `.env`, build artifacts | Stage by explicit path |
| Skipping `npm run check` because "it's a small change" | Run it. Formatters reorder imports; typecheck catches drift |
| `--no-verify` to bypass a failing hook | Fix the hook's complaint; re-stage; new commit |
| `git commit --amend` after push | Make a fixup commit instead |
| Disabling clippy/eslint rule to silence a warning | Fix the code; only suppress with a comment explaining why |
| Vague commit (`fix: bug`, `chore: update`) | Say what changed and why in one sentence |
| Vague **PR title** (`update stuff`, `修了一下`) | This is the squashed commit + changelog entry. Make it a real conventional commit |
| Forgetting Rust side when only frontend touched (or vice versa) | `npm run check` runs both; trust the gate |

## Red Flags — STOP

- "I'll just push and fix CI" → run `npm run check` locally first, it's faster than CI
- "Hook is being annoying, --no-verify" → no
- "The diff is too big to read, `git add -A`" → split the commit instead
- "I'll amend the pushed commit" → fixup commit instead
- "I'll just write a short PR title, cliff will figure it out" → no, vague titles get **dropped from release notes**. Always `<type>(<scope>): <imperative summary>`
