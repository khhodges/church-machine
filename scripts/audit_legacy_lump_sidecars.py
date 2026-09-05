#!/usr/bin/env python3
"""One-time, operator-driven audit/approval for legacy LUMP sidecars.

The default invocation is read-only.  Import requires both --write and one or
more exact --accept filenames; there is deliberately no bulk acceptance mode.
Approvals are SHA-256 keyed records; the manifest is never read or modified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
import struct
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from server.lump_approvals import read_approvals, write_approvals
from server.lump_integrity import (compute_number, parse_canonical_filename)


APPROVABLE_ANNOTATION_FIELDS = frozenset({
    "author", "petname", "pet_names", "notes", "mtbf_notes", "tags",
})
EXCLUDED_FIELDS = frozenset({
    "token", "filename", "sidecar_file", "binary_hash", "identity_hash",
    "identity_string", "lump_size", "cw", "cc", "lump_version", "compiled_at",
    "archived_version", "dot_name", "issue_n", "issue_number",
    # Source and API data are not retained through this legacy channel.
    "source", "api", "api_json", "methods", "grants", "description",
    "capability_type", "authorized", "legacy_authorized", "ns_slot",
    "ns_slot_policy", "boot_resident", "variant_group", "portable_binding",
})


def _write_json_atomic(path: Path, value: object) -> None:
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out, indent=2)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def _binary_intrinsics(path: Path) -> tuple[bytes, str, dict[str, int]]:
    """Derive identity and header values from bytes; never trust sidecar copies."""
    raw = path.read_bytes()
    if len(raw) < 4 or len(raw) % 4:
        raise ValueError("binary is not a non-empty whole-word LUMP")
    header = struct.unpack(">I", raw[:4])[0]
    values = {
        "magic": (header >> 27) & 0x1F,
        "lump_size": 1 << (((header >> 23) & 0xF) + 6),
        "cw": (header >> 10) & 0x1FFF,
        "cc": header & 0xFF,
    }
    if values["magic"] != 0x1F or len(raw) != values["lump_size"] * 4:
        raise ValueError("binary header does not describe its bytes")
    return raw, hashlib.sha256(raw).hexdigest(), values


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    default_dir = Path(__file__).resolve().parents[1] / "server" / "lumps"
    parser.add_argument("--lumps-dir", type=Path, default=default_dir)
    parser.add_argument(
        "--approvals", type=Path,
        help="canonical approval store (default: <lumps-dir>/approvals.json)",
    )
    parser.add_argument("--accept", action="append", default=[], metavar="FILE.json",
                        help="exact reviewed sidecar filename to accept (repeatable)")
    parser.add_argument("--write", action="store_true",
                        help="write accepted annotations to the approval ledger")
    args = parser.parse_args(argv)

    lumps_dir = args.lumps_dir.resolve()
    approvals_path = (args.approvals or lumps_dir / "approvals.json").resolve()
    if args.write and not args.accept:
        parser.error("--write requires at least one explicit --accept FILE.json")
    if args.accept and not args.write:
        parser.error("--accept is inert without --write; supply both after review")

    try:
        approvals = read_approvals(approvals_path, missing_ok=True)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read approvals ledger: {exc}", file=sys.stderr)
        return 2
    accepted = set(args.accept)
    available = {
        p.name for p in lumps_dir.glob("*.json")
        if p.name not in {"manifest.json", "server_managed_tokens.json", "ns-state.json",
                          "approvals.json", approvals_path.name}
    }
    unknown = sorted(accepted - available)
    if unknown:
        print("ERROR: accepted sidecar(s) not found: " + ", ".join(unknown), file=sys.stderr)
        return 2

    changed = False
    failures = 0
    for sidecar_path in sorted(lumps_dir.glob("*.json")):
        if sidecar_path.name not in available:
            continue
        try:
            sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"INVALID {sidecar_path.name}: {exc}")
            failures += sidecar_path.name in accepted
            continue
        if not isinstance(sidecar, dict):
            print(f"INVALID {sidecar_path.name}: root is not an object")
            failures += sidecar_path.name in accepted
            continue

        binary_path = sidecar_path.with_suffix(".lump")
        verified = binary_path.is_file()
        binary_hash = None
        binary_raw = None
        canonical_identity = None
        intrinsics = None
        if verified:
            try:
                binary_raw, binary_hash, intrinsics = _binary_intrinsics(binary_path)
            except ValueError:
                verified = False
        parsed = parse_canonical_filename(binary_path.name) if verified else None
        if parsed:
            dot_name, issue_n, number = parsed
            verified = compute_number(dot_name, binary_raw) == number
            canonical_identity = {
                "dot_name": dot_name, "issue_n": issue_n,
                "identity_hash": hashlib.sha256(
                    f"{dot_name}#{issue_n}".encode("utf-8")).hexdigest(),
            }
        else:
            verified = False
        token = str(sidecar.get("token", "")).lower()
        if token and canonical_identity:
            verified = verified and token == parsed[2]
        if "filename" in sidecar and sidecar["filename"] != binary_path.name:
            verified = False
        for identity_key in ("binary_hash", "dot_name", "issue_n", "issue_number",
                             "identity_hash"):
            if identity_key not in sidecar:
                continue
            derived = (binary_hash if identity_key == "binary_hash"
                       else canonical_identity.get(
                           "issue_n" if identity_key == "issue_number" else identity_key)
                       if canonical_identity else None)
            if sidecar[identity_key] != derived:
                verified = False
        candidates = {
            key: sidecar[key] for key in APPROVABLE_ANNOTATION_FIELDS if key in sidecar
        }
        if "petname" in candidates:
            candidates["pet_name"] = candidates.pop("petname")
        annotations = {}
        for legacy_key in ("mtbf_notes", "tags"):
            if legacy_key in candidates:
                annotations[legacy_key] = candidates.pop(legacy_key)
        if annotations:
            candidates["annotations"] = annotations
        if "notes" in candidates:
            candidates["documentation"] = candidates.pop("notes")
        print(
            f"{'VERIFIED' if verified else 'UNVERIFIED'} {sidecar_path.name}: "
            f"token={token or '-'} sha256={binary_hash or '-'} "
            f"intrinsics={intrinsics or '-'} approvable={','.join(sorted(candidates)) or '-'}"
        )

        if sidecar_path.name not in accepted:
            continue
        if not verified:
            print(f"ERROR: refusing unverified accepted sidecar {sidecar_path.name}",
                  file=sys.stderr)
            failures += 1
            continue
        existing = approvals.get(binary_hash)
        record = dict(candidates)
        record["binary_hash"] = binary_hash
        record["filename"] = binary_path.name
        record.update(canonical_identity)
        if existing is not None and existing != record:
            print(
                f"ERROR: refusing {sidecar_path.name}; SHA-256 approval already differs",
                file=sys.stderr,
            )
            failures += 1
            continue
        approvals[binary_hash] = record
        changed |= existing != record
        print(f"ACCEPTED {sidecar_path.name}: annotations={','.join(sorted(candidates)) or '-'}")

    if failures:
        print("No approval changes written because one or more accepted files failed.",
              file=sys.stderr)
        return 1
    if args.write and changed:
        write_approvals(approvals_path, approvals)
        print(f"WROTE {approvals_path}")
    elif args.write:
        print("NO CHANGES")
    else:
        print("READ-ONLY AUDIT: use --write plus explicit --accept FILE.json after review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())