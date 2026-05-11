# Phase 1 Security Validation TODO — Non-Silicon Tasks

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

> **Scope**: Granular, independent security hardening tasks for Phase 1. Each item is **self-contained**, **non-blocking on silicon**, and can be completed in order or in parallel. None require hardware changes.

---

## Priority 1: Audit Logging Framework (Foundation)

All Phase 1 actions depend on this. Do these first.

### P1-LOG-001: Design NVM Audit Log Format
- **Description**: Define the binary format for all audit log entries across all seven weaknesses.
- **Deliverable**: `docs/audit-log-format.md` specifying:
  - Record structure: `(timestamp[4], event_type[1], severity[1], data[...], checksum[2])`
  - Event type enumeration (threshold_change, failover, mtbf_snapshot, crc_failure, retry_limit, mSave, wraparound, etc.)
  - Severity levels (INFO, WARN, ALERT)
  - Ring buffer design: circular write, oldest records overwritten when full
  - Query interface: user-space read-only access to logs
- **Effort**: 2 days
- **Blocking**: P1-LOG-002, P1-LOG-003

### P1-LOG-002: Implement NVM Ring Buffer
- **Description**: Write the firmware code for NVM audit log buffering (UART flash, ECC memory, or simulator NVM).
- **Deliverable**: `firmware/nvm_audit_log.c` with:
  - `log_event(event_type, data)` function
  - Ring buffer management (write pointer, wraparound)
  - Timestamp generation (system tick counter)
  - User-space read syscall: `read_audit_log(offset, count)` returns log entries
- **Tests**: Unit tests for ring buffer wraparound, checksum validation
- **Effort**: 3 days
- **Blocking**: All Phase 1 logging actions

### P1-LOG-003: Query Interface for User Code
- **Description**: Expose audit logs to user-level code (read-only).
- **Deliverable**: `hardware/audit_log_interface.py` with:
  - `get_audit_log(event_type_filter=None, since_timestamp=None)` returns list of records
  - `clear_audit_log_before(timestamp)` (optional, for cleanup)
  - Simulator integration: mocked NVM backing
- **Tests**: Verify logs can be read back with correct timestamps and data
- **Effort**: 2 days

---

## Priority 2: Threshold Signature Validation (Home Base Security)

Prevents Home Base from forging MTBF policy updates.

### P1-THRESH-001: Design Threshold Signature Scheme
- **Description**: Specify how MTBF threshold payloads are signed by the IDE.
- **Deliverable**: `docs/threshold-signature-scheme.md`:
  - Payload structure: `(timestamp, isolated_floor, user_tier, ns_tier, min_invocations, backup_allowlist, signature)`
  - Algorithm: HMAC-SHA256 or RSA-2048 (decide based on boot key size)
  - Key derivation: how the public key is baked into boot ROM
  - Signature validation path: where in mLoad to check
- **Effort**: 2 days
- **Blocking**: P1-THRESH-002, P1-THRESH-003

### P1-THRESH-002: Implement Signature Validation in mLoad
- **Description**: Add signature check to the mLoad validation pipeline when a threshold update arrives.
- **Deliverable**: `hardware/mload_threshold_validation.py` with:
  - `validate_threshold_signature(payload, signature, public_key)` function
  - Integration point: in the Home Base tunnel R handler
  - Failure path: FAULT with `INVALID_THRESHOLD_SIGNATURE` if check fails
- **Tests**: Validate against test vectors (from IDE public key + signed payload)
- **Effort**: 3 days

### P1-THRESH-003: Immutable Threshold Ledger in NVM
- **Description**: Log every threshold change to an append-only ledger.
- **Deliverable**: `firmware/threshold_ledger.c` with:
  - `log_threshold_change(timestamp, hash(new_threshold), signing_key_version)` appends to ledger
  - Ledger is immutable (no delete, only append)
  - On boot, verify current threshold matches latest ledger entry (hash match)
  - User-space read access: `get_threshold_history()` returns list of changes
