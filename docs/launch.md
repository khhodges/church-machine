# Church Machine Launch Readiness

> **HISTORICAL LAUNCH PLAN / NON-AUTHORITATIVE.** This document preserves an
> older Tang-targeted launch design with CRC-16 namespace seals and planned
> encrypted tunnel/attestation claims. Wukong A7 is the current target; shipped
> FW=2 UART is plaintext and unauthenticated, and NS W2 uses public unkeyed
> `integrity32`. Treat security guarantees here as goals unless separately
> supported by current executable or formal evidence.

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

## What "Launch" Means

Launch means a child can receive a Church Machine device, power it on, learn arithmetic, send a message to a parent, receive a reply, have a teacher grant them a new capability, and store their work — all without trusting any external operating system, certificate authority, or centralized server.

This is preserved planning material, not the authoritative shipped specification.

---

## 1. The OS Analogy

When someone asks "what is the Church Machine?" the honest answer is: **it is an operating system, in the same category as Red Hat Linux or Windows**.

A conventional operating system provides:

| OS Service | Red Hat Linux | Windows | Church Machine |
|---|---|---|---|
| Boot and kernel | init / systemd | NT kernel | Boot.NS + Boot.Thread lumps |
| Identity | PAM / UID | Active Directory | Identity lump (GT is the identity) |
| Filesystem | ext4 / VFS | NTFS | Store lump (GT-gated key-value) |
| Clock | CLOCK_REALTIME (kernel) | System clock | Clock lump |
| Notifications | D-Bus signals | WM_USER messages | Notify lump |
| Process management | fork/exec, scheduler | CreateProcess, scheduler | Scheduler + Memory lumps |
| Networking | TCP/IP stack, socket() | Winsock | Tunnel lump (Outform+Far GTs) |
| Package manager | dnf / rpm | MSI / WinGet | Loader lump (lazy ZIP delivery) |
| User accounts | /etc/passwd, su | SAM, GINA | Family + Negotiate lumps |

Every one of those services, in the Church Machine, is delivered as a **lump** — a binary installed in device flash, reachable only through a Golden Token (GT). There is no kernel/userland split. There is no privilege escalation path. There is no `root`. Every service is accessed through `CALL(GT)`, and every GT is checked by hardware on every use.

This is why the launch list is not arbitrary. A child's device that is missing any of the 16 launch lumps is, in OS terms, a computer that is missing its filesystem, its scheduler, or its network stack. It boots but cannot be used.

---

## 2. The 16-Lump Launch List

A child device is considered **genuinely useful** when it can do all of the following without adult intervention:

1. Boot securely and prove the security pipeline is intact.
2. Create and revoke capabilities on behalf of the user.
3. Run two tasks at once without deadlock.
4. Communicate via serial or network transport.
5. Send a message to a parent and receive a reply.
6. Participate in a parent-approved lesson with a teacher.
7. Share a capability with a peer, subject to parent approval.
8. Compute with integers.
9. Lazy-load a lump from the Home Base when storage is needed.

That is exactly 16 lumps. Two are **special** (they are not callable abstractions; they define the device's physical memory map and the boot thread's execution context). Fourteen are **function lumps** (callable via `CALL(GT)`).

