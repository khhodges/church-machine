# Church Machine Abstraction Generation Roadmap

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

## Executive Summary

**Total Abstractions**: 49  
**Total Methods**: ~229  
**Estimated Implementation Timeline**: 18–24 weeks (4.5–6 months) in continuation mode  
**Team Size Assumption**: 2 engineers (1 hardware/core, 1 software/applications)  
**Critical Path**: Tiers 0–3 (hardware + math); Tier 5+ can proceed in parallel

---

## Complete Abstraction Inventory

### **Layer 0 — Boot (4 abstractions, 0 methods)**

Hardware-initialized, non-callable.

| # | Name | Role | Methods |
|---|------|------|---------|
| 0 | Boot.NS | Namespace root | — |
| 1 | Boot.Thread | Thread identity | — |
| 2 | Boot.CList | Boot c-list | — |
| 3 | Boot.[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) | Boot code entry | — |

**Status**: ✅ Complete (firmware/hardware setup only)

---

### **Layer 1 — System Services (7 abstractions, 35 methods)**

Foundational capability management and resource lifecycle.

| # | Name | Methods | Count | Role |
|---|------|---------|-------|------|
| 4 | Salvation | LOAD, TPERM, LAMBDA, TransitionToNavana | 4 | Security smoke test |
| 5 | Navana | Init, Add, Remove, Abstraction.Add, Abstraction.Update, Abstraction.Remove, Manage, Monitor, IDS | 9 | NS master controller |
| 6 | Mint | Create, Revoke, Transfer | 3 | GT lifecycle |
| 7 | Memory | Allocate, Free, Resize | 3 | Memory management |
| 8 | Scheduler | Yield, Spawn, Wait, Stop | 4 | Thread lifecycle |
| 9 | Stack | Push, Pop, Peek, Depth | 4 | Call stack mgmt |
| 10 | DijkstraFlag | Wait, Signal, Reset, Test | 4 | Synchronization |

**Status**: 🔴 Incomplete  
**Blocking Issue**: Navana NS entry writer, mLoad/mSave gates validation

---

### **Layer 2 — Hardware Attachments (5 abstractions, 17 methods)**

Local peripherals via Abstract GTs (0xFE000000+).

| # | Name | Methods | Count | Perms |
|---|------|---------|-------|-------|
| 11 | UART | Send, Receive, SetBaud | 3 | L, S, E |
| 12 | LED | Set, Clear, Toggle, Pattern | 4 | S, E |
| 13 | Button | Read, WaitPress, OnEvent | 3 | L, E |
| 14 | Timer | Start, Stop, Read, SetAlarm | 4 | L, S, E |
| 15 | Display | Write, Clear, Scroll | 3 | L, S, E |

**Status**: 🔴 Not started  
**Blocking Issue**: Abstract GT hardware validation, local peripheral autonomy (boot scanning)

---

### **Layer 3 — Mathematics (4 abstractions, 28 methods)**

Computational abstractions for arithmetic, trigonometry, geometry.

| # | Name | Methods | Count | Notes |
|---|------|---------|-------|-------|
| 16 | SlideRule | Add, Sub, Mul, Div, Sqrt, Log, Pow, Sin, Cos, Tan, Asin, Acos, Atan, ToDegrees, ToRadians | 15 | IEEE 754 FP; CORDIC on hardware |
| 17 | Abacus | Add, Sub, Mul, Div, Mod, Abs | 6 | 64-bit integer |
| 18 | Constants | Pi, E, Phi, Zero, One | 5 | Read-only |
| 19 | Loader | Load, Prefetch, Evict | 3 | Lazy load on-demand |
| 46 | Circle | Area, Circumference | 2 | Delegates to SlideRule |

**Status**: 🟡 Partially complete (SlideRule reference implementation exists in Haskell)  
**Blocking Issue**: FP format agreement, CORDIC implementation

---

### **Layer 4 — Lambda Calculus (9 abstractions, 9 methods)**

Church numerals as DATA-domain code objects. Each is a pure function.

