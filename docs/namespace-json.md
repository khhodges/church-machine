# namespace-json — NS Table Metadata Formats

The Church Machine IDE uses JSON for all namespace table import, export, and localStorage persistence. There are four distinct formats depending on context. All share a common **entry object** shape produced by `readNSEntry`.

---

## Common: the `entry` object

Every format embeds or references the **entry object**, which is the decoded in-memory representation of one three-word NS table slot.

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
| `word0_location`| number  | Word 0, all 32 bits | Raw base address of the memory object. Matches `location` in upload.json. |
| `word1_limit`   | number  | Word 1, raw packed | Full 32-bit packed flags word. Decode with `parseNSWord1` to get the fields below. |
| `word2_seals`   | number  | Word 2, raw packed | Full 32-bit version+seal word. `(word2_seals >>> 25) & 0x7F` = version; `word2_seals & 0x01FFFFFF` = FNV seal. |
| `gBit`          | 0 or 1  | Word 1 [29]    | GC mark bit. Set by the PP250 garbage collector during mark phase. Not meaningful to application code. |
| `gtType`        | 0–3     | Word 1 [27:26] | Entry type code: `0`=NULL, `1`=Inform, `2`=Outform, `3`=Abstract. |
| `clistCount`    | 0–511   | Word 1 [25:17] | Number of c-list GT slots at the top of the lump (9-bit field). `0` = data object; `>0` = abstraction lump. |
| `chainable`     | boolean | Word 1 [28]    | Whether the chain bit is set. Decoded from the raw `word1_limit`. |
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

- Allocates the next free slot at `sim.nsCount`
- Derives `location = index * SLOT_SIZE`
- Writes NS entry via `writeNSEntry(idx, loc, lim17, 0, 0, 0, chainable, gtType, 0)`
- Copies code words into memory starting at `location`
- Sets label

---

## Format 4 — localStorage persistence

Internal format used by `saveNamespaceState` / `loadNamespaceState`. Stored under the key `church_namespace` in `localStorage`. **Not intended for hand-authoring** — it is written and read automatically by the IDE.

```json
[
  {
    "nsWords": [64512, 0, 0],
    "label": "Boot.NS",
    "dataWords": []
  },
  null,
  {
    "nsWords": [6144, 134250558, 738247681],
    "label": "Navana",
    "dataWords": [1356218373, 268959744, 285736961]
  }
]
```

The outer array is indexed by NS slot. `null` means the slot was empty.

| Field       | Type     | Description |
|-------------|----------|-------------|
| `nsWords`   | number[3]| The three raw 32-bit hardware words of the slot: `[word0, word1, word2]`. Written directly into `sim.memory[NS_TABLE_BASE + idx * 3 + 0..2]`. |
| `label`     | string   | Human-readable name. Stored in `sim.nsLabels`. |
| `dataWords` | number[] | Contents of the backing memory region. The first word is the GT (`sim.memory[loc]`); subsequent words are code/data. Written starting at `word0_location` (decoded from `nsWords[0]`). |

### Load behaviour

- Slots that already pass `isNSEntryValid` are skipped (boot entries are not overwritten)
- If `nsWords` is present and has length 3, the three hardware words are written directly — this is the authoritative path
- If `nsWords` is absent but `entry` is present (legacy format), `writeNSEntry` is called using the parsed `entry` fields

---

## Summary: which fields survive each round-trip

| Field             | Single export | Full export | Label import | localStorage |
|-------------------|:---:|:---:|:---:|:---:|
| `word0_location`  | ✓ (in `entry`) | ✓ (in `entry`) | derived | ✓ (in `nsWords[0]`) |
| `word1_limit` (raw) | ✓ (in `entry`) | ✓ (in `entry`) | derived | ✓ (in `nsWords[1]`) |
| `word2_seals` (raw) | ✓ (in `entry`) | ✓ (in `entry`) | recomputed | ✓ (in `nsWords[2]`) |
| B flag (bind)     | ✗ (entry has raw w1) | ✗ | ✗ | ✓ (packed in `nsWords[1]`) |
| F flag (far)      | ✗ | ✗ | ✗ | ✓ (packed in `nsWords[1]`) |
| G bit (GC)        | ✓ (`gBit`) | ✓ | ✗ | ✓ |
| `gtType`          | ✓ (string + in entry) | ✓ | ✓ (0–3) | ✓ |
| `clistCount`      | ✓ (in `entry`) | ✓ | ✗ | ✓ |
| `chainable`       | ✓ (in `entry`) | ✓ | ✓ | ✓ |
| `label`           | ✓ | ✓ | ✓ | ✓ |
| version           | ✓ (decode `word2_seals`) | ✓ | recomputed (0) | ✓ |
| FNV seal          | ✓ (decode `word2_seals`) | ✓ | recomputed | ✓ |
| code words        | ✓ | ✓ | ✓ | ✓ (in `dataWords[1..]`) |
| GT word           | ✓ (`gt` field) | ✓ | ✗ | ✓ (`dataWords[0]`) |
| permissions       | ✓ (decoded from GT) | ✗ | ✗ | ✗ |

> ✓ = preserved  ✗ = lost or recomputed during round-trip

**Consequence:** Only localStorage preserves the complete slot state (all three hardware words and all data). The export/import formats are for code exchange and bootstrapping, not for perfect fidelity restoration of a running simulator state.

---

## Accepted code word formats

All formats accept code words in either form:

```json
"code": [268959744, "0x10120002", 536936448]
```

- **Decimal integer** — used as-is after `>>> 0` (unsigned 32-bit)
- **Hex string** — parsed with `parseInt(w, 16) >>> 0`; leading `0x` is optional but conventional

Both forms may be mixed in the same array.