| # | NS Slot | Name | Type | Status | Rationale |
|---|---------|------|------|--------|-----------|
| 1 | 0 | Boot.NS | Special — Namespace | exists | Defines the physical address map and pre-populates the NS Table. Without it, no CALL can be validated. |
| 2 | 1 | Boot.Thread | Special — Thread | exists | Holds the boot thread's registers, stack, and heap. Without it, no code can run. |
| 3 | 4 | Salvation | Function | partial | First callable lump. Smoke-tests CALL → TPERM → LAMBDA → Navana handoff. If Salvation reaches TransitionToNavana without faulting, the security pipeline is verified. |
| 4 | 5 | Navana | Function | partial | Master controller and sole NS-entry writer. Runs indefinitely. Without Navana, no new lump can be installed and no capability can be granted. |
| 5 | 6 | Mint | Function | partial | GT lifecycle management. Create, Revoke, Transfer. Without Mint, permissions cannot be granted or revoked and the device cannot onboard any abstraction after boot. |
| 6 | 7 | Memory | Function | partial | Power-of-2 heap allocation. Without Memory, lumps cannot be loaded into RAM from flash. |
| 7 | 8 | Scheduler | Function | missing | Thread spawn, yield, wait, stop. Without Scheduler, only one task can ever run — the device cannot respond to a message while doing arithmetic. |
| 8 | 10 | DijkstraFlag | Function | missing | Semaphore-based inter-thread synchronization. Without DijkstraFlag, threads cannot safely share data and deadlock is undetectable. |
| 9 | 11 | UART | Function — Hardware | partial | Serial byte transport via the BL616 USB bridge. The physical wire through which all tunnel traffic flows on Tang Nano 20K hardware. |
| 10 | 28 | Family | Function | missing | Parent-child namespace binding. Register creates the relationship; Hello sends a message to any family member via their GT. Without Family, a child cannot communicate with anyone. |
| 11 | 31 | Tunnel | Function | missing | Outform+Far encrypted tunnel: Connect, Send, Receive, Close. The protocol carrier for Family.Hello and all cross-device capability grants. |
| 12 | 32 | Negotiate | Function | missing | Dual-approval protocol for capability grants. Without Negotiate, a parent cannot approve a teacher's grant to a child — the three-party trust model collapses. |
| 13 | 29 | Schoolroom | Function | missing | Lesson distribution and grading: Join, Lesson, Submit, Grade. Without Schoolroom, the device is a toy, not a learning machine. |
| 14 | 30 | Friends | Function | missing | Peer-to-peer capability sharing subject to parent approval: Request, Accept, Share, Revoke. Without Friends, children cannot collaborate on work or share tools. |
| 15 | 17 | Abacus | Function | partial | 32-bit integer arithmetic: Add, Sub, Mul, Div, Mod, Abs. The minimum computational substrate. A device that cannot add integers cannot teach mathematics. |
| 16 | 19 | Loader | Function | partial | Lazy-load lumps on demand from Home Base: Load, Prefetch, Evict. The device has limited flash; Loader is the storage and retrieval mechanism that makes the 16-lump device extensible. |

**Four additional abstractions (Store, Clock, Notify, Identity) are being added to the roadmap.** They are not in the 16-lump day-one launch list, but they are required for Tier A readiness (within 3 months of launch). Their roadmap additions are recorded in Section 4.

---

## 3. Acceptance Tests

Each test is observable without source-level access. Pass/fail is determined by running the stated scenario on a physical Tang Nano 20K connected to a Home Base. A test marked **SIM** may be verified in the simulator before hardware is available.

### Boot Tests

**TEST-01: Boot.NS** — Device powers on; the IDE's Device view shows the device as `online` within 10 seconds. The NS Table at `0xFD00` is populated with at least 16 entries; all CRC-16 seals are valid; Navana has written its own entry; no `NS_FAULT` is logged in the boot record.
*(SIM: simulator boots to Navana main loop without FAULT)*

**TEST-02: Boot.Thread** — The boot thread reaches Salvation.TransitionToNavana. The thread lump at NS slot 1 contains valid register state (CR0–CR11 non-zero where expected, PC pointing into Salvation code, stack depth = 0 at entry). No `STACK_OVERFLOW` or `THREAD_FAULT` is logged.
*(SIM: step debugger shows PC advancing through Salvation without fault)*

### System Tests

**TEST-03: Salvation** — A fresh boot completes Salvation end-to-end: `LOAD` validates an E-GT without fault; `TPERM` restricts it to a subset without fault; `LAMBDA` executes without fault; `TransitionToNavana` hands control to Navana and Salvation never returns. The IDE shows Salvation's MTBF counter as ∞ (zero faults since reset).
*(SIM: Salvation instruction trace shows all four methods executing in order, no fault, Navana loop begins)*

