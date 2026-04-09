# Abstraction Definition Format

The abstraction definition format is the JSON schema used to define a Church Machine abstraction and submit it to **Navana.Abstraction.Add**. It combines the compiled instruction words, the capability list, and optional documentation metadata into a single JSON object.

The CLOOMC++ compiler produces this format automatically. You can also write it by hand when building assembler programs directly.

> **Note:** This is the *informational* definition format — the human-readable source of truth for an abstraction. The physical deployment artefact produced from it is `lump.zip`. See [locator.md](locator.md) for how lump.zip archives are stored in the Lump Library and loaded on demand at runtime by the Locator.

---

## Top-level schema

```json
{
  "abstraction": "MyAbstraction",
  "type": "abstraction",
  "grants": ["E"],
  "methods": [ ... ],
  "capabilities": [ ... ],
  "doc": { ... }
}
```

| Field          | Type     | Required | Description |
|----------------|----------|----------|-------------|
| `abstraction`  | string   | **yes**  | Name of the abstraction. Used as the label in the NS table and displayed in the Abstractions view. Fault: `ARGS` if missing. |
| `type`         | string   | no       | Informational only. Always `"abstraction"`. Not validated by Navana. |
| `grants`       | string[] | no       | Documents the permissions the caller receives on the returned E-GT. Navana always forges the E-GT with `{E: 1}` regardless of this field; it is metadata for human readers. |
| `methods`      | object[] | no       | Ordered list of method objects (see below). An abstraction with no methods is valid — it allocates an empty lump. |
| `capabilities` | object[] | no       | Ordered list of capability objects (see below). The length of this array becomes `clistCount`. Maximum 511. Fault: `BOUNDS` if exceeded. |
| `doc`          | object   | no       | Optional documentation block (see below). Stored on the registry entry; shown in the Abstractions view. |

---

## Method objects

Each element of `methods` describes one callable entry point:

```json
{
  "name": "Apply",
  "code": [268959744, "0x10120002", 536936448],
  "params": ["x", "y"]
}
```

| Field    | Type            | Required | Description |
|----------|-----------------|----------|-------------|
| `name`   | string          | **yes**  | Method name. Used in the method dispatch table and registry. |
| `code`   | (number\|string)[] | **yes** | Instruction words for this method. Values may be decimal integers or hex strings (`"0x12345678"`). Both forms are accepted. |
| `params` | string[]        | no       | Parameter names for documentation. Not used at runtime. |

> **Note:** `params` is purely informational. The Church Machine passes arguments in Condition Registers — the ISA has no named parameters.

### Method table layout

Navana writes a **method table** at offset 0 of the lump before writing the code body. Each slot in the table is one word holding the word-offset (from lump base) of the corresponding method's first instruction:

```
offset 0          method table (one word per method)
offset M          code body (instructions, methods concatenated in order)
offset allocSize - clistCount    c-list (GTs for declared capabilities)
```

Where `M = methods.length`.

The table is set up automatically by Navana.Abstraction.Add — you do not include table words in `code`.

---

## Capability objects

Each element of `capabilities` declares a Golden Token that Navana will forge and place in the abstraction's c-list:

```json
{
  "target": 7,
  "name": "Memory",
  "grants": ["E"]
}
```

| Field    | Type     | Required | Description |
|----------|----------|----------|-------------|
| `target` | number   | **yes**  | NS slot index of the target abstraction. Navana reads the version from that slot to forge a correctly-versioned GT. If the target slot is empty at upload time the c-list word is left as zero (NULL GT). |
| `name`   | string   | no       | Human-readable name. Shown in the Abstractions view. Not stored in the NS table. |
| `grants` | string[] | no       | Permission bits to bake into the GT. Valid values: `"R"`, `"W"`, `"X"`, `"L"`, `"S"`, `"E"`. Default if omitted: `["E"]`. |

Permission meanings:

