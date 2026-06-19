#!/bin/bash
# sync-to-github.sh — Push current HEAD to BOTH GitHub repos:
#   • khhodges/s-ide-v1     (S-IDE v1 simplified entry-point IDE)
#   • khhodges/church-machine (full Church Machine source)
#
# Called automatically by scripts/post-merge.sh after every Replit task merge.
# Requires the GITHUB_PAT secret to be set in Replit Secrets (no expiry, repo scope).
#
# On success: records ok status to server/github-sync-status.json.
# On failure: records fail status and sends an immediate Resend alert email.
#
# Usage:
#   scripts/sync-to-github.sh            # fast code-only push (LFS skipped)
#   scripts/sync-to-github.sh --with-lfs # code push PLUS LFS object upload

WITH_LFS=0
for arg in "$@"; do
    case "$arg" in
        --with-lfs) WITH_LFS=1 ;;
        *) echo "sync-to-github: unknown argument '$arg'" >&2; exit 1 ;;
    esac
done

REPO_SIDE="khhodges/s-ide-v1"
REPO_CM="khhodges/church-machine"
REMOTE_SIDE="github-sync"
REMOTE_CM="github-sync-cm"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

_record_status() {
    local status="$1"
    local error_msg="$2"
    local side_status="${3:-$status}"
    local cm_status="${4:-$status}"
    if [ -f "server/github_sync_alert.py" ]; then
        python3 server/github_sync_alert.py "$status" "$BRANCH" "$HEAD_SHA" "$error_msg" "$side_status" "$cm_status" || true
    fi
}

if [ -z "${GITHUB_PAT:-}" ]; then
    echo "sync-to-github: GITHUB_PAT secret is not set — skipping GitHub sync."
    echo "  Set a classic GitHub PAT with 'repo' scope and no expiry in Replit Secrets."
    _record_status "fail" "GITHUB_PAT secret is not set" "fail" "fail"
    exit 0
fi