**TEST-04: Navana** — After boot, call `Navana.Add` with a valid compiled lump binary. The lump is installed: an NS entry appears at the requested slot, the GT returned is a valid Inform E-GT, and `Navana.Monitor` reports the new slot as `Live`. Call `Navana.Remove` on the same slot: the GT version increments, the slot returns to `NULL`, and a subsequent `CALL` on the old GT triggers `VERSION_MISMATCH`.
*(SIM: full round-trip Add → Monitor → Remove → stale-GT-fault)*

**TEST-05: Mint** — Call `Mint.Create` with a valid parent GT at full permissions. A new GT is returned with the requested subset of permissions. Attempt `Mint.Create` with a permission set that exceeds the caller's own permissions: the call faults with `PERMISSION_ESCALATION`. Call `Mint.Revoke` on a live GT: all outstanding copies of that GT immediately fault on next use.
*(SIM: permission escalation fault + revocation propagation test)*

**TEST-06: Memory** — Call `Memory.Allocate` with size 200 words: returns a GT and allocated size rounded up to 256 (next power of 2). Call `Memory.Allocate` with 0 or a negative size: faults with `INVALID_SIZE`. Call `Memory.Free` on the allocated region: the GT is revoked and memory is reclaimed. A subsequent `Memory.Allocate` of the same size succeeds without increasing total committed memory above the baseline.
*(SIM: allocation round-trip with size validation)*

**TEST-07: Scheduler** — Spawn two threads via `Scheduler.Spawn`. Thread A counts to 1000 in a data register and then calls `Scheduler.Stop`. Thread B writes a pattern to UART. Both threads run to completion; neither deadlocks; the IDE shows both threads as `stopped` (not `faulted`); the UART pattern from Thread B is intact.
*(SIM: two concurrent threads, both reach Stop, no fault)*

**TEST-08: DijkstraFlag** — Create a DijkstraFlag. Spawn Thread A, which calls `DijkstraFlag.Wait` and blocks. Spawn Thread B, which calls `DijkstraFlag.Signal` after a 100-step delay. Thread A unblocks and proceeds to completion. Call `DijkstraFlag.Test` on a non-signalled flag: returns 0. Call `DijkstraFlag.Reset` on a signalled flag: subsequent `Test` returns 0.
*(SIM: wait/signal across two threads, non-blocking Test, Reset)*

### Transport Test

**TEST-09: UART** — Call `UART.Send` with the byte `0x55`. Verify receipt at the attached PC serial monitor. Call `UART.Receive`; the next byte sent from the PC is returned in DR0 within 100 ms. Change baud rate via `UART.SetBaud(9600)` and repeat: the byte round-trip succeeds at 9600 baud. A `UART.Send` without the S-permission GT faults with `PERMISSION_DENIED`.
*(SIM: loopback via BL616 bridge, verified by local\_bridge.py log)*

### Social Tests

**TEST-10: Tunnel** — Call `Tunnel.Connect(outform_GT)` where `outform_GT` refers to a running peer. A session GT is returned. Call `Tunnel.Send(session_GT, payload)`: the peer receives the payload with magic `0xCE11` intact and CRC-32 valid. Call `Tunnel.Receive(session_GT)` on the peer: returns the payload. Call `Tunnel.Close(session_GT)`: the session GT is revoked; a subsequent `Send` on the old session GT faults with `VERSION_MISMATCH`.
*(SIM: two simulator instances connected via local\_bridge.py)*

**TEST-11: Negotiate** — Teacher calls `Negotiate.Propose(SlideRule_GT, E_perm, child_GT)`. The proposal arrives at the parent device via Tunnel. Parent calls `Negotiate.Approve(proposal_GT)`: Mint creates a SlideRule GT, SAVE places it in the child's c-list; the child can then `CALL(SlideRule_GT)` successfully. Parent calls `Negotiate.Reject` on a pending proposal: the proposal GT is revoked; child never receives the capability. A second approval attempt on the same proposal faults with `VERSION_MISMATCH`.
*(SIM: three-party simulator test: child / teacher / parent)*

### Arithmetic Test

