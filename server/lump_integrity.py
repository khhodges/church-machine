"""lump_integrity — canonical lump filename integrity and naming helpers.

This module is intentionally kept import-safe: no Flask, no SQLAlchemy, no
application-startup side-effects.  Import it freely from tests, scripts, or
server code.

Canonical filename format: {Dot.Name}.{issue_n}.{Number}.lump
  Dot.Name  — manifest dot_name field (e.g. "SelfTest", "Scheduler.IRQ")
  issue_n   — manifest issue_n field (positive integer, "1" for all initial entries)
  Number    — sha256(dot_name_utf8 + lump_bytes)[:8] (lowercase hex)

The Number embeds both the lump content AND its identity (dot_name) so identical
code compiled under two different names produces different Numbers.
"""

import hashlib
import json
import os
import re

# ── Token-format constants ──────────────────────────────────────────────────
# A cache/index token T is a 32-bit value rendered as exactly 8 lowercase hex.
# An Outform IDE token is a 96-bit value rendered as exactly 24 lowercase hex.
# Per the Words1-3 Outform protocol, the 32-bit cache/index T lives in W3 —
# the FINAL 32 bits (final 8 hex) of the 24-hex token.  Any other length is
# rejected outright (fail-closed): we never guess a token by truncation.
_HEX8_RE  = re.compile(r'^[0-9a-f]{8}$')
_HEX24_RE = re.compile(r'^[0-9a-f]{24}$')


class LumpTokenError(ValueError):
    """Raised when a /api/lump/<token> token is not exactly 8 or 24 hex."""


def normalize_lump_token(token_hex):
    """Validate a /api/lump/<token> token and return its 32-bit cache index T.

    Contract (fail-closed):
      * Input is lower-cased before validation.
      * Exactly 8 hex  → 32-bit cache/index token; T = the 8 hex, key8 = itself.
      * Exactly 24 hex → 96-bit Outform IDE token; T (the 32-bit cache/index)
        is the FINAL 8 hex chars, because the Words1-3 protocol carries T in W3.
      * Any other length or non-hex character raises LumpTokenError.

    Returns a dict:
      { "raw": <lowercased input>,
        "kind": "cache" | "outform",
        "key8": <8-hex cache/index token, lowercase>,
        "ide_token": <24-hex token or None> }

    This deliberately does NOT left-pad, strip, or truncate arbitrary lengths;
    a malformed token is a hard error, never a silent lookup miss.
    """
    if not isinstance(token_hex, str):
        raise LumpTokenError("token must be a string")
    raw = token_hex.strip().lower()
    if _HEX8_RE.match(raw):
        return {"raw": raw, "kind": "cache", "key8": raw, "ide_token": None}
    if _HEX24_RE.match(raw):
        # W3 = final 32 bits = final 8 hex chars = the cache/index token T.
        return {"raw": raw, "kind": "outform", "key8": raw[-8:], "ide_token": raw}
    raise LumpTokenError(
        f"Invalid lump token {token_hex!r}: expected exactly 8 hex (32-bit "
        "cache/index) or 24 hex (96-bit Outform IDE token), got "
        f"{len(raw)} char(s)."
    )

def to_dot_name(abstraction_name: str) -> str:
    """Convert an abstraction name to canonical dot-notation.

    Rules (applied in order):
      1. Strip leading "Abstraction:" prefix (with optional extra spaces)
      2. Replace " (" with "."  ("SlideRule (Haskell)" → "SlideRule.Haskell")
      3. Remove remaining ")"
      4. Replace underscores with dots  ("Human_Hand" → "Human.Hand")
      5. Replace spaces with dots
      6. Collapse runs of dots to a single dot
      7. Strip leading/trailing dots

    This is the canonical inverse of the human-readable abstraction name;
    it must be kept in sync with scripts/migrate_lump_names.py::to_dot_name.
    """
    name = abstraction_name.strip()
    name = re.sub(r'^Abstraction\s*:\s*', '', name).strip()
    name = re.sub(r'\s*\(', '.', name)
    name = name.replace(')', '')
    name = name.replace('_', '.')
    name = name.replace(' ', '.')
    name = re.sub(r'\.{2,}', '.', name)
    name = name.strip('.')
    return name


