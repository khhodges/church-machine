# Button-free FPGA maintenance: R1/R2/R7 control decision

11 November 2026. Normative design for a **new development profile**, not a
claim that the existing board implements it. D1's server-custody trust boundary
was explicitly accepted by the owner. This document authorizes no implementation,
credential access, provisioning, board command, synthesis, programming or flash.
Frozen starter packages remain unchanged.

## 1. Evidence and boundary

Inspected sources and the limits they establish:

| Source | Existing behavior; consequence for the new profile |
|---|---|
| `server/bridge_pairing.py` | Single-use pairing tickets; durable signed grant records; bridge grants allow telemetry/polling, not IDE control/builds. This authenticates a bridge to Flask, not UART to FPGA. The legacy manual reconnect approval must not become board authority. |
| `server/app.py`, `_wukong_control_auth`, `_optional_report_token_check` | Includes a TESTING bypass and permits local access when REPORT_TOKEN is absent. New physical-control routes must use mandatory configured authorization, without inheriting either bypass. Existing routes are not changed by this decision. |
| `hardware/wukong_bridge.py`, credential helpers | Windows current-user protected credential persistence is bridge/server pairing custody, not a board control key. Retain exact IDE/device scoping and original expiry across restarts. |
| `server/uart_profile_install.py` | Pins an old BIT/profile, exact 64 KiB image, version-zero boot assumptions, fresh halt and empty command queue; queues upload with entry metadata. Host queue/bridge write ACK is not board authentication, quiescence, admission or execution proof. |
| `server/development_latest.py`, `development_image_prepare.py` | Preparation uses latest compiled inputs and derives geometry from emitted bytes. Freeze these inputs once for an operation; do not prepare a different image between confirmation and installation. |
| `cooperative-retry/starter_transport.py` | CSI1 selects one of two images, physical maintenance gates parsing; 32-bit epoch is volatile; raw image stream is not MACed. CRC/digest/epoch alone cannot replace the button. |
| `cooperative-retry/starter_lifecycle.py` | Control lives outside execution reset; BEGIN resets execution and advances an epoch; validation is epoch-bound. No independent authenticated STOP/drain handshake exists. |
| `cooperative-retry/starter_top.py` | Two pinned hashes, 16,384-word RAM, CPU/loader/staging write arbitration, fixed boot assumptions. Keep boot identity checking and ROM provenance; replace fixture provisioning, not the checks. |

Paths are relative to repository root except `cooperative-retry/`, which is
relative to `docs/phase-2/`. None of these observations certifies a live target.

**Threat model.** An attacker may inject, drop, delay, reorder or replay UART
and bridge traffic, compromise the bridge, claim another UID, or run hostile
application code. The board independently checks maintenance authority.
The trusted boundary includes the authenticated IDE server, its policy/key
store, the provisioned maintenance implementation and its private storage.
Server compromise can authorize arbitrary compatible images and STOP.
Physical key extraction, replacement of FPGA configuration, malicious provisioning
and invasive attacks are excluded; do not advertise secure boot or hardware
attestation against those attackers. MACs provide authenticity, not confidentiality
of image bytes. Transport denial of service remains possible.

General Phase 2 Passcodes remain **unchecked**, as stated in `README.md`.
They are neither session credentials nor a substitute for HMAC. No opcode,
GT bit, Namespace sequence/version rule, CALL or RETURN rule changes.

## 2. Provisioning, custody and freshness

Choose HMAC-SHA-256 with full 32-byte tags and a unique random 32-byte root
key per board/key generation. Keys exist only in the server's protected store
and board maintenance-private storage: never browser, bridge, application RAM,
GT-accessible memory, logs, source, evidence bundles or downloadable scripts.
Use a vetted software HMAC implementation; qualify a hardware HMAC wrapper
independently of the frozen SHA verifier. Bare SHA(key || message) is forbidden.