- **Tests**: Verify ledger appends correctly, boot validates against ledger
- **Effort**: 2 days

### P1-THRESH-004: Safe Mode Activation (Home Base Failure)
- **Description**: Define and implement Safe Mode when Home Base threshold validation fails.
- **Deliverable**: `docs/safe-mode-protocol.md` specifying:
  - Trigger conditions: invalid signatures, unreachable Home Base, signature mismatch
  - Safe Mode behavior: all network GTs get S=0 (cannot propagate), MTBF thresholds frozen
  - Recovery: user can query threshold ledger via serial console, manually restore
- **Tests**: Trigger Safe Mode in simulator, verify S bits are locked
- **Effort**: 2 days

---

## Priority 3: MTBF Snapshot Logging (MTBF Security)

Prevents MTBF counter reset attacks.

### P1-MTBF-001: Design MTBF Snapshot Format
- **Description**: Define what gets stored in NVM when an abstraction first runs.
- **Deliverable**: `docs/mtbf-snapshot-format.md`:
  - Snapshot: `(abstraction_id_hash, first_invocation_time, initial_invocation_count, initial_failure_count, checksum)`
  - Per-abstraction, stored in NVM on first use
  - Query interface: user-space can read snapshots (read-only)
- **Effort**: 1 day
- **Blocking**: P1-MTBF-002, P1-MTBF-003

### P1-MTBF-002: Implement MTBF Snapshot Capture
- **Description**: Log MTBF counters on first invocation of each abstraction.
- **Deliverable**: `firmware/mtbf_snapshot.c` with:
  - `capture_mtbf_snapshot(abstraction_id, invocation_count, failure_count)` on first CALL
  - Store in NVM with hash of abstraction identity
  - Checksum for integrity
- **Tests**: Verify snapshots are captured on first run, not re-captured on second run
- **Effort**: 2 days

### P1-MTBF-003: MTBF Snapshot Validation on Boot
- **Description**: Compare running counters to stored snapshots; flag **Suspicious** abstractions.
- **Deliverable**: `firmware/mtbf_validation.c` with:
  - On boot, compare current counters to snapshots for all loaded abstractions
  - If counters reset to zero (or near-zero) → mark as **Suspicious**
  - Suspicious → S=0 (no propagation) but E=1 (still callable locally)
  - Log all Suspicious flags to audit log
- **Tests**: Simulate counter reset, verify Suspicious flag is set
- **Effort**: 2 days

### P1-MTBF-004: Multi-Frequency Failure Rate Tracking
- **Description**: Track failures per-hour, per-day, per-week for stability analysis.
- **Deliverable**: `firmware/mtbf_histograms.c` with:
  - Three histograms (1-hour, 1-day, 1-week buckets) per abstraction
  - On every failure event, increment the appropriate bucket(s)
  - MTBF score now includes stability metric: flag if any timescale shows degradation
  - Log unstable abstractions to audit log
- **Tests**: Simulate gradual failure accumulation across timescales; verify detection
- **Effort**: 3 days

### P1-MTBF-005: MTBF Telemetry Signing
- **Description**: Sign MTBF telemetry with HMAC before sending to IDE.
- **Deliverable**: `firmware/mtbf_telemetry.c` with:
  - Telemetry packet: `(abstraction_id, invocation_count, failure_count, timescale_data, timestamp, HMAC-SHA256)`
  - HMAC key derived from Home Base tunnel key
  - Send via Home Base W permission
  - IDE maintains permanent MTBF record; compares CM-reported scores to IDE record + expected delta
- **Tests**: Generate telemetry, verify HMAC matches on IDE side (test vector)
- **Effort**: 2 days

---

## Priority 4: Rate-Limiting on SWITCH/mLoad (Timing Side-Channel Prevention)

Prevents hammering attacks and timing inference.