**TEST-12: Abacus** — Call `Abacus.Add(3, 4)`: returns 7. Call `Abacus.Mul(6, 7)`: returns 42. Call `Abacus.Div(10, 3)`: returns 3 (integer floor). Call `Abacus.Div(10, 0)`: faults with `DIVISION_BY_ZERO`. Call `Abacus.Mod(17, 5)`: returns 2. Call `Abacus.Abs(-99)`: returns 99. All six methods pass in sequence without fault.
*(SIM: standard arithmetic unit test)*

### Storage Test

**TEST-13: Loader** — Load a lump that is marked `Outform` (not yet resident). The Loader detects `CODE_NOT_RESIDENT` (header magic `0x00`), fetches the ZIP from Home Base (`server/lumps/`), inflates it, writes the lump at a valid address within the existing NS grant, and updates `word0_location`. The caller receives a valid Inform GT and calls the newly loaded lump successfully. Evict the lump under memory pressure: the lump header is zeroed. On next use, Loader fetches and re-inflates it transparently. The NS entry authority (type, limit, gt\_seq, seal) is unchanged throughout.
*(SIM: Loader round-trip with simulated eviction)*

---

## 4. The Four New Abstractions

The following four abstractions are **not in the current 45-entry roadmap**. They are being added. Each has a passing acceptance test that gates its Tier A milestone (within 3 months of device launch).

---

### 4.1 Store

**What it is on Red Hat / Windows**: `fopen` / `fwrite` / SQLite / the Windows Registry. A persistent, named key-value store that survives power cycles.

On the Church Machine there is no filesystem. There are only GTs. Store is the abstraction that maps a name (a capability handle) to a persistent value. Every write is GT-gated: you must hold the Store's S-permission GT to write, and the R-permission GT to read. Revoke the GT and the data is inaccessible — but not deleted. The parent holds the master GT and can see everything.

**Methods**:

| Method | Description |
|--------|-------------|
| `Get(key_GT)` | Read the value at the named slot. Returns value in DR0. Faults if the key GT is stale or has no R perm. |
| `Set(key_GT, value)` | Write value to the named slot. Requires S perm on the key GT. |
| `Create(name_str)` | Allocate a new named slot. Returns a key GT with full R/S permission. |
| `Delete(key_GT)` | Revoke the key GT and free the slot. |
| `List(parent_GT)` | Return the count and names of all slots reachable from parent\_GT. |

**Backend that already exists — three tiers**:

```
Tier 1 — On-device (Tang Nano flash)
  NVM flash pages on the Tang Nano 20K BRAM extension.
  Lump binaries are already stored there (boot-image.bin).
  The Store lump writes key-value pairs to reserved NVM pages.
  No new hardware required; the flash write path already exists
  in boot_image.py and the BL702 firmware.

Tier 2 — Home Base (server/lumps/ + church_machine.db)
  server/app.py exposes /api/lumps/ (JSON manifests), /api/library/
  (lump ZIPs), and SQLite via church_machine.db (models.py: Project,
  Device, TutorialProgress tables).
  The Store lump's Outform path writes through the Tunnel to the
  Home Base Flask server. Already routed by local_bridge.py.

Tier 3 — Cloud (khhodges/cloomc-project on GitHub)
  server/app.py (lines 1215–1250) implements github_push_file()
  and github_api(). Lump binaries and named values can be pushed
  to the GitHub repo at build time. The Store lump's Archive method
  triggers a Tier 3 push via the existing github_push_file() call.
```

**What must still be built on-device**:
- Store lump binary (CLOOMC++ source → assembled lump)
- NVM page allocator in the Store lump's c-list (Tier 1 path)
- Outform GT for the Home Base endpoint (Tier 2 path)

**Acceptance test (Tier A gate)**:

`TEST-STORE: Store` — Call `Store.Create("score")`: returns a key GT. Call `Store.Set(key_GT, 42)`. Power-cycle the device. After reboot, call `Store.Get(key_GT)`: returns 42 (persisted). Call `Store.Delete(key_GT)`: subsequent `Get` faults with `VERSION_MISMATCH`. Call `Store.List(parent_GT)` with the master GT: returns a list containing at least the "score" slot before deletion.

