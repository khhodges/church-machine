---
name: V20 designer boot-image contract
description: Generator/designer contract facts — thread caps offset floor, sentinels, parse blocks, e2e port traps
---
- Thread capability zone is a FIXED +244 offset, so `threadLumpWords >= 256` is enforced at both step-1 validation (app.py) and generation (boot_image.py). **Why:** smaller bodies can't contain their own CR0 and extra threads would stomp later allocations.
- Sentinels below the NS table: base-1 format tag, base-2 boot-entry slot, base-3 stored nsCount, base-4 threadCount (written only when >1 so legacy images stay byte-identical; 0 ⇒ 1). Neither simulator loadBootImage nor boot_rom.py reads base-4.
- `parse_ns_table_raw` returns: `header` (decoded mem[0] = Thread.1 header, kind:"thread"), synthesized `nsHeader` (slot count packed (cw<<8)|cc, typ=01), and `thread` block (headerWord/size/cr0Word/capsOffset/count/bootSlot). Drill-down shape faults compare these to the approved design; first-run seeding adopts committed NS + thread geometry.
- Legacy nsSlotsMax fallback is `DEFAULT_NS_SLOTS_MAX` (256), NOT MAX_NS_ENTRIES (now 1024) — every reader path must use the 256 default or legacy images mislocate the NS table. Step-3 emptySlotCount validates against configured nsSlotsMax, not the 1024 cap.
- Extra threads (threadCount 2–9) are anonymous resident bodies after catalog allocations (header + CR0 E-GT at +244, no NS entries); threadCount=1/absent is byte-identical to pre-change images.

**E2E trap:** Playwright reuses an existing server on port 5050 (often a stale instance from the long-running e2e-tests workflow). To test fresh server code, run with `E2E_PORT=<other>` — but avoid Chrome-unsafe ports (5060/5061 fail with ERR_UNSAFE_PORT); 5077 works.
