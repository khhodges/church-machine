---
name: NS slot label persistence across hard resets
description: Why dynamic NS slot labels vanish after reset, and how they are now persisted.
---

## The Bug Pattern

`_initNamespaceTable()` runs first (from `reset()`), then `loadBootImage()` runs after.

Step 3 inside `_initNamespaceTable()` reserves empty slots starting at `nsCount`. With the
default boot config (`emptySlotCount=10`, `nsCount=7` from catalog), Step 3 labels
slots 7-16 as `'(reserved)'` and zeroes their memory.

When `loadBootImage()` then runs it restores the binary data (e.g. W0=0x0400 for a saved
LEDFlash entry at slot 7). The reseed loop tries to update `nsLabels` but the old condition
was `!label || label==='(free)'` — `'(reserved)'` is truthy and not `'(free)'`, so the
stale step-3 label was never corrected.

**Why:** The reseed loop was written to clear `'(free)'` labels but not `'(reserved)'` ones.
Step3 was added later and its label value was never added to the reseed guard.

## The Fix

Three parts:

1. **`simulator.js` `loadBootImage()` reseed loop**: added `|| label === '(reserved)'`
   to the else-if condition, and look up `bootConfig.slotLabels[slot]` before falling
   back to `slot_N`.

2. **`server/app.py`**: new `POST /api/boot-config/slot-label` endpoint — merges one
   slot→label entry into `boot-config.json` without touching step1/step2/step3. The
   existing `boot_config_post()` now preserves `slotLabels` from the on-disk file so
   a Boot Image Designer save doesn't wipe them.

3. **`app-memory.js` `_nsTableAddConfirm()`**: after writing the NS entry, fires a
   fire-and-forget fetch to `/api/boot-config/slot-label` to persist automatically.

## How to Apply

Any time a non-catalog NS slot (slot ≥ 7) gets a user-assigned label:
- The `_doInstall` path in `_nsTableAddConfirm()` handles persistence automatically.
- The reseed loop in `loadBootImage()` restores the label on every hard reset.
- `slotLabels` keys are stored as strings in JSON (`"7"` not `7`); JS property lookup
  coerces numbers to strings so `cfg.slotLabels[7]` correctly reads key `"7"`.
- Stale labels for CLEARED slots don't leak: the reseed loop only reads `_savedLabel`
  when `_hasEntry=true` (non-zero W0 or W1); a cleared slot has all-zero entry → `(free)`.
