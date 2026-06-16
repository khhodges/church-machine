#!/bin/bash
# sync-lfs-to-github.sh — Upload Git LFS objects to BOTH GitHub repos:
#   • khhodges/s-ide-v1       (S-IDE v1 simplified entry-point IDE)
#   • khhodges/church-machine (full Church Machine source)
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

REPO_SIDE="khhodges/s-ide-v1"
REPO_CM="khhodges/church-machine"
REMOTE_SIDE="github-sync"
REMOTE_CM="github-sync-cm"

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "[$TIMESTAMP] sync-lfs-to-github: starting LFS object upload for ${REPO_SIDE} and ${REPO_CM} ..."

if [ -z "${GITHUB_PAT:-}" ]; then
    echo "sync-lfs-to-github: GITHUB_PAT secret is not set — aborting."
    echo "  Set a classic GitHub PAT with 'repo' and 'lfs' scopes and no expiry in Replit Secrets."
    exit 1
fi

# ---------------------------------------------------------------------------
# Preflight: verify the PAT has the 'lfs' scope via the GitHub /user API.
# GitHub returns the granted scopes in the X-OAuth-Scopes response header.
# A PAT with only 'repo' (no 'lfs') will silently fail the LFS upload leg,
# so we catch the misconfiguration early with a clear error.
# ---------------------------------------------------------------------------
_check_pat_lfs_scope() {
    local pat="$1"
    if ! command -v curl &>/dev/null; then
        echo "sync-lfs-to-github: WARNING — curl not found; skipping PAT scope preflight."
        return 0
    fi

    local response_headers
    response_headers=$(curl -s -I \
        -H "Authorization: token ${pat}" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        "https://api.github.com/user" 2>&1) || {
        echo "sync-lfs-to-github: WARNING — could not reach GitHub API to verify PAT scopes (network issue?); proceeding anyway."
        return 0
    }

    local http_status
    http_status=$(echo "$response_headers" | grep -i '^HTTP/' | tail -1 | awk '{print $2}')

    if [ "$http_status" = "401" ]; then
        echo "sync-lfs-to-github: GITHUB_PAT is invalid or expired (HTTP 401) — aborting."
        echo "  Regenerate the PAT and update the GITHUB_PAT Replit secret."
        exit 1
    fi

    if [ "$http_status" != "200" ]; then
        echo "sync-lfs-to-github: WARNING — GitHub API returned HTTP ${http_status}; skipping scope check."
        return 0
    fi

    local scopes
    scopes=$(echo "$response_headers" | grep -i '^X-OAuth-Scopes:' | sed 's/^X-OAuth-Scopes:[[:space:]]*//' | tr '[:upper:]' '[:lower:]' | tr -d '\r')

    if [ -z "$scopes" ]; then
        echo "sync-lfs-to-github: WARNING — X-OAuth-Scopes header absent (fine-grained PAT or GitHub Apps token)."
        echo "  Ensure the token has Contents read/write permission (which covers LFS) for both repos."
        return 0
    fi

    # GitHub classic PATs with 'repo' scope have full LFS access.
    # 'lfs' is NOT listed as a separate scope in X-OAuth-Scopes — it is
    # covered by 'repo'.  Accept either 'lfs' or 'repo' as sufficient.
    if echo "$scopes" | tr ',' '\n' | sed 's/^[[:space:]]*//' | grep -qxE 'lfs|repo'; then
        echo "sync-lfs-to-github: PAT scope check passed — LFS access confirmed via repo/lfs scope. (scopes: ${scopes})"
    else
        echo "sync-lfs-to-github: PAT is missing 'repo' (or 'lfs') scope — aborting."
        echo "  Current scopes: ${scopes}"
        echo "  Create a new classic GitHub PAT at https://github.com/settings/tokens"
        echo "  and enable 'repo' scope (covers LFS), then update the GITHUB_PAT Replit secret."
        exit 1
    fi
}

_check_pat_lfs_scope "${GITHUB_PAT}"

if ! command -v git-lfs &>/dev/null && ! git lfs version &>/dev/null 2>&1; then
    echo "sync-lfs-to-github: git-lfs is not installed — aborting."
    echo "  Install git-lfs via the package manager or Nix environment."
    exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "sync-lfs-to-github: HEAD=${HEAD_SHA} branch=${BRANCH}"

LFS_OBJECT_COUNT=$(git lfs ls-files 2>/dev/null | wc -l | tr -d ' ')
echo "sync-lfs-to-github: ${LFS_OBJECT_COUNT} LFS-tracked file(s) in working tree"

# ---------------------------------------------------------------------------
# Helper: push LFS objects to one remote.
# Usage: _lfs_push_one <remote-name> <repo>
# Returns exit code of git lfs push.
# ---------------------------------------------------------------------------
_lfs_push_one() {
    local remote_name="$1"
    local repo="$2"
    local remote_url="https://x-access-token:${GITHUB_PAT}@github.com/${repo}.git"

    if git remote get-url "$remote_name" &>/dev/null; then
        git remote set-url "$remote_name" "$remote_url"
    else
        git remote add "$remote_name" "$remote_url"
    fi

    echo "sync-lfs-to-github: uploading LFS objects → github.com/${repo} ..."
    GIT_TRACE=0 git lfs push "$remote_name" HEAD 2>&1
    local exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        echo "sync-lfs-to-github: LFS upload to ${repo} FAILED (exit ${exit_code})."
    else
        echo "sync-lfs-to-github: LFS upload to ${repo} succeeded."
    fi

    return "$exit_code"
}

# Push to both repos; collect exit codes so we can report combined status.
SIDE_EXIT=0
CM_EXIT=0

_lfs_push_one "$REMOTE_SIDE" "$REPO_SIDE" || SIDE_EXIT=$?
_lfs_push_one "$REMOTE_CM"   "$REPO_CM"   || CM_EXIT=$?

DONE_TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

if [ "$SIDE_EXIT" -ne 0 ] || [ "$CM_EXIT" -ne 0 ]; then
    FAIL_REPOS=""
    [ "$SIDE_EXIT" -ne 0 ] && FAIL_REPOS="${FAIL_REPOS} ${REPO_SIDE}"
    [ "$CM_EXIT" -ne 0 ]   && FAIL_REPOS="${FAIL_REPOS} ${REPO_CM}"
    echo "[$DONE_TIMESTAMP] sync-lfs-to-github: LFS upload FAILED for:${FAIL_REPOS}"
    exit 1
fi

echo "[$DONE_TIMESTAMP] sync-lfs-to-github: LFS upload complete for both repos."
