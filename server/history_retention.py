"""Conservative, deterministic archive retention; never use filesystem mtime."""
from datetime import datetime


def expired_archives(history, now):
    """Keep the three highest revision numbers (including ties), plus 30 days."""
    versions = sorted({int(row["version"]) for row in history}, reverse=True)
    newest = set(versions[:3])
    result = []
    for row in history:
        if row.get("current") or int(row["version"]) in newest:
            continue
        timestamp = row.get("compiled_at")
        try:
            if isinstance(timestamp, str):
                date = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                if date.tzinfo is None:
                    continue
                timestamp = date.timestamp()
            if isinstance(timestamp, bool) or timestamp is None:
                continue
            timestamp = float(timestamp)
            if not 0 < timestamp < now - 30 * 86400:
                continue
        except (ValueError, TypeError, OverflowError):
            continue
        filename = row.get("archive_filename") or row.get("record_filename")
        if filename:
            result.append(row)
    return result