An independently authorized trusted programming/provisioning procedure records
board ID (16 bytes), key generation (u64), root key, allowed profile/layout
policy, and a durable boot epoch (u64). Board ID is an identifier, not proof.
Ordinary UART has no initial-enrollment, key-export or factory-reset command.
Provisioning must test denial of application/debug access to key/counter storage.
No key is embedded in a shared/exported BIT or generic build package.

**Selected freshness design:** a protected, power-fail-safe monotonic boot counter.
Before accepting any session, reserve and durably commit the next boot epoch,
then use it. Every reset which clears session/replay state must advance it.
Execution-only reset must preserve maintenance state and must not rewind it.
Interrupted commits may skip epochs, never reuse one; torn/corrupt/rollback
storage and exhaustion disable remote control. Counter writes need a durable
commit/readback barrier, not a queued flash write. No wall clock, host-selected
epoch, UART noise, FPGA UID or volatile reset counter substitutes for freshness.

This storage is **not established on the current wrapper**. Before implementation
freeze, inventory a concrete protected NVM/interface, atomic update scheme,
endurance and brownout behavior within the resource/pin budget. Plain writable
application SD storage does not qualify. If unavailable, stop this design's
hardware implementation and review qualified hardware randomness as an
alternative; do not silently select it or claim the current board is ready.

Rotate/revoke by disabling the server key and sessions immediately, then by a
separately authorized trusted reprovisioning operation with a new key generation.
Online server revocation alone cannot retract frames already delivered to a
disconnected board; sessions expire locally as below. A stolen root key requires
board reprovisioning, not waiting for expiry. Lost keys have no UID-based recovery
or manual “approve unknown bridge” bypass. Securely erase retired private keys.
Power loss does not restore an old key generation. Private backups, if used,
must not roll back the board counter; this is a provisioning acceptance criterion.

## 3. Session establishment and wire rules

Proposed wire protocol identifier: `DCM1`, incompatible with CSI1 and legacy raw
commands. No protocol auto-downgrade. Hardware advertises its compiled profile
and policy digest, not a claim supplied by the bridge.

All integers are unsigned big-endian; IDs are fixed 16-byte opaque values,
hashes/tags 32 bytes, reserved fields zero. Image data retains its declared
native byte order without conversion. Use a length-delimited bounded binary
encoding, not JSON. Unknown types, flags, trailing bytes and oversized lengths
are rejected before allocation or side effects. Freeze shared encoder test
vectors before RTL implementation.

1. Server sends HELLO with a fresh 32-byte cryptographic host nonce and selected
   board ID. This is the only unauthenticated request. It cannot stop execution,
   replace an active session or change memory. Rate-limit it and reserve bounded
   parser service so malformed application traffic cannot monopolize maintenance.
2. Board returns a challenge containing protocol version, board ID, key generation,
   boot epoch, a nonwrapping u64 challenge serial, host nonce, compiled profile
   hash and policy hash, with HMAC(root, `"DCM1/challenge"` || those fixed fields).
   One pending challenge, five-second expiry; it cannot evict an active session.
   Increment serial on each issued challenge, not just successful authentication.
3. Server validates the challenge and target/profile policy, then returns
   AUTH = HMAC(root, `"DCM1/auth"` || challenge fields). Board accepts only its
   current unused challenge. Session ID is the first 16 bytes of
   SHA256(`"DCM1/session"` || challenge fields).
4. Derive separate keys with HMAC(root, `"DCM1/host-key"` || challenge fields)
   and HMAC(root, `"DCM1/board-key"` || challenge fields). All subsequent requests
   and responses use the respective directional key. AUTH success is itself
   confirmed with the board key. No application instruction can invoke this KDF.

One active controlling session per board. No unauthenticated preemption.
A healthy session may close itself; otherwise a new controller waits for expiry.
Use a fixed 60-second idle and 15-minute absolute session lifetime measured by
the maintenance clock; only valid, next-sequence requests renew idle time.
Duplicate requests and bad MACs do not renew it. No clock wrapping; expiration
is a maintenance event, not a change to application watchdog policy.

