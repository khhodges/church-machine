"""Canonical Namespace-owned boot-plan validation and compare-and-swap updates.

The Namespace row bearing ``boot: true`` is deliberately the only selection
record.  This module does not read boot-config, a manifest, a catalog, or an
image: those sources may validate/projection-bind a row, but may not choose it.
"""
from __future__ import annotations

import copy
import json
import os
import re
from dataclasses import dataclass


_TOKEN_RE = re.compile(r"^[0-9a-f]{8}$")
_MAX_SEQUENCE = 0x1FF


@dataclass
class NamespacePlanError(ValueError):
    """A user-actionable Namespace-plan error suitable for an API response."""

    message: str
    code: str = "namespace_plan_invalid"
    migration: dict | None = None

    def __str__(self):
        return self.message


def _error(message, code="namespace_plan_invalid", migration=None):
    raise NamespacePlanError(message, code, migration)


def revision_of(state):
    """Return the persisted CAS revision; pre-plan state is revision zero."""
    revision = state.get("revision", 0) if isinstance(state, dict) else 0
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        _error("Namespace revision must be a non-negative integer",
               "namespace_revision_invalid")
    return revision


def rows_of(state):
    if not isinstance(state, dict):
        _error("Namespace state must be a JSON object")
    rows = state.get("abstractions")
    if not isinstance(rows, list):
        _error("ns-state.json has no abstractions array")
    return rows