| # | Name | Method | Type | Notes |
|---|------|--------|------|-------|
| 20 | SUCC | Apply | Church numeral | λn. λf. λx. f(n f x) |
| 21 | PRED | Apply | Church numeral | λn. λf. λx. n(λg. λh. h(g f))(λu. x)(λu. u) |
| 22 | ADD | Apply | Church numeral | λm. λn. λf. λx. m f (n f x) |
| 23 | SUB | Apply | Church numeral | λm. λn. n PRED m |
| 24 | MUL | Apply | Church numeral | λm. λn. λf. m(n f) |
| 25 | ISZERO | Apply | Church boolean | λn. n(λx. FALSE) TRUE |
| 26 | TRUE | Apply | Church boolean | λx. λy. x |
| 27 | FALSE | Apply | Church boolean | λx. λy. y |
| 43 | PAIR | Apply | Church pair | λx. λy. λf. f x y |

**Status**: ✅ Reference implementations exist (Haskell, HP-35)  
**Blocking Issue**: None — pure function definitions

---

### **Layer 5 — Social Abstractions (5 abstractions, 19 methods)**

Family, school, friendship, and network connectivity.

| # | Name | Methods | Count | Role |
|---|------|---------|-------|------|
| 28 | Family | Register, Hello, Oversight | 3 | Parent-child bindings |
| 29 | Schoolroom | Join, Lesson, Submit, Grade | 4 | Teacher-student lessons |
| 30 | Friends | Request, Accept, Share, Revoke | 4 | Peer-to-peer sharing |
| 31 | Tunnel | Connect, Send, Receive, Close | 4 | Outform+Far encrypted tunnel |
| 32 | Negotiate | Propose, Approve, Reject, Status | 4 | Dual-approval protocol |

**Status**: 🔴 Not started  
**Blocking Issue**: Tunnel (Outform+Far) working, Negotiation protocol design

---

### **Layer 6 — IDE Abstractions (4 abstractions, 15 methods)**

Development tools.

| # | Name | Methods | Count | Role |
|---|------|---------|-------|------|
| 33 | Editor | Open, Save, Load, Undo | 4 | Source code editing |
| 34 | Assembler | Assemble, Disassemble, Validate | 3 | Assembly translation |
| 35 | Debugger | Step, Run, Breakpoint, Inspect | 4 | Single-step debugging |
| 36 | Deployer | Build, Upload, Verify, Boot | 4 | Compile & flash |

**Status**: 🟡 Partial (Flask backend has compile/upload endpoints)  
**Blocking Issue**: Hardware debugger integration, Tang Nano 20K UART wire protocol

---

### **Layer 7 — Internet Abstractions (6 abstractions, 24 methods)**

Parent-approved external services via Outform+Far.

| # | Name | Methods | Count | Role |
|---|------|---------|-------|------|
| 37 | Browser | Navigate, Back, Bookmark, Search | 4 | Web browsing (parent-gated) |
| 38 | Messenger | Send, Receive, Contacts, Block | 4 | Messaging (Outform+Far tunnel) |
| 39 | Photos | View, Share, Upload, Album | 4 | Photo sharing |
| 40 | Social | Post, Read, Follow, Feed | 4 | Social feed (parent-approved) |
| 41 | Video | Watch, Search, Playlist, Share | 4 | Video streaming |
| 42 | Email | Compose, Read, Reply, Contacts | 4 | Email (parent-SAVEd addresses) |

**Status**: 🔴 Not started (frontend mockups only)  
**Blocking Issue**: Home Base Tunnel + service catalog API, parental control protocol

---

### **Layer 8 — Garbage Collection (1 abstraction, 4 methods)**

Deterministic GC with PP250 bidirectional G-bit.

| # | Name | Methods | Count | Role |
|---|------|---------|-------|------|
| 44 | GC | Scan, Identify, Clear, Flip | 4 | Memory reclamation |

**Status**: 🟡 Partially implemented (gc_unit.py exists)  
**Blocking Issue**: Integration test with full NS table walk

---

