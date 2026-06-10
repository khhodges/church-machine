# Abstraction / LUMP / Method Development Plan

**Date:** 2026-06-10  
**Status:** Living document — update as items complete  
**Reference:** `docs/cm-msg-protocol.md` (V1), `docs/cloomc-foundation.md`

---

## Reading the status column

| Symbol | Meaning |
|--------|---------|
| `◯` | Not started |
| `◐` | Partial — simulator logic or CLOOMC source exists, no deployed LUMP |
| `▣` | LUMP binary exists, no CM_MSG OGT assigned |
| `●` | Fully deployed — LUMP + OGT + manifest entry + bridge-tested |

---

## Tier 0 — Protocol infrastructure
*Nothing else can communicate securely until these exist.*

| # | Item | Status | Blocks |
|---|------|--------|--------|
| T0.1 | **CM_MSG bridge parser** (`callhome_bridge.py`) — HMAC verify → nonce check → AES decrypt → OGT dispatch pipeline per Section 4 of spec | `◯` | Everything |
| T0.2 | **Firmware ns_manifest emission** (`main.c`) — CALLHOME payload extended to include `ns_manifest` list of `{token, label, resident}` OGT objects | `◯` | Everything |
| T0.3 | **SHA32 definition** — implement `token_32 = first 4 bytes of SHA-256(ogt_bytes)` in both firmware (C) and bridge (Python); collision detection at manifest load | `◯` | T0.1, T0.2 |
| T0.4 | **Per-abstraction key derivation** — `mint_abstraction_keys(board_uid, ogt)` in bridge; corresponding `cm_get_key(ogt)` stub in firmware BRAM | `◯` | T0.1 |
| T0.5 | **Nonce management** — 64-bit `nonce_ctr` per `(board_uid, ogt)`; strict greater-than enforcement in bridge; nonce increment in firmware per send | `◯` | T0.1 |

---

## Tier 1 — Core: minimum viable board
*Three abstractions that make a board registered, observable, and self-loading.*

| # | Abstraction | OGT | NS Slot | Methods | Status | Notes |
|---|-------------|-----|---------|---------|--------|-------|
| T1.1 | **BoardIdentity** | `global.Core.BoardIdentity.boot` | assigned by boot | `Identify` → returns `{board_uid, fw_version, build_date, profile}` | `◯` | Sent with every CALLHOME (0x01); the mandatory anchor for all other OGTs |
| T1.2 | **FaultReporter** | `global.Core.FaultReporter.boot` | assigned by boot | `Report(fault_code, nia, gt, stage)`, `GetLog(n)` | `◐` | Fault logging exists in simulator; needs LUMP binary + OGT; carries msg_types 0x02 (FAULT) and 0x07 (BOOT_LOG) |
| T1.3 | **LumpLoader** | `global.Core.LumpLoader.boot` | NS 19 (existing) | `Load(slot)`, `Prefetch(slot)`, `Evict(slot)` | `▣` | Loader LUMP `00130000` already compiled at NS 19; needs OGT assigned and wired to CM_MSG msg_type 0x04 (LUMP_REQ) |

---

## Tier 2 — Core: full operational
*Board can be fully monitored, debugged, and managed by the IDE.*

| # | Abstraction | OGT | NS Slot | Methods | Status | Notes |
|---|-------------|-----|---------|---------|--------|-------|
| T2.1 | **Heartbeat** | `global.Core.Heartbeat.boot` | assigned by boot | `Ping` → `{timestamp, uptime_s, step_count}` | `◯` | Lowest privilege — msg_type 0x06 (PING/PONG); runs before full session is established; trivial LUMP |
| T2.2 | **NSInspector** | `global.Core.NSInspector.boot` | assigned by boot | `Dump` → serialised NS table snapshot | `◯` | Read-only (R perm only); msg_type 0x05 (NS_DUMP); lets IDE verify what is actually deployed; essential for debugging |
| T2.3 | **TraceEmitter** | `global.Core.TraceEmitter.boot` | assigned by boot | `Enable(rate)`, `Disable`, `Flush` | `◐` | Simulator has trace output; needs LUMP + CM_MSG OGT; feeds live Pipeline view in IDE via msg_type 0x03 (TRACE) |
| T2.4 | **PerfReporter** | `global.Core.PerfReporter.boot` | assigned by boot | `Sample` → `{instructions, cache_hits, faults, uptime}` | `◯` | MTBF calculation source; msg_type 0x08 (PERF); enables IDE performance dashboard |

