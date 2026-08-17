# Contributing to Church Machine

## Setting up local checks

After cloning the repository, install the pre-commit hook so the capabilities
check runs automatically before every commit:

```bash
npm run install-hooks
```

This copies `scripts/hooks/pre-commit` into `.git/hooks/` and makes it
executable.  You only need to do this once per local clone.

## Capabilities block check

Every `.cloomc` file that references another abstraction by name (using
dot-notation `CALL Name.method`, `ELOADCALL CRd, Name, method`, or a plain
`LOAD CRn, Name`) must declare a `capabilities { }` block listing every
referenced name and its required permissions.

**Run the check manually at any time:**

```bash
npm run check:capabilities
```

**What the pre-commit hook does:**

When you `git commit` and one or more `.cloomc` files are staged, the hook runs
the capabilities scan across the whole repo tree.  If any file is missing its
capabilities block the commit is rejected with a short explanation.  Fix the
flagged file(s), re-stage, and commit again.

**Bypassing the hook (not recommended):**

```bash
git commit --no-verify
```

Only use this if you are certain the violation is intentional (e.g. a test
fixture that is itself testing the error path).

## Renaming a .lump file

When you rename a `.lump` file in `server/lumps/`, you **must** also update
`server/lumps/manifest.json` in the same commit.  The pre-commit hook enforces
this automatically:

1. If you stage a renamed `.lump` that still carries a valid LUMP header, the
   hook checks whether `manifest.json` (staged version) has a matching `filename`
   or `token` entry.
2. If no matching entry is found, the commit is blocked with a message listing
   the offending file(s).

**Fix:** update the `filename` field (or add a new entry) in `manifest.json`,
re-stage the manifest, and commit again.

**Run the check manually at any time:**

```bash
python3 scripts/check_staged_lumps.py
```

Note: `check_staged_lumps.py` inspects the git *index* (staged files), so it
must be run from inside the repository.  To audit already-committed lumps use
the R25 pytest rule instead:

```bash
python -m pytest tests/lump/test_lump_consistency.py -v -k R25
```

## Other local checks

| Command | What it checks |
|---|---|
| `npm test` | Assembler tests + capabilities scan |
| `npm run check:selftest-lump` | Selftest LUMP freshness |
| `node scripts/sync-canonical-examples.js --check` | Inline examples match `simulator/examples/` |
| `python -m pytest tests/lump/test_lump_consistency.py -v` | LUMP metadata consistency (R1–R25) |
| `python3 scripts/check_staged_lumps.py` | Staged .lump renames reflected in manifest.json |
