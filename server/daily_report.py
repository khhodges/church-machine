"""
Daily progress and cost report generator and sender.

Generates a six-section report and sends it via Resend.
Called both by the APScheduler job (05:00 UTC) and the /report/send-now route.

Authentication
--------------
The /report/send-now and /report/task-run routes are protected by a shared
secret token stored in the REPORT_TOKEN environment variable.  If that
variable is not set, a random token is generated at startup and logged once
(suitable for development).  Callers must supply it in the
`Authorization: Bearer <token>` header or the `?token=<token>` query param.
"""

import os
import re
import glob
import time
import logging
import datetime
import sqlite3
import secrets

log = logging.getLogger(__name__)

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_TASKS_DIR = os.path.join(_BASE_DIR, ".local", "tasks")
_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))

REPORT_TO = "kenneth@hamer-hodges.us"
BILLING_URL = "https://replit.com/account#billing"
COST_PER_TASK_RUN_USD = 0.50

_REPORT_TOKEN: str = ""


def get_report_token() -> str:
    """Return the shared token used to authenticate report endpoints."""
    global _REPORT_TOKEN
    if _REPORT_TOKEN:
        return _REPORT_TOKEN
    env = os.environ.get("REPORT_TOKEN", "").strip()
    if env:
        _REPORT_TOKEN = env
        log.info("REPORT_TOKEN loaded from environment (fingerprint: %s...)", env[:8])
    else:
        _REPORT_TOKEN = secrets.token_hex(24)
        log.warning(
            "REPORT_TOKEN not set — ephemeral token generated for this process "
            "(fingerprint: %s...). The /report/send-now endpoint will reject all "
            "requests after a server restart. Set REPORT_TOKEN as a Replit secret "
            "to persist the token across restarts.",
            _REPORT_TOKEN[:8],
        )
    return _REPORT_TOKEN


def check_report_auth(request) -> bool:
    """Return True if the Flask request carries a valid report token."""
    token = get_report_token()
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        if secrets.compare_digest(auth_header[7:].strip(), token):
            return True
    qs_token = request.args.get("token", "")
    if qs_token and secrets.compare_digest(qs_token, token):
        return True
    return False


def _get_resend_credentials():
    """Fetch Resend API key and from_email via Replit connectors."""
    import requests as _req

    hostname = os.environ.get("REPLIT_CONNECTORS_HOSTNAME", "")
    repl_identity = os.environ.get("REPL_IDENTITY", "")
    web_repl_renewal = os.environ.get("WEB_REPL_RENEWAL", "")

    if repl_identity:
        token = "repl " + repl_identity
    elif web_repl_renewal:
        token = "depl " + web_repl_renewal
    else:
        token = None

    if hostname and token:
        try:
            resp = _req.get(
                f"https://{hostname}/api/v2/connection?include_secrets=true&connector_names=resend",
                headers={"Accept": "application/json", "X-Replit-Token": token},
                timeout=10,
            )
            data = resp.json()
            item = (data.get("items") or [None])[0]
            if item and item.get("settings", {}).get("api_key"):
                return item["settings"]["api_key"], item["settings"].get("from_email", "")
        except Exception as exc:
            log.warning("Could not fetch Resend credentials via connectors: %s", exc)

    api_key = os.environ.get("RESEND_API_KEY", "")
    from_email = os.environ.get("RESEND_FROM_EMAIL", "")
    if api_key:
        return api_key, from_email

    return None, None


