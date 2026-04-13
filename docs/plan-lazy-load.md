# Plan: Lazy Load

## Goal

Abstractions load on demand — triggered by a capability fault on an
empty NS slot — instead of being pre-loaded at boot. The child never
knows the abstraction was absent. It just works.

## New Abstraction

### Loader (NS slot 19)

**Methods**: Load, Prefetch, Evict

| Method | Description |
|--------|-------------|
| **Load** | Fault-driven load. Catches NULL_CAP fault, looks up the manifest, fetches the lump, installs it, retries the faulting CALL. |
| **Prefetch** | Hint-driven load. A caller requests future loading of a slot without blocking. Returns immediately. |
| **Evict** | Unloads a cold abstraction to reclaim memory. Clears the NS slot. Next access triggers Load again. |

**Capability requirements**: Loader holds GTs for Navana (E), Memory
(E), Mint (E), Locator (E), and UART (R/W) — everything needed to
fetch, allocate, install, and mint.

## Dependencies (existing abstractions)

| Abstraction | Slot | What Loader needs from it |
|-------------|------|--------------------------|
| Navana | 5 | Navana.Abstraction.Add — install lump into NS table |
| Memory | 7 | Memory.Allocate — allocate power-of-2 block for the lump |
| Mint | 6 | Mint.Create — create the GT for the loaded abstraction |
| Locator | — | Locator.Parse — read ZIP header, derive lump size and header word |
| UART | 11 | Fetch lump bytes from bridge / storage device |

## Data Structures

### Lazy Load Manifest

A read-only table mapping NS slot numbers to lump sources. Stored as
a DATA object in the namespace, loaded at boot.

```
manifest[slot] = {
    source: "local" | "uart" | "tunnel",
    path: "SlideRule.lump.zip",
    size: 4096,
    priority: "cold" | "warm" | "hot"
}
```

- **hot**: loaded at boot (current behaviour — Navana.Init)
- **warm**: loaded on first CALL (lazy load)
- **cold**: loaded only on explicit request, evictable

### Fault Vector Integration

The FAULT handler (hardware or simulator) must be extended:

```
On FAULT NULL_CAP:
    faulting_slot = extract NS slot from the faulting GT
    if manifest[faulting_slot] exists:
        Loader.Load(faulting_slot)
        retry faulting instruction
    else:
        raise FAULT NULL_CAP (genuine missing capability)
```

## Implementation Steps

### Step 1: Manifest format and boot integration

- Define the manifest JSON format
- Extend Navana.Init to read the manifest and tag slots as hot/warm/cold
- Hot slots load at boot (existing behaviour)
- Warm/cold slots get NULL entries with a manifest reference

### Step 2: Loader abstraction — CLOOMC++ source

- Write `loader.cloomc` with Load, Prefetch, Evict methods
- Load method: read manifest → fetch lump bytes → call Locator.Parse →
  call Memory.Allocate → call Navana.Abstraction.Add → call Mint.Create
- Compile to `Loader.json`, build lump

### Step 3: Fault handler extension

- Simulator: extend `handleFault()` in app.js to detect NULL_CAP on a
  manifest-registered slot and dispatch to Loader.Load
- Hardware: extend the FAULT FSM in Amaranth HDL to vector to Loader's
  NS slot on NULL_CAP if the manifest flag is set

### Step 4: Eviction and memory pressure

- Loader.Evict: clear the NS entry, free the memory block, NULL the GT
- Track access frequency per slot (simple counter in the manifest)
- On Memory.Allocate failure: Loader.Evict the coldest warm slot, retry

### Step 5: Simulator testing

- Tag SlideRule as "warm" in the manifest
- Boot the simulator — SlideRule slot is NULL
- Call SlideRule.Sin — FAULT → Loader.Load → SlideRule installs → Sin runs
- Verify: no visible difference from pre-loaded behaviour
- Test eviction: Loader.Evict(SlideRule) → next call re-loads

## Memory Budget

| Board | Total BRAM | Boot lumps | Available for lazy load |
|-------|-----------|------------|------------------------|
| Tang Nano 20K | 64 KB | ~8 KB (Navana, Mint, Memory, Scheduler) | ~56 KB |
| Ti60 F225 | 256 KB | ~16 KB | ~240 KB |

Lazy load is most valuable on the Tang Nano where 64 KB is tight.
Without lazy load, all abstractions must fit simultaneously. With it,
only the active set needs to be resident.

## Success Criteria

1. Boot with SlideRule tagged as "warm" — slot is NULL at boot
2. `CALL SlideRule.Sin` triggers FAULT → Loader.Load → Sin executes
3. No visible difference to the caller — transparent lazy loading
4. Loader.Evict frees the slot — next call re-loads
5. MTBF = ∞ for Loader itself — zero faults in the load path