### P1-RATE-001: Per-Instruction Retry Counter
- **Description**: Cap retries at 3 per SWITCH/mLoad/CALL instruction.
- **Deliverable**: `hardware/retry_limiter.py` with:
  - Per-instruction counter: max 3 contention retries before `TRAP: MAX_RETRIES_EXCEEDED`
  - Counter resets on success (CR write) or explicit FAULT
  - When trap fires, log to audit log with instruction type and CR index
- **Tests**: Simulate 4+ retries, verify TRAP fires on attempt #4
- **Effort**: 2 days

### P1-RATE-002: Exponential Backoff Documentation & Policy
- **Description**: Document the required backoff when retrying SWITCH/mLoad/CALL.
- **Deliverable**: `docs/retry-backoff-policy.md`:
  - Delay formula: `(2^attempt_count × base_delay_microseconds) + random(0..jitter_microseconds)`
  - Example: Attempt 1: 10µs, Attempt 2: 20µs + jitter, Attempt 3: 40µs + jitter
  - IRQ handler must explicitly wait (spinlock or timer) before retrying
  - Hardware does NOT automatically retry; application controls all retries
- **Effort**: 1 day

### P1-RATE-003: Retry Failure Telemetry
- **Description**: Track and report retry failure patterns to IDE.
- **Deliverable**: `firmware/retry_telemetry.c` with:
  - Count mLoad/SWITCH failures by reason (bounds, permission, version, crc, etc.)
  - Calculate ratio: `retries / successful_ops`
  - If ratio exceeds threshold (e.g., 1000 failures per 1 success), flag "possible timing side-channel attack"
  - Report to IDE via Home Base W
- **Tests**: Simulate high-retry scenario; verify telemetry pattern detection
- **Effort**: 2 days

---

## Priority 5: CRC Failure Watchdog (Integrity Monitoring)

Detects bit-flip attacks and hardware degradation.

### P1-CRC-001: CRC Failure Counter per NS Entry
- **Description**: Track CRC validation failures for each namespace entry.
- **Deliverable**: `firmware/crc_watchdog.c` with:
  - Per-NS-entry failure counter in NVM (or cached in SW)
  - On every mLoad, if CRC fails, increment counter
  - If counter > 3 in < 1 minute, mark entry as **Poisoned**
  - Poisoned entries: all future mLoad attempts FAULT immediately
- **Tests**: Inject CRC failures in simulation; verify Poisoned flag after 3 failures
- **Effort**: 2 days

### P1-CRC-002: CRC Failure Telemetry
- **Description**: Report CRC failures to IDE for pattern analysis.
- **Deliverable**: `firmware/crc_telemetry.c` with:
  - On every CRC failure, log: `(timestamp, ns_slot, gt_word0, failed_crc, computed_crc, lump_checksum)`
  - Batch telemetry and send via Home Base W
  - IDE builds a CRC failure database to detect systematic bit-flips (e.g., always same bit position)
- **Tests**: Generate synthetic CRC failures; verify telemetry payload structure
- **Effort**: 2 days

### P1-CRC-003: Poisoned Entry Recovery Policy
- **Description**: Define how an operator recovers from Poisoned entries.
- **Deliverable**: `docs/crc-recovery-protocol.md`:
  - Once an entry is Poisoned, it cannot be used until manually cleared
  - Clearing: IDE can issue a revocation (bump gt_seq) to clear the Poisoned flag
  - Or: operator can reboot CM (Poisoned flags reset on next boot, but underlying lump may still be corrupt)
- **Effort**: 1 day

---

## Priority 6: Backup Address Validation (Routing Security)

Prevents routing loops and rogue fallback endpoints.

### P1-BACKUP-001: Explicit Backup Opt-In Policy
- **Description**: Make backup addresses (Word 2/3) optional and logged.
- **Deliverable**: `docs/backup-address-provisioning.md`:
  - Default: Word 2 = 0x00000000, Word 3 = 0x00000000 (no backup)
  - Programmer explicitly configures backups in boot manifest
  - Configuration is immutable (set at boot, cannot be changed at runtime)