_CANONICAL_RE = re.compile(
    r'^(.+)\.(\d+)\.([0-9a-f]{8})\.lump$',
    re.IGNORECASE,
)


def compute_number(dot_name: str, lump_bytes: bytes) -> str:
    """Return sha256(dot_name_utf8 + lump_bytes)[:8] (lowercase hex)."""
    h = hashlib.sha256()
    h.update(dot_name.encode('utf-8'))
    h.update(lump_bytes)
    return h.hexdigest()[:8]


def parse_canonical_filename(filename: str):
    """Parse a canonical lump filename.

    Returns (dot_name_prefix, issue_n, number) on success, or None if the
    filename is not in canonical format.

    The dot_name_prefix is the literal text from the filename (before
    the .{n}.{hex}.lump suffix); callers should compare it to the manifest
    dot_name field.
    """
    m = _CANONICAL_RE.match(filename)
    if not m:
        return None
    return m.group(1), int(m.group(2)), m.group(3).lower()


def check_lump_canonical_integrity(lumps_dir: str, key8: str, lump_raw: bytes):
    """Validate filename-embedded Number for a canonical-format lump entry.

    Canonical format: {Dot.Name}.{issue_n}.{8hex}.lump
    Number = sha256(dot_name_utf8 + lump_bytes)[:8]

    Checks (in order) for entries with a dot_name field:
      1. filename field is present
      2. filename matches canonical pattern
      3. filename name-segment equals manifest dot_name
      4. filename issue-segment equals manifest issue_n (when issue_n present)
      5. recomputed Number equals filename Number segment

    Returns:
      None  — entry has no dot_name (legacy lump); validation not applicable.
      True  — all checks pass; integrity confirmed.
      str   — error message; caller MUST treat as an integrity failure (HTTP 409).
                Triggered by: manifest unreadable, any of the five checks above,
                or token not having a dot_name entry but manifest is malformed.

    This function deliberately avoids broad exception swallowing.
    Every pathway that prevents validation of a dot_name entry returns an
    error string; only legacy entries (no dot_name) return None.
    """
    mf_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        with open(mf_path) as fh:
            mf_data = json.load(fh)
    except FileNotFoundError:
        return (
            f"Integrity check failed: manifest.json not found at {mf_path}. "
            "Cannot validate lump filename integrity."
        )
    except ValueError as exc:
        return (
            f"Integrity check failed: manifest.json is malformed ({exc}). "
            "Cannot validate lump filename integrity."
        )

    for me in mf_data:
        if me.get('token') != key8:
            continue

        dot_name = me.get('dot_name', '')
        if not dot_name:
            return None  # Legacy lump — no canonical validation required

        filename = me.get('filename', '')
        if not filename:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"has dot_name={dot_name!r} but no filename field. "
                "Run scripts/migrate_lump_names.py to restore the canonical filename."
            )

        parsed = parse_canonical_filename(filename)
        if parsed is None:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"has dot_name={dot_name!r} but filename {filename!r} is not in "
                "canonical Dot.Name.n.Number.lump format. "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )

        fn_prefix, fn_issue, fn_number = parsed

        # Verify name segment matches dot_name exactly
        if fn_prefix != dot_name:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"filename {filename!r} name segment {fn_prefix!r} does not match "
                f"manifest dot_name={dot_name!r}. "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )

        # Verify issue_n is present, positive, and matches the filename segment.
        # issue_n is REQUIRED for every dot_name entry; its absence is an
        # invariant violation (run migrate_lump_names.py to repair).
        issue_n_raw = me.get('issue_n')
        if issue_n_raw is None:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"has dot_name={dot_name!r} but no issue_n field. "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )
        try:
            issue_n_int = int(issue_n_raw)
            if issue_n_int <= 0:
                raise ValueError("non-positive")
        except (ValueError, TypeError):
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"has invalid issue_n={issue_n_raw!r} (must be a positive integer). "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )
        if fn_issue != issue_n_int:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"filename {filename!r} issue segment {fn_issue} does not match "
                f"manifest issue_n={issue_n_int}. "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )

        # Verify content hash
        actual_number = compute_number(dot_name, lump_raw)
        if actual_number != fn_number:
            return (
                f"Filename integrity failure for {filename} (token {key8}): "
                f"expected Number={fn_number}, "
                f"recomputed sha256({dot_name!r} + {len(lump_raw)}b)[:8]={actual_number}. "
                "The file was renamed without updating its content or its content was "
                "replaced without renaming. Re-run scripts/migrate_lump_names.py to fix."
            )

        return True  # All checks passed

    return None  # Token not in manifest; validation not applicable


