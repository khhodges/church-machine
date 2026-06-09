"""
github_sync_alert.py — Record GitHub sync status and send an email alert on failure.

Called by scripts/sync-to-github.sh after every push attempt:

    python3 server/github_sync_alert.py ok   <branch> <sha>
    python3 server/github_sync_alert.py fail <branch> <sha> "<error text>"

Writes server/github-sync-status.json so the daily report can include the
last-sync line without re-running git.  On failure, also fires a Resend email
to the same address used by the daily report.
"""

import json
import logging
import os
import sqlite3
import sys
import time

log = logging.getLogger(__name__)

_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
STATUS_FILE = os.path.join(_SERVER_DIR, "github-sync-status.json")
DB_PATH = os.path.join(_SERVER_DIR, "church_machine.db")

REPORT_TO = "kenneth@hamer-hodges.us"

_SYNC_LOG_KEEP = 30


def _ensure_sync_log_table(db_path: str) -> None:
    """Create github_sync_log table lazily if it does not exist."""
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS github_sync_log (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                ts     REAL    NOT NULL,
                status TEXT    NOT NULL,
                branch TEXT    NOT NULL DEFAULT '',
                sha    TEXT    NOT NULL DEFAULT '',
                error  TEXT    NOT NULL DEFAULT ''
            )
        """)
        conn.commit()
        conn.close()
    except Exception as exc:
        print(f"github_sync_alert: could not create sync log table: {exc}", file=sys.stderr)


def log_sync_to_db(db_path: str, status: str, branch: str, sha: str, error: str = "") -> None:
    """Append a sync result to github_sync_log, keeping only the last _SYNC_LOG_KEEP rows."""
    _ensure_sync_log_table(db_path)
    try:
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO github_sync_log (ts, status, branch, sha, error) VALUES (?, ?, ?, ?, ?)",
            (time.time(), status, branch, sha, error),
        )
        conn.execute(
            """DELETE FROM github_sync_log WHERE id NOT IN (
                SELECT id FROM github_sync_log ORDER BY ts DESC LIMIT ?
            )""",
            (_SYNC_LOG_KEEP,),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        print(f"github_sync_alert: could not write to sync log: {exc}", file=sys.stderr)


def write_status(status: str, branch: str, sha: str, error: str = "") -> None:
    """Persist sync result to STATUS_FILE."""
    data = {
        "status": status,
        "branch": branch,
        "sha": sha,
        "error": error,
        "timestamp": time.time(),
    }
    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
    except OSError as exc:
        print(f"github_sync_alert: could not write status file: {exc}", file=sys.stderr)


def _get_resend_credentials():
    """Re-use the same credential lookup as daily_report.py."""
    sys.path.insert(0, _SERVER_DIR)
    try:
        from daily_report import _get_resend_credentials as _dr_creds
        return _dr_creds()
    except Exception:
        pass
    api_key = os.environ.get("RESEND_API_KEY", "")
    from_email = os.environ.get("RESEND_FROM_EMAIL", "")
    return (api_key or None), from_email


def _alert_email_enabled() -> bool:
    """Return False if GITHUB_SYNC_ALERT_EMAIL is explicitly set to '0' or 'false'."""
    val = os.environ.get("GITHUB_SYNC_ALERT_EMAIL", "").strip().lower()
    return val not in ("0", "false")


def send_failure_alert(branch: str, sha: str, error: str) -> None:
    """Send an immediate Resend email when the GitHub push fails."""
    if not _alert_email_enabled():
        print("github_sync_alert: GITHUB_SYNC_ALERT_EMAIL disabled — alert email skipped.")
        return

    api_key, from_email = _get_resend_credentials()
    if not api_key:
        print("github_sync_alert: Resend API key not available — alert not sent.", file=sys.stderr)
        return

    if not from_email or from_email.lower().endswith("@gmail.com"):
        from_email = os.environ.get("RESEND_FROM_EMAIL", "noreply@churchmachine.io")

    subject = f"[Church Machine] GitHub sync FAILED on {branch} ({sha})"

    plain = (
        f"Church Machine — GitHub Sync Failure\n"
        f"{'='*50}\n\n"
        f"Branch : {branch}\n"
        f"HEAD   : {sha}\n"
        f"Error  : {error or '(no details captured)'}\n\n"
        f"The mirror at khhodges/church-machine may be behind.\n"
        f"Check that the GITHUB_PAT secret is valid and has not expired.\n"
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: system-ui, sans-serif; color: #1a1a1a; max-width: 600px;
         margin: 0 auto; padding: 24px; }}
  h1   {{ font-size: 1.3em; color: #c62828; }}
  table {{ border-collapse: collapse; margin: 12px 0; }}
  td   {{ padding: 4px 12px 4px 0; vertical-align: top; }}
  .label {{ color: #555; font-weight: 600; white-space: nowrap; }}
  .footer {{ margin-top: 28px; font-size: 0.85em; color: #888;
             border-top: 1px solid #e0e0e0; padding-top: 10px; }}
</style>
</head>
<body>
<h1>&#9888; GitHub Sync Failed</h1>
<table>
  <tr><td class="label">Branch</td><td><code>{branch}</code></td></tr>
  <tr><td class="label">HEAD</td><td><code>{sha}</code></td></tr>
  <tr><td class="label">Error</td>
      <td><pre style="white-space:pre-wrap;margin:0">{error or '(no details captured)'}</pre></td></tr>
</table>
<p>The mirror at <strong>khhodges/church-machine</strong> may be behind.<br>
Check that the <code>GITHUB_PAT</code> Replit secret is valid and has not expired.</p>
<div class="footer">Sent automatically by Church Machine post-merge hook.</div>
</body>
</html>"""

    try:
        import resend as _resend
        _resend.api_key = api_key
        params = {
            "from": from_email,
            "to": [REPORT_TO],
            "reply_to": REPORT_TO,
            "subject": subject,
            "html": html,
            "text": plain,
        }
        response = _resend.Emails.send(params)
        print(f"github_sync_alert: failure alert sent (id={response.get('id', '?')})")
    except Exception as exc:
        print(f"github_sync_alert: failed to send alert via Resend: {exc}", file=sys.stderr)


def read_status() -> dict:
    """Return the last recorded sync status, or a 'never' sentinel."""
    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {"status": "never", "branch": "", "sha": "", "error": "", "timestamp": 0}


def main():
    if len(sys.argv) < 4:
        print(
            "Usage: github_sync_alert.py <ok|fail> <branch> <sha> [error_message]",
            file=sys.stderr,
        )
        sys.exit(1)

    status = sys.argv[1].strip().lower()
    branch = sys.argv[2].strip()
    sha = sys.argv[3].strip()
    error = " ".join(sys.argv[4:]).strip() if len(sys.argv) > 4 else ""

    if status not in ("ok", "fail"):
        print(f"github_sync_alert: unknown status '{status}' — expected ok or fail", file=sys.stderr)
        sys.exit(1)

    write_status(status, branch, sha, error)
    log_sync_to_db(DB_PATH, status, branch, sha, error)

    if status == "fail":
        send_failure_alert(branch, sha, error)
        print(f"github_sync_alert: recorded FAILED sync for {branch} ({sha})")
    else:
        print(f"github_sync_alert: recorded successful sync for {branch} ({sha})")


if __name__ == "__main__":
    main()
