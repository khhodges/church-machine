# Church Machine Security Hardening Roadmap

> **Status**: Strategic planning document. Identifies seven critical security weaknesses and proposes a two-phase hardening plan — Phase 1 (non-blocking, low effort) and Phase 2 (full hardening, architectural).

---

## Overview

The Church Machine architecture has identified seven security gaps ranging from critical (Home Base SPOF, MTBF gameable) to medium (gt_seq wraparound). This roadmap organizes fixes into two phases:

- **Phase 1**: Non-blocking, mostly software/documentation, low implementation effort. Can begin immediately and run in parallel with normal development.
- **Phase 2**: Requires hardware changes, NS layout changes, or major architectural decisions. Blocks on Phase 1 completion; targets production silicon.

Each weakness includes one Phase 1 mitigation (immediate) and one or more Phase 2 fixes (comprehensive).

---

## Weakness 1: Home Base Tunnel Single Point of Failure

**Threat**: Compromise of Home Base GT = control of all network access, MTBF policy, IDE policy, and abstraction distribution gates. No recovery path.

### Phase 1: Immediate Hardening (Non-Blocking)

**Action 1a: Out-of-Band MTBF Threshold Binding (Documentation + Boot Config)**
- Bake a public key into the **boot ROM** (non-volatile, read-only). This is the IDE's threshold-signing key.
- MTBF threshold payloads delivered via Home Base are now **signed with this key**.
- Hardware validates the signature before installing any threshold change.
- A compromised Home Base can deliver stale/old payloads, but cannot forge new ones.
- **Effort**: Low — mostly documentation of the signing process and hardware validation path.
- **Blocking**: No — can add signature verification to mLoad validation pipeline as a new step.

**Action 1b: Immutable Threshold History Log (Boot Sequence)**
- On first boot, allocate a fixed **append-only ledger in NVM** (e.g., last 64 KB of SPI flash).
- Every MTBF threshold change is logged with: `(timestamp, hash(new_threshold), signing_key_version)`.
- On boot, CTMM verifies that the current threshold matches the latest ledger entry.
- A compromised Home Base cannot silently change thresholds without appending to the log.
- Ledger is readable by user code (read-only) for transparency and forensics.
- **Effort**: Low — NVM driver + ledger append logic.
- **Blocking**: No — doesn't change threshold installation process.

**Action 1c: Home Base Compromise Alert Protocol (IDE Communication)**
- Define a **secondary, firmware-hardened alert channel** independent of the Home Base tunnel.
- If Home Base returns invalid signatures repeatedly, CTMM enters **Safe Mode**: all network access blocked, S=0 on all network GTs, MTBF thresholds frozen.
- CTMM blinks LED or emits acoustic signal (if available) to alert operator.
- Operator can use **local recovery serial console** (UART) to query last-known-good threshold from ledger.
- **Effort**: Medium — requires secondary communication path (may already exist for debug/serial access).
- **Blocking**: No — adds error handling path, doesn't change normal operation.

---

### Phase 2: Full Hardening (Architectural)

**Action 2a: Dual-Root Trust Model**
- Provision **TWO independent Home Base GTs** at boot, each pointing to a different physical tunnel endpoint.
- Both must sign policy updates using a **2-of-2 threshold scheme**:
  - MTBF threshold is split into two shares (e.g., XOR of halves).
  - Root1 signs Share1, Root2 signs Share2.
  - CTMM reconstructs threshold only if both signatures are valid.
- Neither root can unilaterally corrupt policy; both must conspire or be compromised simultaneously.
- Hardware implements automatic failover: Primary tunnel → if unreachable (> 3 retries) → Secondary tunnel.
- **Effort**: High — requires key management infrastructure, threshold split/merge logic, dual provisioning.
- **Blocking**: Yes — requires IDE redesign to support two roots + signature scheme.
- **Hardware impact**: Backup GT mechanism (Word 2/3) already supports this; needs validation logic.

**Action 2b: Time-Limited MTBF Threshold Validity**
- Add a 32-bit **threshold_ttl** field to the MTBF config payload.
- On every CTMM boot, check: `current_time > threshold_timestamp + threshold_ttl → reject threshold, enter Safe Mode`.
- Prevents Home Base from delivering arbitrarily old / stale thresholds indefinitely.
- Threshold becomes invalid after X days (e.g., 30 days) unless refreshed by a fresh signature.
- **Effort**: Low — mostly timestamp comparison logic.
- **Blocking**: No — can be added to Phase 1 threshold validation.