Every session frame consists, in order, of magic(4), version(u16=1),
type(u16), body_length(u32, at most 2048), board_id(16), key_generation(u64),
boot_epoch(u64), session_id(16), sequence(u64), request_id(16),
transaction_id(16), body(body_length), tag(32). Tag covers a fixed ASCII
direction domain (`DCM1/request` or `DCM1/response`) followed by all preceding
frame bytes. CRC is unnecessary for authority; UART/framing errors discard the
partial frame. MAC must pass **before** commands or DATA affect memory.
Stage a full bounded frame privately before authentication. Do not stream
unauthenticated DATA into the destination while waiting for its tag.

Host sequence starts at 1 and advances exactly by 1, including STATUS.
One outstanding request; no pipelining. Board caches the last accepted
request hash and its response: an exact duplicate returns that response with
no repeated effect; same sequence/different bytes, gaps and older sequences
are rejected without modifying the transaction. Invalid MACs do not consume
sequence. Authenticated semantic errors do consume it and are cached.
Responses echo the request sequence/IDs and include result/state; the server
accepts only the response for its outstanding request. Counters never wrap.
Unsolicited legacy telemetry is never authoritative state.

Long operations return ACCEPTED (not completion), then fresh STATUS requests
observe completion. The cached ACCEPTED reply does not evolve into a new
response. Rate-limit invalid frames without taking execution down; authenticated
session expiry is handled by the state machine, not by random garbage reception.

## 4. Exact image and entry authorization

The server verifies the user's authority for the selected board and operation,
resolves exact approved immutable artifacts, and creates a durable operation
record before any command is sent. Possession of a paired bridge grant is
insufficient. Missing server auth/key/policy is a hard refusal, including local
development; tests inject a test authority, not a production bypass.

For the first vertical slice only `REPLACE_IMAGE` is supported. BEGIN's fixed
descriptor body is, in order:

| Field | Encoding / meaning |
|---|---|
| operation, reserved | u16=1, u16=0 |
| profile_hash, layout_hash, policy_hash | three 32-byte hashes; match compiled supported policy |
| payload_length, destination_base, allocation_length | three u64 byte values; aligned, positive, no arithmetic overflow |
| image_sha256, manifest_sha256 | two 32-byte hashes; exact bytes and immutable input inventory |
| namespace_identity | 32-byte canonical identity digest |
| root_base, root_length | two u64 byte values within the authorized allocation |
| namespace_self_gt, entry_thread_gt | two u32 values in unchanged ISA encoding |
| entry_namespace_slot, entry_nia | u32 slot, u32 native entry address |
| expected_boot_guard | u32, existing guard encoding, not a new ISA field |
| expected_active_generation | u64 compare-and-swap precondition from fresh STATUS |

Request/session/board/transaction identity comes from the authenticated envelope.
The descriptor hash is SHA256 of the exact descriptor body. DATA, VERIFY and
START bind that hash, not just a filename or selector. Server authorization of
this descriptor is the exact-image grant; there is no second unauthenticated
“expected hash” register. A server may authorize an unknown-after-freeze image,
but only under supported compiled geometry/policy and a deliberate operation.

The board validates lengths, fixed allowed allocation region, profile/layout,
current generation, and entry ranges before BEGIN. The server cannot use a valid
MAC to address maintenance key/control/ROM storage. Payload length must equal
the entire selected replaceable allocation; no stale unverified executable tail.
Fixed hardware limits and address widths reject oversize images before truncation.
Unsupported layout versions are errors, not conversions or automatic widening.