- **Effort**: 1 day

### P1-BACKUP-002: Backup Address Loop Detection (Hardware)
- **Description**: Validate that Word 2 and Word 3 are distinct from Word 1 and each other.
- **Deliverable**: `hardware/backup_address_validator.py` with:
  - Before attempting Word 2: check Word 2 ≠ Word 1 AND Word 2 ≠ 0x00000000
  - Before attempting Word 3: check Word 3 ≠ Word 1 AND Word 3 ≠ Word 2 AND Word 3 ≠ 0x00000000
  - Maintain 4-entry **recently-tried queue** per tunnel GT (prevents re-trying same backup)
  - If backup is in queue, skip it
- **Tests**: Test all invalid combinations; verify only distinct addresses are attempted
- **Effort**: 2 days

### P1-BACKUP-003: Backup Failover Audit Log
- **Description**: Log every failover to a backup address.
- **Deliverable**: `firmware/backup_failover_log.c` with:
  - On every fallback to Word 2 or Word 3, log: `(timestamp, tunnel_gt_slot, primary_address, backup_used, attempt_count, reason)`
  - User-space query: `get_backup_failover_history()` returns list
  - IDE can correlate failover patterns across CMs to detect rogue endpoints
- **Tests**: Simulate primary failure; verify fallback is logged with correct data
- **Effort**: 2 days

