#!/usr/bin/env bash
# Export the fork's local changes as a portable patch set.
#
# A "fork patch" is the diff between upstream (xingkongliang/skills-manager)
# and this fork's HEAD, split into logical pieces so it can be re-applied on a
# fresh upstream checkout (e.g. after upstream releases a new version).
#
# Usage:
#   bash scripts/export-fork-patch.sh                # export to ./fork-patches/
#   bash scripts/export-fork-patch.sh -o /path/to/dir
#
# What it produces:
#   fork-patches/
#   ├── 0001-fork-changes.patch        # the full fork diff (upstream..HEAD)
#   ├── README.md                      # how to apply + conflict guidance
#   └── manifest.txt                   # file list for quick inspection
#
# Re-apply on a fresh upstream clone:
#   git apply --check fork-patches/0001-fork-changes.patch
#   git apply --3way fork-patches/0001-fork-changes.patch
#
# NOTE: this is a raw git-diff patch, not an mbox. Use git apply, not git am.
# The script is safe to re-run — it regenerates everything.

set -euo pipefail

# ── locate repo root ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── args ──────────────────────────────────────────────────────────────────
OUT_DIR=""
UPSTREAM_REF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) OUT_DIR="$2"; shift 2 ;;
    --upstream)  UPSTREAM_REF="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

OUT_DIR="${OUT_DIR:-./fork-patches}"
mkdir -p "$OUT_DIR"

# ── resolve the upstream base commit ──────────────────────────────────────
# Default: the merge-base of HEAD and upstream/main (where the fork diverged).
if [[ -z "$UPSTREAM_REF" ]]; then
  if ! git remote get-url upstream >/dev/null 2>&1; then
    echo "ERROR: no 'upstream' remote configured." >&2
    echo "       Run: git remote add upstream https://github.com/xingkongliang/skills-manager.git" >&2
    exit 1
  fi
  # Make sure upstream refs are fresh.
  git fetch upstream --quiet
  UPSTREAM_REF="$(git merge-base HEAD upstream/main)"
fi
echo "→ fork base (upstream): $UPSTREAM_REF  ($(git log -1 --format='%s' "$UPSTREAM_REF"))"

# ── sanity: working tree clean? ───────────────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
  echo "WARNING: working tree has uncommitted changes." >&2
  echo "         The patch will include them via 'git diff', but for a clean" >&2
  echo "         re-applicable export, commit or stash first." >&2
fi

PATCH_FILE="$OUT_DIR/0001-fork-changes.patch"
MANIFEST="$OUT_DIR/manifest.txt"

# ── generate the patch ────────────────────────────────────────────────────
# We use `git diff` (not `format-patch`) so the output is one self-contained
# patch that applies cleanly with `git apply --3way` on a fresh tree, even
# without the original commit metadata. Includes uncommitted changes so the
# export always reflects the current working state.
echo "→ writing $PATCH_FILE"
{
  echo "# Fork changes vs upstream $UPSTREAM_REF"
  echo "# Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "# Apply with: git apply --check 0001-fork-changes.patch"
  echo "#             git apply --3way 0001-fork-changes.patch"
  echo ""
  git diff "$UPSTREAM_REF" --binary
} > "$PATCH_FILE"

# ── manifest: which files the fork touches ────────────────────────────────
echo "→ writing $MANIFEST"
git diff --name-status "$UPSTREAM_REF" | sort > "$MANIFEST"

added=$(grep -c '^A' "$MANIFEST" || true)
modded=$(grep -c '^M' "$MANIFEST" || true)
deleted=$(grep -c '^D' "$MANIFEST" || true)
echo "  files: $added added, $modded modified, $deleted deleted"

# ── README with apply instructions ────────────────────────────────────────
cat > "$OUT_DIR/README.md" <<EOF
# Fork patches

Generated from \`skills-manager\` fork vs upstream \`$UPSTREAM_REF\`.

## What's here

- \`0001-fork-changes.patch\` — the complete fork diff (tracked + uncommitted).
- \`manifest.txt\` — file-level change list (A/M/D).

## Apply on a fresh upstream checkout

\`\`\`bash
git clone https://github.com/xingkongliang/skills-manager.git
cd skills-manager

# Option A: verify, then apply the raw diff patch
git apply --check fork-patches/0001-fork-changes.patch
git apply --3way fork-patches/0001-fork-changes.patch
git add -A && git commit -m "apply fork changes"

# To preserve per-commit history instead, export committed changes with:
# git format-patch upstream/main..HEAD
\`\`\`

## When upstream releases a new version

1. Update this fork: \`git fetch upstream && git rebase upstream/main\`
   (see \`scripts/sync-with-upstream.sh\` for an automated version).
2. Resolve conflicts — most will be in the files listed in \`manifest.txt\`.
3. Re-run \`bash scripts/export-fork-patch.sh\` to refresh this patch set.

## What the fork changes (high level)

See \`manifest.txt\` for the full file list. Key areas:
- Smart-tag system (smart_tags.rs, skill_store.rs, SkillTagPickerDialog)
- Agent workspace organize/strip (sync.rs, agent_workspace.rs, skill_metadata.rs)
- Startup reindex split (app_state.rs, panic_log.rs)
- Promo banner + layout offsets (PromoBanner.tsx, Layout.tsx, Sidebar.tsx)
- CI/release (pnpm switch, changelog robustness)
EOF

echo ""
echo "✓ exported $((added + modded + deleted)) file changes to $OUT_DIR"
echo "  patch: $PATCH_FILE"
echo "  verify: git apply --check $PATCH_FILE"
echo "  apply:  git apply --3way $PATCH_FILE"
echo "  sha256: $(sha256sum "$PATCH_FILE" | cut -d' ' -f1)"
