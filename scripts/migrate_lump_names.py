#!/usr/bin/env python3
"""Migrate LUMP files to the canonical Dot.Name.#n.Number naming convention.

Usage:
    python3 scripts/migrate_lump_names.py [--dry-run] [--lumps-dir PATH]

Convention: {Dot.Name}.{#n}.{Number}.lump
  Dot.Name  — abstraction name in dot-notation (spaces→dots, underscores→dots,
               "(X)"→".X", "Abstraction: X"→"X")
  #n        — issue number; 1 for all bootstrap lumps (grows when a lump is
               transferred to a second owner)
  Number    — first 8 hex digits of sha256(dot_name_utf8 + lump_bytes)
               name is included so identical code under different names differs;
               identical rebuilds of the same name produce the same Number

The loader MUST recompute sha256(dot_name + lump_bytes)[:8] after opening
the file and compare against the Number in the filename.  A mismatch is a
content-integrity failure (HTTP 409 from the server).

Migration steps (per manifest entry that has a resolvable lump file):
  1. Compute dot_name from the `abstraction` field
  2. Read lump bytes from the current file (prefers `filename` field, falls back
     to `{token}.lump`)
  3. Compute Number = sha256(dot_name_utf8 + lump_bytes)[:8]
  4. New canonical filename: {dot_name}.1.{number}.lump
  5. Rename the file (or copy if rename crosses filesystems)
  6. Create a symlink at the old name pointing to the new name (for backward
     compatibility during the transition window)
  7. Update manifest entry: add `dot_name`, `issue_n`, update `filename`

Dry-run mode (--dry-run) prints the plan without writing anything.
"""
import argparse
import hashlib
import json
import os
import re
import struct
import sys
import shutil


def to_dot_name(abstraction_name: str) -> str:
    """Convert an abstraction name to canonical dot-notation.

    Rules (applied in order):
      1. Strip leading "Abstraction:" prefix (with optional extra spaces)
      2. Replace " (" with "."  (captures "SlideRule (Haskell)" → "SlideRule.Haskell")
      3. Remove remaining ")"
      4. Replace underscores with dots  ("Human_Hand" → "Human.Hand")
      5. Replace spaces with dots
      6. Collapse runs of dots to a single dot
      7. Strip leading/trailing dots
    """
    name = abstraction_name.strip()
    # 1. Strip "Abstraction:  ..." prefix
    name = re.sub(r'^Abstraction\s*:\s*', '', name).strip()
    # 2. " (" → "."
    name = re.sub(r'\s*\(', '.', name)
    # 3. Remove ")"
    name = name.replace(')', '')
    # 4. Underscores → dots
    name = name.replace('_', '.')
    # 5. Spaces → dots
    name = name.replace(' ', '.')
    # 6. Collapse multiple dots
    name = re.sub(r'\.{2,}', '.', name)
    # 7. Strip leading/trailing dots
    name = name.strip('.')
    return name


def compute_number(dot_name: str, lump_bytes: bytes) -> str:
    """Compute the 8-hex-char Number field.

    Number = first 8 chars of sha256(dot_name_utf8 + lump_bytes).
    The dot_name is included so two abstractions with identical code but
    different names produce different Numbers.
    """
    h = hashlib.sha256()
    h.update(dot_name.encode('utf-8'))
    h.update(lump_bytes)
    return h.hexdigest()[:8]


def _safe_lumps_path(lumps_dir: str, filename: str) -> str:
    """Return the absolute path for `filename` inside `lumps_dir`.

    Raises ValueError if `filename` contains path separators or resolves
    outside `lumps_dir` (path traversal guard).
    """
    if not filename:
        raise ValueError("filename must not be empty")
    # Reject names with explicit path separators or parent-dir components
    basename = os.path.basename(filename)
    if basename != filename or '..' in filename.split(os.sep):
        raise ValueError(
            f"Filename {filename!r} contains path separators or traversal sequences. "
            "Only plain basenames are allowed in the lumps directory."
        )
    resolved = os.path.realpath(os.path.join(lumps_dir, basename))
    lumps_real = os.path.realpath(lumps_dir)
    if not resolved.startswith(lumps_real + os.sep) and resolved != lumps_real:
        raise ValueError(
            f"Filename {filename!r} resolves to {resolved!r} which is outside "
            f"lumps_dir {lumps_real!r}. Refusing to operate outside the lumps directory."
        )
    return resolved