---

## Tier 3 — System abstractions: kernel layer
*Platform services that all application abstractions depend on.*

| # | Abstraction | OGT | NS Slot | Methods | Status | Notes |
|---|-------------|-----|---------|---------|--------|-------|
| T3.1 | **Scheduler** | `global.Core.Scheduler.boot` | NS 8 (existing) | `Yield`, `Spawn`, `Wait`, `Stop`, `Pause(deadline)`, `IRQ` | `◐` | Simulator fully implemented including 3-tier fault recovery and timer IRQ; needs LUMP binary compiled and ns_slot verified; `IRQ` method is NS 50 (Scheduler.IRQ.Thread) |
| T3.2 | **Navana** | `global.Core.Navana.boot` | NS 5 (existing) | `Init`, `Add`, `Manage` | `◐` | CLOOMC source exists (`simulator/cloomc/navana.cloomc`); namespace controller — required for all dynamic abstraction creation; needs LUMP binary |
| T3.3 | **Mint** | `global.Core.Mint.boot` | NS 6 (existing) | `Create`, `Revoke` | `◐` | CLOOMC source exists (`simulator/cloomc/mint.cloomc`); security primitive — required for capability minting; needs LUMP binary |
| T3.4 | **Memory** | `global.Core.Memory.boot` | NS 7 (existing) | `Allocate`, `Free` | `◐` | CLOOMC source exists (`simulator/cloomc/memory.cloomc`); physical allocator underpinning all LUMP placement; needs LUMP binary |
| T3.5 | **Salvation** | `global.Core.Salvation.boot` | NS 4 (existing) | `LAMBDA`, `TransitionToNavana`, `LOAD`, `TPERM` | `◐` | Boot entry point in simulator; needs LUMP binary and OGT formalisation |

---

## Tier 4 — Telecommunications namespace
*The flagship application namespace — primary educational demo and OGT mobility showcase.*

| # | Abstraction | OGT | NS Slot | Methods | Status | Notes |
|---|-------------|-----|---------|---------|--------|-------|
| T4.1 | **Contact** | `global.Telecommunications.{canonical_name}.{instance}` | dynamic | `Call`, `Message`, `GetProfile`, `SetLabel` | `◐` | CLOOMC source in `Contact.cloomc`, `ContactCall.cloomc`, `ContactStage2.cloomc`; no LUMP binary yet; roaming deployment |
| T4.2 | **CallHistory** | `global.Telecommunications.CallHistory.{instance}` | dynamic | `Append(entry)`, `GetRecent(n)`, `Clear` | `◯` | Canonical resident deployment example (state is board-local); needs CLOOMC source + LUMP binary; `resident: true` in manifest |
| T4.3 | **MessageBox** | `global.Telecommunications.MessageBox.{instance}` | dynamic | `Send(to, body)`, `Receive`, `ListUnread` | `◯` | Defined in spec as Telecommunications abstraction type; no source yet |
| T4.4 | **VoiceChannel** | `global.Telecommunications.VoiceChannel.{instance}` | dynamic | `Open(contact)`, `Close`, `SendFrame(pcm)` | `◯` | μ-law 8kHz fits within 115,200 baud budget (see Appendix A); needs MediaConsumer coordination |
| T4.5 | **Tunnel (OGT)** | `global.Core.Tunnel.boot` | NS 31 (existing) | `Send(data)`, `Receive`, `Connect(target)` | `▣` | LUMP `00001f00` already compiled at NS 31; needs OGT assigned and CM_MSG encryption wired |
| T4.6 | **Mum** | instance of Contact | — | inherits Contact methods | `◐` | `simulator/cloomc/Mum.cloomc` exists as a Contact usage example; no binary |

---

## Tier 5 — Library and math abstractions
*Educational content available immediately after boot.*