### **Layer 9 — Tier A Post-Launch (4 abstractions, 16 methods)**

Foundational services required within 3 months of launch: persistent storage, wall-clock time, asynchronous notification, and device identity.

| # | Name | Methods | Count | Role |
|---|------|---------|-------|------|
| 47 | Store | Get, Set, Create, Delete, List | 5 | GT-gated persistent key-value storage |
| 48 | Clock | Now, Elapsed, Mark, Alarm | 4 | Wall-clock time + timestamp Abstract GTs |
| 49 | Notify | Subscribe, Unsubscribe, Dispatch, Pending | 4 | Asynchronous inbound event signalling |
| 50 | Identity | Attest, Verify, Bind | 3 | Device-bound unforgeable identity GT |

**Status**: 🔴 Missing (not yet started)  
**Blocking Issues**:
- Store: NVM page allocator + Outform GT for Home Base endpoint
- Clock: Clock lump binary + Tunnel epoch-sync at boot (`/api/time`)
- Notify: Notify lump binary + Tunnel `0x10–0x1F` frame type extension
- Identity: Identity lump binary + hardware UID → Abstract GT binding at boot

---

## Method Count Summary

| Layer | Abstractions | Methods | Status |
|-------|--------------|---------|--------|
| 0 (Boot) | 4 | 0 | ✅ Complete |
| 1 (System) | 7 | 35 | 🔴 ~10% |
| 2 (Hardware) | 5 | 17 | 🔴 0% |
| 3 (Math) | 4 | 28 | 🟡 50% |
| 4 (Lambda) | 9 | 9 | ✅ 100% (reference) |
| 5 (Social) | 5 | 19 | 🔴 0% |
| 6 (IDE) | 4 | 15 | 🟡 40% |
| 7 (Internet) | 6 | 24 | 🔴 0% |
| 8 (GC) | 1 | 4 | 🟡 70% |
| 9 (Tier A Post-Launch) | 4 | 16 | 🔴 Missing |
| **TOTAL** | **49** | **229** | **~20%** |

---

## Implementation Timeline (18–24 weeks, Dual-Team)

### **Phase 0 — Unblock (Weeks 1–2)**

**Team 1 (Hardware):**
- Finish Abstract GT type validation in hw_types.py (3 days)
- mLoad/mSave handlers for Abstract addresses (3 days)
- Boot ROM peripheral scanning (2 days)

**Team 2 (Software):**
- Extend NS entry for MTBF counters (2 days)
- Navana skeleton + NS entry writer (5 days)

**Deliverable**: Abstract GTs validated, Navana writing entries, local peripherals discoverable.

**Duration**: 2 weeks  
**Critical Path**: Yes

---

### **Phase 1 — Hardware Drivers (Weeks 3–5)**

**Team 1**: UART, LED, Button, Timer, Display (5 abstractions, 17 methods)

- Abstract GT provisioning for each peripheral (1 week)
- UART → BL616 bridge integration (3 days)
- LED pattern engine (2 days)
- Button event queue (2 days)
- Timer interrupt handler (2 days)
- Display HDMI driver (1 week, most complex)

**Team 2**: Mint + Memory abstractions (6 methods)

- GT creation with permission subsetting (2 days)
- Revocation mechanism (1 day)
- Memory allocation (power-of-2 rounding) (2 days)

**Deliverable**: All 5 hardware drivers functional; code UART debugging; memory allocation working.

**Duration**: 3 weeks  
**Critical Path**: Yes (enables testing of all higher layers)

---

### **Phase 2 — Concurrency Foundations (Weeks 6–8)**

**Team 1**: Scheduler + Stack (8 abstractions, 8 methods)

- Thread spawn/context switch (1 week)
- Call stack depth tracking (3 days)
- Dijkstra semaphore + wait queue (1 week)

**Team 2**: Mint.Revoke end-to-end (3 days)

- Version increment propagation through all CRs
- Stale GT rejection tests

**Parallel**: Outform+Locator integration test (1 week, both teams)