---

### 4.2 Clock

**What it is on Red Hat / Windows**: `clock_gettime(CLOCK_REALTIME)` / `GetSystemTime()`. A source of wall-clock time and elapsed time.

On the Church Machine there is no kernel providing a time syscall. The Clock lump reads from the Tang Nano 20K's hardware timer (the Timer abstraction at NS slot 14) and from the Home Base's system clock (via Tunnel). It mints timestamped Abstract GTs so that Schoolroom lessons can have deadlines, Negotiate proposals can expire, and MTBF counters can report fault rates in real time rather than in step counts.

**Methods**:

| Method | Description |
|--------|-------------|
| `Now()` | Returns current Unix timestamp in DR0 (seconds since epoch, Home Base-synchronized). |
| `Elapsed(start_GT)` | Returns elapsed seconds since the Abstract GT `start_GT` was created. |
| `Mark()` | Mints a timestamp Abstract GT capturing the current instant. |
| `Alarm(delta_seconds)` | Returns a one-shot Abstract GT that fires the Absent event after `delta_seconds`. Integrates with DijkstraFlag to wake a sleeping thread. |

**Backend that already exists**:
- Tang Nano 20K hardware timer (Timer abstraction, NS slot 14) provides a 32-bit tick counter.
- Home Base Flask server knows wall time; `local_bridge.py` already relays JSON payloads and can include a `ts` field.
- `church_machine.db` `Device.last_seen` and `Device.first_seen` columns (models.py) track device time.

**What must still be built on-device**:
- Clock lump binary that reads the hardware timer, applies the Home Base epoch offset, and mints timestamp Abstract GTs.
- Tunnel integration for epoch synchronization at boot (one-shot `Tunnel.Send` to the Home Base `/api/time` endpoint).

**Acceptance test (Tier A gate)**:

`TEST-CLOCK: Clock` — Call `Clock.Now()`: returns a Unix timestamp within ±5 seconds of the actual wall clock (verified against Home Base). Call `Clock.Mark()`: returns a timestamp GT. Wait at least 1 second and call `Clock.Elapsed(mark_GT)`: returns a value ≥ 1.0. Call `Clock.Alarm(3)`: after 3 seconds the alarm GT fires the Absent event; a thread blocked on `DijkstraFlag.Wait` wakes within 100 ms.

---

### 4.3 Notify

**What it is on Red Hat / Windows**: `inotify` (Linux) / `WM_NOTIFY` (Windows) / push notification delivery. A mechanism for one part of the system to alert another asynchronously, without polling.

On the Church Machine, Notify is the inbound signalling layer. When a parent approves a Negotiate proposal, the child's device must wake up and process the arriving GT — even if the child is in the middle of a Schoolroom lesson. Notify delivers the signal as a DijkstraFlag event, so the sleeping thread wakes safely without any polling loop.

**Methods**:

| Method | Description |
|--------|-------------|
| `Subscribe(event_type, flag_GT)` | Register a DijkstraFlag to be signalled when `event_type` occurs. Returns a subscription GT. |
| `Unsubscribe(subscription_GT)` | Remove the subscription; revoke the subscription GT. |
| `Dispatch(event_GT)` | Internal method (Tunnel calls this). Receives an inbound event from the wire and signals the appropriate DijkstraFlag. |
| `Pending()` | Returns the count of undelivered events for the current thread. |

**Backend that already exists**:
- `local_bridge.py` already routes inbound messages from the Home Base to the device.
- `DijkstraFlag` (NS slot 10) is in the launch list and provides the wakeup primitive.
- `Tunnel.Receive` already delivers the raw byte stream; Notify is the demultiplexer above it.

**What must still be built on-device**:
- Notify lump binary (event routing table, subscription registry in c-list).
- Integration with Tunnel: Tunnel must call `Notify.Dispatch` on inbound frames whose type byte is in the `0x10–0x1F` reserved notification range (extending the `0xCE11` wire format).

