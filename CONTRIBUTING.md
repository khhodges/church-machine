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

## Other local checks

| Command | What it checks |
|---|---|
| `npm test` | Assembler tests + capabilities scan |
| `npm run check:selftest-lump` | Selftest LUMP freshness |
| `node scripts/sync-canonical-examples.js --check` | Inline examples match `simulator/examples/` |
| `python -m pytest tests/lump/test_lump_consistency.py -v` | LUMP metadata consistency (11 rules) |
