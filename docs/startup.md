# Startup.Config — Specification

_Church-Turing Meta-Machine startup configuration abstraction_

---

## 1. Background and motivation

### 1.1 Pre-baking Boot.Abstr

The Church Machine boot ROM is a 13-instruction fixed program (BOOT_ROM_WORDS)
that lives in the Boot.Abstr lump at NS slot 3.  The design is moving toward
**pre-baking**: placing Boot.Abstr's GT directly into the thread lump's c-list
at index 4 at image-build time.  This lets the hardware call Boot.Abstr
directly from the thread c-list without a dynamic NS table lookup, making the
entry point deterministic from reset.

Pre-baking is the right trade-off for firmware — it eliminates B:01–B:04
dynamic-resolution overhead — but it has one consequence: Boot.Abstr's physical
address is baked into the thread lump.  Patching NS slot 3 at runtime no longer
changes what runs at boot.

### 1.2 The flexibility gap

Before pre-baking, operators could change the entire boot behaviour by patching
NS slot 3 (`PATCH_LUMP`).  After pre-baking, Boot.Abstr is firmware.  A
replacement seam is needed: a well-defined, patchable abstraction that
Boot.Abstr always calls immediately, and which decides what the machine does.

### 1.3 The solution: Startup.Config at NS slot 2

NS slot 2 has been free and null since Task #247 removed the Boot.Abstr
director.  **Startup.Config** claims that slot.  It is:

- small (one 64-word lump),
- fully patchable via `PATCH_LUMP` at runtime without touching Boot.Abstr or
  the thread lump, and
- the single authoritative source for all startup configuration.

---

## 2. NS slot layout

```
NS[0]  Boot.NS          — namespace root; holds the NS table descriptor
NS[1]  Boot.Thread      — thread lump; c-list[4] holds Boot.Abstr's GT (pre-baked)
NS[2]  Startup.Config   — THIS ABSTRACTION (formerly free/null since Task #247)
NS[3]  Boot.Abstr       — 13-instruction firmware loaded into CR6 at B:03/B:04
NS[4]  LED flash        — first user abstraction; the default boot target
NS[5]  Salvation        — security pipeline entry
NS[6]  Navana           — namespace controller
       …
```

NS slots 0–3 form the **foundational quad**.  All four must be non-null in
every valid boot image.  Startup.Config joining this quad requires bumping
`BOOT_IMAGE_FORMAT_TAG` so `validate_boot_image()` rejects stale images.

---

## 3. Boot call chain

The pre-baked scheme places Boot.Abstr's GT at thread c-list[4] so the Boot
ROM can call it directly.  Boot.Abstr's own c-list (stored in the Boot.Abstr
lump, accessed via CR6 during execution) holds Startup.Config's GT at c-list
index 4, which is what BOOT_ROM_WORDS instruction [5] (`LOAD AL, CR0, CR6[4]`)
loads and instruction [7] (`CALL AL, CR0, CR0`) calls.

```
Power-on / Reset
    │
    ▼
Boot ROM (hardware)
  ├─ B:00 FAULT_RST — clear all CRs/DRs, M-Elevation ON,  ledBits = 0b000001
  ├─ B:01 LOAD_NS   — NS[0] → CR15,                        ledBits = 0b000011
  ├─ B:02 INIT_THRD — NS[1] → CR12 (thread stack),         ledBits = 0b000111
  ├─ B:03 INIT_ABSTR — NS[3] (Boot.Abstr) → CR6 (E-perm), ledBits = 0b001111
  └─ B:04 LOAD_NUC  — CR14 ← Boot.Abstr code region,      ledBits = 0b111111
    │
    ▼
Boot.Abstr BOOT_ROM_WORDS executes (CR6 = Boot.Abstr lump):
  [5]  LOAD  AL, CR0, CR6[4]   — load Boot.Abstr c-list[4] = Startup.Config GT
  [6]  TPERM AL, CR0, #E
  [7]  CALL  AL, CR0, CR0      — call Startup.Config.Execute()
    │
    ▼
Startup.Config.Execute()        — FIRST USER-SPACE ENTRY POINT after boot
  │
  ├─ Runs self-test pre-checks (see §5 — Execute semantics):
  │     checks config_version, flags, entry_slot bounds,
  │     NS[entry_slot] non-null, NS[0/1/3] non-null
  │
  ├─ PASS ──▶ ledBits = 0b111111 (all-on, healthy)
  │            loads NS[entry_slot] with E-perm, calls it
  │                  │
  │                  ▼
  │            Configured main abstraction runs
  │
  └─ FAIL ──▶ params[0] (fault_count) incremented
               ledBits = fault_count & 0x3F   (6-bit count on 6-LED display)
               PP250 restart triggered
                    └─ B:00 → … → Boot.Abstr → Execute() again
```