**Acceptance test (Tier A gate)**:

`TEST-NOTIFY: Notify` — Thread A calls `Notify.Subscribe(EVENT_GT_TRANSFER, flag_GT)` and then `DijkstraFlag.Wait(flag_GT)`, blocking. From the Home Base, trigger a `GT_TRANSFER` message on the wire. Thread A unblocks within 500 ms. Call `Notify.Pending()` before the event fires: returns 0. Call `Notify.Unsubscribe(sub_GT)`: subsequent inbound `GT_TRANSFER` messages do not wake the thread.

---

### 4.4 Identity

**What it is on Red Hat / Windows**: `/etc/machine-id` (Linux) / `GetComputerNameEx` (Windows) / a PKI certificate. A stable, unforgeable proof of who this device is.

On the Church Machine, identity is not a string — it is a GT. The Identity lump mints a device-bound Abstract GT whose `word0_location` is the Tang Nano 20K's unique hardware serial (`Device.device_uid` in church\_machine.db). The GT cannot be transferred or copied. Every Tunnel connection starts with an Identity attestation exchange, so both sides know they are talking to a genuine registered device, not a replay.

**Methods**:

| Method | Description |
|--------|-------------|
| `Attest()` | Returns the device's identity GT — an Abstract GT sealed to the hardware UID. |
| `Verify(remote_GT)` | Checks that `remote_GT` is a valid, non-stale Identity GT for the device recorded in the NS entry. Returns 1 in DR0 on success, faults if invalid. |
| `Bind(identity_GT, service_GT)` | Associates a service GT with this device's identity, so the Home Base can route messages correctly. |

**Backend that already exists**:
- `Device.device_uid` (8-hex-digit string, models.py) is stored in `church_machine.db` and sent by the device at call-home.
- `server/app.py` `/api/devices/<uid>` endpoint exposes device identity for verification.
- Abstract GT minting already exists in the Loader infrastructure.

**What must still be built on-device**:
- Identity lump binary that reads the hardware UID from NVM at boot, mints the identity Abstract GT, and stores it in the boot NS table.
- `Verify` implementation that cross-checks an inbound Abstract GT's sealed location against the Home Base device registry.

**Acceptance test (Tier A gate)**:

`TEST-IDENTITY: Identity` — Call `Identity.Attest()`: returns an Abstract GT whose sealed location matches the device's `device_uid`. On a second device, pass the first device's identity GT to `Identity.Verify(remote_GT)`: returns 1. Pass a tampered GT (seal mismatch): faults with `SEAL_MISMATCH`. After `Mint.Revoke` on the identity GT: `Verify` on any device faults with `VERSION_MISMATCH`.

---

## 5. The Cut List — 29 Abstractions Not Needed at Launch

The original roadmap contains 45 abstractions. 16 are required for launch. The remaining **29 are deferred** — not cancelled, but moved to post-launch tiers based on which infrastructure they need and how quickly they deliver user value.

### Tier A — First 3 Months Post-Launch

These abstractions have small implementation footprints or fill gaps that become obvious quickly after the first devices ship.

| NS Slot | Name | Layer | Why Deferred | Notes |
|---------|------|-------|--------------|-------|
| 2 | Boot.CList | 0 — Boot | Hardware-initialized; no user-callable interface needed at launch | Already present as a boot entry; no lump to ship |
| 3 | Boot.CLOOMC | 0 — Boot | Hardware-initialized; boot code entry is burned in firmware | Already present as a boot entry |
| 9 | Stack | 1 — System | Hardware enforces stack bounds; the lump is a managed wrapper that adds depth tracking. Useful for IDE debugging, not day-one use. | Low risk: hardware STACK_OVERFLOW faults without this |
| 12 | LED | 2 — Hardware | Useful for diagnostics but not needed for communication or learning | Single-day implementation once Abstract GT hardware is validated |
| 13 | Button | 2 — Hardware | Same as LED; input events handled via UART for launch | Single-day implementation |
| 14 | Timer | 2 — Hardware | Clock lump (Tier A new abstraction) provides wall time; hardware timer tick available without a separate lump | Needed for Clock lump's internals |
| 15 | Display | 2 — Hardware | HDMI driver is the most complex hardware abstraction; useful for standalone UI but launch uses UART + IDE | Most complex driver; 1–2 weeks |
| 18 | Constants | 3 — Math | Pi, E, Phi are needed for SlideRule (Tier B), not Abacus. No learning use case at launch requires irrational constants. | Trivial to implement once SlideRule is needed |
| — | Store | NEW | Tier A new addition (Section 4.1) | |
| — | Clock | NEW | Tier A new addition (Section 4.2) | |
| — | Notify | NEW | Tier A new addition (Section 4.3) | |
| — | Identity | NEW | Tier A new addition (Section 4.4) | |