def resolve_lump_path(lumps_dir: str, entry: dict) -> str | None:
    """Find the actual lump file path for a manifest entry.

    Prefers the `filename` field; falls back to `{token}.lump`.
    Returns None when no file is found.
    """
    filename = entry.get('filename', '')
    if filename:
        try:
            p = _safe_lumps_path(lumps_dir, filename)
        except ValueError:
            p = None
        if p and os.path.isfile(p):
            return p
    token = entry.get('token', '')
    if token:
        try:
            p = _safe_lumps_path(lumps_dir, f'{token}.lump')
        except ValueError:
            p = None
        if p and os.path.isfile(p):
            return p
    return None


def migrate(lumps_dir: str, dry_run: bool = False):
    manifest_path = os.path.join(lumps_dir, 'manifest.json')
    if not os.path.isfile(manifest_path):
        print(f'ERROR: manifest.json not found at {manifest_path}', file=sys.stderr)
        sys.exit(1)

    with open(manifest_path) as f:
        manifest = json.load(f)

    print(f'{"DRY RUN — " if dry_run else ""}Migrating {len(manifest)} manifest entries in {lumps_dir}')
    print()

    changed = 0
    skipped = 0
    already_ok = 0

    for i, entry in enumerate(manifest):
        abs_name = entry.get('abstraction', '')
        token = entry.get('token', '')

        dot_name = to_dot_name(abs_name)
        issue_n = entry.get('issue_n', 1)

        # Find current lump file
        lump_path = resolve_lump_path(lumps_dir, entry)
        if lump_path is None:
            print(f'  [{i:02d}] SKIP  {token:20s}  {abs_name!r}')
            print(f'         No lump file found (filename={entry.get("filename","")!r})')
            skipped += 1
            continue

        with open(lump_path, 'rb') as f:
            lump_bytes = f.read()

        number = compute_number(dot_name, lump_bytes)
        canonical_filename = f'{dot_name}.{issue_n}.{number}.lump'
        try:
            canonical_path = _safe_lumps_path(lumps_dir, canonical_filename)
        except ValueError as exc:
            print(f'  [{i:02d}] ERROR {token:20s}  {abs_name!r}')
            print(f'         Canonical filename rejected by containment guard: {exc}')
            skipped += 1
            continue

        old_basename = os.path.basename(lump_path)

        if old_basename == canonical_filename:
            print(f'  [{i:02d}] OK    {token:20s}  {canonical_filename}')
            # Still ensure manifest fields are set
            entry['dot_name'] = dot_name
            entry['issue_n'] = issue_n
            entry['filename'] = canonical_filename
            already_ok += 1
            continue

        print(f'  [{i:02d}] RENAME  {token:20s}')
        print(f'         dot_name  : {dot_name!r}')
        print(f'         old file  : {old_basename}')
        print(f'         new file  : {canonical_filename}')
        print(f'         number    : {number} (sha256({dot_name!r} + {len(lump_bytes)}b)[:8])')

        if not dry_run:
            # Rename to canonical name
            if lump_path != canonical_path:
                shutil.move(lump_path, canonical_path)
            # Create symlink from old name → canonical name (for transition window)
            old_symlink = os.path.join(lumps_dir, old_basename)
            if old_basename != canonical_filename and not os.path.exists(old_symlink):
                os.symlink(canonical_filename, old_symlink)
                print(f'         symlink   : {old_basename} → {canonical_filename}')

        # Update manifest fields
        entry['dot_name'] = dot_name
        entry['issue_n'] = issue_n
        entry['filename'] = canonical_filename
        changed += 1

    print()
    print(f'Results: {changed} renamed, {already_ok} already canonical, {skipped} skipped (no file)')

    if not dry_run and (changed > 0):
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=4)
        print(f'manifest.json updated.')
    elif dry_run:
        print('Dry run — no files or manifest changed.')

    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true',
                        help='Print the migration plan without making any changes')
    parser.add_argument('--lumps-dir', default=None,
                        help='Path to server/lumps/ directory (default: auto-detect)')
    args = parser.parse_args()

    if args.lumps_dir:
        lumps_dir = os.path.abspath(args.lumps_dir)
    else:
        # Auto-detect from script location
        script_dir = os.path.dirname(os.path.abspath(__file__))
        lumps_dir = os.path.join(script_dir, '..', 'server', 'lumps')
        lumps_dir = os.path.abspath(lumps_dir)

    migrate(lumps_dir, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