**Wiring summary:**

| c-list slot | Location | Contents |
|---|---|---|
| thread c-list[4] | NS[1] lump (pre-baked at build time) | Boot.Abstr GT |
| Boot.Abstr c-list[4] | NS[3] lump | Startup.Config GT |

---

## 4. The Startup.Config lump

### 4.1 Lump size

64 words (one SLOT_SIZE allocation).

### 4.2 Permissions

```
E = 1   (callable by Boot.Abstr and by privileged callers)
R = 0, W = 0, X = 0, L = 0, S = 0
```

### 4.3 Data region layout

The lump body contains a structured data area after the code words.  All words
are 32-bit unsigned integers.

| Word | Name             | Default | Description |
|------|------------------|---------|-------------|
| 0    | `entry_slot`     | 4       | NS slot of the main abstraction that Execute calls. Default 4 (LED flash — the first user abstraction). Must not be set to 3 (Boot.Abstr) or 2 (Startup.Config itself) as those would produce a recursive boot loop. |
| 1    | `config_version` | *const* | Must equal `STARTUP_CONFIG_VERSION`. A mismatch causes Execute's pre-check to fault with `VERSION_MISMATCH`. |
| 2    | `flags`          | 0       | Reserved; must be zero. |
| 3–N  | `params[0–N-3]`  | 0       | User-defined startup parameters. params[0] at word 3 is **reserved as the fault counter** (incremented on each failed Execute pre-check, cleared by `Reset`). params[1] onwards are free. |

`ReadParam(k)` returns `data[k]` for k in 0–63.  It spans the full data
region including the header words.

`WriteParam(k, v)` only writes `data[k]` for k ≥ 3 (user params region
starting with the fault counter).  Returns error code 2 (`READ_ONLY`) for
k = 0–2 (entry_slot, config_version, flags are write-protected; use `SetEntry`
for entry_slot).

---

## 5. Methods

Startup.Config exposes the following 8 methods.  Boot.Abstr calls `Execute`
via the CALL at BOOT_ROM_WORDS[7].  All methods are callable by any holder of
the Startup.Config GT with E-permission.

DR conventions:
- **DR0** — return value / status (0 = ok, non-zero = error/fault code)
- **DR1** — first input argument
- **DR2** — second input argument (where needed)

### Execute

Called by Boot.Abstr on every reset.  Runs a self-test pre-check sequence
before handing off to the configured main abstraction.

**Pre-check sequence (runs in order; first failure aborts):**

| # | Check | Fault code |
|---|-------|------------|
| 1 | `data[1]` == `STARTUP_CONFIG_VERSION` | `VERSION_MISMATCH` |
| 2 | `data[2]` == 0 | `BAD_FLAGS` |
| 3 | `data[0]` in `[0, NS_TABLE_SIZE)` | `ENTRY_OOB` |
| 4 | NS[data[0]] non-null | `ENTRY_NULL` |
| 5 | NS[0] non-null | `NS0_MISSING` |
| 6 | NS[1] non-null | `NS1_MISSING` |
| 7 | NS[3] non-null | `NS3_MISSING` |

**On pass:** set `ledBits = 0b111111`, load NS[entry_slot] with E-permission,
CALL it.  Returns the callee's DR0 if the callee ever returns.

**On fail:** increment `params[0]` (fault_count at data[3]), set
`ledBits = params[0] & 0x3F` (encodes fault count as a 6-bit binary number
across all 6 LEDs), trigger PP250 restart.

| DR1 in | DR2 in | DR0 out |
|---|---|---|
| — | — | 0=pass/propagated, fault code on fail |

### GetEntry

Return `data[0]` (the configured entry NS slot).

| DR1 in | DR2 in | DR0 out |
|---|---|---|
| — | — | entry_slot (u32) |

### SetEntry

Validate the requested slot (in bounds; NS[slot] non-null; slot ≠ 2 and
slot ≠ 3 to prevent recursive boot loops), then write it to `data[0]`.
Takes effect on the next call to Execute (or the next restart).

