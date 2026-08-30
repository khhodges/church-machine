# namespace-json — NS Table Metadata Formats

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

The Church Machine IDE uses JSON for all namespace table import, export, and localStorage persistence. There are four distinct formats depending on context. All share a common **entry object** shape produced by `readNSEntry`.

---

## Common: the `entry` object

Every format embeds or references the **entry object**, which is the decoded in-memory representation of one four-word NS table slot.

```json
{
  "word0_location": 6144,
  "word1_limit": 134250558,
  "word2_seals": 738247681,
  "gBit": 0,
  "gtType": 1,
  "clistCount": 4,
  "chainable": false,
  "label": "Navana"
}
```

| Field           | Type    | Source in slot | Description |
|-----------------|---------|----------------|-------------|
| `word0_location`| number  | Word 0, all 32 bits | Raw base address of the memory object. Matches `location` in the abstraction definition. |
| `word1_limit`   | number  | Word 1, raw packed | Full 32-bit packed flags word. Decode with `parseNSWord1` to get the fields below. |
| `word2_seals`   | number  | Word 2, raw packed | Deprecated field name for the full 32-bit `integrity32(word0_location, word1_limit)` value. It contains no version subfield and is not a cryptographic seal. |
| `gBit`          | 0 or 1  | Word 1 [30]    | GC mark bit. Masked from `integrity32`. |
| `gtType`        | 0–3     | UI/catalog metadata | Entry type is obtained from catalog/LUMP context; it is not encoded in NS W1. GT words encode type at bits [26:25]. |
| `clistCount`    | number  | LUMP header/UI metadata | C-list count comes from the LUMP header, not NS W1. |
| `chainable`     | boolean | Compatibility/UI metadata | Not a canonical NS W1 bit. |
| `label`         | string  | `sim.nsLabels` | Human-readable name. Stored separately from the three-word slot; not encoded in the hardware words. |

> **Note:** The `b` (Bind), `f` (Far), and `limit` fields are not surfaced directly in the entry object. To read them, pass `word1_limit` through `parseNSWord1`, which returns `{ b, f, g, chainable, gtType, clistCount, limit }`.

---

## Format 1 — Single entry export

Produced by the **Export** button on each NS table row. Saved as `<label>.json`.

```json
{
  "label": "Navana",
  "index": 5,
  "location": "0x00001800",
  "gt": "0x50C00005",
  "gtType": "Inform",
  "codeLength": 12,
  "permissions": {
    "R": 0, "W": 0, "X": 0, "L": 0, "S": 0, "E": 1
  },
  "code": [
    "0x12345678",
    "0xABCD1234"
  ],
  "entry": { ... }
}
```

| Field         | Type     | Description |
|---------------|----------|-------------|
| `label`       | string   | Human-readable name from `sim.nsLabels`. |
| `index`       | number   | NS slot index (0–255). |
| `location`    | string   | Hex base address of the memory object (e.g. `"0x00001800"`). |
| `gt`          | string   | 32-bit GT word for this entry as an uppercase hex string. |
| `gtType`      | string   | Type name: `"NULL"`, `"Inform"`, `"Outform"`, or `"Abstract"`. |
| `codeLength`  | number   | Number of code words at the entry's memory region. |
| `permissions` | object   | Six permission bits from the GT: `R`, `W`, `X`, `L`, `S`, `E` — each `0` or `1`. |
| `code`        | string[] | Instruction words as zero-padded lowercase hex strings (`"0x12345678"`). |
| `entry`       | object   | Raw `readNSEntry` result (see common entry object above). |

### What import does with this format

When imported via the **Import** button on a specific row (targeting slot `idx`):
- Reads `code` (or `words`) and calls `setEntryMemory(idx, words)`
- Updates `sim.nsLabels[idx]` if `label` is present
- The three-word NS slot itself is NOT rewritten — only the backing memory is updated

---

## Format 2 — Full namespace export (`church_namespace.json`)

Produced by the **Export All** button. Contains every currently-allocated NS slot.

```json
{
  "namespace": [
    {
      "index": 0,
      "label": "Boot.NS",
      "gt": "0x00000000",
      "codeLength": 0,
      "code": [],
      "entry": {
        "word0_location": 64512,
        "word1_limit": 0,
        "word2_seals": 0,
        "gBit": 0,
        "gtType": 0,
        "clistCount": 0,
        "chainable": false,
        "label": "Boot.NS"
      }
    },
    {
      "index": 5,
      "label": "Navana",
      "gt": "0x50C00005",
      "codeLength": 12,
      "code": ["0x12345678", "0xABCD1234"],
      "entry": { ... }
    }
  ]
}
```

Top-level wrapper:

| Field       | Type    | Description |
|-------------|---------|-------------|
| `namespace` | array   | Ordered list of entry objects, one per populated NS slot. Null/empty slots are omitted. |

Each item in `namespace`:

| Field        | Type     | Description |
|--------------|----------|-------------|
| `index`      | number   | NS slot index. |
| `label`      | string   | Human-readable label. |
| `gt`         | string   | 32-bit GT word as hex string. `"0x00000000"` for empty/no-GT entries. |
| `codeLength` | number   | Word count of the backing memory region. |
| `code`       | string[] | All words in the backing region as hex strings. |
| `entry`      | object   | Raw `readNSEntry` result (see common entry object above). |

### What import does with this format

When imported via **Import All** (file has a `namespace` array at the top level):
- For each item with a non-empty `code`/`words` array:
  - Uses `item.index` if present, otherwise appends at `sim.nsCount`
  - Derives `location = index * SLOT_SIZE`
  - Writes NS entry via `writeNSEntry(idx, loc, lim17, 0, 0, 0, chainable, gtType, 0)`
  - Copies code words into memory starting at `location`
  - Sets `sim.nsLabels[idx]` from `item.label` or `item.entry.label`
- Note: the `b` and `f` flags are **not** restored from this format — they are written as `0`

---

## Format 3 — Single label import

A lightweight format for importing a single entry without a pre-existing slot target. Detected by the presence of `label` at the top level without a `namespace` wrapper.

```json
{
  "label": "MyKernel",
  "code": [268959744, "0x10120002", 536936448],
  "entry": {
    "gtType": 1,
    "chainable": false
  }
}
```

| Field     | Type            | Required | Description |
|-----------|-----------------|----------|-------------|
| `label`   | string          | **yes**  | Entry name. Stored in `sim.nsLabels`. Presence of this field at the top level triggers this import path. |
| `code`    | (number\|string)[] | no   | Instruction words. Accepts decimal integers or hex strings. Also accepted as `words`. |
| `entry`   | object          | no       | Optional metadata. Only `gtType` (0–3) and `chainable` (boolean) are read. All other fields are ignored. |

### What import does with this format

- Allocates the first free user slot at or above slot 11
- Derives the physical location from the shared user-slot mapping
- Writes NS entry via `writeNSEntry(idx, loc, lim17, 0, 0, 0, chainable, gtType, 0)`
- Copies code words into memory starting at `location`
- Sets label

---

## Retired browser snapshot

Older IDE versions stored a full Namespace snapshot under the
`church_namespace` localStorage key. The IDE now deletes that key at startup
without parsing or restoring it. Occupied slots, labels, and LUMP memory come
only from the committed Namespace/boot image; browser state is not authoritative.

```json
localStorage.removeItem("church_namespace")
```

## Summary: which fields survive each round-trip

| Field             | Single export | Full export | Label import |
|-------------------|:---:|:---:|:---:|
| `word0_location`  | ✓ (in `entry`) | ✓ (in `entry`) | derived |
| `word1_limit` (raw) | ✓ (in `entry`) | ✓ (in `entry`) | derived |
| `word2_seals` (raw) | ✓ (in `entry`) | ✓ (in `entry`) | recomputed |
| B flag (bind)     | ✗ (entry has raw w1) | ✗ | ✗ |
| F flag (far)      | ✗ | ✗ | ✗ |
| G bit (GC)        | ✓ (`gBit`) | ✓ | ✗ |
| `gtType`          | ✓ (string + in entry) | ✓ | ✓ (0–3) |
| `clistCount`      | ✓ (in `entry`) | ✓ | ✗ |
| `chainable`       | ✓ (in `entry`) | ✓ | ✓ |
| `label`           | ✓ | ✓ | ✓ |
| sequence/version  | ✓ (decode `word1_limit[29:21]`) | ✓ | recomputed (0) |
| `integrity32`     | ✓ (`word2_seals`, deprecated name) | ✓ | recomputed |
| code words        | ✓ | ✓ | ✓ |
| GT word           | ✓ (`gt` field) | ✓ | ✗ |
| permissions       | ✓ (decoded from GT) | ✗ | ✗ |

> ✓ = preserved  ✗ = lost or recomputed during round-trip

The retired browser payload is intentionally excluded: it is deleted, not
restored. Canonical boot-image persistence is the authority for a running
Namespace.

---

## Accepted code word formats

All formats accept code words in either form:

```json
"code": [268959744, "0x10120002", 536936448]
```

- **Decimal integer** — used as-is after `>>> 0` (unsigned 32-bit)
- **Hex string** — parsed with `parseInt(w, 16) >>> 0`; leading `0x` is optional but conventional

Both forms may be mixed in the same array.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