# ---------------------------------------------------------------------------
# Helper: verify a required PAT scope is present via the GitHub /user API.
# GitHub returns granted scopes in X-OAuth-Scopes.  Fine-grained tokens omit
# this header — we warn and continue rather than blocking them.
# Usage: _require_pat_scope <scope> <script-name>
# ---------------------------------------------------------------------------
_require_pat_scope() {
    local scope="$1"
    local script_name="$2"

    if ! command -v curl &>/dev/null; then
        echo "${script_name}: WARNING — curl not found; skipping PAT scope preflight."
        return 0
    fi

    local response_headers
    response_headers=$(curl -s -I \
        -H "Authorization: token ${GITHUB_PAT}" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        "https://api.github.com/user" 2>&1) || {
        echo "${script_name}: WARNING — could not reach GitHub API to verify PAT scopes; proceeding anyway."
        return 0
    }

    local http_status
    http_status=$(echo "$response_headers" | grep -i '^HTTP/' | tail -1 | awk '{print $2}')

    if [ "$http_status" = "401" ]; then
        echo "${script_name}: GITHUB_PAT is invalid or expired (HTTP 401) — aborting."
        echo "  Regenerate the PAT and update the GITHUB_PAT Replit secret."
        exit 1
    fi

    if [ "$http_status" != "200" ]; then
        echo "${script_name}: WARNING — GitHub API returned HTTP ${http_status}; skipping scope check."
        return 0
    fi

    local scopes
    scopes=$(echo "$response_headers" | grep -i '^X-OAuth-Scopes:' | sed 's/^X-OAuth-Scopes:[[:space:]]*//' | tr '[:upper:]' '[:lower:]' | tr -d '\r')

    if [ -z "$scopes" ]; then
        echo "${script_name}: WARNING — X-OAuth-Scopes header absent (fine-grained PAT or GitHub Apps token)."
        echo "  Ensure the token has the appropriate permissions for both repos."
        return 0
    fi

    if echo "$scopes" | tr ',' '\n' | sed 's/^[[:space:]]*//' | grep -qx "${scope}"; then
        echo "${script_name}: PAT scope check passed — '${scope}' scope confirmed. (scopes: ${scopes})"
    else
        echo "${script_name}: PAT is missing the '${scope}' scope — aborting."
        echo "  Current scopes: ${scopes}"
        echo "  Create a new classic GitHub PAT at https://github.com/settings/tokens"
        echo "  and enable 'repo' and 'lfs' scopes, then update the GITHUB_PAT Replit secret."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Helper: push one remote (code only, no LFS).
# Usage: _push_code <remote-name> <repo> <remote-url>
# Returns exit code of git push.
# ---------------------------------------------------------------------------
_push_code() {
    local remote_name="$1"
    local repo="$2"
    local remote_url="$3"

    echo "sync-to-github: pushing ${BRANCH} (${HEAD_SHA}) → github.com/${repo} (LFS skipped) ..."

    # Push directly to URL — avoids git remote set-url (which writes .git/config
    # and can be blocked by a stale .git/config.lock from a prior killed run).
    local push_output push_exit
    push_output=$(
        GIT_LFS_SKIP_PUSH=1 \
        GIT_TRACE=0 \
            git push "$remote_url" "HEAD:refs/heads/${BRANCH}" --force 2>&1
    )
    push_exit=$?

    echo "$push_output"

    if [ "$push_exit" -ne 0 ]; then
        echo "sync-to-github: push to ${repo} FAILED (exit ${push_exit})."
    else
        echo "sync-to-github: push to ${repo} succeeded."
    fi

    return "$push_exit"
}

# ---------------------------------------------------------------------------
# Helper: push one remote (code + LFS).
# Usage: _push_with_lfs <remote-name> <repo> <remote-url>
# Returns exit code (0 only if both code push and LFS upload succeeded).
# ---------------------------------------------------------------------------
_push_with_lfs() {
    local remote_name="$1"
    local repo="$2"
    local remote_url="$3"

    # Add or update the remote
    if git remote get-url "$remote_name" &>/dev/null; then
        git remote set-url "$remote_name" "$remote_url"
    else
        git remote add "$remote_name" "$remote_url"
    fi

    echo "sync-to-github: uploading LFS objects to ${repo} (this may take several minutes for large files) ..."
    # Stream progress live — do NOT buffer in a subshell; project.zip is ~1.3 GB.
    GIT_TRACE=0 git lfs push "$remote_name" "HEAD"
    local lfs_exit=$?

    if [ "$lfs_exit" -ne 0 ]; then
        echo "sync-to-github: LFS upload to ${repo} FAILED (exit ${lfs_exit})."
        return "$lfs_exit"
    fi

    echo "sync-to-github: LFS upload done — now pushing ${BRANCH} (${HEAD_SHA}) → github.com/${repo} ..."
    local push_output push_exit
    push_output=$(GIT_TRACE=0 \
        git push "$remote_name" "HEAD:refs/heads/${BRANCH}" --force 2>&1)
    push_exit=$?
    echo "$push_output"

    if [ "$push_exit" -ne 0 ]; then
        echo "sync-to-github: push to ${repo} FAILED (exit ${push_exit})."
        return "$push_exit"
    fi

    echo "sync-to-github: LFS upload + push to ${repo} succeeded."
    return 0
}

# ---------------------------------------------------------------------------
# Main: push to both remotes, track per-repo results, record combined status.
# ---------------------------------------------------------------------------
SIDE_URL="https://x-access-token:${GITHUB_PAT}@github.com/${REPO_SIDE}.git"
CM_URL="https://x-access-token:${GITHUB_PAT}@github.com/${REPO_CM}.git"

SIDE_EXIT=0
CM_EXIT=0

# Always validate the PAT before attempting any push — catches expired/revoked
# tokens with a clear error message instead of a confusing git auth failure.
_require_pat_scope "repo" "sync-to-github"

if [ "$WITH_LFS" -eq 1 ]; then
    # 'lfs' is not a separate classic-PAT scope — LFS access is covered by 'repo'.
    # The repo scope check above is sufficient.

    _push_with_lfs "$REMOTE_SIDE" "$REPO_SIDE" "$SIDE_URL"
    SIDE_EXIT=$?

    _push_with_lfs "$REMOTE_CM" "$REPO_CM" "$CM_URL"
    CM_EXIT=$?
else
    _push_code "$REMOTE_SIDE" "$REPO_SIDE" "$SIDE_URL"
    SIDE_EXIT=$?

    _push_code "$REMOTE_CM" "$REPO_CM" "$CM_URL"
    CM_EXIT=$?
fi

# Record combined status
SIDE_STATUS="ok"; [ "$SIDE_EXIT" -ne 0 ] && SIDE_STATUS="fail"
CM_STATUS="ok";   [ "$CM_EXIT"   -ne 0 ] && CM_STATUS="fail"

if [ "$SIDE_EXIT" -ne 0 ] || [ "$CM_EXIT" -ne 0 ]; then
    FAIL_REPOS=""
    [ "$SIDE_EXIT" -ne 0 ] && FAIL_REPOS="${FAIL_REPOS} ${REPO_SIDE}"
    [ "$CM_EXIT" -ne 0 ]   && FAIL_REPOS="${FAIL_REPOS} ${REPO_CM}"
    _record_status "fail" "Push failed for:${FAIL_REPOS}" "$SIDE_STATUS" "$CM_STATUS"
    exit 1
fi

_record_status "ok" "" "ok" "ok"
