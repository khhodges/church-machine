# LUMP Reference

**LUMP** — *Layered Unit of Machine Placement* — is the fundamental deployable unit of the Church Machine. A LUMP is always a power-of-two block of 32-bit words that bundles executable code, embedded data, and a private Capability List into a single, cryptographically sealed object. Every abstraction on the Church Machine is compiled to a LUMP and given a unique 32-bit token.

---

## Table of Contents

1. [Binary Layout](#1-binary-layout)
2. [Header Word 0 — Bit Fields](#2-header-word-0--bit-fields)
3. [Object Types (`typ`)](#3-object-types-typ)
4. [Golden Token & Context Register Structure](#4-golden-token--context-register-structure)
5. [Permission Bits](#5-permission-bits)
6. [Sidecar JSON — Complete Field Reference](#6-sidecar-json--complete-field-reference)
7. [Manifest Entry Fields](#7-manifest-entry-fields)
8. [NS Slot Policy & Variant Groups](#8-ns-slot-policy--variant-groups)
9. [IDE Views](#9-ide-views)
10. [API Endpoints](#10-api-endpoints)
11. [Lump Audit Rules](#11-lump-audit-rules)

---

## 1. Binary Layout

A LUMP is always `2^n` words long (`n ∈ 6..14`, i.e. 64–16 384 words).

```
┌──────────────────────────────────────────┐  Word 0
│  Header (1 word)                         │  magic=0x1F, cw, cc, typ, size exponent
├──────────────────────────────────────────┤  Word 1  ← PC entry point
│  Code Section (cw words)                 │
├──────────────────────────────────────────┤  Word cw+1
│  Freespace (zero-filled)                 │  Must be all-zero (verified by Mint)
├──────────────────────────────────────────┤  Word lump_size − cc
│  Capability List / C-List (cc words)     │  32-bit Golden Token Word 0s
└──────────────────────────────────────────┘  Word lump_size − 1
```

| Region       | Offset                        | Content |
|:-------------|:------------------------------|:--------|
| Header       | 0                             | One descriptor word. |
| Code         | 1 … cw                        | Executable instructions. Entry point is always **PC = 1**. |
| Freespace    | cw+1 … lump_size−cc−1         | Zeroed padding. Provides room to grow code or c-list. |
| C-List       | lump_size−cc … lump_size−1    | One GT Word 0 per slot. |

Data words (`dw`) live inside the code section immediately after the last instruction (`data_offset` in the sidecar gives the first data-word index relative to the lump base).

---

## 2. Header Word 0 — Bit Fields

Bits 31:27 are always `11111` (opcode 0x1F — an invalid instruction), so the hardware traps immediately if execution ever reaches the header.

```
 31      27 26    23 22        10  9  8  7              0
 ┌────────┬────────┬────────────┬────┬─────────────────┐
 │ magic  │  n-6   │     cw     │ typ│       cc        │
 │ 5 bits │ 4 bits │  13 bits   │ 2b │    8 bits       │
 └────────┴────────┴────────────┴────┴─────────────────┘
```

| Field | Bits  | Meaning |
|:------|:------|:--------|
| magic | 31:27 | Always `0x1F`. Identifies word 0 as a LUMP header. |
| n-6   | 26:23 | Size exponent minus 6. `lump_size = 2^(n-6 + 6)`. Range 0–8 → 64–16 384 words. |
| cw    | 22:10 | **Code Word count.** Number of 32-bit instructions (max 8 191). |
| typ   | 9:8   | Object type (see §3). |
| cc    | 7:0   | **C-List count.** Number of capability slots at the lump's tail (0–255). |

The hardware derives two root Capability Registers from these fields at load time:

- **CR6** (C-List Root): `base = NS_base + (lump_size − cc) × 4`, `limit = cc − 1`.
- **CR14** (Code Root): `base = NS_base + 4`, `limit = cw − 1`.

---

## 3. Object Types (`typ`)

| `typ` | Name         | Description |
|:------|:-------------|:------------|
| `00`  | Code / Lump  | Standard executable abstraction. |
| `01`  | Data         | Opaque data block (image, text, binary blob). No instructions. |
| `10`  | Thread       | Captured thread state (PC + 16 DRs + call stack). |
| `11`  | Outform      | Placeholder. Triggers an "Absent" event on first `LOAD`; the loader fetches the real lump from the Home Base. |

The `content_type` field in the sidecar further refines `typ=01` into `"text"`, `"markdown"`, `"image"`, `"grayscale"`, etc.

---

## 4. Golden Token & Context Register Structure

A **Context Register (CR)** is 128 bits — four 32-bit words. **Word 0 is the Golden Token (GT)**, the only part that can be shared across security boundaries.

### GT Word 0 (sharable)

```
 31   25 24  23 22    16 15               0
 ┌──────┬─────┬────────┬──────────────────┐
 │ perm │ typ │ gt_seq │    object_id     │
 │ 7 b  │ 2 b │  7 b   │    16 bits       │
 └──────┴─────┴────────┴──────────────────┘
```

| Sub-field  | Bits  | Meaning |
|:-----------|:------|:--------|
| perm       | 31:25 | Permission bits: B R W X L S E (MSB→LSB). |
| typ        | 24:23 | `00`=NULL, `01`=Inform, `10`=Outform, `11`=Abstract. |
| gt_seq     | 22:16 | Revocation sequence number. Stale tokens are rejected. |
| object_id  | 15:0  | Namespace slot index of the referred-to object. |

### Words 1–3 (local to the CR, not shared)

| Word | Bits        | Content |
|:-----|:------------|:--------|
| 1    | 31:0        | Physical base address (byte-addressed, word-aligned). |
| 2    | 91:85       | gt_seq (must match Word 0). `84:64` = limit_offset (inclusive word count − 1). |
| 3    | 112         | G-bit (GC mark). `111:96` = CRC-16 over Words 0[24:0], 1, 2. |

---

## 5. Permission Bits

Permissions divide strictly into two non-overlapping groups. A single capability can never hold permissions from both groups simultaneously — this enforces the "Red-to-Green" barrier.

| Bit | Symbol | Group  | Meaning |
|:----|:-------|:-------|:--------|
| 31  | B      | —      | **Bind.** Must be set for a GT to be stored in a C-List slot. Defaults to 0; auto-cleared by `CALL`. |
| 30  | R      | Turing | Read raw data. |
| 29  | W      | Turing | Write raw data. |
| 28  | X      | Turing | Execute (branch into). |
| 27  | L      | Church | Load a GT from a C-List. |
| 26  | S      | Church | Store a GT into a C-List. |
| 25  | E      | Church | Enter / Call an abstraction. |

**C-Lists may only hold E permission.** `CLOOMC` capabilities are limited to `E` or `RX`.

---

## 6. Sidecar JSON — Complete Field Reference

Every LUMP has a companion `.json` sidecar in `server/lumps/`. The sidecar is the authoritative metadata record; the binary header only encodes `cw`, `cc`, `lump_size`, and `typ`.

### 6.1 Top-Level Fields

| Field | Type | Required | Description |
|:------|:-----|:--------:|:------------|
| `token` | `string` | ✓ | 8-character hex token (e.g. `"00001200"`). Primary identity. |
| `abstraction` | `string` | ✓ | Human-readable name (e.g. `"Constants"`, `"SlideRule"`). |
| `lump_version` | `integer` | ✓ | Monotonically incrementing compile counter. Bumped by `/api/lumps/save`. |
| `ns_slot` | `integer\|null` | ✓ | Fixed Namespace slot, or `null` for floating lumps (see §8). |
| `ns_slot_policy` | `string` | — | `"static"` (fixed slot) \| `"dynamic"` (floating). Absent = static. |
| `variant_group` | `string` | — | Shared string that allows multiple lumps to claim the same `ns_slot` (see §8). |
| `lump_size` | `integer` | ✓ | Total word count. Must equal `2^(n-6+6)` and match header. |
| `cw` | `integer` | ✓ | Code word count. Must match header bits 22:10. |
| `cc` | `integer` | ✓ | C-List slot count. Must match header bits 7:0. |
| `dw` | `integer` | — | Data word count embedded inside the code section. |
| `data_offset` | `integer` | — | Word index (relative to lump base) of the first data word. |
| `data_word_names` | `string[]` | — | Human names for each data word in order. |
| `typ` | `integer` | — | Header `typ` field: 0=code, 1=data, 2=thread, 3=outform. |
| `content_type` | `string` | — | Semantic refinement of `typ=1`: `"text"`, `"markdown"`, `"image"`, `"grayscale"`, `"code"`, etc. |
| `lump_type` | `string` | — | Alternative type label used by some import flows. |
| `profile` | `string` | — | Target hardware profile (e.g. `"IoT"`, `"ti60-f225"`). |
| `language` | `string` | — | Source language: `"cloomc"`, `"assembly"`, `"haskell"`, `"lambda"`, `"unknown"`. |
| `author` | `string` | — | Creator name. |
| `version` | `string` | — | Human version string (e.g. `"1.0"`). |
| `release_notes` | `string` | — | Change description for this version. |
| `compiled_at` | `float` | — | Unix timestamp (seconds) of compilation. |
| `grants` | `string[]` | — | Top-level permissions this LUMP confers. Usually `["E"]`. |
| `self_data_r` | `boolean` | — | `true` if slot 0 of the C-List is a self-referential read-only data capability. |
| `boot_resident` | `boolean` | — | `true` if this LUMP must be present in the boot image. |
| `domain` | `string` | — | Security domain label (e.g. `"trusted"`, `"user"`). |
| `domain_perms` | `string[]` | — | Permissions granted within the domain. |
| `media_tags` | `string[]` | — | Content tags for data LUMPs (e.g. `["image", "grayscale", "64x64"]`). |
| `methods` | `object[]` | — | Method descriptors (see §6.2). |
| `capabilities` | `object[]` | — | C-List slot descriptors (see §6.3). |
| `pet_names` | `object` | — | Register aliases (see §6.4). |
| `deployment` | `object` | — | Build environment metadata (see §6.5). |
| `mtbf` | `object` | — | Reliability tracking (see §6.6). |
| `source` | `string` | — | Full source code. Omitted from `/api/lumps/list`; present in `/api/lumps/<token>/detail`. |
| `filename` | `string` | — | Name of the `.lump` binary file (e.g. `"00001200.lump"`). |
| `sidecar_file` | `string` | — | Name of this sidecar file (e.g. `"00001200.json"`). |

### 6.2 `methods[]` — Method Descriptors

Each entry describes one named entry point into the code section.

| Field | Type | Description |
|:------|:-----|:------------|
| `name` | `string` | Method identifier (e.g. `"Multiply"`). |
| `offset` | `integer` | Word offset from lump base word 1 (code start). |
| `length` | `integer` | Number of instructions in this method. |
| `description` | `string` | Human-readable explanation of what the method does. |
| `inputs` | `string[]` | Register expectations on entry (e.g. `"DR0: multiplicand"`). |
| `outputs` | `string[]` | Register state on return (e.g. `"DR0: result"`). |
| `comments` | `string[]` | Step-by-step implementation notes, one entry per logical step. |
| `pet_names` | `object` | Method-scoped register aliases, overrides top-level pet_names while in this method. Same `{"DR": {}, "CR": {}}` shape. |
| `aliasOf` | `string` | If present, this method shares its body with the named method (same `offset`). It is a call alias, not an independent implementation. |

### 6.3 `capabilities[]` — C-List Slot Descriptors

| Field | Type | Description |
|:------|:-----|:------------|
| `slot` | `integer` | Zero-indexed C-List slot this descriptor applies to. |
| `name` | `string` | Human name, usually `"Abstraction.CapabilityName"` (e.g. `"Constants.SelfDataR"`). The prefix before `.` is the depended-on abstraction. |
| `grants` | `string[]` | Permissions the GT in this slot carries (e.g. `["R", "W"]`). |
| `note` | `string` | Detailed description of what authority this slot confers. |

### 6.4 `pet_names` — Register Aliases

```json
{
  "DR": { "0": "result", "1": "operandA", "2": "operandB" },
  "CR": { "0": "ScratchPad", "1": "OutputBuffer" }
}
```

Keys are string-formatted register indices. `DR` maps Data Registers; `CR` maps Capability Registers. Method-level `pet_names` override these for the duration of that method.

### 6.5 `deployment` — Build Metadata

| Field | Description |
|:------|:------------|
| `target_board` | Hardware target, e.g. `"ti60-f225"`, `"tang-nano-20k"`, `"wukong-artix7"`. |
| `profile` | Profile at compile time (e.g. `"IoT"`, `"full"`). |
| `built_at` | ISO 8601 timestamp. |
| `builder` | Toolchain identifier (e.g. `"CLOOMC++ IDE v1.0"`). |

### 6.6 `mtbf` — Reliability Tracking

Populated by the FPGA call-home system and the simulator fault logger.

| Field | Description |
|:------|:------------|
| `status` | `"clean"` \| `"faulted"` \| `"unknown"`. |
| `consecutive_clean` | Number of consecutive fault-free test runs. |
| `total_runs` | Total test runs recorded. |
| `source_hash` | SHA-256 of the source code at compile time. Used to detect drift between deployed binary and current source. |

---

## 7. Manifest Entry Fields

`server/lumps/manifest.json` is a JSON array of 29 entries (as of Release 1.2). Each entry is a lean copy of the sidecar — the `source` field is always omitted. The manifest is the authoritative list for `/api/lumps/list` and the boot-image builder.

Fields present in manifest entries (superset of what every entry uses):

`token`, `abstraction`, `ns_slot`, `ns_slot_policy`, `variant_group`, `lump_size`, `cw`, `cc`, `dw`, `methods`, `grants`, `capabilities`, `pet_names`, `data_offset`, `data_word_names`, `boot_resident`, `author`, `version`, `lump_version`, `compiled_at`, `filename`, `sidecar_file`, `domain`, `domain_perms`, `media_tags`, `self_data_r`, `lump_type`.

The manifest is never written directly by hand — it is maintained by `/api/lumps/save` (adds/updates), `/api/lumps/<token>` DELETE (removes), and the consistency gate (`tests/lump/test_lump_consistency.py`) validates it before every merge.

### Three-file Rule

Every LUMP requires exactly three artefacts:

```
server/lumps/<token>.lump     — binary
server/lumps/<token>.json     — sidecar
server/lumps/manifest.json    — contains this entry
```

---

## 8. NS Slot Policy & Variant Groups

### `ns_slot_policy`

| Value | Behaviour |
|:------|:----------|
| `"static"` (default) | The LUMP is always loaded into the specific `ns_slot`. Required for lumps on the cold-boot critical path. |
| `"dynamic"` | **Floating lump.** `ns_slot` is `null`. Mint allocates an ephemeral slot on first use via the Loader/Tunnel fetch path. The slot may change between reboots; callers hold a GT, not a slot index. Correct default for any abstraction not needed at boot. |

### `variant_group`

Two manifest entries may claim the same non-null `ns_slot` only if they both carry the same non-null `variant_group` string. This allows language-variant pairs (e.g. `SlideRule` in CLOOMC++ and `SlideRuleHS` in Haskell) to share one slot — exactly one is loaded at runtime.

---

## 9. IDE Views

The LUMP detail panel is reached via the **Lumps tab** in the full IDE. Selecting any LUMP from the sidebar opens the detail view, which is split into eight sub-tabs plus a header strip.

### Header Strip

Always visible. Shows:

| Element | Description |
|:--------|:------------|
| Token | 8-hex token, copyable. |
| NS Slot | Fixed slot number, or `—` for floating lumps. |
| Version | `lump_version` integer. |
| Size | `lump_size` in words. |
| CW / CC | Code word count / C-List count. |
| **Edit** button | Opens the source editor preloaded with this LUMP's source. |
| **Audit** button | Runs all lump-audit rules against the binary (see §11). |
| **Run** button | Loads the binary into the simulator and boots. |
| **Shrink** button | Calls `/api/lump/<token>/resize` to remove freespace. |

---

### Sub-Tab: Overview

Shows identity and authorship metadata.

**For code LUMPs:**
- Author, version, compiled date
- Token, size, cw, cc, language, grants
- **Pet Names** — table of DR and CR register aliases
- **MTBF Reliability** — status badge, consecutive-clean count, total runs
- **Deployment** — target board, profile, builder, build timestamp

**For the Namespace LUMP (Boot.Abstr):**
- SVG dependency graph of the namespace hierarchy
- NS Table: slot index, label, state, and hash/file for each resident abstraction

---

### Sub-Tab: API

The call contract for this abstraction.

- **Methods table**: index, name, offset (word), length (words), description
- **Caller Grants**: what permissions a caller must have to enter this LUMP
- **C-List / Capabilities table**: slot index, name, grants, note for every C-List entry

---

### Sub-Tab: Content

Renders the LUMP's logical content based on `content_type` / `typ`:

| Content Type | Rendering |
|:-------------|:----------|
| `code` | Disassembled instructions with semantic comments, branch-target arrows, method-boundary markers, and stub-method warnings (amber) for bare-`RETURN` methods. |
| `text` / `markdown` | Plain text editor or formatted Markdown render. |
| `image` / `grayscale` | Reconstructed image canvas + "Replace file" utility. |
| `thread` | Thread state: PC, call depth, all 16 Data Registers. |

---

### Sub-Tab: Tokens *(MyGoldenTokens)*

C-List viewer and POLA editor.

- **GT chips**: one chip per C-List slot, showing the raw GT word, permissions, object_id, and pet name.
- **POLA tools**: strip excess permissions from individual slots (Principle of Least Authority).
- **Push Names**: writes this LUMP's pet names into the running simulator's namespace so the Memory and GT views use them.

---

### Sub-Tab: Source

Displays the original CLOOMC++ / Assembly source that produced this binary (fetched from `/api/lumps/<token>/detail`). Shows `binary_only` notice if no source was saved.

---

### Sub-Tab: Versions *(Version Telemetry)*

Per-version fault telemetry from FPGA call-home data.

- Table of every archived version with: version number, fault count, Tier-1/2/3 recovery breakdown, MTBF estimate.
- **Bulk upgrade** button: pushes the current version to all registered devices still on an older version.

---

### Sub-Tab: History *(Binary Version Archive)*

Archived `.lump` binaries stored as `<token>-v<N>.lump`.

- Lists every archived version with timestamp and word count.
- **Preview**: fetches the old binary and renders its hex dump.
- **Restore**: promotes the archived version to the active binary (writes it back as `<token>.lump` and updates the sidecar).

---

### Sub-Tab: Hex Dump

Raw binary view of the `.lump` file.

- One 32-bit word per row, colour-coded by region:
  - **Header** (word 0): gold
  - **Code** (words 1–cw): blue/white
  - **Freespace**: dim grey
  - **C-List** (tail cc words): amber
- ASCII sidecar alongside each word.
- Header decode panel: expands `magic`, `n-6`, `cw`, `typ`, `cc` inline.

---

### Other IDE Panels that Show LUMP Data

| Panel | Location | What it shows |
|:------|:---------|:--------------|
| **Memory View** | `app-memory.js` | Physical address space map — shows where each LUMP is loaded as a coloured block with its token and size. |
| **GT View** | `app-gt-view.js` | All Golden Tokens currently held in machine registers or C-Lists during execution, resolved to their abstraction names. |
| **CR Detail** | `app-cr-detail.js` | Deep inspection of a specific Capability Register: resolves the underlying LUMP token, base, limit, and permissions. |
| **Namespace tab** | Main IDE sidebar | Shows all NS slots with their resident LUMP token, state (loaded/absent/outform), and size. |
| **Lesson 5 form** | `/start` (starter IDE) | "Start from an existing abstraction" picker: populates `absName`, `absDesc`, and method rows from a selected LUMP's sidecar data via `/api/lumps/list`. |

---

## 10. API Endpoints

All endpoints are served by the Flask backend (`server/app.py`).

### Read / Retrieve

| Method | Path | Description |
|:-------|:-----|:------------|
| `GET` | `/api/lumps/list` | JSON array of all lumps (sidecar minus `source`). Includes `binary_valid` flag. |
| `GET` | `/api/lumps/<token>/detail` | Full sidecar JSON including `source`. |
| `GET` | `/api/lump/<token_hex>` | Raw binary (`application/octet-stream`). Falls back to Mum Tunnel Library on GitHub. `X-Lump-Source` header indicates origin. |
| `GET` | `/api/lump/<token_hex>/words` | `{token, words: uint32[], count}` — word array as JSON. |
| `GET` | `/api/lump-source/<name>` | `{name, source}` for the named abstraction. Returns `{binary_only: true}` if no source exists. |
| `GET` | `/api/lumps/bundle.zip` | ZIP of all `.lump` binaries + `manifest.json`. |
| `GET` | `/api/lumps/<token>/history` | `{history: [{version, filename, compiled_at, lump_size}]}`. |

### Create / Save

| Method | Path | Description |
|:-------|:-----|:------------|
| `POST` | `/api/lumps/save` | Save a compiled LUMP. Body: `{binary: uint32[], metadata: {...}}`. Runs c-list bounds check. Returns `{token, lump_path, sidecar_path}`. |
| `POST` | `/api/lumps/import` | Pack a base64 file into a data LUMP. Body: `{name, content_type, data_b64, width?, height?}`. |
| `POST` | `/api/lumps/upload-lump` | Import a raw `.lump` binary. Body: `{name, data_b64}`. Parses header to generate sidecar. |

### Update / Modify

| Method | Path | Description |
|:-------|:-----|:------------|
| `PUT` | `/api/lump/<token>/content` | Overwrite the content of a data/text LUMP in-place. Body: `{text?} | {data_b64?}`. Returns `{cw, lump_size}`. |
| `PATCH` | `/api/lump/<token>/meta` | Update sidecar fields (`author`, `version`, `pet_names`, etc.). |
| `PATCH` | `/api/lump/<token_hex>/clist/<slot>` | Write one GT word into a specific C-List slot. Body: `{gt_word: uint32}`. |
| `POST` | `/api/lump/<token_hex>/resize` | Repack to minimum power-of-2, removing freespace. Returns `{old_size, new_size, saved_words}`. |
| `POST` | `/api/lump/<token>/fork-version` | Archive current binary as `-vN`, promote new compile as primary. |

### Delete

| Method | Path | Description |
|:-------|:-----|:------------|
| `DELETE` | `/api/lumps/<token>` | Remove binary, sidecar, and manifest entry. Returns list of deleted files. |

### Telemetry

| Method | Path | Description |
|:-------|:-----|:------------|
| `GET` | `/api/lump/version-telemetry/<name>` | Per-version fault statistics for the named abstraction. Used by the Versions sub-tab. |

---

## 11. Lump Audit Rules

The audit system (`simulator/lump-audit.js`) runs structural consistency checks on LUMP binaries. Invoked from the **Audit** button in the IDE header strip, and from the `lump-consistency` CI workflow.

The auditor operates in two modes:
- **Manifest-guided**: sidecar metadata is available; all rules apply.
- **Binary-only**: no sidecar; only binary-derivable rules apply (R0, R1, R2, RB1, RB2, RFS, RCI, RNC).

| Rule ID | Name | What it checks |
|:--------|:-----|:---------------|
| **R0** | Empty Binary | Word array must not be empty. |
| **R1** | Header Magic | Bits 31:27 of word 0 must equal `0x1F`. |
| **R2** | Word Count | Actual word count must equal `2^(n-6+6)` as encoded in the header exponent field. |
| **RB1** | Code Word Count | `cw >= 1` — at least one code word must exist. |
| **RB2** | Layout Bounds | `1 + cw + cc <= lump_size` — header + code + c-list must fit. |
| **RFS** | Freespace Zone | All words in the padding region (between code and c-list) must be zero. |
| **RMC** | Manifest Coherence | If a sidecar is provided, its `cw`, `cc`, and `lump_size` must exactly match the binary header. |
| **RCI** | Instruction Range | `LOAD`/`SAVE`/`ELOADCALL`/`XLOADLAMBDA` must reference slots `0 … cc-1`. `BRANCH` targets must land within the code section. |
| **RNC** | NULL GT Check | Warns if code accesses a C-List slot that holds a NULL (all-zero) Golden Token. |
| **RPN** | Pet Name Coverage | Every C-List slot referenced by code must have a corresponding pet name in the sidecar. |
| **RSM** | Stub Method | Detects methods whose entire body is a single bare `RETURN` with no implementation. Flagged as amber warnings in the Content sub-tab. |

Failures at R0–RFS are hard errors; RMC–RPN are reported as warnings that block merge (enforced by `tests/lump/test_lump_consistency.py` — 11 rules, R1–R11 in that file). RSM is advisory only.

---

## Related Documents

- `docs/cloomc-foundation.md` — ISA overview, PP250 heritage, capability model, memory architecture, and per-board profiles.
- `docs/CM_LUMP_SPECIFICATION.md` — Authoritative binary format specification.
- `docs/instruction-set.md` — Full instruction set reference including `LOAD`, `SAVE`, `CALL`, `ELOADCALL`, and `XLOADLAMBDA`.
- `CHANGELOG.md` — LUMP metadata change-control rules and release history.
- `tests/lump/test_lump_consistency.py` — CI consistency gate (11 rules).