def _parse_task_file(path):
    """Parse a task markdown file and return a dict with id, title, content, deps."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception:
        return None
    tid = os.path.splitext(os.path.basename(path))[0]
    title = tid

    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            fm = content[3:end]
            m = re.search(r"^title:\s*(.+)$", fm, re.MULTILINE)
            if m:
                title = m.group(1).strip()

    deps = []
    for m in re.finditer(r"\*\*Blocked By\*\*[:\s]*\[([^\]]*)\]", content, re.IGNORECASE):
        refs = [r.strip() for r in m.group(1).split(",") if r.strip()]
        deps.extend(refs)
    for m in re.finditer(r"(?:depends?|blocked by)[:\s]+([#\w\s,-]+)", content, re.IGNORECASE):
        refs = [r.strip() for r in re.split(r"[,\s]+", m.group(1)) if r.strip().startswith("#")]
        deps.extend(refs)
    deps = list(dict.fromkeys(deps))

    return {"id": tid, "title": title, "content": content, "path": path, "deps": deps}


def _read_task_files():
    """Return list of parsed task dicts for all .md files in .local/tasks/."""
    tasks = []
    if not os.path.isdir(_TASKS_DIR):
        return tasks
    for path in glob.glob(os.path.join(_TASKS_DIR, "*.md")):
        t = _parse_task_file(path)
        if t:
            tasks.append(t)
    return tasks


def _get_merged_today_from_db(db_path):
    """
    Return list of task dicts merged in the last 24 h using the authoritative
    report_tracking table (populated by post-merge.sh on each task completion).

    Falls back to mtime-based detection when the table is empty or absent.
    """
    now = time.time()
    day_ago = now - 86400

    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute(
            """SELECT DISTINCT note FROM report_tracking
               WHERE event_type='task_merge' AND ts >= ?
               ORDER BY ts DESC""",
            (day_ago,),
        )
        rows = cur.fetchall()
        conn.close()
        if rows:
            task_ids = [row[0] for row in rows if row[0] and row[0] != "task-merge"]
            if task_ids:
                tasks_by_id = {t["id"]: t for t in _read_task_files()}
                result = []
                for tid in task_ids:
                    if tid in tasks_by_id:
                        result.append(tasks_by_id[tid])
                    else:
                        result.append({"id": tid, "title": tid, "path": "", "deps": []})
                return result[:10]
    except Exception:
        pass

    tasks = _read_task_files()
    merged = []
    for t in tasks:
        try:
            mtime = os.path.getmtime(t["path"])
        except OSError:
            mtime = 0
        if mtime >= day_ago:
            merged.append((mtime, t))
    merged.sort(key=lambda x: x[0], reverse=True)
    return [t for _, t in merged[:10]]


def _get_task_states(db_path):
    """
    Return (merged_today, in_progress, queued_next).

    merged_today  — tasks recorded in report_tracking as 'task_merge' in the
                    last 24 h (authoritative); falls back to file mtime
    in_progress   — tasks with status='IN_PROGRESS' in task_status table;
                    falls back to recently accessed task files (last 30 min)
    queued_next   — up to 5 oldest task files not in merged_today set,
                    with dependency refs extracted from markdown
    """
    merged_today = _get_merged_today_from_db(db_path)
    in_progress = _get_in_progress_from_db(db_path)

    merged_ids = {t["id"] for t in merged_today}
    in_progress_ids = {t["id"] for t in in_progress}

    all_tasks = _read_task_files()

    def _sort_key(t):
        m = re.match(r"task-(\d+)", t["id"])
        return int(m.group(1)) if m else 9999

    all_tasks.sort(key=_sort_key)
    queued_next = [
        t for t in all_tasks
        if t["id"] not in merged_ids and t["id"] not in in_progress_ids
    ][:5]

    return merged_today, in_progress, queued_next


def _get_in_progress_from_db(db_path):
    """
    Return in-progress tasks.

    Primary source: task_status table rows with status='IN_PROGRESS'.
    This is populated by update_task_status() called from the scheduler job
    and from post-merge.sh on each task completion.

    Fallback: task files accessed in the last 30 minutes (proxy for tasks
    currently being worked on by an agent session).  We exclude task-759
    itself to avoid self-reporting as in-progress during report generation.
    """
    tasks = []

    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute(
            "SELECT task_id, title FROM task_status WHERE status='IN_PROGRESS' ORDER BY updated_at DESC LIMIT 10"
        )
        rows = cur.fetchall()
        conn.close()
        if rows:
            return [{"id": row[0], "title": row[1] or row[0], "deps": []} for row in rows]
    except Exception:
        pass

    recent_cutoff = time.time() - 1800
    if os.path.isdir(_TASKS_DIR):
        for path in glob.glob(os.path.join(_TASKS_DIR, "*.md")):
            tid = os.path.splitext(os.path.basename(path))[0]
            if tid == "task-759":
                continue
            try:
                atime = os.path.getatime(path)
                mtime = os.path.getmtime(path)
                if max(atime, mtime) >= recent_cutoff:
                    t = _parse_task_file(path)
                    if t:
                        tasks.append(t)
            except OSError:
                pass

    tasks.sort(key=lambda t: max(
        os.path.getatime(t["path"]) if os.path.exists(t["path"]) else 0,
        os.path.getmtime(t["path"]) if os.path.exists(t["path"]) else 0,
    ), reverse=True)
    return tasks[:5]


def _get_test_results():
    """Return dict with test suite status from JSON result files if present."""
    results = {
        "assembler": {"status": "not-run", "pass": 0, "fail": 0, "last_run": None},
        "boot_image": {"status": "not-run", "pass": 0, "fail": 0, "last_run": None},
        "e2e": {"status": "not-run", "pass": 0, "fail": 0, "last_run": None},
    }
    build_dir = os.path.join(_BASE_DIR, "build")
    for key, filename in [
        ("assembler", "assembler_test_results.json"),
        ("boot_image", "boot_test_results.json"),
        ("e2e", "e2e_results.json"),
    ]:
        path = os.path.join(build_dir, filename)
        if os.path.isfile(path):
            try:
                import json
                with open(path) as f:
                    data = json.load(f)
                results[key]["pass"] = data.get("passed", 0)
                results[key]["fail"] = data.get("failed", 0)
                results[key]["status"] = "pass" if data.get("failed", 0) == 0 else "fail"
                ts = data.get("timestamp")
                if ts:
                    results[key]["last_run"] = (
                        datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d %H:%M UTC")
                    )
            except Exception:
                pass
    return results


def _get_ti60_status(db_path):
    """Return Ti60 call-home status from the devices table."""
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute(
            "SELECT device_uid, last_seen FROM devices WHERE board_type=3 ORDER BY last_seen DESC LIMIT 1"
        )
        row = cur.fetchone()
        conn.close()
        if row:
            uid, last_seen = row
            if last_seen and last_seen > 0:
                ts = datetime.datetime.utcfromtimestamp(last_seen).strftime("%Y-%m-%d %H:%M UTC")
                return {"connected": True, "uid": uid, "last_seen": ts}
        return {"connected": False}
    except Exception as exc:
        log.debug("Ti60 status check failed: %s", exc)
        return {"connected": False}


def _get_cost_summary(db_path):
    """Return cost summary from the report_tracking table."""
    today = datetime.date.today()
    month_start = today.replace(day=1)
    today_ts = time.mktime(today.timetuple())
    month_ts = time.mktime(month_start.timetuple())
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*), SUM(cost_usd) FROM report_tracking WHERE ts >= ?", (today_ts,)
        )
        row = cur.fetchone()
        runs_today = row[0] or 0
        cost_today = row[1] or 0.0
        cur.execute(
            "SELECT SUM(cost_usd) FROM report_tracking WHERE ts >= ?", (month_ts,)
        )
        row = cur.fetchone()
        cost_month = row[0] or 0.0
        conn.close()
    except Exception:
        runs_today = 0
        cost_today = 0.0
        cost_month = 0.0
    return {"runs_today": runs_today, "cost_today": cost_today, "cost_month": cost_month}


def _ensure_tracking_table(db_path):
    """Create report_tracking and task_status tables if they don't exist."""
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS report_tracking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                event_type TEXT NOT NULL DEFAULT 'task_run',
                cost_usd REAL NOT NULL DEFAULT 0.50,
                note TEXT DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS task_status (
                task_id TEXT PRIMARY KEY,
                title TEXT DEFAULT '',
                status TEXT DEFAULT 'QUEUED',
                updated_at REAL DEFAULT 0
            )
        """)
        conn.commit()
        conn.close()
    except Exception as exc:
        log.warning("Could not create report tables: %s", exc)


def record_task_run(db_path, event_type="task_run", cost_usd=None, note=""):
    """Record a task agent run in the tracking table."""
    if cost_usd is None:
        cost_usd = COST_PER_TASK_RUN_USD
    _ensure_tracking_table(db_path)
    try:
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO report_tracking (ts, event_type, cost_usd, note) VALUES (?, ?, ?, ?)",
            (time.time(), event_type, cost_usd, note),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        log.warning("Could not record task run: %s", exc)


def update_task_status(db_path, task_id, title, status):
    """Upsert a task's status in task_status table (for in-progress tracking)."""
    _ensure_tracking_table(db_path)
    try:
        conn = sqlite3.connect(db_path)
        conn.execute(
            """INSERT INTO task_status (task_id, title, status, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(task_id) DO UPDATE SET
                 title=excluded.title, status=excluded.status, updated_at=excluded.updated_at""",
            (task_id, title, status, time.time()),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        log.warning("Could not update task status: %s", exc)


def generate_report(db_path):
    """
    Build the daily report.
    Returns (plain_text, html_text, cost_today).
    """
    _ensure_tracking_table(db_path)
    now_utc = datetime.datetime.utcnow()
    date_str = now_utc.strftime("%Y-%m-%d")

    merged_today, in_progress, queued_next = _get_task_states(db_path)
    test_results = _get_test_results()
    ti60 = _get_ti60_status(db_path)
    cost = _get_cost_summary(db_path)

    cost_today = cost["cost_today"]
    cost_month = cost["cost_month"]
    runs_today = cost["runs_today"]

    def _task_line(t):
        deps = t.get("deps", [])
        dep_str = f"  [depends: {', '.join(deps)}]" if deps else ""
        return f"  #{t['id']}  {t['title']}{dep_str}"

    def _test_line(key, label):
        r = test_results[key]
        if r["status"] == "not-run":
            return f"  {label}: not yet run"
        icon = "PASS" if r["status"] == "pass" else "FAIL"
        ts = f" (last run: {r['last_run']})" if r["last_run"] else ""
        return f"  {label}: {icon}  {r['pass']} passed, {r['fail']} failed{ts}"

    merged_lines = (
        "\n".join(_task_line(t) for t in merged_today) if merged_today else "  (none in last 24 h)"
    )
    ip_lines = "\n".join(_task_line(t) for t in in_progress) if in_progress else "  (none)"
    queued_lines = (
        "\n".join(_task_line(t) for t in queued_next) if queued_next else "  (none)"
    )

    if ti60["connected"]:
        ti60_line = (
            f"  Connected — FPGA ID: {ti60['uid']}  |  Last call-home: {ti60['last_seen']}"
        )
    else:
        ti60_line = "  Not yet connected — Stage 2 bitstream not yet flashed"

    plain = f"""Church Machine — Daily Report {date_str}
Generated: {now_utc.strftime('%Y-%m-%d %H:%M')} UTC
{'='*60}

1. TASKS MERGED / COMPLETED TODAY
{merged_lines}

2. IN PROGRESS
{ip_lines}

3. QUEUED NEXT
{queued_lines}

4. TEST SUITE
{_test_line('assembler', 'Assembler tests')}
{_test_line('boot_image', 'Boot image tests')}
{_test_line('e2e', 'E2E tests      ')}

5. Ti60 CALL-HOME STATUS
{ti60_line}

6. COST SUMMARY
  Agent task runs today:       {runs_today}
  Estimated cost today:        ${cost_today:.2f}
  Estimated cost this month:   ${cost_month:.2f}
  Replit billing dashboard:    {BILLING_URL}

{'='*60}
This report is sent automatically at 05:00 UTC every day.
"""

    def _h(text):
        return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    def _task_html(tasks, empty="(none)"):
        if not tasks:
            return f"<li><em>{empty}</em></li>"
        items = []
        for t in tasks:
            deps = t.get("deps", [])
            dep_html = (
                f" <span style='color:#888;font-size:0.85em'>[depends: {_h(', '.join(deps))}]</span>"
                if deps
                else ""
            )
            items.append(
                f"<li><code>#{_h(t['id'])}</code> {_h(t['title'])}{dep_html}</li>"
            )
        return "\n".join(items)

    def _test_html(key, label):
        r = test_results[key]
        if r["status"] == "not-run":
            return f"<tr><td>{label}</td><td colspan='3'><em>not yet run</em></td></tr>"
        colour = "#2e7d32" if r["status"] == "pass" else "#c62828"
        badge = f"<span style='color:{colour};font-weight:bold'>{'PASS' if r['status']=='pass' else 'FAIL'}</span>"
        ts = _h(r["last_run"]) if r["last_run"] else "—"
        return (
            f"<tr><td>{label}</td><td>{badge}</td>"
            f"<td>{r['pass']} passed, {r['fail']} failed</td>"
            f"<td style='color:#666;font-size:0.9em'>{ts}</td></tr>"
        )

    if ti60["connected"]:
        ti60_html = (
            f"<p>Connected &mdash; FPGA ID: <code>{_h(ti60['uid'])}</code> "
            f"&mdash; Last call-home: {_h(ti60['last_seen'])}</p>"
        )
    else:
        ti60_html = "<p><em>Not yet connected &mdash; Stage 2 bitstream not yet flashed</em></p>"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Church Machine — Daily Report {_h(date_str)}</title>
<style>
  body {{ font-family: system-ui, sans-serif; color: #1a1a1a; max-width: 700px; margin: 0 auto; padding: 24px; }}
  h1 {{ font-size: 1.4em; color: #1565c0; border-bottom: 2px solid #1565c0; padding-bottom: 8px; }}
  h2 {{ font-size: 1.1em; color: #333; margin-top: 24px; }}
  ul {{ margin: 4px 0; padding-left: 20px; }}
  li {{ margin: 2px 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 8px 0; }}
  th,td {{ text-align: left; padding: 6px 10px; border-bottom: 1px solid #e0e0e0; }}
  th {{ background: #f5f5f5; font-weight: 600; }}
  .cost-grid {{ display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; }}
  .cost-label {{ color: #555; }}
  .cost-value {{ font-weight: 600; }}
  .footer {{ margin-top: 32px; font-size: 0.85em; color: #888; border-top: 1px solid #e0e0e0; padding-top: 12px; }}
</style>
</head>
<body>
<h1>Church Machine &mdash; Daily Report {_h(date_str)}</h1>
<p style="color:#666;font-size:0.9em">Generated {_h(now_utc.strftime('%Y-%m-%d %H:%M'))} UTC</p>

<h2>1. Tasks Merged / Completed Today</h2>
<ul>
{_task_html(merged_today, '(none in last 24 h)')}
</ul>

<h2>2. In Progress</h2>
<ul>
{_task_html(in_progress)}
</ul>

<h2>3. Queued Next</h2>
<ul>
{_task_html(queued_next)}
</ul>

<h2>4. Test Suite</h2>
<table>
<thead><tr><th>Suite</th><th>Status</th><th>Results</th><th>Last Run</th></tr></thead>
<tbody>
{_test_html('assembler', 'Assembler tests')}
{_test_html('boot_image', 'Boot image tests')}
{_test_html('e2e', 'E2E tests')}
</tbody>
</table>

<h2>5. Ti60 Call-Home Status</h2>
{ti60_html}

<h2>6. Cost Summary</h2>
<div class="cost-grid">
  <span class="cost-label">Agent task runs today:</span>
  <span class="cost-value">{runs_today}</span>
  <span class="cost-label">Estimated cost today:</span>
  <span class="cost-value">${cost_today:.2f}</span>
  <span class="cost-label">Estimated cost this month:</span>
  <span class="cost-value">${cost_month:.2f}</span>
  <span class="cost-label">Replit billing dashboard:</span>
  <span class="cost-value"><a href="{BILLING_URL}">{BILLING_URL}</a></span>
</div>

<div class="footer">
  This report is sent automatically at 05:00 UTC every day.
</div>
</body>
</html>"""

    return plain, html, cost_today


def send_daily_report(db_path):
    """Generate and send the daily report via Resend. Returns (success, message)."""
    api_key, from_email = _get_resend_credentials()
    if not api_key:
        msg = "Resend API key not available — email not sent"
        log.error(msg)
        return False, msg

    if not from_email or from_email.lower().endswith("@gmail.com"):
        from_email = os.environ.get("RESEND_FROM_EMAIL", "noreply@churchmachine.io")

    plain, html, cost_today = generate_report(db_path)
    date_str = datetime.date.today().strftime("%Y-%m-%d")
    subject = f"Church Machine \u2014 Daily Report {date_str} | Est. cost: ${cost_today:.2f}"

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
        log.info("Daily report sent via Resend: %s", response)
        return True, f"Report sent successfully (id={response.get('id', '?')})"
    except Exception as exc:
        msg = f"Failed to send report via Resend: {exc}"
        log.error(msg)
        return False, msg
