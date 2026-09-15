"""Privacy-preserving browser diagnostic ingestion.

The endpoint in this module deliberately has no persistence layer.  A valid
report is reduced to the small allowlist below and emitted to the
``browser_diagnostics`` logger.  Rate state is process-local; deployments with
multiple workers therefore enforce the limits independently in each worker.
"""

from __future__ import annotations

from collections import OrderedDict, deque
from datetime import datetime, timezone
import json
import logging
import os
import re
import threading
import time
from typing import Callable, Iterable
from urllib.parse import urlsplit
import uuid

from flask import Blueprint, jsonify, request


LOGGER = logging.getLogger("browser_diagnostics")

MAX_REPORT_BYTES = 8192
GLOBAL_RATE_LIMIT = 120
SOURCE_RATE_LIMIT = 12
RATE_WINDOW_SECONDS = 60.0
MAX_RATE_SOURCES = 1024

_RATE_LOCK = threading.Lock()
_GLOBAL_RATE = deque()
_SOURCE_RATE: "OrderedDict[str, deque]" = OrderedDict()

_KINDS = frozenset({"script", "resource", "rejection", "resize_observer"})
_ERROR_TYPES = frozenset({
    "Error",
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "RangeError",
    "URIError",
    "EvalError",
    "NonError",
    "Unknown",
})
_PAGES = frozenset({"editor", "other"})
_INTERACTIONS = frozenset({"scroll", "resize", "click", "keydown", "none"})
_BROWSERS = frozenset({"chromium", "firefox", "safari", "other"})
_VERSION_RE = re.compile(r"^[0-9a-fA-F]{7,64}$")

_REQUIRED_REPORT_FIELDS = frozenset({
    "kind",
    "error_type",
    "occurred_at",
    "page",
    "interaction",
    "browser",
    "viewport",
    "frames",
    "resource",
    "version",
})


def served_filenames(simulator_dir: str) -> tuple[frozenset[str], frozenset[str]]:
    """Return ``(frame_files, resource_files)`` for the served simulator.

    Only regular files immediately inside ``simulator_dir`` are considered.
    Frames can point to JavaScript files or the fixed simulator
    ``index.html``.  Resource diagnostics additionally allow CSS files.
    """

    frame_files = {"index.html"}
    resource_files = {"index.html"}
    try:
        entries: Iterable[os.DirEntry[str]] = os.scandir(simulator_dir)
    except OSError:
        return frozenset(frame_files), frozenset(resource_files)

    try:
        for entry in entries:
            try:
                if not entry.is_file(follow_symlinks=True):
                    continue
            except OSError:
                continue
            basename = entry.name
            if basename.endswith(".js"):
                frame_files.add(basename)
                resource_files.add(basename)
            elif basename.endswith(".css"):
                resource_files.add(basename)
    finally:
        entries.close()
    return frozenset(frame_files), frozenset(resource_files)


def _safe_version(value: object) -> str:
    if value == "unknown":
        return "unknown"
    if isinstance(value, str) and _VERSION_RE.fullmatch(value):
        return value
    return "unknown"


def _utc_timestamp(value: object) -> str | None:
    if not isinstance(value, str) or len(value) > 64 or "T" not in value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(None):
        return None
    return value