# ── Task 2862 — fail-closed canonical resolver ──────────────────────────────
#
# resolve_canonical_lump() is the single authoritative contract that GET
# /api/lump/<token> uses to decide whether it may serve bytes, and — when it
# may — what canonical identity headers to bind onto the response.
#
# Trust model (no crypto, no secrets): the trust source is TLS + server trust
# plus the pre-registered full identity carried in the manifest and sidecar.
# The resolver's job is to prove that the bytes about to be served match the
# ONE canonical manifest record for the requested token, and to reject anything
# ambiguous, mismatched, or tampered.  It NEVER mutates or backfills metadata.
#
# Return values:
#   * A CanonicalResolution (dict) with ok=True and trusted=True/False.
#   * A CanonicalResolution with ok=False and an "error" string → HTTP 409.
# Legacy 8-hex entries with no trustworthy canonical metadata resolve with
# ok=True, trusted=False so the secure simulator promotion path can reject
# them, while the raw byte delivery path may still serve them.


def _load_manifest(lumps_dir):
    """Return (records, error).  records is a list; error is a string or None."""
    mf_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        with open(mf_path) as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return None, (
            f"Integrity check failed: manifest.json not found at {mf_path}. "
            "Cannot validate lump identity."
        )
    except ValueError as exc:
        return None, (
            f"Integrity check failed: manifest.json is malformed ({exc}). "
            "Cannot validate lump identity."
        )
    if not isinstance(data, list):
        return None, (
            "Integrity check failed: manifest.json is not a JSON array. "
            "Cannot validate lump identity."
        )
    return data, None


def _load_sidecar(lumps_dir, entry):
    """Load the sidecar dict for a manifest entry, or (None, error).

    Returns (sidecar_dict, None) on success, (None, None) when no sidecar is
    referenced, or (None, error_string) when the referenced sidecar is missing
    or malformed (fail-closed for canonical entries).
    """
    sc_name = entry.get('sidecar_file') or entry.get('filename', '').replace('.lump', '.json')
    if not sc_name:
        return None, None
    sc_path = os.path.join(lumps_dir, sc_name)
    if not os.path.exists(sc_path):
        return None, None  # sidecar optional; absence handled by caller
    try:
        with open(sc_path) as fh:
            sc = json.load(fh)
    except ValueError as exc:
        return None, (
            f"Integrity invariant violated: sidecar {sc_name!r} is malformed "
            f"({exc}). Cannot validate lump identity."
        )
    if not isinstance(sc, dict):
        return None, (
            f"Integrity invariant violated: sidecar {sc_name!r} is not a JSON "
            "object. Cannot validate lump identity."
        )
    return sc, None


