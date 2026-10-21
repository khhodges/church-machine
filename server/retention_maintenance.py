"""Authorized hourly housekeeping; never triggered by browsing or module import."""
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
import tempfile
import threading
import time

from server.history_retention import durable_json, recorded_timestamp, reference_documents

INTERVAL = 3600
THREE_DAYS = 3 * 86400


def _open_in_process(path):
    """Do not unlink a plain log still held open by a local writer."""
    identity = path.stat()
    for process in Path("/proc").glob("[0-9]*"):
        try:
            for fd in (process / "fd").iterdir():
                try:
                    other = fd.stat()
                    if (other.st_dev, other.st_ino) == (identity.st_dev, identity.st_ino):
                        return True
                except FileNotFoundError:
                    pass
        except (FileNotFoundError, PermissionError):
            continue
    return False


def cleanup_logs(project, lumps, diagnostic_lock, frozen_root, now):
    """Three-day operational logs, not approvals, journals, or uploaded evidence."""
    project, lumps = Path(project), Path(lumps)
    cutoff = now - THREE_DAYS
    frozen = "".join(reference_documents(frozen_root).values())
    result = dict(deleted=[], trimmedEvents=0, protected=[], errors=[])
    paths = set(project.glob("*.log*"))
    for directory in (project / "build", project / "logs", project / "server"):
        if directory.exists():
            paths.update(directory.rglob("*.log"))
            paths.update(directory.rglob("*.log.[0-9]*"))
    for path in sorted(paths):
        try:
            relative = path.relative_to(project).as_posix()
            if (path.is_symlink() or not path.is_file()
                    or path.stat().st_nlink != 1
                    or any(part in ("build-snapshots", ".git", ".change-reviews")
                           for part in path.parts)):
                continue
            if path.stat().st_mtime >= cutoff:
                continue
            if (path.name in frozen or relative in frozen
                    or hashlib.sha256(path.read_bytes()).hexdigest() in frozen
                    or _open_in_process(path)):
                result["protected"].append(relative)
                continue
            path.unlink()
            result["deleted"].append(relative)
        except OSError as exc:
            result["errors"].append(dict(path=str(path), reason=str(exc)))

    # Share both locks with the runtime event appender/rotator. Filter records
    # rather than deleting an active file containing recent diagnostics.
    with diagnostic_lock:
        with (lumps / "save-runtime-diagnostics.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            for path in sorted(lumps.glob("*diagnostic*.jsonl*")):
                try:
                    if path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
                        continue
                    fallback = path.stat().st_mtime
                    kept, removed = [], 0
                    for line in path.read_bytes().splitlines(keepends=True):
                        try:
                            event = json.loads(line)
                            stamp = recorded_timestamp(event.get("timestamp")) if isinstance(event, dict) else None
                        except (ValueError, UnicodeDecodeError):
                            stamp = None
                        if (stamp if stamp is not None else fallback) < cutoff:
                            removed += 1
                        else:
                            kept.append(line)
                    if not removed:
                        continue
                    fd, temporary = tempfile.mkstemp(dir=lumps, prefix=".log-retention-")
                    try:
                        with os.fdopen(fd, "wb") as stream:
                            stream.writelines(kept)
                            stream.flush()
                            os.fsync(stream.fileno())
                        os.replace(temporary, path)
                    finally:
                        if os.path.exists(temporary):
                            os.unlink(temporary)
                    result["trimmedEvents"] += removed
                except OSError as exc:
                    result["errors"].append(dict(path=str(path), reason=str(exc)))
    return result


def run_maintenance(app, lumps, prune, diagnostic_lock, frozen_root):
    lumps = Path(lumps)
    key = hashlib.sha256(str(lumps.resolve()).encode()).hexdigest()[:16]
    with (Path(tempfile.gettempdir()) / f"church-retention-{key}.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return None
        report = dict(startedAt=time.time(), archives=[], errors=[])
        report_path = Path(tempfile.gettempdir()) / f"church-retention-{key}.json"
        durable_json(report_path, report)
        try:
            manifest = json.loads((lumps / "manifest.json").read_text())
            tokens = sorted({str(row["token"]) for row in manifest
                             if row.get("archived") is not True and row.get("token")})
            # prune performs fresh eligibility, history membership, reference
            # checks and durable deletion bookkeeping under the transition lock.
            with app.test_request_context("/internal/authorized-retention", method="POST"):
                for token in tokens:
                    report["currentToken"] = token
                    durable_json(report_path, report)
                    try:
                        response = app.make_response(prune(token, trigger="scheduled_policy"))
                        result = response.get_json()
                        report["archives"].append(dict(token=token, status=response.status_code, result=result))
                        if response.status_code != 200:
                            report["errors"].append(dict(token=token, result=result))
                    except Exception as exc:
                        report["errors"].append(dict(token=token, reason=str(exc)))
            report["logs"] = cleanup_logs(
                Path(__file__).resolve().parent.parent, lumps,
                diagnostic_lock, frozen_root, time.time())
        except Exception as exc:
            report["errors"].append(dict(reason=str(exc)))
            logging.exception("Scheduled retention did not complete")
        report["finishedAt"] = time.time()
        report.pop("currentToken", None)
        durable_json(report_path, report)
        logging.info("Retention maintenance: %s archives deleted; %s errors",
                     sum(len(row["result"].get("deleted", [])) for row in report["archives"]),
                     len(report["errors"]) + len(report.get("logs", {}).get("errors", [])))
        return report


def start_maintenance(app, lumps, prune, diagnostic_lock, frozen_root):
    def worker():
        while True:
            try:
                run_maintenance(app, lumps, prune, diagnostic_lock, frozen_root)
            except Exception:
                logging.exception("Retention maintenance failed; will retry next hour")
            time.sleep(INTERVAL)
    thread = threading.Thread(target=worker, name="retention-maintenance", daemon=True)
    thread.start()
    return thread