| DR1 in | DR2 in | DR0 out |
|---|---|---|
| slot (u32) | — | 0=ok, 1=OUT_OF_RANGE, 2=ENTRY_NULL, 3=RECURSIVE_SLOT |

### ReadParam

Return `data[key]` for key in 0–63, covering the full data region.
Keys 0–2 read the header (entry_slot, config_version, flags).  Key 3 reads the
fault counter.  Keys 4–63 read user params.  Returns 0xFFFFFFFF for key ≥ 64.

| DR1 in | DR2 in | DR0 out |
|---|---|---|
| key (u32, 0–63) | — | data[key] or 0xFFFFFFFF=KEY_OOB |

### WriteParam

Write `value` to `data[key]` for key ≥ 3 (the user-writable region, which
includes the fault counter at key 3 and free params at keys 4–63).  Keys 0–2
are read-only (use SetEntry for entry_slot); returns error 2.  Keys ≥ 64
return error 1.

| DR1 in | DR2 in | DR0 out |
|---|---|---|
| key (u32, 3–63) | value (u32) | 0=ok, 1=KEY_OOB, 2=READ_ONLY |

### Validate

Check each of NS slots 0–3.  Bit N of the return value is 1 if NS[N] is
non-null.  A healthy foundational quad returns `0b1111` (0xF).

| DR1 in | DR2 in | DR0 out |
|---|---|---|
| — | — | status bitmask (u32) |

### Version

Return `STARTUP_CONFIG_VERSION`.  Callers can verify compatibility before
invoking Execute, e.g. after patching Startup.Config.

| DR1 in | DR2 in | DR0 out |
|---|---|---|
| — | — | version word (u32) |

### Reset

Restore factory defaults: `entry_slot` ← 4 (LED flash), `flags` ← 0, fault
counter (`params[0]`) ← 0, all other params ← 0.  Does not modify
`config_version`.
Does not clear the LED display; a subsequent successful Execute restores
`ledBits = 0b111111`.

| DR1 in | DR2 in | DR0 out |
|---|---|---|
| — | — | 0=ok |

---

## 6. LED fault display

When Execute's pre-check fails, `ledBits` is set to the current fault count
encoded as a 6-bit binary number across the 6-LED display:

| `ledBits` value | Fault count | Meaning |
|---|---|---|
| `0b111111` (63) | 0 | Pre-checks passed — healthy boot |
| `0b000001` (1) | 1 | One failed boot attempt |
| `0b000010` (2) | 2 | Two failed boot attempts |
| `0b000011` (3) | 3 | Three failed boot attempts |
| … | … | … |
| `0b111110` (62) | 62 | 62 failed boot attempts |

The boot sequence (B:00–B:04) uses the LED display as a progress bar, reaching
`0b111111` at B:04 completion.  Execute runs as the first user-space code after
B:04, and its LED write (`0b111111` on success or `fault_count & 0x3F` on
failure) does not conflict with boot-progress semantics.

The fault counter stored at `data[3]` (`params[0]`) is persistent across PP250
restarts (it lives in the lump, which survives soft resets).  `Reset()` is the
only programmatic way to clear it.

---

## 7. Patching Startup.Config at runtime

To replace Startup.Config without a full image reflash:

1. Build a new 64-word lump body (new method implementations and/or data
   region values).
2. Call `PATCH_LUMP` with the Startup.Config GT and the new lump body.
   The patch takes effect immediately in memory — no reboot is required for
   the patch itself to be applied.
3. Boot.Abstr's c-list[4] continues to point to NS slot 2; on the next
   invocation of Boot.Abstr (e.g. after a PP250 restart), the patched lump
   is called automatically.

Constraints:
- The patched lump must implement the Execute method (method index 0 in the
  dispatch table).
- `data[1]` must equal `STARTUP_CONFIG_VERSION` unless the replacement
  Execute is version-agnostic.
- The lump size must remain ≤ 64 words (one SLOT_SIZE allocation).

Patching Boot.Abstr (NS[3]) or the thread lump (NS[1]) is **not** required.

---

## 8. Capability comparison table

