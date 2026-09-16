# LUMP File Naming Convention

## Canonical filename format

```
{Dot.Name}.{#n}.{Number}.lump
```

### Fields

| Field      | Meaning | Example |
|------------|---------|---------|
| `Dot.Name` | Full hierarchical abstraction name in dot-notation | `SelfTest`, `Scheduler.IRQ`, `SlideRule.Haskell` |
| `#n`       | Issue number — `1` for all bootstrap lumps (sole author, no ownership transfer). Increments when a lump is transferred to a second owner. Present from day one so the format never needs to change; only the value grows. | `1` |
| `Number`   | First 8 hex digits of `sha256(dot_name_utf8 + lump_bytes)`. Name is included so identical code under different names produces different Numbers. Identical rebuilds of the same abstraction produce the same Number. | `f987cc01` |

### Example filenames

```
SelfTest.1.f987cc01.lump
Scheduler.IRQ.1.a3f20011.lump
SlideRule.Haskell.1.cb8a9d14.lump
WukongCallHome.1.04f2ee30.lump
```

---

## Dot.Name derivation rules

Applied to the `abstraction` field in `manifest.json`:

1. Strip leading `Abstraction:` prefix (with optional extra spaces)
2. Replace ` (` with `.`  → `SlideRule (Haskell)` becomes `SlideRule.Haskell`
3. Remove remaining `)`
4. Replace underscores with dots  → `Human_Hand` becomes `Human.Hand`
5. Replace spaces with dots
6. Collapse runs of dots to a single dot
7. Strip leading/trailing dots

The reference implementation is `to_dot_name()` in `scripts/migrate_lump_names.py`.

---

## Number derivation

```python
import hashlib

def compute_number(dot_name: str, lump_bytes: bytes) -> str:
    h = hashlib.sha256()
    h.update(dot_name.encode('utf-8'))
    h.update(lump_bytes)
    return h.hexdigest()[:8]
```

JavaScript equivalent:

```javascript
async function computeLumpNumber(dotName, lumpBytes) {
    const nameBytes = new TextEncoder().encode(dotName);
    const combined = new Uint8Array(nameBytes.length + lumpBytes.length);
    combined.set(nameBytes, 0);
    combined.set(lumpBytes, nameBytes.length);
    const digest = await crypto.subtle.digest('SHA-256', combined);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0,8);
}
```

---

## Loader contract

The loader **MUST** recompute `sha256(dot_name_utf8 + lump_bytes)[:8]` after opening
a canonical-format file and compare it against the Number in the filename.  A mismatch
means the file was renamed without updating its content (or vice versa) and is treated
as a content-integrity failure.

- Server returns **HTTP 409** with a clear error message when the check fails.
- No skip path exists — the loader never trusts the filename without recomputing.

---

## Migration window

During the transition from old naming schemes (`00000600.lump`, `a56597e9.lump`,
`SelfTest_v75.lump`) to the canonical format, old names are kept as symlinks pointing
to the new canonical file.  Once all references are updated and one full build cycle
confirms the new names resolve correctly, the symlinks may be removed.

---

## Issue number (`#n`)

`#n = 1` for all bootstrap lumps in the Church Machine IDE repository.  The field is
present from day one so the filename format is stable — a future ownership transfer
changes the value to `2` without changing the format.

---

## Manifest fields

Each entry in `manifest.json` gains two fields after migration:

| Field      | Type   | Value |
|------------|--------|-------|
| `dot_name` | string | Canonical dot-notation name (e.g. `"SelfTest"`) |
| `issue_n`  | int    | Issue number (1 for all current lumps) |
| `filename` | string | Canonical filename (e.g. `"SelfTest.1.f987cc01.lump"`) |

---

## Archive files

Files matching `{Name}_v{N}.lump` or `{token}-v{N}.lump` are archived versions of
earlier builds.  They are not renamed by the migration — only the current canonical
file for each manifest entry is renamed.  Archive files are kept for historical
reference and rollback.