After reception, board verification hashes destination readback under exclusive
write ownership. It also validates image structure, Namespace self/entry
descriptors, type/version/limits, Thread context and entry NIA against the
descriptor using the existing ISA boot rules. Compare guard values against
the image, not merely against host metadata. Nonzero valid versions are supported
by the new profile; no zero-version bypass. Invalid identity fails even when
the SHA matches. The descriptor's manifest hash is an audit binding, not proof
that a host manifest can override board geometry or image bytes.

Only while execution is held may verified root/entry/guard values be latched
into protected boot configuration. START atomically binds admitted digest,
descriptor, configuration and active generation, then invokes the normal
guarded boot path. No arbitrary PC register write, direct GT grant, or
host-controlled “validation succeeded” bit. No code patch after VERIFY.
Any later image write invalidates READY and requires complete verification again.

`UPGRADE_LUMP` and `INSTALL_NAMESPACE` use separate future operation schemas and
SYSTEM allocation/publication contracts; reject them in this slice. This
whole-image grant cannot bypass SYSTEM or reuse a destination from an unrelated
Namespace. A future Namespace B failure must preserve A; future upgrades retain
old allocations and continuations. These are R3/R4/G1–G9 gates, not permissions
implicitly supplied by maintenance authentication.

## 5. STOP, transfer and activation state machine

Maintenance parser, authentication, clocks, state and memory arbitration remain
outside application execution/reset/watchdog control. They must work when
application code loops, faults or stops servicing requests.

| Command | Preconditions, effect and completion evidence |
|---|---|
| STATUS | Any authenticated session; no execution effect. Return a fresh atomic snapshot described below. |
| STOP | Authenticated expected active generation; RUNNING or faulted execution → STOPPING. Close issue of new work, drain/cancel already accepted work by explicit bus contract, then HELD. Repeating STOP in HELD has no effect. |
| BEGIN | HELD with certified quiescence, no active transfer, valid descriptor/generation and nonzero new transaction ID. Latch descriptor; advance nonwrapping transaction generation; invalidate old admission; enter RECEIVING. No implicit STOP. |
| DATA | RECEIVING; body = descriptor_hash(32), offset(u64), bytes(1..1024, multiple of 4). Require next contiguous offset and exact remaining bounds. ACK only after authenticated bytes commit to memory. |
| VERIFY | RECEIVING with exact byte count; body = descriptor_hash. Enter VERIFYING, deny all destination writes, hash readback and validate entry. Success → READY; failure → FAILED_HELD with reason. |
| START | READY; body = descriptor_hash. Require same transaction, valid admission, quiescence and unchanged generation. Atomically advance active generation, latch boot config and enter STARTING. Normal boot acceptance → RUNNING; boot failure → FAILED_HELD/fault evidence. |
| ABORT | Active replacement or READY; empty body, matching transaction. Stop loader issuance, drain accepted loader writes, invalidate admission and enter FAILED_HELD. It never restores an overwritten old image or starts execution. |

STOP body is expected_active_generation(u64). STATUS and ABORT bodies are empty.
STOP/STATUS use zero transaction ID when no replacement is active; all other
commands use the BEGIN transaction ID. STARTING/STOPPING/VERIFYING reject new
mutations other than a matching ABORT of a pre-start transfer; STATUS remains
available. START consumes READY once. ABORT after START acceptance is rejected;
use a distinct authorized STOP to stop the now-started application.

**Quiescence is a hardware predicate, not a delay.** Inventory every writer:
CPU data, Namespace/C-list saves, thread-switch/context engines, LUMP staging,
loader, DMA/peripheral queues and pending MMIO side effects. On STOP, latch
ownership boundaries and block new issues. An accepted RAM write completes
before the drain barrier; an unaccepted write is cancelled. Multi-cycle/context
operations must explicitly acknowledge cancellation or finish their outstanding
writes. Peripheral accepted side effects must report completion; inability to
prove this is not quiescence. Assert/reset execution only with the documented
drain/isolation ordering, so reset cannot hide a still-pending writer.