- ZIP inflation with ZLIB
- NS entry minting for lazy-loaded dependencies
- Eviction on memory pressure

**Deliverable**: Multi-threaded programs executable; lazy loading working; synchronization tested.

**Duration**: 3 weeks  
**Critical Path**: Yes (unblocks Layer 5 social abstractions)

---

### **Phase 3 — Network & Home Base (Weeks 9–11)**

**Team 1**: Home Base Tunnel infrastructure (weeks 9–11, 3 weeks)

- Abstract GT failover sequencing (Word 2/3 backups) — 1 week
- Network transport driver (Resend integration) — 1 week
- Per-abstraction bandwidth quota enforcement — 1 week

**Team 2**: MTBF tracking infrastructure

- Invocation/failure counter logic in NS (3 days)
- Hardware S-bit locking based on MTBF tier (2 days)
- IDE policy download + validation (3 days)
- Telemetry serialization (2 days)

**Deliverable**: CMs can reach IDE via Home Base tunnel; MTBF qualification gating abstractions.

**Duration**: 3 weeks  
**Critical Path**: Yes (enables all Layer 5+ abstractions)

---

### **Phase 4 — Lambda Calculus Reference (Weeks 12–13)**

**Team 2**: Church numerals as DATA code objects (9 abstractions, 9 methods)

- Define SUCC, PRED, ADD, SUB, MUL in [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) (3 days)
- ISZERO, TRUE, FALSE (2 days)
- PAIR constructor + tests (2 days)

(Team 1 continues with parallel streams below)

**Deliverable**: Pure lambda arithmetic working end-to-end.

**Duration**: 2 weeks

---

### **Phase 5 — Mathematics Layer (Weeks 12–14)**

**Team 1**: SlideRule + Abacus + Circle (4 abstractions, 28 methods)

- IEEE 754 arithmetic (floating-point package) — 2 days
- Trigonometric functions (Sin, Cos, Tan via Taylor series or CORDIC) — 1 week
- Inverse trig (Asin, Acos, Atan) — 3 days
- Abacus (64-bit integer ops) — 2 days
- Circle geometry (delegates to SlideRule) — 1 day

**Deliverable**: HP-35 calculator fully functional; pure math compilation working.

**Duration**: 3 weeks

---

### **Phase 6 — Social & Networking (Weeks 15–18)**

**Team 1**: Layer 5 (5 abstractions, 19 methods)

- Family namespace isolation + parent-child binding (1 week)
- Schoolroom lesson distribution (1 week)
- Friends peer-to-peer capability sharing (3 days)
- Tunnel encrypted connection establishment (1 week)
- Negotiate dual-approval protocol (1 week)

**Team 2**: Layer 7 Internet abstractions (6 abstractions, 24 methods)

- Browser (Navigate, Back, Bookmark, Search) — 3 days
- Messenger (Send, Receive, Contacts, Block) — 3 days
- Photos (View, Share, Upload, Album) — 3 days
- Social (Post, Read, Follow, Feed) — 3 days
- Video (Watch, Search, Playlist, Share) — 3 days
- Email (Compose, Read, Reply, Contacts) — 2 days

**Deliverable**: Full family governance; school lesson system; external services integrated.

**Duration**: 4 weeks

---

### **Phase 7 — IDE Tooling & Debugger (Weeks 16–18)**

**Team 2**: Layer 6 IDE abstractions (4 abstractions, 15 methods)

- Editor (Open, Save, Load, Undo) — 2 days
- Assembler (Assemble, Disassemble, Validate) — 3 days
- Debugger (Step, Run, Breakpoint, Inspect) — 1 week
- Deployer (Build, Upload, Verify, Boot) — 2 days

(Overlaps with Layer 7 team-work)

**Deliverable**: Full source-level debugging; hardware flashing from IDE.

**Duration**: 3 weeks

---

### **Phase 8 — GC Integration & Hardening (Weeks 19–20)**

**Team 1**: Garbage collection (1 abstraction, 4 methods)