| # | Abstraction | OGT | NS Slot | Methods | Status | Notes |
|---|-------------|-----|---------|---------|--------|-------|
| T5.1 | **WordString** | NULL (data LUMP) | — | `Length`, `Concat`, `Slice`, `ToUpper`, `Compare` | `▣` | LUMP `ab1e86af` exists; NULL policy (no NS slot); needs methods documented and expanded; referenced as canonical NULL LUMP example |
| T5.2 | **SlideRule** | `global.Core.SlideRule.boot` | NS 16 (existing) | `Multiply`, `Divide`, `Sqrt`, `Log`, `Sin`, `Cos` | `▣` | Two LUMPs at NS 16 (`00001000`, `00001001`); trig methods need implementing; the flagship hands-on math tool |
| T5.3 | **Abacus** | `global.Core.Abacus.boot` | NS 17 (existing in sim) | `Add`, `Sub`, `Reset`, `GetDisplay` | `◐` | Simulator has Abacus; no LUMP binary; basic arithmetic with bead-counting model |
| T5.4 | **Constants** | `global.Core.Constants.boot` | NS 18 (existing) | `Get(name)` → Pi, E, Phi, Sqrt2, … | `▣` | LUMP `00001200` at NS 18; needs OGT and method index formalisation |
| T5.5 | **Keystone** | `global.Core.Keystone.boot` | NS 32 (existing, resident) | `Deploy(lump_token)`, `GetTopology` | `▣` | LUMP `00002000` at NS 32; `boot_resident=True`; application namespace anchor; needs OGT and Visual NS Builder integration |
| T5.6 | **billing** | `global.Finance.Billing.{instance}` | dynamic | `RecordUsage`, `GetBalance`, `Invoice` | `◐` | CLOOMC source in `simulator/cloomc/billing.cloomc`; Finance namespace demonstration; no LUMP binary |
| T5.7 | **PhysicalPool** | `global.Core.PhysicalPool.boot` | dynamic | `Acquire`, `Release`, `Status` | `◐` | CLOOMC source in `simulator/cloomc/physical_pool.cloomc`; pre-allocation pool manager; implements the pool pattern from Appendix A.5 |

---

## Tier 6 — Extended capabilities
*Advanced features gated on Tier 0–2 being complete.*

| # | Abstraction | OGT | NS Slot | Methods | Status | Notes |
|---|-------------|-----|---------|---------|--------|-------|
| T6.1 | **MediaConsumer** | `global.Core.MediaConsumer.boot` | assigned by boot | `Fetch(token)`, `StreamChunk(n)`, `Acknowledge` | `◯` | JPEG/audio chunked delivery; msg_types 0x09–0x0A; requires `CM.IDE.MediaServer` counterpart |
| T6.2 | **BrowseClient** | `global.Core.BrowseClient.boot` | assigned by boot | `Request(url)`, `GetPage`, `Navigate(rel)` | `◯` | Capability-secured web access; C-list contains domain GTs (`CM.Domain.BBCNews`, etc.); msg_types 0x10–0x14; requires `CM.IDE.BrowseProxy` |
| T6.3 | **Ethernet** | `global.Core.Ethernet.boot` | NS 40 (sim) | `Send(frame)`, `Receive`, `GetMAC`, `SetFilter` | `◐` | CLOOMC source in `simulator/cloomc/ethernet.cloomc`; depends on hardware Ethernet peripheral; Ti60 profile only |

---

## Tier 7 — Educational demonstration LUMPs
*Formal LUMPs for example programs — compile canonical sources to binaries.*

| # | Item | Source | Status | Notes |
|---|------|--------|--------|-------|
| T7.1 | **Dijkstra flag** (assembly + Ada + Haskell variants) | `simulator/cloomc/dijkstra_flag*.cloomc` | `◐` | Three variants proving multi-frontend compilation; needs formal LUMP binaries for catalog |
| T7.2 | **Lambda Calculus examples** | `simulator/cloomc/lambda_*.cloomc` | `◐` | Church encoding, fixed point, rational arithmetic, SlideRule in Lambda; catalog entries |
| T7.3 | **Ada / Symbolic Math examples** | `simulator/cloomc/ada_note_g*.cloomc` | `◐` | Series calculation, published bug reproduction, symbolic math frontend demo |
| T7.4 | **Bernoulli numbers** | `simulator/cloomc/bernoulli_numbers.cloomc` | `◐` | Mathematical demonstration; catalog entry |
| T7.5 | **Church Math / Pair / Case** | `simulator/cloomc/church_*.cloomc` | `◐` | Pure lambda-calculus arithmetic primitives |
| T7.6 | **English frontend examples** | `simulator/cloomc/english_*.cloomc` | `◐` | Loops, integer ops, packed strings, Contact usage — English frontend showcases |
| T7.7 | **PostFlashSelftest** | `server/lumps/d906a27f.lump` | `▣` | Already compiled; runs on boot to verify LUMP loading; needs OGT and boot-chain integration |

