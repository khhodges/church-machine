#!/bin/bash
# sync-to-github.sh — Push current HEAD to khhodges/s-ide-v1 on GitHub.
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

REPO="khhodges/s-ide-v1"
REMOTE_NAME="github-sync"
REMOTE_URL="https://x-access-token:${GITHUB_PAT}@github.com/${REPO}.git"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

_record_status() {
    local status="$1"
    local error_msg="$2"
    if [ -f "server/github_sync_alert.py" ]; then
        python3 server/github_sync_alert.py "$status" "$BRANCH" "$HEAD_SHA" "$error_msg" || true
    fi
}

if [ -z "${GITHUB_PAT:-}" ]; then
    echo "sync-to-github: GITHUB_PAT secret is not set — skipping GitHub sync."
    echo "  Set a classic GitHub PAT with 'repo' scope and no expiry in Replit Secrets."
    _record_status "fail" "GITHUB_PAT secret is not set"
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
        echo "  Ensure the token has the appropriate permissions for ${REPO}."
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

# Add or update the github-sync remote (safe to re-run)
if git remote get-url "$REMOTE_NAME" &>/dev/null; then
    git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
else
    git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi

if [ "$WITH_LFS" -eq 1 ]; then
    _require_pat_scope "lfs" "sync-to-github"
    echo "sync-to-github: pushing ${BRANCH} (${HEAD_SHA}) + LFS objects → github.com/${REPO} ..."

    # Push regular git objects first
    PUSH_OUTPUT=$(GIT_LFS_SKIP_PUSH=1 GIT_TRACE=0 \
        git push "$REMOTE_NAME" "HEAD:refs/heads/${BRANCH}" --force 2>&1)
    PUSH_EXIT=$?
    echo "$PUSH_OUTPUT"

    if [ "$PUSH_EXIT" -ne 0 ]; then
        echo "sync-to-github: push FAILED (exit $PUSH_EXIT)."
        _record_status "fail" "$PUSH_OUTPUT"
        exit "$PUSH_EXIT"
    fi

    echo "sync-to-github: uploading LFS objects ..."
    LFS_OUTPUT=$(GIT_TRACE=0 git lfs push "$REMOTE_NAME" "HEAD" 2>&1)
    LFS_EXIT=$?
    echo "$LFS_OUTPUT"

    if [ "$LFS_EXIT" -ne 0 ]; then
        echo "sync-to-github: LFS upload FAILED (exit $LFS_EXIT)."
        _record_status "fail" "$LFS_OUTPUT"
        exit "$LFS_EXIT"
    fi

    echo "sync-to-github: push + LFS upload succeeded."
    _record_status "ok" ""
else
    # Disable LFS for this remote so we only push regular git objects.
    # LFS binaries are large; routine code sync doesn't need them.
    git config "remote.${REMOTE_NAME}.lfsurl" "https://github.com/${REPO}.git/info/lfs" 2>/dev/null || true
    git config "lfs.${REMOTE_URL}/info/lfs.locksverify" "false" 2>/dev/null || true

    echo "sync-to-github: pushing ${BRANCH} (${HEAD_SHA}) → github.com/${REPO} (LFS skipped) ..."

    # Capture both stdout+stderr and exit code from the push.
    PUSH_OUTPUT=$(
        GIT_LFS_SKIP_PUSH=1 \
        GIT_TRACE=0 \
            git -c "lfs.${REMOTE_URL}.locksverify=false" \
                push "$REMOTE_NAME" "HEAD:refs/heads/${BRANCH}" --force 2>&1
    )
    PUSH_EXIT=$?

    echo "$PUSH_OUTPUT"

    if [ "$PUSH_EXIT" -ne 0 ]; then
        echo "sync-to-github: push FAILED (exit $PUSH_EXIT)."
        _record_status "fail" "$PUSH_OUTPUT"
        exit "$PUSH_EXIT"
    fi

    echo "sync-to-github: push succeeded (LFS objects not uploaded; run with --with-lfs to include them)."
    _record_status "ok" ""
fi