| Letter | Meaning |
|--------|---------|
| `R`    | Read (DREAD into the backing data object) |
| `W`    | Write (DWRITE into the backing data object) |
| `X`    | Execute (CALL into the abstraction) |
| `L`    | Load (mLoad — use GT as a capability handle) |
| `S`    | Save (mSave — store GT into another c-list slot) |
| `E`    | Enter (CALL — the standard callable permission) |

Capability GTs are stored in c-list order at the top of the lump:

```
c-list slot 0  →  capabilities[0] GT
c-list slot 1  →  capabilities[1] GT
...
c-list slot N  →  capabilities[N] GT
```

At runtime, CALL splits the lump and sets `CR6` to the c-list region (L-only). The abstraction accesses its capabilities by loading from `CR6` with an offset.

---

## Allocation and lump layout

Navana computes the lump layout deterministically from the upload fields. No size hints are needed.

```
methodTableSize = methods.length
totalCodeWords  = sum of method.code.length for all methods
codeSize        = methodTableSize + totalCodeWords
neededSize      = codeSize + capabilities.length
allocSize       = max(64, nextPow2(neededSize))   ← always power-of-2, minimum 64 words
clistStart      = allocSize - capabilities.length
```

```
Lump (allocSize words):

  0                M              codeSize        clistStart      allocSize
  ┌────────────────┬──────────────┬───────────────┬───────────────┐
  │  method table  │  code body   │   (freespace) │    c-list     │
  │   M words      │ totalCode wds│               │  clistCount   │
  └────────────────┴──────────────┴───────────────┴───────────────┘
       CR14 (X-only, limit = clistStart-1)       CR6 (L-only)
```

After CALL the processor sets:

| Register | Base address          | Limit              | Permissions |
|----------|-----------------------|--------------------|-------------|
| CR14     | `location`            | `clistStart - 1`   | X-only      |
| CR6      | `location + clistStart` | `clistCount - 1` | L-only      |
| PC       | 0                     | —                  | —           |

---

## Validation and fault codes

Navana.Abstraction.Add performs these checks in order:

| Check | Fault code | Condition |
|-------|-----------|-----------|
| Name present | `ARGS` | `upload.abstraction` is missing or empty |
| C-list size | `BOUNDS` | `capabilities.length > 511` |
| Lump overflow | `OVERFLOW` | `codeSize + clistCount > allocSize` (cannot occur if nextPow2 is correct; guards against integer errors) |
| Memory available | `OOM` | Memory.Allocate returns failure |
| NS slot available | `NS_FULL` | All 256 NS slots are occupied |

---

## doc block (optional)

The `doc` field carries human-readable metadata. It is stored on the registry entry and displayed in the Abstractions view. It does not affect runtime behaviour.

```json
{
  "author": "Jane Smith",
  "date": "2026-03-15",
  "language": "javascript",
  "languageLabel": "JavaScript",
  "description": "Implements the lambda application combinator.",
  "tags": ["lambda", "math"],
  "methods": [
    { "name": "Apply", "params": ["f", "x"], "instructions": 5 }
  ],
  "capabilities": ["Memory", "SlideRule"],
  "sourcePreview": "create abstraction Combinator\n..."
}
```

| Field          | Type     | Description |
|----------------|----------|-------------|
| `author`       | string   | Creator name. Falls back to `"Anonymous"` if omitted. |
| `date`         | string   | ISO date (`YYYY-MM-DD`). |
| `language`     | string   | Source language key. One of: `english`, `javascript`, `haskell`, `symbolic`, `lambda`, `assembly`. |
| `languageLabel`| string   | Display name for `language`. |
| `description`  | string   | One-line summary. |
| `tags`         | string[] | Free-form tags for search and grouping. |
| `methods`      | object[] | Compact method list: `{ name, params[], instructions }`. `instructions` is the word count, not the code array. |
| `capabilities` | string[] | Capability names in c-list order. |
| `sourcePreview`| string   | First 20 lines of the source that produced this abstraction. |

[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)++ fills all of these automatically via `buildDocBlock`. When writing by hand, every field is optional.

---

## What Navana.Abstraction.Add returns

On success, the caller receives:

```json
{
  "ok": true,
  "result": {
    "nsIndex": 50,
    "version": 1,
    "eGT": 1342177330,
    "location": 12800,
    "allocSize": 64,
    "codeSize": 7,
    "clistCount": 2,
    "clistStart": 62,
    "methods": ["Apply", "Compose"],
    "doc": { ... }
  },
  "message": "Navana.Abstraction.Add: \"Combinator\" @ NS[50] v1, code=7, clist=2, alloc=64"
}
```

| Field        | Type   | Description |
|--------------|--------|-------------|
| `nsIndex`    | number | Assigned NS slot index. |
| `version`    | number | Initial version (starts at 1 for new entries). Used to revoke all outstanding GTs by incrementing this. |
| `eGT`        | number | 32-bit Inform E-GT for the new abstraction. This is the capability handle to store in your c-list or return to a caller. |
| `location`   | number | Base address of the allocated lump in the unified address space. |
| `allocSize`  | number | Total lump size in words (power-of-2, minimum 64). |
| `codeSize`   | number | Words occupied by the method table + code body. |
| `clistCount` | number | Number of c-list GT slots (= `capabilities.length`). |
| `clistStart` | number | Word offset from `location` where the c-list begins. |
| `methods`    | string[] | Ordered list of method names. |
| `doc`        | object | The doc block passed in, echoed back. |

---

## Complete minimal example

A zero-capability, single-method abstraction with two instructions:

```json
{
  "abstraction": "Hello",
  "methods": [
    {
      "name": "Greet",
      "code": [268959744, 536936448]
    }
  ]
}
```

After `Navana.Abstraction.Add`:
- `methodTableSize` = 1, `totalCodeWords` = 2 → `codeSize` = 3
- `neededSize` = 3 → `nextPow2(3)` = 4 → `allocSize` = 32 (minimum floor)
- `clistCount` = 0; CALL sets CR14 over the entire lump, no CR6

## Complete full example

An abstraction with two methods and two capabilities:

```json
{
  "abstraction": "Adder",
  "type": "abstraction",
  "grants": ["E"],
  "methods": [
    {
      "name": "Add",
      "params": ["a", "b"],
      "code": [268959744, 285736961, 536936448]
    },
    {
      "name": "AddF",
      "params": ["a", "b"],
      "code": [268959746, 285736963, 553713664]
    }
  ],
  "capabilities": [
    { "target": 16, "name": "SlideRule", "grants": ["E"] },
    { "target": 17, "name": "Abacus",    "grants": ["E"] }
  ],
  "doc": {
    "author": "Jane",
    "date": "2026-03-15",
    "language": "javascript",
    "languageLabel": "JavaScript",
    "description": "Integer and float addition abstraction.",
    "tags": ["math", "arithmetic"],
    "methods": [
      { "name": "Add",  "params": ["a", "b"], "instructions": 3 },
      { "name": "AddF", "params": ["a", "b"], "instructions": 3 }
    ],
    "capabilities": ["SlideRule", "Abacus"],
    "sourcePreview": "create abstraction Adder\n  needs SlideRule, Abacus\n..."
  }
}
```

Lump layout for this example:
```
methodTableSize = 2, totalCodeWords = 6
codeSize   = 8   (2-entry table + 6 code words)
neededSize = 10  (codeSize 8 + clistCount 2)
nextPow2(10) = 16 → max(32, 16) = 32
allocSize  = 32 words (minimum floor)

offset  0   method table[0]  = 2   (Add starts at word 2)
offset  1   method table[1]  = 5   (AddF starts at word 5)
offset  2   Add:   instr 0
offset  3   Add:   instr 1
offset  4   Add:   instr 2
offset  5   AddF:  instr 0
offset  6   AddF:  instr 1
offset  7   AddF:  instr 2
offset  8..29  (freespace — 22 words)
offset 30   c-list[0]  Inform E-GT → NS[16] (SlideRule)
offset 31   c-list[1]  Inform E-GT → NS[17] (Abacus)
```
