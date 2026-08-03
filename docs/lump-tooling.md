# LUMP Developer Tooling

Reference guide for the scripts used to rebuild and validate `.lump` binaries
and keep inline assembly examples in sync with their canonical source files.
See `replit.md` § "LUMP Metadata Integrity" for the underlying data model and
change-control rules these tools enforce.

## One-Command LUMP Rebuild (update-lump)

Changing a LUMP requires assembling the `.cloomc` source, writing the binary, updating the sidecar JSON, and patching `manifest.json` — all in one commit or the 11-rule consistency gate rejects the merge. `update-lump.js` wraps the entire sequence into a single command.

### Usage

```bash
node scripts/update-lump.js --token <hex>           # rebuild lump
node scripts/update-lump.js --token <hex> --check   # drift check (no writes)
make update-lump TOKEN=<hex>                         # via Makefile shorthand
```

On success: prints `Updated <token>: cw=N cc=N lump_size=N` and exits 0.
On failure: exits non-zero with a clear message; all files are left unchanged.

### What it does

1. Looks up `<token>` in `server/lumps/manifest.json`
2. Finds the `.cloomc` source (see "Source discovery" below)
3. Assembles the source with `ChurchAssembler`
4. Reads the existing `.lump` binary to extract and preserve the c-list GT words
5. Packs the new binary: header + new code words + zero pad + preserved c-list
6. Writes the `.lump` binary, updates the sidecar JSON (`cw`/`cc`/`lump_size` only),
   and patches the matching `manifest.json` entry

### --check mode

Assembles the source and compares the result against the current binary on disk. Exits 0 if identical, exits 1 with a `DRIFT` message if different. Makes no writes. Useful for CI drift detection.

### Source discovery

The script searches for the `.cloomc` source in this order:

1. The manifest entry's `"source"` field (explicit path relative to repo root)
2. `simulator/examples/<token>.cloomc`
3. `simulator/examples/<normalised-abstraction>.cloomc`
4. `server/lumps/<token>.cloomc`

Lumps with no discoverable `.cloomc` source (binary-only data lumps, hardware-compiled binaries) are out of scope. To add source support, set `"source": "relative/path/to/file.cloomc"` in the manifest entry.

### Lumps with known sources

| Token | Abstraction | Source |
|---|---|---|
| `2570eade` | PostFlashSelftest | `simulator/examples/post_flash_selftest.cloomc` |
| `b3076308` | EventRouter | `simulator/cloomc/EventRouter.cloomc` |
| `13ade9a4` | LedControl | `simulator/examples/led_control.cloomc` |
| `00000a00` | CapabilityTest | `simulator/examples/capability_test.cloomc` |
| `0baf5e0e` | NoteGPublishedBug | `simulator/examples/ada_note_g_published_bug.cloomc` |
| `4ea370af` | NoteGAssembly | `simulator/examples/ada_note_g.cloomc` |

### After rebuilding

Always run the consistency gate to confirm the output is gate-clean:

```bash
python -m pytest tests/lump/test_lump_consistency.py -v
```

Or run the lump group in one step:

```bash
./scripts/run-all-tests.sh --group lump
```

### Relevant files

- `scripts/update-lump.js` — the rebuild script
- `scripts/test_update_lump.js` — 11 tests covering error cases, check mode, and update round-trip
- `server/lumps/manifest.json` — add `"source"` field to enable a lump for rebuild
- `tests/lump/test_lump_consistency.py` — 11-rule gate (must pass after every rebuild)

## Keeping Canonical Examples in Sync (Task #1238)

The inline assembly examples embedded in `simulator/app-run.js` must stay identical to the canonical source files in `simulator/examples/*.cloomc`. The assembler test suite enforces this at test time, but the sync script lets you repair drift immediately when you edit an inline example.

### When to run it

Run the sync script any time you edit an inline example string in `simulator/app-run.js`:

```bash
node scripts/sync-canonical-examples.js
```

This reads every inline example, compares it to the corresponding `simulator/examples/<key>.cloomc` file, and overwrites any file that differs. It exits 0 on success.

### CI guard mode

To check for drift without writing any files (useful in pre-commit hooks or CI):

```bash
node scripts/sync-canonical-examples.js --check
```

Exits non-zero and lists drifted files if any canonical file is out of date.

### Excluded key: `led_dr_test`

`led_dr_test` is a variable reference in `app-run.js` (not a backtick literal), so it cannot be extracted by the sync script:

```javascript
'led_dr_test': _TURING_DR_TEST_SOURCE,
```

Its source (`_TURING_DR_TEST_SOURCE`) is a standalone backtick literal verified separately by EX14–EX15 in `simulator/assembler_test.js`. `led_control` is now a plain backtick literal and is fully synced by the script.

### Relevant files

- `scripts/sync-canonical-examples.js` — the sync script
- `simulator/app-run.js` — source of inline example strings
- `simulator/examples/*.cloomc` — canonical files kept in sync
- `simulator/assembler_test.js` — inline-vs-canonical test suite (EX-*-INLINE tests)