---

## Weakness 2: MTBF Qualification Mechanism Is Gameable

**Threat**: GC resets counters, soft failures not counted, counters can be manually edited. Attacker can fake high MTBF scores.

### Phase 1: Immediate Hardening (Non-Blocking)

**Action 1a: Immutable MTBF Snapshot in NVM**
- When an abstraction first runs, store a **snapshot of its MTBF counters in NVM** with a hash of the abstraction's identity.
- On every CTMM boot, compare running counters to the snapshot.
- If counters reset to zero mid-session (sign of tampering or GC), mark abstraction as **Suspicious**.
- Suspicious abstractions: S=0 (cannot be propagated), but E=1 (still callable locally).
- **Effort**: Low — NVM logging + counter comparison.
- **Blocking**: No — purely detection and flagging.

**Action 1b: Multi-Frequency Soft-Failure Tracking (Software Counter)**
- Track failures at multiple timescales in a **software histogram**:
  - Per-hour failure rate
  - Per-day failure rate
  - Per-week failure rate
- MTBF score = `invocation_count / (failure_count + timeout_count + exception_count + 1)`
- Require MTBF **stability** over time: if any timescale shows degradation, flag abstraction.
- Prevents a single soft failure from tanking the score, but catches sustained unreliability.
- **Effort**: Low — histogram tracking + statistical analysis.
- **Blocking**: No — adds telemetry, doesn't change core flow.

**Action 1c: Cryptographic Attestation of Counters (Home Base Telemetry)**
- MTBF telemetry sent to IDE via Home Base W permission is signed with **HMAC-SHA256** derived from the tunnel key.
- IDE maintains a **permanent MTBF score record** per abstraction per CTMM.
- CTMM cannot claim a higher score than what the IDE has recorded for it.
- If CTMM reports counters that don't match IDE record + expected delta, IDE flags as tampered.
- **Effort**: Medium — HMAC computation + IDE-side record keeping.
- **Blocking**: No — adds verification, doesn't change provisioning.

---

### Phase 2: Full Hardening (Architectural)

**Action 2a: Tamper-Proof Hardware Counter Registers**
- Move `invocation_count` and `failure_count` out of **writable NS entry** into **dedicated hardware counter registers**.
- One 48-bit counter pair per abstraction (up to 256 abstractions per CTMM, ~1.5 KB silicon).
- Counters are:
  - **Readable** by CTMM (for local MTBF calculation) via TPERM query.
  - **Writable only by CALL/RETURN microcode path** — no other instruction can touch them.
  - **Persistent across GC** — GC cannot reset them.
  - **Persistent across revocation/re-provisioning** — history is preserved.
- GC cannot reset; counters survive revocation.
- **Effort**: High — requires new hardware datapath, counter pipeline, register allocation.
- **Blocking**: Yes — silicon change.
- **Hardware impact**: Small (1.5 KB registers) but requires layout planning.

**Action 2b: Leased GT Validity (NS Layout Change)**
- **Requires NS entry extension from 3 words (current: 12 bytes) to 4 words (16 bytes); not yet adopted.**
- Add 16-bit **lease_ttl** field to NS Entry Word 0 (requires extending NS entry from 12 bytes to 16 bytes).
- On every mLoad access, decrement TTL; if TTL=0, treat GT as revoked.
- Sender sets TTL at provisioning time: 0=permanent, 1–65535=seconds TTL.
- Receiver cannot extend lease; GT auto-expires.
- Automatically revokes propagated GTs without sender intervention.
- **Effort**: Medium — NS layout change, mLoad validation update.
- **Blocking**: Yes — NS entry size impacts memory layout.

---

## Weakness 3: Backup IDE Addresses Add Routing Complexity

**Threat**: Silent failovers to Word 2/3 with no visibility; routing loops possible; per-recipient tracking absent.

### Phase 1: Immediate Hardening (Non-Blocking)