HELD requires all write queues empty, all owners idle and application write
grants disabled across clock domains. Return `STOP_COMPLETE` only after this
predicate; latch its active generation and barrier counter in STATUS.
A bounded, profile-declared drain timeout enters `STOP_FAILED_ISOLATED`, never
HELD: execution issuance stays blocked, BEGIN/START prohibited, outstanding
effects reported unknown. Trusted recovery is separate. Do not lie about
quiescence because a stuck peripheral cannot drain. The maintenance controller
still answers STATUS; application cooperation is not required.

Session expiry/link loss while RUNNING never implicitly stops/restarts the
application. While STOPPING, finish the safety drain without renewing authority.
During replacement, expiry stops new loader work, drains accepted writes and
invalidates admission; stay FAILED_HELD. A partial frame timeout discards that
frame only; it neither performs ABORT nor changes application state. No blind
rollback, watchdog renewal, fault release or automatic RUN accompanies reconnect.

## 6. Reconnect and IDE operation ownership

Persist the server operation ID, board/key/profile identity, immutable artifact
hashes/descriptor, session/boot epoch, last request bytes/sequence and last
authenticated response before advancing the operation. Browser refresh must
attach to this operation, not create another queue item. Bridge restart reuses
its protected IDE/device grant without extending expiry; that grant still
does not hold the board key. Never log session keys or authentication material.

Within a live session after a lost response, retransmit only the **exact**
outstanding authenticated request; duplicate handling returns the cached result.
Then query STATUS. If session state was lost/expired, establish a fresh session
and query STATUS first, never resend BEGIN/START as a new request to “try again.”
Do not preempt another controller by opening HELLO.

Authenticated STATUS includes boot epoch/session/request correlation, compiled
profile/policy, lifecycle/fault state, quiescence/barrier and pending-writer mask,
active generation and admitted image/descriptor digests, root/entry configuration,
current/last transaction ID and descriptor digest, received byte offset,
verification state, START acceptance and guarded-boot result. Freeze these as
fixed-width enum/bitmask/hash records within the frame bound; explicit valid bits
distinguish absent image/state from all-zero identities. Preserve the last
transaction outcome across session expiry, but not across maintenance reset.

Reconciliation rules:

- Matching RUNNING/STARTING identity and transaction: observe completion; do not
  issue START again. START_ACCEPTED is not “program ran successfully.”
- Matching live transfer/session: continue only from authenticated committed
  offset and known next sequence. Without the exact session state, abandon it;
  expiry invalidates it. A new transfer requires a fresh explicit operation.
- Different board/profile/epoch/transaction or active image: show a conflict,
  retain evidence and send no mutation. After board reset report prior outcome
  unknown; never infer failure or retry from missing history.
- Matching HELD/FAILED_HELD: report that the image may be overwritten and the
  board remains stopped. A replacement retry uses a new deliberate operation,
  descriptor and transaction, not hidden recovery.

The IDE's Replace Image & Run flow is prepare immutable inputs → authorize exact
board/descriptor → session + fresh STATUS/preflight → STOP_COMPLETE → BEGIN →
DATA → VERIFY success → START → guarded-boot evidence → required progress/test
oracle. Distinguish queued, delivered, write committed, verified, start accepted,
booted and application acceptance in the UI. Unknown outcome is visible.
One deliberate user action authorizes these disclosed substeps; no repeated
security confirmations or button timing. STOP is a destructive maintenance halt,
not a promise to resume saved execution. This initial protocol has no RESUME;
the UI must disclose that restart requires a verified replacement and normal boot.
Latest compilation changes during this flow require new preparation/confirmation,
not substitution. Signing/sending is serialized per target; compilation may
remain concurrent. Authenticated status proves the provisioned maintenance
implementation's report, not externally measured installed BIT bytes.

## 7. Concrete acceptance tests and gates

