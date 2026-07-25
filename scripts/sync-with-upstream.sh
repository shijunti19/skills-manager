#!/usr/bin/env bash
# Sync this fork with upstream (xingkongliang/skills-manager).
#
# Rebase strategy: replay the fork's commits on top of the latest upstream
# main, preserving the fork's history as a linear sequence of commits. This is
# the day-to-day upgrade flow — run it whenever upstream ships a new release.
#
# Usage:
#   bash scripts/sync-with-upstream.sh                # fetch + rebase + tests
#   bash scripts/sync-with-upstream.sh --skip-tests   # skip the test gate
#   bash scripts/sync-with-upstream.sh --abort        # undo a conflicted rebase
#
# What it does, in order:
#   1. Preflight: clean working tree, 'upstream' remote exists, on a branch.
#   2. Fetch upstream/main + origin/main (so refs are current).
#   3. Safety: back up the current branch tip (refs/fork-backup/<branch>).
#   4. rebase upstream/main — replays fork commits on the new upstream.
#   5. If conflicts: stop, print the resolve/continue/skip/abort guidance.
#   6. On success: run cargo test --lib + tsc --noEmit as a smoke gate.
#   7. Print the push command (does NOT push automatically — rebase rewrites
#      history, so force-with-leases needs a human's confirmation).
#
# Recovery:
#   - Rebase went wrong?  bash scripts/sync-with-upstream.sh --abort
#     (or: git rebase --abort)
#   - Lost commits?       git reset --hard refs/fork-backup/<your-branch>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SKIP_TESTS=0
ABORT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=1; shift ;;
    --abort)      ABORT=1; shift ;;
    -h|--help)    sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── abort path ────────────────────────────────────────────────────────────
if [[ "$ABORT" -eq 1 ]]; then
  echo "→ aborting any in-progress rebase"
  git rebase --abort 2>/dev/null || echo "  (no rebase in progress)"
  exit 0
fi

# ── preflight ─────────────────────────────────────────────────────────────
echo "→ preflight checks"

# must be on a branch (not detached HEAD)
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "HEAD" ]]; then
  echo "ERROR: detached HEAD — checkout a branch first." >&2
  exit 1
fi
echo "  on branch: $BRANCH"

# working tree must be clean (rebase refuses otherwise, but fail early + clear)
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is dirty. Commit or stash first:" >&2
  git status --short | head -10 | sed 's/^/         /' >&2
  echo "       Safe stash command (includes untracked files):" >&2
  echo "       git stash push --include-untracked --message 'before upstream sync'" >&2
  exit 1
fi
echo "  working tree: clean"

# upstream remote must exist
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "ERROR: no 'upstream' remote. Add it first:" >&2
  echo "       git remote add upstream https://github.com/xingkongliang/skills-manager.git" >&2
  exit 1
fi
echo "  upstream: $(git remote get-url upstream)"

# ── fetch ─────────────────────────────────────────────────────────────────
echo ""
echo "→ fetching upstream + origin"
git fetch upstream --quiet
git fetch origin --quiet 2>/dev/null || echo "  (origin fetch failed — continuing, push will need network)"
UPSTREAM_HEAD="$(git rev-parse upstream/main)"
echo "  upstream/main: $UPSTREAM_HEAD  ($(git log -1 --format='%s' upstream/main))"

# already up to date?
FORK_BASE="$(git merge-base HEAD upstream/main)"
if [[ "$FORK_BASE" == "$UPSTREAM_HEAD" ]]; then
  echo "  already up to date — upstream/main has no new commits to replay."
  exit 0
fi

# ── safety backup ─────────────────────────────────────────────────────────
BACKUP_REF="refs/fork-backup/$BRANCH/$(date -u '+%Y%m%dT%H%M%SZ')"
echo ""
echo "→ safety: backing up $BRANCH → $BACKUP_REF"
git update-ref "$BACKUP_REF" HEAD
echo "  saved $(git rev-parse --short HEAD)"
echo "  recover with: git reset --hard $BACKUP_REF"

# ── rebase ────────────────────────────────────────────────────────────────
echo ""
echo "→ rebasing $BRANCH onto upstream/main"
if ! git rebase upstream/main; then
  cat >&2 <<EOF

━━━ rebase conflicts ━━━

git stopped because of conflicts. Resolve each conflicted file, then:

    git add <resolved-files>
    git rebase --continue

To skip a conflicting fork commit:
    git rebase --skip

To give up and return to where you started:
    git rebase --abort
    # or: bash scripts/sync-with-upstream.sh --abort

Conflicted files:
$(git diff --name-only --diff-filter=U | sed 's/^/    /')

EOF
  exit 1
fi

echo "  rebase complete: $(git rev-parse --short HEAD)"

# ── smoke-gate: tests ─────────────────────────────────────────────────────
if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo ""
  echo "→ running smoke tests (cargo test --lib + pnpm build)"
  echo "  (skip with --skip-tests)"
  echo ""
  if ! (cd src-tauri && cargo test --lib --quiet); then
    echo "" >&2
    echo "ERROR: cargo test --lib failed after rebase." >&2
    echo "       The rebase landed but tests regressed. Either fix the code," >&2
    echo "       or roll back: git reset --hard $BACKUP_REF" >&2
    exit 1
  fi
  echo ""
  if ! pnpm build; then
    echo "" >&2
    echo "ERROR: pnpm build failed after rebase." >&2
    echo "       Fix the frontend build, or roll back: git reset --hard $BACKUP_REF" >&2
    exit 1
  fi
  echo "  ✓ Rust tests + frontend build pass"
else
  echo "→ skipping tests (--skip-tests)"
fi

# ── done ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━ sync complete ━━━"
echo "  $BRANCH is now on top of upstream/main ($UPSTREAM_HEAD)."
echo ""
echo "  review:   git log --oneline upstream/main..HEAD"
echo "  push:     git fetch origin"
echo "            git push origin $BRANCH --force-with-lease"
echo "            (force-with-lease = safe push after rebase; aborts if remote moved)"
echo ""
echo "  backup ref still available: $BACKUP_REF"
echo "  (delete it once you're happy: git update-ref -d $BACKUP_REF)"