| Capability | Before pre-baking | After pre-baking + Startup.Config |
|---|---|---|
| Change what runs at boot | Patch NS[3] (Boot.Abstr) | `SetEntry(slot)` — no reflash |
| Change startup parameters | No mechanism | `WriteParam(key, value)` |
| Inspect startup health | Only at API level before boot | `Validate()` callable at runtime |
| Count failed boot attempts | No mechanism | `ReadParam(3)` → fault counter |
| Show fault count on LEDs | No mechanism | Automatic: `ledBits = fault_count & 0x3F` |
| Replace entire startup logic | Patch NS[3] | `PATCH_LUMP` on NS[2] — takes effect immediately |
| Replace Boot.Abstr firmware | Patch NS[3] | **Not possible** — pre-baked; requires reflash |
| Know schema version | No mechanism | `Version()` |
| Recover from corrupt config | No mechanism | `Reset()` restores factory defaults |

---

## 9. Version constant

```
STARTUP_CONFIG_VERSION = 0x00000001
```

Written to `data[1]` at lump build time.  Execute's pre-check compares it
against the compiled-in constant and faults with `VERSION_MISMATCH` if they
differ.  Increment this value whenever the data region layout (§4.3) changes
in a backward-incompatible way.

---

## 10. Implementation notes for Task #396

### simulator/system_abstractions.js

Add `_bindStartupConfig()` called from `_bindAll()`.  Register 8 methods at
NS slot 2 via `this.registry.bindMethod(2, name, fn)`.  Keep a module-local
`startupConfigState` object with fields:
`entry_slot` (default 4), `config_version` (= STARTUP_CONFIG_VERSION),
`flags` (0), `data` (64-element array, data[3] = fault_count, data[4+] = user
params, all initially 0).

`Execute` runs the 7 pre-checks from §5 in order.  On pass: `sim.ledBits = 0x3F`
then dispatch to NS[entry_slot].  On fail: `state.data[3]++`,
`sim.ledBits = state.data[3] & 0x3F`, then `sim.fault('SELF_TEST', faultCode)`.

`SetEntry`: reject slot 2 (Startup.Config) and slot 3 (Boot.Abstr) with error
code 3 (`RECURSIVE_SLOT`) in addition to the out-of-range and null checks.

`ReadParam(k)`: return `state.data[k]` for k = 0–63; 0xFFFFFFFF for k ≥ 64.

`WriteParam(k, v)`: write `state.data[k]` only for k = 3–63; error 2 for
k = 0–2; error 1 for k ≥ 64.

`Reset`: set `state.data[0] = 4`, `state.data[2] = 0`, `state.data[3] = 0`,
`state.data[4..63] = 0`.  Leave `state.data[1]` (config_version) unchanged.

`Validate`: check `sim.memory[sim.NS_TABLE_BASE + N * sim.NS_ENTRY_WORDS]`
for N = 0–3; return bitmask.

### server/boot_image.py

Replace `None` at index 2 in `DEFAULT_ABSTRACTION_CATALOG` with:
```python
("Startup.Config", {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
```
Add `STARTUP_CONFIG_NS_SLOT = 2` and `STARTUP_CONFIG_VERSION = 0x00000001`.
Update `_MANDATORY_NS_SLOTS` to include slot 2.

In `generate_boot_image()`: allocate a 64-word lump for slot 2, write the
data region header (word 0 = 4, word 1 = STARTUP_CONFIG_VERSION, word 2 = 0,
words 3–63 = 0), populate a non-zero NS entry at slot 2.

In the Boot.Abstr lump build: set c-list[4] to the Startup.Config GT
(E-permission, nsSlot=2).  Bump `BOOT_IMAGE_FORMAT_TAG` to mark the new
slot-2 / c-list-4 layout.

### simulator/simulator.js

In `_initNamespaceTable()`: remove the free/null early-exit for slot 2;
build a real 64-word NS entry using the same pattern as other foundational
slots; set `nsLabels[2] = 'Startup.Config'`; add `slotSizes[2] = 64`.

After building the Boot.Abstr lump, overwrite c-list[4] with the Startup.Config
GT.  Add a Gate Log entry when Execute is entered so the call is visible in
the Trace view.

### tests/test_startup_config.py

One test per method (8 tests), a pre-check failure test (corrupt a mandatory
NS slot, call Execute, check fault_count = 1 and ledBits = 1), and an
integration test that runs a full simulated boot and verifies the Gate Log
contains a `Startup.Config.Execute` entry followed by the configured main
abstraction.  All existing tests must continue to pass.
