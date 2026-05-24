#!/bin/bash
# sync-lfs-to-github.sh — Upload Git LFS objects to GitHub for khhodges/cloomc-project.
#
# Designed for scheduled (e.g. nightly) use so large binary assets (.lump files,
# FPGA bitstreams) are kept in the GitHub LFS store as a complete backup, without
# slowing down routine per-merge code syncs.
#
# Usage (manual):
#   bash scripts/sync-lfs-to-github.sh
#
# Nightly cron example (APScheduler or system cron):
#   0 3 * * *  cd /path/to/workspace && bash scripts/sync-lfs-to-github.sh >> /tmp/lfs-sync.log 2>&1
#
# Requires:
#   - GITHUB_PAT secret set in Replit Secrets (classic PAT, repo + lfs scopes, no expiry)
#   - git-lfs installed (available in the Replit/NixOS environment)

set -euo pipefail

REPO="khhodges/cloomc-project"
REMOTE_NAME="github-sync"
REMOTE_URL="https://x-access-token:${GITHUB_PAT}@github.com/${REPO}.git"

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "[$TIMESTAMP] sync-lfs-to-github: starting LFS object upload for ${REPO} ..."

if [ -z "${GITHUB_PAT:-}" ]; then
    echo "sync-lfs-to-github: GITHUB_PAT secret is not set — aborting."
    echo "  Set a classic GitHub PAT with 'repo' and 'lfs' scopes and no expiry in Replit Secrets."
    exit 1
fi

if ! command -v git-lfs &>/dev/null && ! git lfs version &>/dev/null 2>&1; then
    echo "sync-lfs-to-github: git-lfs is not installed — aborting."
    echo "  Install git-lfs via the package manager or Nix environment."
    exit 1
fi

# Ensure the github-sync remote exists and points at the right URL
if git remote get-url "$REMOTE_NAME" &>/dev/null; then
    git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
else
    git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "sync-lfs-to-github: HEAD=${HEAD_SHA} branch=${BRANCH}"

# Count how many LFS objects are tracked so we can report progress
LFS_OBJECT_COUNT=$(git lfs ls-files 2>/dev/null | wc -l | tr -d ' ')
echo "sync-lfs-to-github: ${LFS_OBJECT_COUNT} LFS-tracked file(s) in working tree"

# git lfs push uploads all LFS objects reachable from HEAD that the remote
# does not already have. --all uploads every object across all refs.
GIT_TRACE=0 \
    git lfs push "$REMOTE_NAME" HEAD 2>&1

DONE_TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "[$DONE_TIMESTAMP] sync-lfs-to-github: LFS upload complete."