def resolve_canonical_lump(lumps_dir, key8, lump_raw):
    """Fail-closed canonical resolution for GET /api/lump/<token>.

    Arguments:
      lumps_dir  — directory holding manifest.json + *.lump + *.json sidecars.
      key8       — the 8-hex (32-bit) cache/index token (already normalized).
      lump_raw   — the raw lump bytes about to be served (no CRC prefix).

    Returns a resolution dict:
      { "ok": bool,
        "trusted": bool,                # True only for verified canonical entries
        "error": str | None,            # set when ok is False
        "dot_name": str | None,
        "issue_n": int | None,
        "identity_hash": str | None,
        "binary_hash": str,             # always the sha256 of lump_raw served
        "cache_token": str,             # key8
        "reason": str }                 # human-readable classification

    Rules:
      1. Token format must already be an 8-hex cache index (caller normalizes).
      2. There must be EXACTLY ONE manifest record for a canonical (dot_name)
         token.  Zero canonical records with the token → legacy/unknown path.
         More than one → ambiguous collision → fail-closed (ok=False).
      3. For the canonical record we cross-check, in order: canonical filename
         format, filename↔dot_name, positive issue_n, filename↔issue_n,
          filename Number (identity+content hash), cache T↔Number, full
          binary_hash and full
         identity_hash consistency across manifest/sidecar.  Any mismatch
         → ok=False.
      4. A canonical filename without a complete trusted identity record is
         served only as untrusted.  Legacy 8-hex entries likewise resolve
         ok=True, trusted=False so secure promotion rejects them.
    """
    served_binary_hash = hashlib.sha256(lump_raw).hexdigest()
    key8 = (key8 or '').lower()

    base = {
        "ok": True,
        "trusted": False,
        "identity_verified": False,
        "error": None,
        "dot_name": None,
        "issue_n": None,
        "identity_hash": None,
        "binary_hash": served_binary_hash,
        "cache_token": key8,
        "reason": "",
    }

    if not _HEX8_RE.match(key8):
        base["ok"] = False
        base["error"] = (
            f"Integrity check failed: cache token {key8!r} is not 8 hex chars."
        )
        base["reason"] = "bad-cache-token"
        return base

    records, mf_err = _load_manifest(lumps_dir)
    if mf_err is not None:
        base["ok"] = False
        base["error"] = mf_err
        base["reason"] = "manifest-unreadable"
        return base

    # Partition manifest records that claim this cache token.
    token_records = [r for r in records
                     if isinstance(r, dict) and str(r.get('token', '')).lower() == key8]
    canonical_records = [r for r in token_records if r.get('dot_name')]

    # Rule 2: ambiguous collision among CANONICAL records is fatal.
    if len(canonical_records) > 1:
        names = sorted({r.get('dot_name', '?') for r in canonical_records})
        base["ok"] = False
        base["error"] = (
            f"Ambiguous token collision: {len(canonical_records)} canonical "
            f"manifest records claim token {key8} ({', '.join(names)}). "
            "Refusing to serve — resolve the collision before retrying."
        )
        base["reason"] = "ambiguous-canonical-collision"
        return base

    if not canonical_records:
        # No canonical metadata.  Legacy / library / unknown → untrusted-but-ok.
        # If multiple *legacy* records exist we still cannot bind an identity,
        # but the raw path may serve them; the promotion path must reject.
        base["trusted"] = False
        base["reason"] = ("legacy-untrusted" if token_records
                          else "not-in-manifest-untrusted")
        return base

    entry = canonical_records[0]
    dot_name = entry.get('dot_name', '')
    filename = entry.get('filename', '')

    if not filename:
        base["ok"] = False
        base["error"] = (
            f"Integrity invariant violated: canonical entry for token {key8} "
            f"has dot_name={dot_name!r} but no filename field."
        )
        base["reason"] = "missing-filename"
        return base

    parsed = parse_canonical_filename(filename)
    if parsed is None:
        base["ok"] = False
        base["error"] = (
            f"Integrity invariant violated: canonical entry for token {key8} "
            f"filename {filename!r} is not in Dot.Name.n.Number.lump format."
        )
        base["reason"] = "non-canonical-filename"
        return base

    fn_prefix, fn_issue, fn_number = parsed

    if fn_prefix != dot_name:
        base["ok"] = False
        base["error"] = (
            f"Integrity invariant violated: token {key8} filename {filename!r} "
            f"name segment {fn_prefix!r} does not match dot_name={dot_name!r}."
        )
        base["reason"] = "filename-dotname-mismatch"
        return base

    issue_n_raw = entry.get('issue_n')
    if issue_n_raw is None:
        base["ok"] = False
        base["error"] = (
            f"Integrity invariant violated: canonical entry for token {key8} "
            f"(dot_name={dot_name!r}) has no issue_n field."
        )
        base["reason"] = "missing-issue-n"
        return base
    try:
        issue_n_int = int(issue_n_raw)
        if issue_n_int <= 0:
            raise ValueError("non-positive")
    except (ValueError, TypeError):
        base["ok"] = False
        base["error"] = (
            f"Integrity invariant violated: token {key8} has invalid "
            f"issue_n={issue_n_raw!r} (must be a positive integer)."
        )
        base["reason"] = "invalid-issue-n"
        return base

    if fn_issue != issue_n_int:
        base["ok"] = False
        base["error"] = (
            f"Integrity invariant violated: token {key8} filename {filename!r} "
            f"issue segment {fn_issue} does not match issue_n={issue_n_int}."
        )
        base["reason"] = "filename-issue-mismatch"
        return base

    # Content+identity hash embedded in the filename Number.
    actual_number = compute_number(dot_name, lump_raw)
    if actual_number != fn_number:
        base["ok"] = False
        base["error"] = (
            f"Filename integrity failure for {filename} (token {key8}): "
            f"expected Number={fn_number}, recomputed={actual_number}. "
            "The served bytes do not match the canonical filename."
        )
        base["reason"] = "number-mismatch"
        return base

    # The manifest token is historically also used as a boot/catalogue lookup
    # alias (for example, a slot-derived value).  Such aliases may remain
    # readable, but they are NOT the Golden Token cache value T and therefore
    # can never produce a trusted promotion response.  Canonical T is the
    # recomputed issue-blind filename Number.
    is_canonical_cache_token = (key8 == actual_number)
    base["cache_token"] = actual_number

    # Manifest + sidecar are the external identity record.  Either may carry a
    # value, but duplicate values must agree.  A secure/canonical binding
    # requires BOTH a full binary hash and a full issued-identity hash.
    sidecar, sc_err = _load_sidecar(lumps_dir, entry)
    if sc_err is not None:
        base["ok"] = False
        base["error"] = sc_err
        base["reason"] = "sidecar-unreadable"
        return base

    manifest_binary_hash = entry.get('binary_hash') or None
    manifest_identity_hash = entry.get('identity_hash') or None
    sidecar_binary_hash = None
    sidecar_identity_hash = None
    canonical_identity_string = f"{dot_name}#{issue_n_int}"

    if sidecar is not None:
        sidecar_binary_hash = sidecar.get('binary_hash') or None
        sidecar_identity_hash = sidecar.get('identity_hash') or None

        # Sidecar dot_name / issue_n must not contradict the manifest.
        sc_dot = sidecar.get('dot_name')
        if sc_dot and sc_dot != dot_name:
            base["ok"] = False
            base["error"] = (
                f"Sidecar dot_name {sc_dot!r} contradicts manifest "
                f"dot_name={dot_name!r} for token {key8}."
            )
            base["reason"] = "sidecar-dotname-mismatch"
            return base
        sc_issue = sidecar.get('issue_n')
        if sc_issue is not None:
            try:
                if int(sc_issue) != issue_n_int:
                    raise ValueError
            except (ValueError, TypeError):
                base["ok"] = False
                base["error"] = (
                    f"Sidecar issue_n {sc_issue!r} contradicts manifest "
                    f"issue_n={issue_n_int} for token {key8}."
                )
                base["reason"] = "sidecar-issue-mismatch"
                return base

        # The canonical issued identity is unambiguous UTF-8
        #   <dot_name>#<positive base-10 issue>
        # A sidecar that records the preimage must record exactly that value.
        id_string = sidecar.get('identity_string')
        if id_string and id_string != canonical_identity_string:
            base["ok"] = False
            base["error"] = (
                f"Identity string mismatch for token {key8}: sidecar "
                f"identity_string={id_string!r}, expected "
                f"{canonical_identity_string!r}."
            )
            base["reason"] = "identity-string-mismatch"
            return base

    if (manifest_binary_hash and sidecar_binary_hash
            and manifest_binary_hash != sidecar_binary_hash):
        base["ok"] = False
        base["error"] = (
            f"Binary hash metadata conflict for {filename} (token {key8}): "
            f"manifest={manifest_binary_hash}, sidecar={sidecar_binary_hash}."
        )
        base["reason"] = "binary-hash-metadata-conflict"
        return base

    binary_hash = manifest_binary_hash or sidecar_binary_hash
    if binary_hash is not None:
        if not re.fullmatch(r"[0-9a-f]{64}", str(binary_hash)):
            base["ok"] = False
            base["error"] = (
                f"Binary hash for {filename} (token {key8}) must be exactly "
                "64 lowercase hex characters."
            )
            base["reason"] = "invalid-binary-hash"
            return base
        if binary_hash != served_binary_hash:
            base["ok"] = False
            base["error"] = (
                f"Binary hash mismatch for {filename} (token {key8}): "
                f"metadata={binary_hash} but served sha256={served_binary_hash}."
            )
            base["reason"] = "binary-hash-mismatch"
            return base

    if (manifest_identity_hash and sidecar_identity_hash
            and manifest_identity_hash != sidecar_identity_hash):
        base["ok"] = False
        base["error"] = (
            f"Identity hash metadata conflict for {filename} (token {key8}): "
            f"manifest={manifest_identity_hash}, "
            f"sidecar={sidecar_identity_hash}."
        )
        base["reason"] = "identity-hash-metadata-conflict"
        return base

    identity_hash = manifest_identity_hash or sidecar_identity_hash
    expected_identity_hash = hashlib.sha256(
        canonical_identity_string.encode('utf-8')).hexdigest()
    if identity_hash is not None:
        if not re.fullmatch(r"[0-9a-f]{64}", str(identity_hash)):
            base["ok"] = False
            base["error"] = (
                f"Identity hash for {filename} (token {key8}) must be exactly "
                "64 lowercase hex characters."
            )
            base["reason"] = "invalid-identity-hash"
            return base
        if identity_hash != expected_identity_hash:
            base["ok"] = False
            base["error"] = (
                f"Identity hash mismatch for token {key8}: "
                f"sha256({canonical_identity_string!r})="
                f"{expected_identity_hash} but metadata={identity_hash}."
            )
            base["reason"] = "identity-hash-mismatch"
            return base

    # Complete metadata is required before the response may claim canonical
    # trust.  A partial historical record remains readable but can never drive
    # the Outform→Inform promotion path.
    if binary_hash is None or identity_hash is None:
        base["trusted"] = False
        base["dot_name"] = dot_name
        base["issue_n"] = issue_n_int
        base["identity_hash"] = identity_hash
        base["reason"] = "incomplete-identity-untrusted"
        return base

    # Full external identity and exact bytes are verified independently of the
    # lookup key.  A historical alias still cannot be used as W3 T, but boot
    # generation may bind this verified identity to the recomputed canonical T.
    base["identity_verified"] = True

    # A historical lookup alias may select these bytes, but cannot be promoted
    # as W3 T.  Emit the recomputed canonical T while explicitly classifying the
    # response untrusted; callers may still download/read legacy content.
    if not is_canonical_cache_token:
        base["trusted"] = False
        base["dot_name"] = dot_name
        base["issue_n"] = issue_n_int
        base["identity_hash"] = identity_hash
        base["reason"] = "lookup-alias-untrusted"
        return base

    # All canonical full-identity and cache-token cross-checks passed.
    base["trusted"] = True
    base["dot_name"] = dot_name
    base["issue_n"] = issue_n_int
    base["identity_hash"] = identity_hash
    base["reason"] = "canonical-verified"
    return base


def canonical_binding_headers(resolution):
    """Build the response headers that bind bytes to their canonical identity.

    Given a resolve_canonical_lump() result, return a dict of X-Lump-* headers.
    Trusted resolutions carry dot_name / issue_n / identity_hash / binary_hash /
    cache-token bindings and X-Lump-Trust: canonical.  Untrusted (legacy)
    resolutions carry only the binary_hash + cache-token binding and
    X-Lump-Trust: untrusted so the caller / promotion path can reject.
    """
    headers = {
        "X-Lump-Cache-Token": resolution.get("cache_token", ""),
        "X-Lump-Binary-Hash": f"sha256:{resolution.get('binary_hash', '')}",
    }
    if resolution.get("trusted"):
        headers["X-Lump-Trust"] = "canonical"
        if resolution.get("dot_name"):
            headers["X-Lump-Dot-Name"] = resolution["dot_name"]
        if resolution.get("issue_n") is not None:
            headers["X-Lump-Issue-N"] = str(resolution["issue_n"])
        if resolution.get("identity_hash"):
            headers["X-Lump-Identity-Hash"] = f"sha256:{resolution['identity_hash']}"
    else:
        headers["X-Lump-Trust"] = "untrusted"
    return headers