### Tier B — 6 Months Post-Launch

These abstractions require either the floating-point pipeline (SlideRule), the full Lambda infrastructure, or the GC to be stable before they can be built and tested.

| NS Slot | Name | Layer | Why Deferred | Notes |
|---------|------|-------|--------------|-------|
| 16 | SlideRule | 3 — Math | IEEE 754 floating point + CORDIC trig; significant implementation work. Abacus covers all integer arithmetic needed at launch. | Needed for science curriculum (Tier B) |
| 20 | SUCC | 4 — Lambda | Church numerals are computationally complete but have no user-facing value at launch; the math curriculum uses Abacus integers | Reference implementation exists in Haskell |
| 21 | PRED | 4 — Lambda | Same as SUCC | |
| 22 | ADD | 4 — Lambda | Same as SUCC | |
| 23 | SUB | 4 — Lambda | Same as SUCC | |
| 24 | MUL | 4 — Lambda | Same as SUCC | |
| 25 | ISZERO | 4 — Lambda | Same as SUCC | |
| 26 | TRUE | 4 — Lambda | Same as SUCC | |
| 27 | FALSE | 4 — Lambda | Same as SUCC | |
| 43 | PAIR | 4 — Lambda | Same as SUCC | |
| 44 | GC | 8 — GC | Garbage collection requires a stable NS table walk implementation. Devices at launch will have small c-lists; GC pressure is low. | gc_unit.py partial implementation exists |

### Tier C — Long-Term (6+ Months)

These abstractions require the Home Base Tunnel to be production-hardened and the full Internet layer to be operational. They are the Church Machine's equivalent of a web browser and app store — powerful, but built on top of everything else.

| NS Slot | Name | Layer | Why Deferred | Notes |
|---------|------|-------|--------------|-------|
| 33 | Editor | 6 — IDE | Source code editing works in the Home Base web IDE; the on-device Editor is for self-hosting and offline work | Flask backend already has compile/upload endpoints |
| 34 | Assembler | 6 — IDE | Same as Editor | Hardware debugger integration needed |
| 35 | Debugger | 6 — IDE | Hardware single-step debugger requires stable JTAG or UART protocol | Most complex IDE tool |
| 36 | Deployer | 6 — IDE | Build + flash already works from the Home Base IDE; on-device Deployer enables self-hosting | BL702 firmware flash path needed |
| 37 | Browser | 7 — Internet | Requires parent-approved Tunnel service catalog; not available at launch | Frontend mockups exist |
| 38 | Messenger | 7 — Internet | Internet-scale messaging requires full Tunnel + service catalog; Family.Hello covers family messaging at launch | |
| 39 | Photos | 7 — Internet | Requires Display (Tier A) + Internet Tunnel | |
| 40 | Social | 7 — Internet | Parent-approved social feed; requires service catalog and content policy infrastructure | |
| 41 | Video | 7 — Internet | Requires Display + high-bandwidth Tunnel | |
| 42 | Email | 7 — Internet | Parent-SAVE'd address list needed; Resend integration is server-side; on-device lump is the last mile | |

**Total deferred from existing 45**: 29 abstractions across Tiers A, B, and C.  
**Total new roadmap additions**: 4 (Store, Clock, Notify, Identity) — all Tier A.  
**Total expanded roadmap**: 49 abstractions.