### P1-BACKUP-004: Backup IDE Allowlist Validation
- **Description**: Validate backup addresses against a whitelist in the MTBF threshold payload.
- **Deliverable**: `firmware/backup_allowlist.c` with:
  - MTBF threshold payload includes `backup_allowlist: [SHA256(0xFF000001), SHA256(0xFF000002), ...]`
  - On every backup attempt, compute SHA256(backup_address) and check against allowlist
  - If not in allowlist, treat as invalid (don't attempt)
  - Log allowlist validation results to audit log
- **Tests**: Attempt backup with/without allowlist entry; verify only whitelisted addresses are tried
- **Effort**: 3 days

---

## Priority 7: Chain-of-Custody Logging (Propagation Security)

Tracks all GT distributions for forensics.

### P1-COC-001: mSave Audit Logging
- **Description**: Log every GT propagation via mSave.
- **Deliverable**: `firmware/msave_audit.c` with:
  - On every successful mSave, log: `(timestamp, sender_id, recipient_clist_slot, recipient_abstraction_id, gt_slot, gt_word0, purpose_tag)`
  - User-space query: `get_propagation_history(gt_slot)` returns chain-of-custody
  - IDE can request chain-of-custody for any GT to detect unauthorized distribution
- **Tests**: Perform mSave; verify entry is logged with correct sender/recipient
- **Effort**: 2 days

### P1-COC-002: b_flag Propagation Restrictions Policy
- **Description**: Document which abstractions are designed for propagation.
- **Deliverable**: `docs/bind-flag-policy.md`:
  - Default: b_flag=0 on all GTs (not propagable)
  - IDE explicitly sets b_flag=1 only for abstractions designed for distribution (marked in boot manifest)
  - Programmer must justify why each abstraction needs b_flag=1
  - Changes to b_flag are logged to audit log
- **Effort**: 1 day

### P1-COC-003: Propagation Transparency
- **Description**: Make propagation history user-queryable.
- **Deliverable**: User-space interface:
  - `get_propagation_history(gt_slot)` returns list of `(timestamp, sender_id, recipient_id)` tuples
  - `count_propagations(gt_slot)` returns total number of copies in circulation
  - Helps detect unusual distribution patterns (e.g., a single GT propagated to 1000 recipients)
- **Tests**: Propagate GT multiple times; verify history reflects all copies
- **Effort**: 1 day

---

## Priority 8: gt_seq Wraparound Safety (GC Revocation)

Ensures wraparound doesn't confuse stale with fresh GTs.

### P1-GC-001: Wraparound Documentation
- **Description**: Formally specify gt_seq behavior at boundaries.
- **Deliverable**: `docs/gt_seq-wraparound-semantics.md`:
  - gt_seq is 7-bit (0–127)
  - On GC increment: `gt_seq = (gt_seq + 1) % 128`
  - Semantics: gt_seq=0 is a **fresh** value (just incremented from 127), not stale
  - Stale detection: if outstanding GT has gt_seq that now belongs to a *different* entry, FAULT
- **Effort**: 1 day

### P1-GC-002: Wraparound Safety Limits
- **Description**: Add hardware guards to prevent rapid wraparound attacks.
- **Deliverable**: `hardware/wraparound_safety.py` with:
  - Minimum GC interval: 1 second between wraparound events
  - If GC tries to wrap more frequently (e.g., triggered by attacker bulk revocation), TRAP: `GC_WRAPAROUND_TOO_FAST`
  - Timer-based: hardware tracks last wraparound timestamp
- **Tests**: Try to force GC wraparound twice within 1 second; verify TRAP fires on second attempt
- **Effort**: 2 days

### P1-GC-003: Wraparound Event Logging
- **Description**: Log every gt_seq wraparound for observability.
- **Deliverable**: `firmware/wraparound_log.c` with:
  - On every gt_seq wraparound event, log: `(timestamp, gc_cycle_count, affected_ns_entries, reason)`
  - User-space query: `get_wraparound_history()` returns list
  - IDE can detect accelerated or unexpected wraparound patterns
- **Tests**: Trigger GC wraparound; verify event is logged with correct data
- **Effort**: 1 day

---

## Summary: Execution Order (One-by-One, Non-Blocking)

**Week 1–2: Foundation**
1. P1-LOG-001 (NVM audit log format)
2. P1-LOG-002 (NVM ring buffer implementation)
3. P1-LOG-003 (User-space query interface)

**Week 2–4: Home Base Security**
4. P1-THRESH-001 (Signature scheme design)
5. P1-THRESH-002 (Signature validation in mLoad)
6. P1-THRESH-003 (Immutable threshold ledger)
7. P1-THRESH-004 (Safe Mode protocol)

**Week 4–6: MTBF Security**
8. P1-MTBF-001 (Snapshot format)
9. P1-MTBF-002 (Snapshot capture)
10. P1-MTBF-003 (Snapshot validation)
11. P1-MTBF-004 (Multi-frequency tracking)
12. P1-MTBF-005 (Telemetry signing)

**Week 6–7: Rate Limiting**
13. P1-RATE-001 (Retry counter)
14. P1-RATE-002 (Backoff policy documentation)
15. P1-RATE-003 (Retry telemetry)

**Week 7–8: CRC & Corruption**
16. P1-CRC-001 (CRC failure watchdog)
17. P1-CRC-002 (CRC telemetry)
18. P1-CRC-003 (Recovery policy documentation)

**Week 8–9: Backup Routing**
19. P1-BACKUP-001 (Opt-in policy)
20. P1-BACKUP-002 (Loop detection hardware)
21. P1-BACKUP-003 (Failover audit log)
22. P1-BACKUP-004 (Allowlist validation)

**Week 9–10: Propagation Security**
23. P1-COC-001 (mSave audit logging)
24. P1-COC-002 (b_flag policy)
25. P1-COC-003 (Propagation transparency)

**Week 10–11: GC Wraparound**
26. P1-GC-001 (Wraparound semantics documentation)
27. P1-GC-002 (Wraparound safety limits)
28. P1-GC-003 (Wraparound event logging)

**Total: 11 weeks (3 months)**

Each task can be picked up independently after its dependencies are complete. All are non-blocking on silicon.
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