---

## Dependency graph (simplified)

```
T0 (Protocol)
  └── T1 (Min viable board)
        ├── T2 (Full operational)
        │     └── T3 (Kernel layer)
        │           ├── T4 (Telecommunications)
        │           ├── T5 (Library / Math)
        │           └── T6 (Extended)
        └── T7 (Demo LUMPs — can start in parallel with T2+)
```

`T7` can begin immediately — demo LUMPs require only the CLOOMC compiler and
the existing LUMP build pipeline. They do not depend on CM_MSG infrastructure.

`T5.1–T5.5` (existing LUMPs) can receive OGT assignments and method documentation
in parallel with T0–T2.

---

## IDE counterparts required (server-side)

Each firmware abstraction has a paired IDE service. These must be built alongside
the firmware LUMP, not after.

| Firmware abstraction | IDE service GT | Route | Implementation file |
|---|---|---|---|
| BoardIdentity | `CM.IDE.CallhomeService` | POST `/api/device/call-home` | `server/app.py` (exists, needs CM_MSG upgrade) |
| FaultReporter | `CM.IDE.FaultReceiver` | POST `/api/device/fault` | `server/app.py` (exists, needs OGT validation) |
| LumpLoader | `CM.IDE.LumpServer` | GET `/api/lump/{token}` | `server/app.py` (exists, needs Loader OGT check) |
| Heartbeat | `CM.IDE.HeartbeatService` | inline PONG | `callhome_bridge.py` |
| NSInspector | `CM.IDE.NSAuthority` | GET `/api/ns/{board_uid}` | `server/app.py` (new endpoint) |
| TraceEmitter | `CM.IDE.TraceReceiver` | WebSocket `/ws/trace/{board_uid}` | new |
| PerfReporter | — | POST `/api/device/perf` | new |
| MediaConsumer | `CM.IDE.MediaServer` | GET `/api/media/{token}` | new |
| BrowseClient | `CM.IDE.BrowseProxy` | POST `/api/browse` | new |

---

## What can start today (no blockers)

1. **T7 demo LUMPs** — run `node simulator/assembler.js` on each `.cloomc` source,
   package as `.lump` + sidecar, add to manifest. Pure compiler work.

2. **T0.3 SHA32 implementation** — add `sha32(ogt)` to `callhome_bridge.py` and
   a matching C implementation in `hardware/soc_minimal/firmware/main.c`. Standalone,
   no dependencies.

3. **T5.1 WordString method documentation** — the LUMP exists; document all methods
   with their slot indices and CLOOMC calling conventions.

4. **T5.2 SlideRule trig expansion** — the LUMP exists at NS 16; add `Sin`, `Cos`,
   `Log` methods to the CLOOMC source and recompile.

5. **T1.2 FaultReporter CLOOMC source** — write the `.cloomc` file; the fault
   logging logic already exists in `simulator.js`, it just needs to become a
   formal abstraction with an OGT.

---

## Sapphire SoC as Trusted Security Base

*Architectural note — does not require FPGA changes.*

The Sapphire SoC (RISC-V rv32im soft-core) is already the physical Trusted Security
Base for the CM_MSG protocol. Its RAM (`0xF9004000–0xF9007FFF`) is private — the
Church Machine core has no bus path to read it. This makes it the correct and
natural home for K_enc/K_mac secrets derived by HKDF after each CALLHOME.

### APB3 bridge register map (already wired in hardware)