**Action 1a: Explicit Backup Opt-In with Audit Logging**
- Default: backup addresses (Word 2/3) disabled — 0x00000000.
- Programmer explicitly configures backups at provisioning time in the boot config.
- Every failover to a backup is **logged in local audit log** with: `(timestamp, gt_slot, primary_address, backup_used, attempt_count)`.
- Audit log is **readable by user code** (read-only) for transparency.
- Administrator can query log to detect unexpected failovers.
- **Effort**: Low — configuration flag + audit logging.
- **Blocking**: No — purely logging.

**Action 1b: Routing Loop Detection (Hardware Validation)**
- Before attempting a backup address, hardware checks:
  - Word 2 ≠ Word 1 (backup must differ from primary)
  - Word 3 ≠ Word 1 AND Word 3 ≠ Word 2 (second backup must differ from both)
- Maintain a **4-entry recently-tried queue** per tunnel GT in hardware state.
- If a backup is in the queue (recently attempted), skip it and try next.
- Prevents routing loops and repeated failures to same endpoint.
- **Effort**: Low — simple address comparison + queue logic.
- **Blocking**: No — doesn't change tunnel driver.

**Action 1c: Backup IDE Allowlist (Policy File)**
- MTBF threshold payload includes a **Backup IDE Allowlist** as SHA256 hashes of permitted backup addresses.
- Hardware checks every backup address against the allowlist before attempting.
- Only whitelisted backups are tried; others treated as invalid (0x00000000).
- IDE can update the allowlist remotely via threshold payload.
- **Effort**: Low — hash comparison logic.
- **Blocking**: No — additional validation step.

---

### Phase 2: Full Hardening (Architectural)

**Action 2a: Per-Recipient Backup Stripping (mSave Enhancement)**
- Extend **TPERM** with a **STRIP_BACKUPS** mode.
- When a GT is saved with STRIP_BACKUPS=1, Word 2/3 are zeroed in the destination c-list.
- Allows fine-grained distribution: "downstream receives only primary, no fallback."
- Every strip operation is logged: `(timestamp, sender, recipient, gt_slot)`.
- **Effort**: Medium — TPERM extension, audit logging.
- **Blocking**: No — backward compatible.

---

## Weakness 4: CRC-16 Is Not Cryptographically Secure

**Threat**: 16-bit CRC over 89 bits = ~1 in 65,536 undetected collisions. Single-bit flips can pass validation.

### Phase 1: Immediate Hardening (Non-Blocking)

**Action 1a: CRC Failure Watchdog**
- Track **CRC failures per NS entry** in a software counter in NVM.
- If an entry fails CRC validation > 3 times in rapid succession (< 1 minute), mark it as **Poisoned**.
- All future mLoad attempts on poisoned entries **FAULT immediately** (refuse the corrupted data).
- Prevents attacker from using CRC collision vulnerability repeatedly.
- Operator gets alert on multiple CRC failures.
- **Effort**: Low — counter + state tracking.
- **Blocking**: No — purely detection/prevention.

**Action 1b: CRC Failure Telemetry**
- Report all CRC failures back to IDE via Home Base W permission with context: `(timestamp, ns_slot, gt_word0, failed_crc, computed_crc)`.
- IDE builds a **CRC failure database** to detect patterns (e.g., systematic bit flips in certain NS regions).
- Helps identify hardware bit-flip issues vs. deliberate tampering.
- **Effort**: Low — telemetry logging.
- **Blocking**: No — purely observability.

---

### Phase 2: Full Hardening (Architectural)

**Action 2a: Upgrade to HMAC-SHA256**
- Replace CRC-16 with **HMAC-SHA256** keyed by a hardware-owned secret (derived from trusted boot key).
- Store first 32 bits of HMAC in NS Entry Word 2 (existing CRC field), remaining 224 bits in offline signature store or secure enclave.
- Detection cost: same (32-bit compare); security: ~2^224 collision resistance.
- **Effort**: High — requires crypto accelerator / hardware support for HMAC.
- **Blocking**: Yes — crypto operations must be performant on mLoad path.
- **Hardware impact**: May need HMAC coprocessor or AES-NI equivalent.