- NS table scan with reachability marking (3 days)
- Mark-and-sweep with G-bit flip (2 days)
- Wraparound safety + TRAP on rapid GC (2 days)

**Team 2**: Security hardening Phase 1 (non-silicon)

- NVM audit logging (CRC failures, permission escalations) — 3 days
- Rate-limiting enforcement on mLoad/SWITCH (2 days)
- Chain-of-custody logging for mSave propagation (2 days)

**Deliverable**: Memory reclamation working; audit trail intact.

**Duration**: 2 weeks

---

### **Phase 9 — Integration & Testing (Weeks 21–24)**

**Both teams**: End-to-end system validation

- Multi-layer abstraction calling (CALL → Scheduler → Timer → UART) — 1 week
- Family + Schoolroom + Tunnel integration test — 1 week
- DoS resistance tests (Claim 9–14 validation) — 1 week
- MTBF qualification gating (reliability thresholds) — 3 days
- Crime-free service scoping (profession/language/age isolation) — 1 week

**Deliverable**: Full system demonstration; all 45 abstractions functional.

**Duration**: 4 weeks

---

## Timeline Summary

| Phase | Duration | Abstractions | Methods | Focus |
|-------|----------|--------------|---------|-------|
| 0 | 2w | 0 | 0 | Unblock: Abstract GTs, Navana, peripheral scanning |
| 1 | 3w | 7 | 23 | Hardware drivers + Mint + Memory |
| 2 | 3w | 3 | 8 | Scheduler + Stack + Locator integration |
| 3 | 3w | 0 | 0 | Home Base Tunnel + MTBF infrastructure |
| 4 | 2w | 9 | 9 | Church numerals (reference) |
| 5 | 3w | 4 | 28 | Mathematics layer |
| 6 | 4w | 5 | 19 | Social abstractions + Layer 7 Internet |
| 7 | 3w | 4 | 15 | IDE tooling |
| 8 | 2w | 1 | 4 | GC + security hardening |
| 9 | 4w | 8 | 107 | Integration + full system test |
| **Tier A** | **≤12w post-launch** | **4** | **16** | Store + Clock + Notify + Identity |
| **TOTAL** | **24w + Tier A** | **49** | **229** | End-to-end CM + Tier A |

---

## Dependencies & Parallel Execution

### Critical Path
```
Phase 0 (Unblock) ──→ Phase 1 (Hardware) ──→ Phase 2 (Concurrency) ──→ Phase 3 (Network)
                          ↓
                    Phase 5 (Math)
                          ↓
                    Phase 6 (Social)
```

### Parallel Streams (No Blocking)
- Phase 4 (Lambda Calculus) — can start at Week 12
- Phase 7 (IDE) — can start at Week 16
- Phase 8 (GC) — can start at Week 19

### Optimal Dual-Team Assignment

**Team 1 (Hardware/Core)**: Phases 0, 1, 2, 3, 5, 8  
**Team 2 (Software/Apps)**: Phases 1 (Mint), 2 (Outform), 4, 6, 7

---

## Effort Breakdown

### Per-Abstraction Effort Estimate

| Category | Effort | Examples |
|----------|--------|----------|
| **Trivial** (1–2 days) | 1–2 methods | Constants (5 methods, 2 days), Button (3 methods, 2 days) |
| **Simple** (2–5 days) | 2–5 methods | UART (3 methods, 3 days), Mint (3 methods, 2 days) |
| **Moderate** (1–2 weeks) | 5–10 methods | Scheduler (4 methods, 1 week), Tunnel (4 methods, 1 week) |
| **Complex** (2–4 weeks) | 10+ methods, hardware integration | SlideRule (15 methods, 3 weeks), Home Base (non-abstraction, 3 weeks) |
| **Very Complex** (4+ weeks) | Architecture-level | Navana (9 methods, 2 weeks), Network integration (3 weeks) |

### Code Generation Volume Estimate