| Offset | Name | Access | What it provides |
|---|---|---|---|
| `0x00` | `CTRL` | R/W | Drive CM push_button from software (brief pulse = single-step; hold ≥1s = free-run) |
| `0x04` | `STATUS` | RO | `boot_complete`, `fault_valid`, `fault_latched` |
| `0x08` | `NIA` | RO | Live CM program counter — every cycle |
| `0x0C` | `FAULT` | RO | Fault code [4:0] |
| `0x10/14` | `UID_LO/HI` | R/W | 64-bit device UID (firmware writes at boot) |
| `0x18` | `FAULT_GT` | RO | GT word0 of faulting capability (latched on fault) |
| `0x1C` | `FAULT_INSTR` | RO | Instruction word at fault NIA |
| `0x20` | `FAULT_CR14` | RO | Active abstraction slot at fault time |
| `0x24` | `FAULT_STAGE` | RO | Pipeline stage [3:0]: Fetch/Decode/Perm/Lambda/TPERM/Call/Return/DataRW |

### Five capabilities available now — no FPGA changes needed

**1. Hardware watchdog for hung programs**
`fault_valid` only fires on capability violations. An infinite loop or deadlock
produces silence. The RISC-V can poll NIA every 100 ms; if it hasn't changed in
3 seconds, emit a `HUNG` CALLHOME and pulse CTRL to reset the CM core.

**2. Keystore custodian**
K_enc/K_mac live in RISC-V private RAM. The CM core never touches them. The
RISC-V is the hardware security module — this is the physical realisation of the
TSB described in `docs/cm-msg-protocol.md` Section 1.

**3. Full fault telemetry already latched — just not emitted**
On every fault, `FAULT_GT`, `FAULT_INSTR`, `FAULT_CR14`, `FAULT_STAGE` are
latched in bridge hardware. The current `uart_emit_callhome()` reads none of them.
Adding ~20 lines to read and JSON-format those four registers gives the IDE
complete fault telemetry with zero FPGA changes.

**4. NIA as a free TraceEmitter**
NIA is live and readable every cycle. The RISC-V can sample it at 10 Hz, buffer
10 samples, and emit `TRACE:[0x0012,0x0014,...]` to the bridge. This is T2.3
(TraceEmitter) at hardware cost zero — no LUMP binary required.

**5. Software-controlled CM reset**
`CTRL[0]` drives the CM push_button. The bridge can send `RESET\r\n` over UART;
the RISC-V writes `CTRL=0` for 1 second, triggering a clean CM reboot. No power
cycle needed for remote fault recovery.

### Gap resolved: `FAULT_RST` register added in firmware v2.0

`fault_latched` was sticky until hardware reset. In firmware v2.0 a `FAULT_RST`
register was added to `apb3_cm_bridge.v` at offset `0x28` (write-1-to-clear).
Writing `1` to this register atomically clears `fault_latched`, `fault_code_r`,
`fault_gt_r`, `fault_instr_r`, `fault_cr14_r`, and `fault_stage_r`, re-arming
fault detection so the next fault is independently detectable. The firmware v2.0
fault-recovery path reads all six telemetry registers, emits a `FAULT_EVENT:{...}`
JSON record, writes `FAULT_RST=1`, then pulses `CTRL=0` to reboot the CM core.
This completes the 3-tier fault recovery model at hardware level.

### FP coprocessor verdict

Not needed, not recommended for the Ti60 UART starter kit. SHA-256 is pure integer
arithmetic (no FP). SlideRule trig runs on the CM core via CLOOMC methods, not the
RISC-V. If MTBF averaging ever needs FP in firmware, a software CORDIC
implementation fits in ~500 bytes of the 14+ KB of headroom remaining after SHA32.
A hardware FPU would require Sapphire SoC regeneration with `rv32imf`, full
resynthesis, and an ABI change — not justified for the current use case.

### SHA32 commissioning impact

Commissioning steps are identical (same `efx_pgm`, same `make`, same bridge
command line). The firmware grows from ~1.6 KB to ~4.6 KB (28% of 16 KB ROM).
Boot time adds ~100 ms for 9× SHA256 computations at startup. The CALLHOME JSON
grows by ~700 chars (ns_manifest array); at 57600 baud this adds ~120 ms to the
first transmission. No new manual steps. The SHA32 cross-check in the bridge makes
commissioning self-verifying: a misconfigured firmware is detected on first
CALLHOME before any keys are derived.