**Action 2b: Dual CRC-32 (Practical Alternative)**
- **Requires NS entry extension from 3 words (current: 12 bytes) to 4 words (16 bytes); not yet adopted.**
- Replace single 16-bit CRC with **two independent 32-bit CRC-32 checksums** (different polynomials).
- Both must match; collision resistance = 2^32 × 2^32 = 2^64.
- Fits in existing NS Entry Word 2 (32 bits) + extend to Word 3 (add 32 bits).
- NS entries grow from 12 to 16 bytes, but still aligned.
- **Effort**: Medium — CRC-32 computation (well-optimized), NS layout extension.
- **Blocking**: Yes — NS entry size change.

---

## Weakness 5: No Rate-Limiting on SWITCH/mLoad Retries

**Threat**: Unlimited retries enable timing side-channels, DoS attacks, and reverse-engineering of NS layout.

### Phase 1: Immediate Hardening (Non-Blocking)

**Action 1a: Per-Instruction Retry Limit**
- Every SWITCH / LOAD / CALL instruction is allowed **max 3 contention retries** before raising `TRAP: MAX_RETRIES_EXCEEDED`.
- Hardware counter resets on successful completion or explicit FAULT.
- Application IRQ handler decides: retry, wait, or abort.
- **Effort**: Low — counter logic.
- **Blocking**: No — doesn't change retry mechanism, just caps it.

**Action 1b: Exponential Backoff Requirement**
- If an instruction retries, the IRQ handler **must wait** before retrying using an explicit **spinlock delay** or timer instruction.
- Delay = `(2^attempt_count × base_delay) + random(0..jitter)`.
- Hardware does not retry automatically; all retries are explicit (mediated by application).
- Prevents tight-loop hammering.
- **Effort**: Low — documentation + IRQ handler guidance.
- **Blocking**: No — application-level change.

**Action 1c: Telemetry on Exception Patterns**
- Count and report SWITCH/mLoad FAULT rates back to IDE.
- Pattern detection: if `(retries/success_ratio) > threshold`, report "possible timing side-channel attack."
- IDE can correlate with other CTMMs to detect coordinated attacks.
- **Effort**: Low — telemetry logging.
- **Blocking**: No — purely observability.

---

### Phase 2: Full Hardening (Architectural)

**Action 2a: Per-CR Fairness Scheduler**
- Hardware tracks which CRs have recently failed mLoad/SWITCH.
- mLoad gives lower scheduling priority to CRs with recent failures.
- Forces attacker to spread requests across many CRs, increasing observability.
- **Effort**: Medium — scheduling logic in mLoad path.
- **Blocking**: No — doesn't change validation, only contention handling.

---

## Weakness 6: GT Propagation via b_flag Is One-Way

**Threat**: Once a GT is copied (b_flag=1), receiver holds it until gt_seq is revoked (all-or-nothing). No per-recipient revocation.

### Phase 1: Immediate Hardening (Non-Blocking)

**Action 1a: Chain-of-Custody Logging**
- Every **mSave** records `(sender_id, recipient_id, timestamp, purpose, gt_slot)` in an **append-only audit log in NVM**.
- IDE can request the chain-of-custody for any GT.
- Detects unauthorized propagation; provides forensic capability.
- **Effort**: Low — audit logging.
- **Blocking**: No — purely observability.

**Action 1b: b_flag Propagation Restrictions (Policy)**
- Default: b_flag=0 on all GTs (not propagable).
- IDE explicitly enables b_flag=1 only for abstractions designed for distribution.
- Document which abstractions are propagable in boot manifest.
- **Effort**: Low — configuration policy.
- **Blocking**: No — doesn't change mechanism.

---

### Phase 2: Full Hardening (Architectural)

**Action 2a: Leased GT Validity (Time-Limited Propagation)**
- **lease_ttl** field (16-bit, NS Entry Word 0 — see Weakness 2, Action 2b) automatically revokes propagated GTs.
- Receiver cannot extend lease; GT auto-expires after sender-specified TTL.
- Eliminates the need for sender to actively revoke.
- **Effort**: Medium — NS layout change (combined with Weakness 2 fix).
- **Blocking**: Yes — NS entry size.