These are required tests for later implementation, **not tests run or passed by
this documentation task**. Use synthetic keys and isolated stores. Retain exact
stimulus, authenticated response classification, memory/write-bus observations
and candidate hashes; redact keys/tags/session material from user-facing logs.

| ID / owner | Stimulus | Required oracle |
|---|---|---|
| C01 host + RTL | Independent HMAC known-answer vectors; flip every header/body field, wrong key/board/direction/profile; oversized/truncated frames | No command/write/STOP pulse before valid full MAC; parser remains bounded. |
| C02 RTL | Record session and START, reset execution, reset maintenance, power-cycle; replay each transcript | Execution reset preserves replay state; maintenance reset advances durable epoch; all stale transcripts rejected. |
| C03 storage model + physical | Cut power at every counter commit step; corrupt/roll back storage; exhaust counters | Epoch never reused; uncertain state disables authentication. Real power-loss evidence required before release. |
| C04 host + RTL | Duplicate DATA/BEGIN/START, altered same-sequence request, reordered/gapped/old sequence, cross-session frame | Exactly one effect; exact duplicate cached; invalid frame cannot advance offset, generation or PC. |
| C05 RTL | Stuck CPU, fault, context save, C-list/NS write, staging write, pending MMIO/DMA at STOP | No new issue after barrier; accepted writes accounted for; STOP_COMPLETE only with all owners quiescent. |
| C06 RTL | Force a writer never to drain | STOP_FAILED_ISOLATED; no BEGIN/START success or false quiescence; STATUS still works. |
| C07 RTL | Bad length, overflow/wrap, protected destination, incompatible layout, wrong digest, digest-correct bad entry/guard/type/version | Reject before protected writes, or remain failed-held after validation; boot never bypasses identity. Include nonzero-version valid and invalid cases. |
| C08 host + RTL | Freeze candidate RTL, then build/authorize a new compatible image and entry | New image verified/booted without changing RTL constants or using button; unauthorized hash/entry substitutions fail. |
| C09 RTL | Modify memory after VERIFY; late verifier result from older transaction; simultaneous ABORT/START | No stale READY/admission; deterministic single state transition; no partial activation. |
| C10 host integration | Drop responses before/after STOP, BEGIN, final DATA, VERIFY and START; restart browser, bridge, server | Status-first reconciliation, at-most-once effects; restart never renews bridge grants or blindly restarts board. |
| C11 host + RTL | Idle/absolute expiry during every phase; challenge flood while running; bad MAC flood | Running code not implicitly stopped; unfinished replacement fails held; no unauthorized session preemption or timer renewal. |
| C12 authorization | No configured auth, test-mode deployment, telemetry-only bridge grant, UID spoof, expired/revoked key, unknown reconnect request | New hardware-control route refuses all; no queued command, credentials or grant revival. |
| C13 isolation | Application/debug tries to read/write keys, boot epoch and boot configuration; descriptor targets each private region | Access denied; no key disclosure or counter/config mutation. Provisioning/recovery tested separately with fake stores. |
| C14 host + board evidence | Bridge fabricates upload ACK, stale RUNNING or substituted identity; boot accepted but workload fails | UI never reports success from bridge ACK; fresh authenticated identity plus workload oracle required. |
| C15 regression | Run unchanged frozen starter tests and relevant ISA/boot/authority cases beside new profile | Historical button semantics/fixtures preserved; unchecked Passcodes unchanged; no legacy protocol fallback. |

Gate order: approve design → separately authorize implementation → establish
key/counter feasibility and shared wire vectors → isolated host/RTL tests →
resource/timing and peripheral-write inventory → separately authorized vendor
build → separately authorized provisioning/physical negative and power-loss
tests. Unknown storage/fit is an explicit blocker, not approval to weaken D1.
R1/R2/R7 whole-image acceptance does not close R3–R6, general Passcodes, persistent
application boot, multi-board networking or the complete Phase 2 checklist.