def _valid_slot(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 0x1FFF


def _valid_sequence(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= _MAX_SEQUENCE


def validate_rows(state, *, require_marker=True):
    """Validate Namespace row shape and return ``(rows, boot_row_or_none)``.

    A missing marker is distinguishable from a malformed plan so an explicit
    first selection may repair a checked-in legacy document.  Duplicate rows,
    duplicate markers, and malformed row identities always fail closed.
    """
    rows = rows_of(state)
    seen_slots = set()
    markers = []
    capability_test_rows = []
    for row in rows:
        if not isinstance(row, dict):
            _error("ns-state.json contains a non-object Namespace row")
        slot = row.get("slot")
        if not _valid_slot(slot):
            _error(f"ns-state.json contains invalid Namespace slot {slot!r}")
        if slot in seen_slots:
            _error(f"ns-state.json has duplicate Namespace slot {slot}",
                   "namespace_slot_duplicate")
        seen_slots.add(slot)
        sequence = row.get("seq")
        if not _valid_sequence(sequence):
            _error(f"NS[{slot}] has invalid generation {sequence!r}")
        if row.get("boot") is True:
            markers.append(row)
        elif "boot" in row and row["boot"] not in (False, None):
            _error(f"NS[{slot}] boot marker must be boolean")
        if row.get("name") == "CapabilityTest":
            capability_test_rows.append(row)
    if len(capability_test_rows) > 1:
        _error("Namespace has multiple CapabilityTest identities",
               "capabilitytest_identity_duplicate")
    if capability_test_rows and capability_test_rows[0]["slot"] != 10:
        _error("CapabilityTest is immutable at NS[10]",
               "capabilitytest_slot_immutable",
               {"required": False, "capability_test_slot": 10})
    if len(markers) > 1:
        _error("Namespace has multiple Lightning Bolt markers",
               "namespace_boot_marker_duplicate")
    if not markers:
        if require_marker:
            _error(
                "Namespace has no Lightning Bolt marker. Explicitly select and "
                "save a boot row; no legacy default will be inferred.",
                "namespace_boot_marker_missing",
                device_migration(state),
            )
        return rows, None
    validate_boot_row(markers[0])
    return rows, markers[0]


def validate_boot_row(row):
    """Ensure a marked row has a complete executable identity."""
    slot = row.get("slot")
    name = row.get("name")
    token = str(row.get("token") or row.get("cache_token") or "").lower()
    filename = row.get("filename")
    if not isinstance(name, str) or not name.strip():
        _error(f"NS[{slot}] Lightning Bolt row has no abstraction identity",
               "namespace_boot_identity_invalid")
    if not _valid_sequence(row.get("seq")):
        _error(f"NS[{slot}] Lightning Bolt row has invalid generation",
               "namespace_boot_identity_invalid")
    if not _TOKEN_RE.fullmatch(token):
        _error(f"NS[{slot}] Lightning Bolt row has no exact eight-hex artifact token",
               "namespace_boot_identity_invalid")
    if (not isinstance(filename, str) or not filename
            or os.path.basename(filename) != filename):
        _error(f"NS[{slot}] Lightning Bolt row has no safe exact artifact filename",
               "namespace_boot_identity_invalid")
    if row.get("resident") is not True or row.get("boot_resident") is not True:
        _error(f"NS[{slot}] Lightning Bolt row is not a boot-resident executable",
               "namespace_boot_target_not_resident")
    if row.get("load_policy", row.get("loadPolicy")) != "Resident":
        _error(f"NS[{slot}] Lightning Bolt row must have load_policy=Resident",
               "namespace_boot_target_not_resident")
    if row.get("symbolic") is True:
        _error(f"NS[{slot}] symbolic row cannot be a Lightning Bolt target",
               "namespace_boot_target_not_executable")
    return row


def identity_of(row):
    """Return the exact fields a client must echo to select an existing row."""
    return {
        "slot": row["slot"],
        "seq": row["seq"],
        "token": str(row.get("token") or row.get("cache_token") or "").lower(),
        "filename": row.get("filename"),
    }


def update_marker(state, expected_revision, requested_identity):
    """Return a CAS-updated state document without writing it.

    Missing markers may be repaired only through this explicit selection path.
    The caller writes the returned document while holding its process lock.
    """
    if (isinstance(expected_revision, bool)
            or not isinstance(expected_revision, int) or expected_revision < 0):
        _error("expected_revision must be a non-negative integer",
               "namespace_revision_invalid")
    current = revision_of(state)
    if expected_revision != current:
        _error(
            f"Namespace revision conflict: expected {expected_revision}, current {current}. Refresh and choose again.",
            "namespace_revision_conflict",
        )
    rows, _ = validate_rows(state, require_marker=False)
    if not isinstance(requested_identity, dict):
        _error("boot must identify an existing Namespace row",
               "namespace_boot_identity_invalid")
    try:
        requested = {
            "slot": requested_identity["slot"],
            "seq": requested_identity["seq"],
            "token": str(requested_identity["token"]).lower(),
            "filename": requested_identity["filename"],
        }
    except (KeyError, TypeError):
        _error("boot requires slot, seq, token, and filename",
               "namespace_boot_identity_invalid")
    candidates = [row for row in rows if row["slot"] == requested["slot"]]
    if len(candidates) != 1:
        _error("selected Namespace row no longer exists",
               "namespace_boot_target_missing")
    row = candidates[0]
    if identity_of(row) != requested:
        _error(
            f"selected NS[{requested['slot']}] identity or generation is stale; refresh before selecting it",
            "namespace_boot_identity_stale",
        )
    validate_boot_row(row)
    result = copy.deepcopy(state)
    for candidate in result["abstractions"]:
        candidate.pop("boot", None)
    result["abstractions"][rows.index(row)]["boot"] = True
    result["revision"] = current + 1
    return result


def device_migration(state):
    """Describe the canonical device layout without making it writable.

    UART is the fixed address-based device row at NS[2].  This projection is
    diagnostic only; device membership is part of the Namespace document and
    cannot be moved through a separate migration authority.
    """
    try:
        rows = rows_of(state)
    except NamespacePlanError:
        return {"required": True, "reason": "Namespace rows are unreadable"}
    captest = [r for r in rows if isinstance(r, dict) and r.get("name") == "CapabilityTest"]
    uart = [r for r in rows if isinstance(r, dict) and r.get("name") == "UART_DEV"]
    expected = {"location": "0x40000014", "limit": "0x00002"}
    if len(captest) != 1 or captest[0].get("slot") != 10:
        return {
            "required": True,
            "reason": "CapabilityTest must remain at NS[10]",
            "expected_uart": expected,
        }
    if len(uart) != 1:
        return {
            "required": True,
            "reason": "UART_DEV is missing from the Namespace plan",
            "expected_uart": expected,
            "capability_test_slot": 10,
        }
    row = uart[0]
    if row.get("location") != expected["location"] or row.get("limit") != expected["limit"]:
        return {
            "required": True,
            "reason": "UART_DEV address or register limit does not match the hardware decoder",
            "expected_uart": expected,
            "current_uart": {"slot": row.get("slot"), "location": row.get("location"), "limit": row.get("limit")},
            "requires_clist_rebind": row.get("slot") != 2,
        }
    if row.get("device_rebind_pending") is True:
        return {
            "required": True,
            "reason": ("UART is not at its canonical NS[2] device slot; "
                       "restore the Namespace row before hardware projection"),
            "expected_uart": expected,
            "current_uart": {"slot": row.get("slot"), "location": row.get("location"),
                             "limit": row.get("limit")},
            "requires_clist_rebind": True,
        }
    return {"required": False, "capability_test_slot": 10, "uart_slot": 2}


def presentation(state):
    """Return state plus a non-authoritative, validated plan projection."""
    result = copy.deepcopy(state)
    rows, row = validate_rows(result)
    result["revision"] = revision_of(result)
    result["plan"] = identity_of(row)
    result["migration"] = device_migration(result)
    return result