**Action 2b: Per-Recipient Revocation via Bloom Filter**
- NS entry includes a **32-bit recipient bloom filter**.
- When recipient receives GT via mSave, their CTMM ID is added to the bloom filter.
- Sender issues **revoke-recipient** command to IDE, which clears the CTMM ID from the filter.
- On next mLoad on that CTMM, CRC fails (filter changed), GT faults.
- Enables fine-grained per-recipient revocation.
- **Effort**: Medium — bloom filter integration, NS layout change.
- **Blocking**: Yes — NS entry size.

**Action 2c: Consumable GT (One-Time Capability)**
- Extend GT layout with a **consumable bit** (using spare bits in Word 0 or new flag).
- Consumable GTs can be used **exactly once**; on first mLoad, hardware sets a flag.
- Second attempt to use same GT faults: `FAULT: ALREADY_CONSUMED`.
- Useful for one-time auth tokens, session keys, reset credentials.
- **Effort**: Medium — GT layout extension, mLoad validation.
- **Blocking**: No — backward compatible.

---

## Weakness 7: GC gt_seq Wraparound Undefined

**Threat**: 7-bit gt_seq gives 128 revocation generations. Wraparound behavior unspecified; could confuse stale GTs with fresh ones.

### Phase 1: Immediate Hardening (Non-Blocking)

**Action 1a: Wraparound Documentation & Safety Limits**
- Document: "gt_seq wraps from 127 to 0. At wraparound, gt_seq=0 is **fresh**, not stale."
- Add a hardware guard: **minimum GC interval** of 1 second between wraparound cycles.
- If GC tries to wrap around more frequently, TRAP: `GC_WRAPAROUND_TOO_FAST`.
- Prevents rapid wraparound attacks.
- **Effort**: Low — documentation + timer logic.
- **Blocking**: No — adds safety guard.

**Action 1b: Wraparound Telemetry**
- Every time gt_seq wraps from 127 to 0, log it with timestamp.
- Report to IDE when it happens.
- Helps detect accelerated or unexpected wraparound patterns.
- **Effort**: Low — telemetry logging.
- **Blocking**: No — purely observability.

---

### Phase 2: Full Hardening (Architectural)

**Action 2a: Wraparound Hardening with High-Bit Flag**
- When `gt_seq` would overflow from 127 to 0, set a **wraparound flag** in NS Entry Word 1 (bit 28).
- Any GT matching gt_seq=0 with wraparound_flag=0 is treated as invalid (FAULT).
- Requires GC to bump wraparound_flag and reset gt_seq to 0+1 atomically.
- Effectively gives 256 revocation generations with minimal overhead.
- **Effort**: Low — add 1 flag bit to NS Entry Word 1.
- **Blocking**: No — backward compatible.

**Action 2b: Infinite gt_seq via Extended Counter**
- **Requires NS entry extension from 3 words (current: 12 bytes) to 4 words (16 bytes); not yet adopted.**
- Extend NS Entry from 3 words to 4 words, adding a 32-bit **gt_seq_extended** field.
- Full revocation counter = `(gt_seq_extended << 7) | gt_seq[6:0]`.
- Gives 2^39 revocation generations (~500 billion), eliminating wraparound risk entirely.
- **Effort**: Low — add one word to NS entry.
- **Blocking**: Yes — NS entry size change.

---

## Phase 1 vs Phase 2 Summary

### Phase 1: Immediate & Non-Blocking

| Weakness | Phase 1 Action | Effort | Blocking? |
|:---------|:---------------|:-------|:----------|
| 1. Home Base SPOF | Out-of-band threshold binding + immutable log | Low–Med | No |
| 2. MTBF Gameable | Snapshot NVM + multi-frequency tracking + HMAC telemetry | Low–Med | No |
| 3. Backup Routing | Opt-in audit logging + loop detection + allowlist | Low | No |
| 4. CRC-16 Weak | CRC failure watchdog + telemetry | Low | No |
| 5. No Rate Limits | Per-instruction limit + backoff requirement + telemetry | Low | No |
| 6. One-Way mSave | Chain-of-custody logging + propagation policy | Low | No |
| 7. gt_seq Wraparound | Documentation + safety limits + telemetry | Low | No |

**Phase 1 Benefits:**
- Immediate deployment (no hardware changes).
- All non-blocking (can run in parallel with normal development).
- Adds visibility and detection capabilities.
- Provides audit trails for forensics.
- Can catch attacks in progress.