- **Hardware drivers** (Layer 2): ~500 lines Amaranth HDL per driver
- **System services** (Layer 1): ~300–500 lines Python per abstraction
- **Mathematics** (Layer 3): ~200–400 lines per abstraction
- **Social/Internet** (Layers 5–7): ~150–250 lines per abstraction (mostly routing/delegation)
- **Tests**: ~100–200 lines per abstraction

**Total estimated codebase**: ~50–70K lines of code across hardware + software.

---

## Resource Requirements

### Hardware
- Tang Nano 20K FPGA (for iterative testing)
- USB UART adapter
- Optional: Efinix Ti60 F225 (for parallel hardware development)

### Software Stack
- Amaranth HDL (already in place)
- Flask + SQLite (server)
- [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)++ compiler (5 front-ends)
- ZLIB + ZIP handling
- Resend email/SMS API (for Home Base tunnel)
- pytest for integration tests

### Team Capacity
- **2 engineers full-time** (18–24 weeks)
- OR **3–4 engineers part-time** (12–16 weeks)
- OR **1 engineer full-time** (36–48 weeks, not recommended)

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Abstract GT hardware validation delays | Medium | High | Start Phase 0 immediately; use simulation if needed |
| Network transport (Resend) integration complexity | Medium | High | Prototype Home Base messaging in isolation first |
| MTBF counter rollover/edge cases | Low | Medium | Extensive counter behavior tests before Phase 3 |
| GC wraparound edge cases (gt_seq overflow) | Low | Medium | Formal verification of GC state machine |
| Trigonometric precision issues (SlideRule) | Low | Medium | Use CORDIC library; validate against reference implementations |
| Multi-threaded race conditions | Medium | High | Use thread sanitizer; extensive stress tests in Phase 2 |

---

## Success Criteria

**Phase 0**: ✅ Abstract GTs validated by hardware, Navana writes NS entries, peripherals probed at boot  
**Phase 1**: ✅ UART send/receive, LED patterns, Button events, Timer interrupts, Display output  
**Phase 2**: ✅ Multi-threaded programs run; lazy loading; synchronization primitives work  
**Phase 3**: ✅ CMs reach IDE; MTBF gating abstractions; telemetry flowing  
**Phase 4**: ✅ Church numerals compute correctly (SUCC/PRED/ADD verified)  
**Phase 5**: ✅ Trigonometry matches reference (HP-35 comparison); geometric calculations correct  
**Phase 6**: ✅ Family isolation enforced; Schoolroom lessons delivered; Tunnel messaging works  
**Phase 7**: ✅ Browser navigates (simulated); Messenger sends/receives; Email routable  
**Phase 8**: ✅ GC reclaims stale entries; no stale GTs used  
**Phase 9**: ✅ Full integration: 45 abstractions callable in any combination; 9 layers hierarchical; all 14 DoS prevention claims validated; security audit passing  
**Tier A**: ✅ Store persists values across power cycles (TEST-STORE); Clock returns wall time within ±5 s of Home Base (TEST-CLOCK); Notify wakes blocked thread within 500 ms of inbound event (TEST-NOTIFY); Identity.Attest returns hardware-UID-sealed GT (TEST-IDENTITY)  

---

## Conclusion

The Church Machine's 49 abstractions across 10 layers (Layers 0–8 plus the Tier A post-launch layer) represent a **complete, self-contained operating system** with no external kernel dependencies. Implementation in 18–24 weeks (dual-team) is feasible and realistic, with **Phase 0 (Abstract GT validation) as the immediate blocker**. Once that unblocks, Phases 1–3 can proceed in parallel with later layers, achieving a fully functional, security-hardened, capability-based architecture by week 24. The four Tier A abstractions — Store, Clock, Notify, and Identity — are targeted for completion within 12 weeks of device launch, gated on their respective acceptance tests (TEST-STORE, TEST-CLOCK, TEST-NOTIFY, TEST-IDENTITY) as defined in docs/launch.md Section 4.

The abstraction model is **scale-free** — the same pattern (CALL, c-list isolation, MTBF tracking, GT revocation) applies from a boot driver to a global social network. This uniformity means much of the code is templatable, reducing actual implementation time below the linear estimate.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
