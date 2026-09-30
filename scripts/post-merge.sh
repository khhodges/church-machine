#!/bin/bash
set -e

echo "Post-merge setup complete (no dependencies to install)"

# A task merge may include saved runtime artifacts. Refuse to publish a changed
# Namespace/image bundle unless the checked-out bundle passes the same read-only
# semantic and image-admission rules as the server. Code-only merges do not
# silently repair or require migration of the programmer's historical state.
# --root also covers the first commit; -m includes every merge parent.
CHANGED_RUNTIME=$(git diff-tree --root -m --no-commit-id --name-only -r HEAD -- server/lumps/)
if [ -n "$CHANGED_RUNTIME" ]; then
    echo "post-merge: validating changed Namespace/artifact bundle before publication"
    if ! python3 scripts/check_namespace_authority.py --lumps-dir server/lumps; then
        echo "post-merge: publication blocked; review Namespace diagnostics. No repair was attempted." >&2
        exit 1
    fi
fi

# Use a file lock so concurrent post-merge runs (rapid back-to-back task
# merges) queue rather than racing on .git/config.lock — which caused the
# 90 s timeout when two merges landed simultaneously.
LOCK_FILE="/tmp/church-post-merge.lock"

(
    flock -w 30 9 || { echo "post-merge: lock wait timed out — skipping GitHub sync"; exit 0; }

    # Push to GitHub so the mirror never goes stale.
    # Requires GITHUB_PAT secret — see scripts/sync-to-github.sh for details.
    bash scripts/sync-to-github.sh || true

) 9>"$LOCK_FILE"

# Record task completion in the cost-tracking table and update task status.
# TASK_ID and TASK_TITLE are passed safely via environment — no shell injection.
DB="server/church_machine.db"
if [ -f "$DB" ]; then
    export REPORT_DB="$DB"
    python3 - <<'PYEOF'
import os, sys
sys.path.insert(0, 'server')
db   = os.environ.get('REPORT_DB', 'server/church_machine.db')
task = os.environ.get('TASK_ID',    'task-merge')
title = os.environ.get('TASK_TITLE', '')
try:
    from daily_report import record_task_run, update_task_status
    record_task_run(db, event_type='task_merge', note=task)
    if task and task != 'task-merge':
        update_task_status(db, task, title or task, 'COMPLETED')
    print('Cost tracking: recorded task merge for', task)
except Exception as e:
    print('Cost tracking warning:', e)
PYEOF
fi