---

### Phase 2: Full Hardening (Architectural)

| Weakness | Phase 2 Solution | Effort | Blocking? |
|:---------|:-----------------|:-------|:----------|
| 1. Home Base SPOF | Dual-Root + 2-of-2 threshold signatures | High | Yes |
| 2. MTBF Gameable | Tamper-proof hardware counters | High | Yes |
| 3. Backup Routing | Per-recipient backup stripping | Medium | No |
| 4. CRC-16 Weak | HMAC-SHA256 or dual CRC-32 | High | Yes |
| 5. No Rate Limits | Per-CR fairness scheduler | Medium | No |
| 6. One-Way mSave | Leased GT validity + bloom filter revocation | Medium | Yes |
| 7. gt_seq Wraparound | Wraparound flag or extended counter | Low | No |

**Phase 2 Benefits:**
- Comprehensive hardening at the architectural level.
- Structural protections (not just detection).
- Requires production silicon but worth the investment.
- Can be deployed across multiple hardware generations.

---

## Implementation Timeline

### Phase 1: Months 1–3 (Parallel Workstreams)

```
Week 1–2:   Document Phase 1 mitigations; create tickets.
Week 2–4:   Implement audit logging framework (all weaknesses).
Week 3–6:   CRC watchdog + telemetry (Weakness 4).
Week 3–6:   Rate-limit caps + backoff guidance (Weakness 5).
Week 4–8:   MTBF snapshot logging + multi-freq tracking (Weakness 2).
Week 5–8:   Threshold signing validation + signature verification (Weakness 1).
Week 6–9:   Backup loop detection + allowlist (Weakness 3).
Week 7–9:   Chain-of-custody logging (Weakness 6).
Week 8–9:   gt_seq wraparound telemetry (Weakness 7).

Phase 1 Complete: Month 3 (all changes merged, tested, deployed).
```

### Phase 2: Months 4–12 (Sequential Stages)

```
Stage 1 (Months 4–6):  Dual-Root infrastructure; IDE signature scheme design.
Stage 2 (Months 6–8):  Hardware counter register design; NS layout extension design.
Stage 3 (Months 8–10): RTL implementation; simulation validation.
Stage 4 (Months 10–12): Silicon tape-out; Phase 2 validation against test vectors.

Production Silicon Available: Month 12–18.
```

---

## Success Criteria

### Phase 1 Success
- [ ] All seven weaknesses have audit trails or detection logic.
- [ ] Threshold signatures are verified before installation.
- [ ] CRC failures trigger watchdog alerts.
- [ ] Rate limits prevent tight-loop hammering.
- [ ] Chain-of-custody is logged for all propagated GTs.
- [ ] All Phase 1 changes pass regression tests.
- [ ] Zero functional impact on normal operation.

### Phase 2 Success
- [ ] Dual-Root policy update requires 2-of-2 signatures.
- [ ] MTBF counters are tamper-proof and hardware-owned.
- [ ] Backup addresses are strictly validated and audited.
- [ ] CRC protection is cryptographically strong (HMAC or dual CRC-32).
- [ ] GT propagation can be time-limited or per-recipient revoked.
- [ ] gt_seq wraparound is hardened with extended generation counter.
- [ ] Hardware validation (silicon) confirms all mitigations.

---

## Decision Points

**After Phase 1 (Month 3):**
- Proceed to Phase 2 design, or
- Iterate on Phase 1 findings if new vulnerabilities emerge.

**At Phase 2 Stage 1 (Month 6):**
- Freeze NS entry layout (decision: 16 bytes or variable size?).
- Confirm Dual-Root signature scheme.

**At Phase 2 Stage 3 (Month 10):**
- Decide: tape-out now, or one more design iteration?

---

## Risk Mitigation

**Phase 1 risks (low):**
- Audit logging overhead → mitigated by efficient NVM buffering.
- Signature verification latency → mitigated by caching validated thresholds.

**Phase 2 risks (medium-high):**
- Hardware counter register allocation → address early in floorplan.
- NS entry size growth → plan memory layout impact.
- HMAC latency on mLoad path → validate crypto accelerator performance.
- Dual-Root threshold scheme complexity → prototype first in simulator.