def _safe_integer(value: object, *, minimum: int, maximum: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if value < minimum or value > maximum:
        return None
    return value


def _normalize_frame(frame: object, frame_files: frozenset[str]) -> dict | None:
    if not isinstance(frame, dict):
        return None
    filename = frame.get("file")
    if (
        not isinstance(filename, str)
        or filename not in frame_files
        or "/" in filename
        or "\\" in filename
    ):
        return None
    line = _safe_integer(frame.get("line"), minimum=1, maximum=10_000_000)
    column = _safe_integer(
        frame.get("column"), minimum=0, maximum=10_000_000
    )
    if line is None or column is None:
        return None
    return {"file": filename, "line": line, "column": column}


def _normalize_report(
    report: object,
    frame_files: frozenset[str],
    resource_files: frozenset[str],
) -> dict | None:
    """Validate and reduce an untrusted JSON object to the log schema."""

    if not isinstance(report, dict):
        return None
    if not _REQUIRED_REPORT_FIELDS.issubset(report):
        return None

    enum_fields = (
        ("kind", _KINDS),
        ("error_type", _ERROR_TYPES),
        ("page", _PAGES),
        ("interaction", _INTERACTIONS),
        ("browser", _BROWSERS),
    )
    for field, allowed in enum_fields:
        value = report.get(field)
        if not isinstance(value, str) or value not in allowed:
            return None

    occurred_at = _utc_timestamp(report.get("occurred_at"))
    if occurred_at is None:
        return None

    viewport = report.get("viewport")
    if not isinstance(viewport, dict):
        return None
    width = _safe_integer(viewport.get("width"), minimum=0, maximum=100_000)
    height = _safe_integer(viewport.get("height"), minimum=0, maximum=100_000)
    if width is None or height is None:
        return None

    frames = report.get("frames")
    if not isinstance(frames, list) or len(frames) > 64:
        return None
    normalized_frames = []
    for frame in frames:
        normalized = _normalize_frame(frame, frame_files)
        if normalized is None:
            return None
        normalized_frames.append(normalized)

    resource = report.get("resource")
    if (
        not isinstance(resource, str)
        or (resource != "" and resource not in resource_files)
        or "/" in resource
        or "\\" in resource
    ):
        return None

    version = report.get("version")
    if version != "unknown" and (
        not isinstance(version, str) or _VERSION_RE.fullmatch(version) is None
    ):
        return None

    # Construct a fresh object instead of copying the input.  This is the
    # privacy boundary: arbitrary client fields can never reach the logger.
    return {
        "kind": report["kind"],
        "error_type": report["error_type"],
        "occurred_at": occurred_at,
        "page": report["page"],
        "interaction": report["interaction"],
        "browser": report["browser"],
        "viewport": {"width": width, "height": height},
        "frames": normalized_frames,
        "resource": resource,
        "version": version,
    }


def _same_origin() -> bool:
    """Return whether browser origin metadata permits this request.

    Missing Origin is accepted because diagnostics can be sent during
    pre-login/bootstrap paths and non-browser callers do not always send it.
    A supplied Origin must be an exact origin match.  ``Sec-Fetch-Site`` is
    checked independently because it is present on modern browser requests.
    """

    fetch_site = request.headers.get("Sec-Fetch-Site", "").strip().lower()
    if fetch_site == "cross-site":
        return False
    # Sec-Fetch-Site is a browser-controlled forbidden request header. A
    # same-origin value is stronger evidence than Flask's externally visible
    # host/scheme after a reverse proxy has rewritten the request. Replit's
    # preview proxy can otherwise make a relative same-origin fetch appear to
    # arrive on an internal host and incorrectly reject the crash report.
    if fetch_site == "same-origin":
        return True

    origin = request.headers.get("Origin")
    if origin is None:
        return True
    if not origin or len(origin) > 512:
        return False
    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    if (
        parsed.scheme != request.scheme
        or not parsed.netloc
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.username is not None
        or parsed.password is not None
    ):
        return False
    try:
        origin_port = parsed.port
    except ValueError:
        return False
    try:
        expected = urlsplit(f"//{request.host}")
    except ValueError:
        return False
    try:
        expected_port = expected.port
    except ValueError:
        return False
    default_port = {"http": 80, "https": 443}.get(request.scheme)
    if origin_port is None:
        origin_port = default_port
    if expected_port is None:
        expected_port = default_port
    try:
        parsed_hostname = parsed.hostname
        expected_hostname = expected.hostname
    except ValueError:
        return False
    return (
        parsed_hostname is not None
        and expected_hostname is not None
        and parsed_hostname.lower() == expected_hostname.lower()
        and origin_port == expected_port
    )


def _rate_source() -> str:
    # Do not trust arbitrary forwarded addresses. Behind a shared proxy this
    # may conservatively group clients. Never log or persist this value.
    return request.remote_addr or "<unknown>"


def _rate_allowed(source: str, now: float) -> bool:
    with _RATE_LOCK:
        cutoff = now - RATE_WINDOW_SECONDS
        while _GLOBAL_RATE and _GLOBAL_RATE[0] <= cutoff:
            _GLOBAL_RATE.popleft()
        source_times = _SOURCE_RATE.get(source)
        if source_times is not None:
            while source_times and source_times[0] <= cutoff:
                source_times.popleft()
            if not source_times:
                del _SOURCE_RATE[source]
                source_times = None

        if len(_GLOBAL_RATE) >= GLOBAL_RATE_LIMIT:
            return False
        if source_times is not None and len(source_times) >= SOURCE_RATE_LIMIT:
            return False

        if source_times is None:
            if len(_SOURCE_RATE) >= MAX_RATE_SOURCES:
                _SOURCE_RATE.popitem(last=False)
            source_times = deque()
            _SOURCE_RATE[source] = source_times
        else:
            _SOURCE_RATE.move_to_end(source)
        source_times.append(now)
        _GLOBAL_RATE.append(now)
        return True


def _bad_request(message: str, status: int):
    return jsonify({"ok": False, "error": message}), status


def _read_body() -> bytes | None:
    """Read at most one byte beyond the report limit.

    Werkzeug's bounded stream respects Content-Length and safely handles
    server-terminated chunked bodies. Reading the raw socket past a known
    Content-Length can block forever on persistent connections.
    """

    content_length = request.content_length
    if content_length is not None and content_length > MAX_REPORT_BYTES:
        return None
    return request.stream.read(MAX_REPORT_BYTES + 1)


def _parse_json(raw_body: bytes) -> object | None:
    if not raw_body or len(raw_body) > MAX_REPORT_BYTES:
        return None
    try:
        text = raw_body.decode("utf-8")

        def reject_constant(_value: str):
            raise ValueError("non-standard JSON number")

        return json.loads(
            text,
            parse_constant=reject_constant,
        )
    except (UnicodeDecodeError, ValueError, TypeError):
        return None


def _received_at() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def create_blueprint(
    *,
    simulator_dir: str,
    server_version: Callable[[], object] | object = "unknown",
    name: str = "browser_diagnostics",
) -> Blueprint:
    """Create the diagnostics blueprint for the main or a standalone Flask app."""

    frame_files, resource_files = served_filenames(simulator_dir)
    blueprint = Blueprint(name, __name__)

    def get_server_version() -> object:
        try:
            return server_version() if callable(server_version) else server_version
        except Exception:
            return "unknown"

    @blueprint.post("/api/browser-diagnostics")
    def browser_diagnostics():
        if not _same_origin():
            return _bad_request("origin forbidden", 403)
        if request.mimetype != "application/json":
            return _bad_request("JSON content type required", 400)
        if not _rate_allowed(_rate_source(), now=time.monotonic()):
            return _bad_request("rate limit exceeded", 429)

        raw_body = _read_body()
        if raw_body is None or len(raw_body) > MAX_REPORT_BYTES:
            return _bad_request("report too large", 413)
        report = _parse_json(raw_body)
        normalized = _normalize_report(
            report, frame_files=frame_files, resource_files=resource_files
        )
        if normalized is None:
            return _bad_request("bad schema", 400)

        report_id = uuid.uuid4().hex
        record = {
            "report_id": report_id,
            "received_at": _received_at(),
            "server_version": _safe_version(get_server_version()),
            "untrusted_client_report": True,
            "client_report": normalized,
        }
        try:
            LOGGER.warning(
                "BROWSER_DIAGNOSTIC %s",
                json.dumps(record, ensure_ascii=True, separators=(",", ":")),
            )
        except Exception:
            # Reporting must not turn a browser failure into another failure if
            # an embedding application's logging handler is unavailable.
            return _bad_request("diagnostic log unavailable", 503)
        return jsonify({"ok": True, "report_id": report_id})

    return blueprint


def register_browser_diagnostics(
    app,
    *,
    simulator_dir: str,
    server_version: Callable[[], object] | object = "unknown",
):
    """Register browser diagnostics on an existing Flask application."""

    blueprint = create_blueprint(
        simulator_dir=simulator_dir,
        server_version=server_version,
    )
    app.register_blueprint(blueprint)
    return blueprint


def reset_rate_limits_for_tests() -> None:
    """Clear process-local rate state for isolated endpoint tests."""

    with _RATE_LOCK:
        _GLOBAL_RATE.clear()
        _SOURCE_RATE.clear()
