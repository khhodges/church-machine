# ide.Mint: existing hardware commit-path review

Date: 2026-10-11  
Scope: current source, not generated RTL, a frozen bitstream or physical-board
acceptance. No hardware or saved-LUMP changes.

## Conclusion

The existing Mint FSM provides sequential installation with local CPU execution
exclusion. It does **not** establish the authenticated, atomic,
interruption-safe create/replace operation required by
[`ide-mint-forge-contract.md`](ide-mint-forge-contract.md).

Ordinary Outform ingress is intentionally blocked. This review identifies
hazards that must be addressed before exposing or reusing the dormant writer,
not a demonstrated exploit through the current ordinary CALL/LOAD routes.

## Entry and authority

`hardware/core.py:2013–2089` combines three start sources: shared mLoad,
ChurchOutformFSM, and explicit test injection. Slot and caller C-list address
are latched on start. These latches are not guarded by an idle-only acceptance
condition at this wiring layer. Re-enabling a producer would therefore require
an explicit no-reentry contract.

`hardware/mload.py`, the Outform branch of its GT checks, faults with
OUTFORM_UNAUTH before its legacy download trigger. `hardware/church_outform.py`
likewise faults instead of starting a download or promoting the source CR.
Core test-injection ports are a separate bypass, not a programmer-facing ABI;
this review does not establish external production access to those ports.

The core Mint FSM starts on `u_outform.mint_call` and latches the proposed base.
It has no independent passkey/proof-verification or per-operation create/replace
policy at that interface. The existing download/CRC pipeline must not be
promoted into a trusted authentication service.

## Write ordering and limited guarantees

Both profiles in `hardware/core.py` have this sequence:

1. Read header; check magic, size and code/C-list bounds.
2. Scan the legacy freespace region for zero words.
3. MINT_WRITE_NS0: location.
4. MINT_WRITE_NS1: authority/limit with a fixed generation.
5. MINT_WRITE_NS2: integrity32.
6. MINT_WRITE_NS3: zero, because no trusted content-token input exists.
7. Copy the object's C-list to the legacy per-slot C-list area.
8. Write the resulting E-GT into the caller's C-list.
9. Assert Mint completion.

Source references: IoT states around 2181–2341; non-IoT states around
2417–2567. The exact current source, rather than historical comments, governs
the conclusions below.

| Property | Finding |
|---|---|
| Validation precedes NS writes | Explicit Mint header/freespace failure transitions precede NS0; this does not prove complete validation or absence of earlier download/allocation writes |
| Local execution exclusion | `mint_busy` contributes to `any_unit_busy`; normal instruction starts and external Thread-switch admission are gated by that busy signal |
| Writer priority inside core | Mint NS writes have priority over GC in the core NS mux |
| Ordered completion | Completion comes after the NS and C-list write states |
| Four-word transaction | Absent: four distinct write cycles, no shadow-entry publication or transaction marker |
| Accepted-write acknowledgement | Absent from these NS write transitions; states advance unconditionally |
| Rollback/recovery outcome | No transaction journal, undo path or committed-request record in this FSM |

Busy exclusion can prevent the same CPU from executing a normal instruction
between writes. It does not make the RAM update indivisible or prove exclusion
of upload, initialization, reset, debug readers or every external observer.

## Wukong memory arbitration

`hardware/wukong_top.py:639–645` selects the core NS address ahead of C-list and
DMEM addresses. Around 998–1030, the physical write-port order is:

1. Hardware initialization.
2. Upload writes.
3. CPU writes, internally prioritizing NS over C-list over ordinary DMEM.

Thus an overlapping upload/init write wins the RAM port, while the Mint state
machine contains no write-acceptance feedback to detect the lost write.
This is an **arbitration hazard if overlap is possible**, not proof that normal
operation currently creates that overlap.

The upload comment says the CPU is halted. Halt/fetch gating by itself is not
proof that an already-running Mint FSM has drained. Before enabling Mint,
prove producer exclusion across the full transfer interval, or implement an
accepted-write handshake. Do not infer that a completion pulse proves all
physical writes reached RAM.

## Fault, reboot and reset

`hardware/core.py` defines `clear_all` from FAULT_RST and uses ResetInserter
for execution submodules, including the Outform engine. The Mint FSMs are
defined directly in the parent module and are not wrapped by that local
ResetInserter or explicitly branched on `clear_all`.

Consequently the source does not establish that FAULT_RST cancels or drains an
in-flight Mint transaction. Resetting the download engine while its associated
parent Mint state persists is a boundary requiring explicit verification.

Physical Wukong sets `defer_fault_reset=1` and requests reboot separately after
retaining fault evidence. This preserves diagnostics; it is not a commit-recovery
protocol. Likewise, a sync-domain reset may reset control state, but does not
establish rollback of words already accepted by RAM. No crash-consistent
old-or-new guarantee was found.

These are static findings. Per-cycle reset/fault/upload injection into an
actively executing Mint transaction was **not run**.

## Representation and replacement blockers

- Mint fixes generation to one; it does not read and compare the destination's
  live generation before replacement.
- NS addresses use live CR15 location plus slot shifted by four. There is no
  destination-slot CAS or destination authority check in the writer.
- The C-list placement uses a legacy fixed per-slot formula. It cannot be
  adopted as the current portable/destination-localized LUMP layout.
- W3 is written as zero rather than a verified T.
- IoT and non-IoT returned-GT expressions differ: the IoT expression includes
  `GT_DOM_BIT`; the non-IoT expression does not explicitly include it.
  Resolve this against the approved encoding rather than copying either formula.
- Caller C-list mutation is part of this installation path. It does not implement
  the proposed DR1 return ABI.
- Context latching is incomplete as a transaction boundary: slot/base are captured
  at different stages while the NS base is derived from live CR15.

These findings rule out simply redirecting ide.Mint to MINT_WRITE_NS2 or calling
the legacy FSM a ready-made commit primitive.

## Verification performed

Command:

```text
python3 -m pytest hardware/test_outform_mode2.py -q -k 'not core_integration'
```

Result: **3 passed, 1 deselected**.

Those tests cover Mode-2 fail-closed interception, non-promotion despite a
reported download result, and no-intercept behavior. They do not exercise
successful Mint writes, Mode-1 integration, full-core interruption or FPGA RAM.
Mode-1 containment above is a source observation.

| Layer / behavior | Evidence in this review |
|---|---|
| Current-source sequencing/arbitration/reset wiring | Inspected |
| Isolated Mode-2 containment | PASS |
| Successful Mint / interrupted commit simulation | NOT RUN |
| Full-core integration replay | NOT RUN |
| Synthesized implementation / exact release bitstream | NOT RUN |
| Physical FPGA behavior | NOT RUN |

## Recommended contract decision

Do not expose the legacy writer as the ide.Mint commit mechanism. First specify
an authenticated transaction interface with frozen request/evidence, destination
freshness checks, exclusion of all relevant readers/writers, acknowledged writes,
generation handling, and an explicit pre/post-commit recovery outcome.

A dedicated FSM may implement that interface, but “dedicated FSM” alone is not
an atomicity guarantee. Choose its memory publication and recovery strategy
before writing instruction bodies. Keep current ingress containment intact.