---

## 6. Launch Readiness Checklist

One checkbox per acceptance test. Copy this into the milestone tracker. A release is declared ready when all 16 boxes are checked.

```
Boot
[ ] TEST-01  Boot.NS       — Device online; NS Table valid; all CRC seals pass
[ ] TEST-02  Boot.Thread   — Boot thread reaches Navana; no THREAD_FAULT

System
[ ] TEST-03  Salvation     — All four methods pass; MTBF = ∞; Navana takes over
[ ] TEST-04  Navana        — Lump Add → Monitor → Remove round-trip; stale GT faults
[ ] TEST-05  Mint          — Subset permission enforced; escalation faults; Revoke propagates
[ ] TEST-06  Memory        — Power-of-2 alloc; size-0 faults; Free reclaims
[ ] TEST-07  Scheduler     — Two threads run to completion; no deadlock
[ ] TEST-08  DijkstraFlag  — Wait blocks; Signal wakes; Test non-blocking; Reset clears

Transport
[ ] TEST-09  UART          — Byte send/receive at 115200 and 9600; permission denied faults

Social
[ ] TEST-10  Tunnel        — Connect → Send → Receive → Close; stale session faults
[ ] TEST-11  Negotiate     — Approve delivers GT to child; Reject never delivers; replay faults

Arithmetic
[ ] TEST-12  Abacus        — Add, Sub, Mul, Div, Mod, Abs all correct; Div-by-zero faults

Storage
[ ] TEST-13  Loader        — Absent lump fetched, inflated, installed; eviction transparent;
                             NS authority unchanged throughout
```

---

## Appendix — Rationale for Tier Assignment

### Why all Layer 5 Social abstractions make the launch list

The social layer (Family, Schoolroom, Friends, Tunnel, Negotiate) is the entire point of the Church Machine for a child. A device that can compute but cannot communicate with parents or teachers is a calculator, not an OS. All five social abstractions are in the launch list because they form an indivisible trust model: Family gives you the relationships, Tunnel carries the messages, Negotiate gates the grants, Schoolroom delivers the lessons, and Friends enables collaboration. Remove any one and the model breaks.

### Why Lambda Calculus is Tier B, not launch

The Lambda Calculus lumps (SUCC through PAIR) are academically important — they prove the machine is computationally complete without any Turing-domain instructions. But a child learning addition does not need Church numerals. Abacus (32-bit integers) covers the arithmetic curriculum. Lambda Calculus becomes relevant when teaching computer science theory, which is a Tier B curriculum goal.

### Why IDE tools are Tier C

The Home Base web IDE already provides compile, assemble, upload, and debug services via the Flask backend (`server/app.py`). On-device IDE lumps (Editor, Assembler, Debugger, Deployer) are needed for **self-hosting** — running the development environment on the Church Machine itself, without a connected PC. That is a powerful goal, but it requires the full hardware debugger and a complete Tunnel service catalog. It is firmly Tier C.

### Why the four new abstractions (Store, Clock, Notify, Identity) are Tier A, not launch

They are needed quickly — within the first 3 months — because:
- **Store**: Lessons produce work that must survive power cycles. Without Store, every session starts from scratch.
- **Clock**: Negotiate proposals need expiry. MTBF counters need wall-clock rates. Schoolroom deadlines need timestamps.
- **Notify**: Without Notify, a child's device must poll for inbound GT grants. Polling wastes CPU and misses messages.
- **Identity**: Without Identity, the Tunnel cannot distinguish a genuine device from a replay. The FamilyRegistry binding is meaningless without attestation.

They are not in the day-one launch list because their backends (NVM page allocator, epoch synchronization, notification wire format, hardware UID attestation) require infrastructure that comes after the 16 core lumps are stable.

### Why Civilizational-Scale Abstractions Are Out of Scope

Space, Democracy, Justice, and similar civilization-level abstractions are noted as future direction only. They are scale-free applications of the same capability model, not new mechanisms. They do not appear in this document.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
