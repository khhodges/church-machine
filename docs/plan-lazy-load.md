# Plan: Lazy Load

## Goal

Abstractions load on demand — triggered by a CODE_NOT_RESIDENT fault
when the lump header shows cw=0 — instead of being pre-loaded at boot.
The GT (NS entry) is always preserved; only code words are evicted.
The child never knows the code was absent. It just works.

## New Abstraction

### Loader (NS slot 19)

**Methods**: Load, Prefetch, Evict

| Method | Description |
|--------|-------------|
| **Load** | Fault-driven load. Catches CODE_NOT_RESIDENT fault (lump header cw=0), looks up the manifest, fetches the lump code, installs it into the existing GT's memory region, retries the faulting CALL. GT and c-list are untouched. |
| **Prefetch** | Hint-driven load. A caller requests future loading of a slot without blocking. Returns immediately. |
| **Evict** | Unloads a warm/cold abstraction's code to reclaim memory. Zeroes code words and sets lump header cw=0. GT (NS entry) and c-list are preserved. Next access triggers Load again. |

**Capability requirements**: Loader holds GTs for Navana (E), Memory
(E), Locator (E), and UART (R/W) — everything needed to fetch and
install code. Mint is NOT needed because the GT already exists from boot.

## Dependencies (existing abstractions)

| Abstraction | Slot | What Loader needs from it |
|-------------|------|--------------------------|
| Navana | 5 | Navana.Abstraction.Add — install lump into NS table |
| Memory | 7 | Memory.Allocate — allocate power-of-2 block for the lump |
| Mint | 6 | Not needed — GT already exists from boot |
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
- **warm**: GT exists from boot, code evicted at init; loaded on first CALL (lazy load)
- **cold**: GT exists from boot, code loaded only on explicit request, evictable

### Fault Vector Integration

The FAULT handler (hardware or simulator) must be extended:

```
On CALL/LOAD to a valid NS entry:
    read lump header at word0_location
    if lump_header.cw == 0 and manifest[slot] exists:
        FAULT CODE_NOT_RESIDENT
        Loader.Load(slot)    -- writes code words, updates lump header cw
        retry faulting instruction
    (GT and c-list are never destroyed — only code residency changes)
```

## Implementation Steps

### Step 1: Manifest format and boot integration

- Define the manifest JSON format
- Extend Navana.Init to read the manifest and tag slots as hot/warm/cold
- Hot slots load at boot (existing behaviour)
- Warm/cold slots: GT preserved, code words zeroed, lump header set to cw=0

### Step 2: Loader abstraction — CLOOMC++ source

- Write `loader.cloomc` with Load, Prefetch, Evict methods
- Load method: read manifest → fetch lump bytes → call Locator.Parse →
  call Memory.Allocate → call Navana.Abstraction.Add
  (The GT already exists in the c-list from boot — Mint.Create is not
  needed. Lazy load re-populates the NS entry; it does not mint a new GT.)
- Compile to `Loader.json`, build lump

### Step 3: Fault handler extension

- Simulator: in _execLoad/_execCall, after resolving a valid NS entry,
  read the lump header. If cw=0 and manifest entry exists, dispatch
  CODE_NOT_RESIDENT fault to Loader.Load
- Hardware: extend the CALL/LOAD FSM in Amaranth HDL to check lump
  header cw field before dispatch; vector to Loader if cw=0

### Step 4: Eviction and memory pressure

- Loader.Evict: zero code words in the lump, set lump header cw=0.
  GT (NS entry) and c-list are preserved — ownership is never destroyed.
- Track access frequency per slot (simple counter in the manifest)
- On Memory.Allocate failure: Loader.Evict the coldest warm slot, retry

### Step 5: Simulator testing

- Tag SlideRule as "warm" in the manifest
- Boot the simulator — SlideRule GT exists, lump header cw=0 (code not resident)
- Call SlideRule.Sin — CODE_NOT_RESIDENT → Loader.Load → code installed → Sin runs
- Verify: GT, c-list, and seals unchanged across load cycle
- Test eviction: Loader.Evict(SlideRule) → code cleared, GT preserved → next call re-loads

## Memory Budget

| Board | Total BRAM | Boot lumps | Available for lazy load |
|-------|-----------|------------|------------------------|
| Tang Nano 20K | 64 KB | ~8 KB (Navana, Mint, Memory, Scheduler) | ~56 KB |
| Ti60 F225 | 256 KB | ~16 KB | ~240 KB |

Lazy load is most valuable on the Tang Nano where 64 KB is tight.
Without lazy load, all abstractions must fit simultaneously. With it,
only the active set needs to be resident.

## Success Criteria

1. Boot with SlideRule tagged as "warm" — GT exists, code not resident (cw=0)
2. `CALL SlideRule.Sin` triggers CODE_NOT_RESIDENT → Loader.Load → Sin executes
3. No visible difference to the caller — transparent lazy loading
4. GT, c-list, and seals are preserved across all load/evict cycles
5. Loader.Evict clears code (cw=0) — GT stays, next call re-loads
6. MTBF = ∞ for Loader itself — zero faults in the load path
