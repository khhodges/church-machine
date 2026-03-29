# Abstract GT I/O and Network Addressing

> **Status**: Architectural specification. The Abstract GT type field (`gt_type = 11₂`) and
> the SWITCH PassKey mechanism (Task #58) are implemented in hardware. The generalised
> Abstract Address Space, the Home Base tunnel, and the IDE provisioning protocol are
> specified here as the canonical extension of that foundation.

---

## The Core Idea

The PassKey mechanism introduced for SWITCH revealed a general principle:

> An **Abstract GT** (`gt_type = 11₂`) whose `word1_location` field holds a
> **reserved hardware sentinel address** is an unforgeable, self-describing token
> for a hardware-routed resource. No namespace entry. No CRC validation. No lump.
> The address *is* the identity.

The SWITCH PassKeys (0xFFFFFFFF for CR15, 0xFFFFFFFE for CR13) are the first two
instances of a much larger **Abstract Address Space** — the 32-bit `word1_location`
range reserved for hardware-routed I/O and remote network resources.

This document specifies that space in full, starting with the **Home Base tunnel**:
the first and most important Abstract GT in the system, which provides every
Meta Machine's outbound network connection to the IDE and cloud infrastructure.

---

## Security Goals

The Abstract GT I/O addressing scheme exists to **eliminate the privileged superuser
attack window entirely**.

In conventional operating systems a privileged layer — ring 0, superuser, hypervisor,
monitor — mediates all resource access. Any code that can reach that layer, impersonate
a privileged caller, or confuse the supervisor into acting on its behalf gains arbitrary
access to every resource on the machine. This is the root cause of:

- **Confused deputy attacks** — a trusted intermediary (the OS, a privileged daemon, a
  browser extension) is deceived into exercising its authority on behalf of an attacker
  who does not hold that authority themselves.
- **Cross-site scripting and cross-site request forgery** — ambient authority (session
  cookies, shared privilege context) is stolen or exercised by code running in a
  different trust domain.
- **Monitor/hypervisor attacks** — a compromised supervisor can read or overwrite any
  memory, any register, any capability belonging to any process it manages.

The Abstract GT scheme removes the attack surface at the architectural level:

1. **No superuser.** There is no privileged layer that holds authority on behalf of
   others. Every abstraction holds only the GTs it was explicitly given. Capabilities
   cannot be borrowed, impersonated, or forged.

2. **Secure individuality.** Each abstraction's identity is the unique set of GTs in
   its c-list. No two abstractions share ambient authority. An attacker who compromises
   one abstraction gains only its GTs — it cannot escalate to another abstraction's
   resources without holding that abstraction's GTs.

3. **No confused deputy possible.** A deputy (any abstraction acting on behalf of a
   caller) can only exercise permissions it holds in its own c-list. It cannot be tricked
   into using a capability it was never given. The GT is the authority — not the identity
   of the caller, not the call stack, not a session token.

4. **No ambient authority.** There are no shared cookies, no global session state, no
   OS-level file descriptors accessible by name. Every resource is a GT, and GTs are
   not ambient — they must be explicitly held to be used.

---

## Abstract GT Structure (recap)

An Abstract GT is a 128-bit capability register with:

| Word | Field | Value for an Abstract GT |
|------|-------|--------------------------|
| Word 0 (32-bit GT) | `gt_type[24:23]` | `11₂` (Abstract) |
| Word 0 | `slot_id[15:0]` | Identifier within the Abstract Address sub-range |
| Word 0 | `perms[30:25]` | Access rights granted to the holder |
| Word 0 | `b_flag[31]` | 1 = may be propagated via mSave |
| **Word 1** (32-bit) | **`word1_location`** | **The Abstract Address — hardware-routed sentinel** |
| **Word 2** (32-bit) | **`word2_backup1`** | **First backup Abstract Address** (tunnel GTs only; `0x00000000` = not configured) |
| **Word 3** (32-bit) | **`word3_backup2`** | **Second backup Abstract Address** (tunnel GTs only; `0x00000000` = not configured) |

For non-tunnel Abstract GTs (local peripherals, SWITCH PassKeys) Word 2 and Word 3
are always zero. For tunnel-range Abstract GTs (`word1_location` in `0xFF000000–0xFF0000FE`)
Word 2 and Word 3 may optionally encode programmer-defined backup IDE addresses. See
[Programmer Backup Home Base IDEs](#programmer-backup-home-base-ides).

No namespace lookup ever occurs for an Abstract GT. Hardware matches `word1_location`
(and backup words if needed) against the Abstract Address Space table and routes the
operation directly.

---

## The Abstract Address Space

The 32-bit `word1_location` field of an Abstract GT holds an **Abstract Address** — a
value in the reserved hardware range. No real RAM lump can have a base address here;
the hardware recognises these addresses as I/O or system tokens.

```
word1_location range         Category
──────────────────────────── ───────────────────────────────────────────────
0x00000000 – 0xFDFFFFFF      Real RAM  — never an Abstract GT address
0xFE000000 – 0xFEFFFFFF      Local hardware peripheral range (UART, GPIO, Timer, Display)
                               IDE assigns one Abstract GT per attached peripheral.
0xFF000000                   Home Base tunnel — the primary outbound network gateway.
                               All network connections flow through this single endpoint.
0xFF000001 – 0xFF0000FE      IDE-allocated tunnel channels (up to 254 named channels).
                               Each is an independent encrypted tunnel to a named remote
                               service (e.g., family registry, software repository, CDN).
0xFF0000FF – 0xFFFEFFFF      Reserved — future IDE-defined Abstract resources.
0xFFFF0000 – 0xFFFFFFFD      Reserved — future system Abstract GTs.
0xFFFFFFFE                   SWITCH PassKey → CR13 (IRQ Thread).
0xFFFFFFFF                   SWITCH PassKey → CR15 (Namespace).
```

The two outermost sentinels (0xFFFFFFFF and 0xFFFFFFFE) are fixed in silicon.
Everything else in the Abstract Address Space is **owned and assigned by the IDE** at
boot time. No user code can create an Abstract GT with a reserved address — only the
IDE/kernel can write directly to a capability register.

---

## The Home Base Tunnel (0xFF000000)

The Home Base is the **single outbound network gateway** for all Meta Machine
connectivity. It is the first Abstract GT the IDE installs at every boot.

### What it is

The Home Base tunnel is an Abstract GT with:
- `word1_location = 0xFF000000`
- `gt_type = 11₂` (Abstract)
- `perms` set by the IDE (typically `R | W | E`) depending on what operations
  are permitted for the holder thread

It represents a hardware-managed encrypted connection to the IDE infrastructure.
All higher-level network channels (0xFF000001–0xFF0000FE) are multiplexed over
this single physical tunnel.

### What it does

Operations on the Home Base Abstract GT route to the hardware tunnel driver:

| Permission on GT | Operation | Meaning |
|:-----------------|:----------|:--------|
| `R` (Read) | DREAD / mLoad | Receive data from the Home Base (IDE push, config, updates) |
| `W` (Write) | DWRITE / mSave | Send data to the Home Base (telemetry, events, uploads) |
| `E` (Enter) | CALL | Invoke a named remote service via the encrypted RPC tunnel |

The Home Base is the architectural equivalent of a network socket, but expressed as
a capability token. Only code that has been given the Home Base GT (or a derivative
with restricted permissions) can make outbound network calls.

### Security

The Abstract GT for the Home Base is unforgeable:
- Only the IDE (running at boot, before user code) can write the GT into a thread's c-list
- The `b_flag` controls whether the GT may be propagated to child threads (default: 0, not propagable)
- Revoking network access is instant — set the GT to NULL in the thread's c-list

No network call can be made without the Home Base GT. A thread that has never been
given the GT has no path to the network, regardless of what code it runs.

---

## Programmer Backup Home Base IDEs

Tunnel-range Abstract GTs (word1_location in `0xFF000000–0xFF0000FE`) may optionally
carry **two backup Abstract Addresses** in Word 2 and Word 3. These encode alternative
IDE endpoints that the hardware will try in order if the primary address is unreachable.

### Purpose

A developer can configure their CTMM to fall back to a private or secondary IDE server
— for example a local development machine, a team server, or a geographically closer
cloud region — without any degradation in security. The backup addresses are unforgeable
(provisioned at boot by the IDE), hardware-validated (must be in the tunnel range),
and subject to the same permission and b_flag constraints as the primary.

### Structure

| Word | Field | Meaning |
|:-----|:------|:--------|
| Word 1 (`word1_location`) | Primary Abstract Address | Tried first — the main IDE/Home Base |
| Word 2 (`word2_backup1`) | First backup Abstract Address | Tried if primary unreachable; `0x00000000` = not configured |
| Word 3 (`word3_backup2`) | Second backup Abstract Address | Tried if Word 2 also unreachable; `0x00000000` = not configured |

### Hardware fallback sequence

```
1. Try word1_location (primary Abstract Address).
2. If unreachable:
   a. If word2_backup1 != 0x00000000 and is a valid tunnel-range address → try it.
   b. If word2_backup1 also unreachable (or not configured):
      i. If word3_backup2 != 0x00000000 and is a valid tunnel-range address → try it.
      ii. If word3_backup2 also unreachable (or not configured) → TRAP: TUNNEL_UNAVAILABLE.
3. All operations on a backup address use the same Word 0 permissions and b_flag as the primary.
```

The TRAP on total failure is recoverable: the caller's IRQ thread can decide to wait and
retry, alert the user, or switch to local-only operation.

### Security constraints

1. **Tunnel range only.** Word 2 and Word 3 are only interpreted as backup addresses if
   `word1_location` is itself in the tunnel range (`0xFF000000–0xFF0000FE`). For any
   other Abstract GT (peripherals, SWITCH PassKeys) hardware ignores Word 2/3 entirely.

2. **Hardware validation.** Before attempting a backup, hardware checks that the
   backup address is also within the tunnel range. A value outside that range is treated
   as `0x00000000` (not configured) — not attempted and not a fault.

3. **Provisioned at boot only.** Word 2 and Word 3 are set by the IDE during the same
   boot provisioning pass as Word 1. User code cannot write any word of an Abstract GT
   directly. This is the same guarantee that protects Word 1.

4. **Same permissions.** Backup IDEs inherit the permission bits from Word 0 exactly.
   There is no mechanism to grant different permissions per backup — the GT is a single
   atomic capability. If the holder may only `E`-call the primary, they may only
   `E`-call a backup as well.

5. **Same b_flag.** The `b_flag` from Word 0 governs propagation of the whole 128-bit
   capability register. Propagating the GT (via mSave, if b_flag=1) always propagates
   all three addresses together — a backup IDE cannot be stripped from a propagated copy.

6. **No cross-address escalation.** A backup address in Word 2 or Word 3 carries no
   new authority. It is a redundant route to an alternative provisioned by the same
   IDE that provisioned the primary — not a hidden back-door. The same encrypted tunnel
   key negotiation applies to every address tried.

### Provisioning example (boot sequence step)

```
Primary Home Base:    word1_location = 0xFF000000  (main cloud IDE)
Backup #1:            word2_backup1  = 0xFF000001  (developer's private IDE server)
Backup #2:            word3_backup2  = 0xFF000002  (team fallback server)
Permissions:          R | W | E
b_flag:               0  (not propagable)
```

All three are set in a single IDE provisioning write at boot. The CTMM will try them
in order whenever the primary is unreachable — transparently, without any change to
the user's code or the permission model.

---

## IDE Provisioning Protocol

At boot, the IDE creates the Abstract GT table and distributes tokens to privileged
abstractions. This happens before any user code runs.

C-Lists do not define any private identity structure. The identity and capability
structure of the system — its DNA — is defined entirely by the structure and
relationships of GTs within Secure Abstractions, not by the c-list itself.

### Boot sequence for Abstract GTs

```
1. Hardware completes SWITCH PassKey installation (CR13 ← IRQ PassKey, CR15 ← NS PassKey).
2. IDE reads the Abstract Address Space configuration (baked into the boot image).
3. For each defined Abstract resource:
   a. Construct the Abstract GT:
      word0_gt  = (abstract_addr[15:0] as slot_id) | (0b11 << 23) | (perms << 25) | (b_flag << 31)
      word1_loc = abstract_addr          ← the Abstract Address for this resource
      word2     = backup1_addr           ← first backup IDE address if tunnel-range GT, else 0x00000000
      word3     = backup2_addr           ← second backup IDE address if tunnel-range GT, else 0x00000000
   b. Write the GT directly into the appropriate c-list slot of the privileged abstraction.
      (No NS slot is allocated — Abstract GTs are self-defining.)
4. The Home Base tunnel GT (word1_loc = 0xFF000000) is always provisioned first,
   with up to two programmer-defined backup addresses in word2/word3.
5. Local peripheral GTs (0xFE000000 range) are provisioned based on attached hardware
   (word2 and word3 are always 0x00000000 for peripheral GTs).
6. IDE-defined channel GTs (0xFF000001–0xFF0000FE) are provisioned based on network config,
   each with optional backup addresses in word2/word3.
7. Boot completes. User code starts with Abstract GTs in place.
```

### Slot_id encoding in Abstract GTs

For Abstract GTs, `slot_id[15:0]` (the low 16 bits of Word 0) is not an NS index
but a **sub-identifier** within the Abstract Address sub-range. By convention:

| `word1_location` | `slot_id` use |
|:-----------------|:--------------|
| 0xFF000000 (Home Base) | 0x0000 — reserved, always zero |
| 0xFF000001–0xFF0000FE (channels) | 0x0001–0x00FE — matches the low byte of the Abstract Address |
| 0xFFFFFFFE / 0xFFFFFFFF (PassKeys) | 0xFFFE / 0xFFFF — matches the low word of the Abstract Address |
| 0xFE000000+ (peripherals) | hardware-assigned I/O port number |

This makes the `slot_id` a redundant but hardware-readable sub-index, useful for
fast hardware routing without a full 32-bit address compare.

---

## Local Peripheral Security (Autonomous Operation)

**Each CTMM can identify and secure locally attached equipment independently —
without any IDE connection, network access, or remote authority.**

The local peripheral range (Abstract Addresses `0xFE000000–0xFEFFFFFF`) is populated
entirely by the CTMM's own hardware boot sequence, based on equipment physically
detected during startup. No IDE request is made. No network round-trip occurs. The
CTMM is the sole authority for its own local peripherals.

This has three important consequences:

### Air-gapped and offline operation
A CTMM with no network connection still enforces full capability-based I/O security.
Peripherals (UART, GPIO, display, storage) are each represented by an Abstract GT
provisioned locally. Code that has not been given the UART GT cannot access the UART —
regardless of whether a network or IDE is present.

### Local trust decisions made in hardware
When a new peripheral is connected, the CTMM's hardware probe assigns it an Abstract
Address from the local range and provisions an Abstract GT. The security decision —
which abstractions receive the GT, with what permissions — is made by the local boot
policy, not by any remote party. A remote IDE has no ability to override this.

### Networked connections are the exception, not the rule
The Home Base tunnel (`0xFF000000`) and IDE-allocated channels (`0xFF000001+`) are the
only Abstract GTs that require IDE provisioning. Everything local is self-contained.
This preserves security even when the Home Base tunnel is unavailable, unreachable, or
deliberately absent:

| Resource type | Provisioned by | Requires IDE / network? |
|:--------------|:---------------|:------------------------|
| Local peripherals (UART, GPIO, Timer, Display) | CTMM hardware boot | **No** |
| SWITCH PassKeys (CR13, CR15) | CTMM hardware boot | **No** |
| Home Base tunnel | IDE at boot | Yes |
| IDE-allocated tunnel channels | IDE at boot | Yes |

---

## Permission Semantics for Abstract GTs

The 6 permission bits apply to Abstract GTs exactly as for Inform GTs, but the
*effect* is routed to the hardware I/O layer instead of the namespace:

| Perm | Church/Turing | Abstract GT Meaning |
|:-----|:--------------|:--------------------|
| `R` | Turing | Read data from the I/O endpoint / receive from tunnel |
| `W` | Turing | Write data to the I/O endpoint / send to tunnel |
| `X` | Turing | Execute / trigger at endpoint (hardware-specific) |
| `L` | Church | Load a sub-capability from the endpoint (future: capability delegation) |
| `S` | Church | Save a sub-capability to the endpoint (future: capability delegation) |
| `E` | Church | Enter / invoke the endpoint (RPC call through tunnel) |

The same domain-purity rule applies: a single Abstract GT may carry Turing permissions
OR Church permissions, never both.

---

## Relationship to SWITCH PassKeys

SWITCH PassKeys and I/O Abstract GTs are the same mechanism at different addresses:

| Aspect | SWITCH PassKey | I/O / Network Abstract GT |
|:-------|:---------------|:--------------------------|
| `gt_type` | `11₂` (Abstract) | `11₂` (Abstract) |
| `word1_location` | 0xFFFFFFFF (CR15) or 0xFFFFFFFE (CR13) | 0xFF000000–0xFEFFFFFF |
| Purpose | Authorises SWITCH to a system register | Authorises I/O or network operation |
| NS entry needed | No | No |
| Provisioned by | IDE at boot (into CR13/CR15 via SWITCH) | IDE at boot (into thread c-list) |
| Forgeable? | No — only code with the GT can use it | No — same hardware guarantee |
| Revocable? | Yes — SWITCH in another PassKey | Yes — set GT to NULL in c-list |

The SWITCH PassKey design is therefore not a special case — it is the **first
published instance** of the generalised Abstract GT I/O addressing scheme.

---

## Security Properties

### Unforgeability
Software cannot construct an Abstract GT pointing to a reserved address. Only the
IDE/kernel can write directly to capability registers during boot. Post-boot, Abstract
GTs can only be copied, attenuated (perms removed via TPERM), or nullified — never
synthesised from scratch.

### Attenuation
A privileged abstraction that holds the Home Base GT with `R | W | E` can create
attenuated derivatives (using TPERM) with only `E` permission and distribute
those to less-privileged abstractions. Those abstractions can make RPC calls but
cannot read or write raw tunnel data.

### No namespace attack surface
Abstract GTs bypass the entire namespace validation pipeline (NS table lookup,
CRC check, version match). The hardware just compares `word1_location` against the
Abstract Address table. There is no NS entry to tamper with, no CRC to forge.

### Revocation
Revoking an I/O token is instant and local: the IDE writes NULL into the c-list slot
that holds the Abstract GT. No GC sweep required, no version bump in the NS table.
The hardware will fault on the very next use of the revoked slot.

---

## Extension Points

The Abstract Address Space is intentionally sparse. The IDE can allocate new Abstract
resource addresses within the reserved ranges without hardware changes:
- New tunnel channels (0xFF000001–0xFF0000FE): add network services without firmware updates
- New peripheral GTs (0xFE000000+): attach new hardware and assign Abstract Addresses
- New system GTs (0xFFFF0000–0xFFFFFFFD): future architectural extensions

The SWITCH mechanism documents the hardware validation pattern. New Abstract resources
that require hardware-checked installation should follow the same pattern: a dedicated
sentinel for each resource, validated by hardware before the GT is installed.

---

## MTBF Qualification and Downloadability Regulation

Every Secure Abstraction carries an **MTBF qualification** — a hardware-tracked
reliability metric (Mean Time Between Failures) that determines whether the abstraction
may be distributed beyond the local CTMM and, if so, to whom. The parent IDE assists
in setting the thresholds for each tier and may update them remotely via the Home Base
tunnel.

### Why MTBF gates downloadability

A distributed abstraction becomes part of the capability structure of every CTMM that
receives it. A poorly qualified abstraction — one with a high failure rate — degrades
the reliability of every system it enters. MTBF qualification makes reliability a
first-class architectural property: an abstraction that has not demonstrated sufficient
reliability cannot propagate, regardless of who asks for it.

This is enforced in hardware through the **S (Save) permission** on the abstraction's
GT. The MTBF tier determines whether the hardware permits `mSave` on that GT:

| Tier | MTBF condition | S permission | Scope |
|:-----|:---------------|:-------------|:------|
| **Isolated** | Below minimum threshold, or unvalidated | Blocked — hardware denies mSave | Local CTMM only; cannot be copied or distributed |
| **User-regulated** | Meets user-tier threshold | Permitted — user-level abstractions may receive a copy | Individual user distribution via the Home Base tunnel |
| **Namespace-regulated** | Meets namespace-tier threshold | Permitted — all abstractions in the namespace may receive it | Full namespace distribution; CR15 (Namespace) validates each download |

### MTBF tracking

The hardware tracks two counters per abstraction in the namespace entry:

| Counter | Meaning |
|:--------|:--------|
| `invocation_count` | Number of times the abstraction has been entered via CALL |
| `failure_count` | Number of those invocations that resulted in a FAULT or unhandled exception |

```
MTBF score = invocation_count / (failure_count + 1)
             ↑ higher is more reliable; failure_count + 1 avoids division by zero
```

These counters are updated atomically by hardware at the end of every CALL / RETURN
cycle. They cannot be written by user code — they are read-only from software's
perspective, writable only by the hardware invocation path.

### Downloadability tiers in detail

#### Isolated
The abstraction exists only on the local CTMM. The S bit on its GT is hardware-locked
to 0 — `mSave` of this GT faults unconditionally. An abstraction enters the Isolated
tier when:
- It has fewer than the minimum invocation count for any tier (freshly installed,
  unvalidated), or
- Its MTBF score is below the Isolated floor set by the IDE threshold config.

Isolated abstractions can still be called locally (E permission is independent of S).
They simply cannot leave the c-list (abstraction) they are provisioned for.

#### User-regulated
The abstraction's MTBF score meets the user-tier threshold preventing downloads, remote access and propagation. The S bit is enabled for
GTs held by user-level abstractions. Distribution is mediated by the Home Base tunnel:
the sending CTMM packages the abstraction via `mSave` and the receiving CTMM installs
it via `mLoad` after the tunnel delivers it. The receiving CTMM recalculates a fresh
MTBF score from zero — history from the sending machine does not transfer.

#### Namespace-regulated
The abstraction's MTBF score meets the namespace-tier threshold. Distribution is
permitted to all abstractions within the namespace. Each distribution is authorised
by the Namespace register (CR15): the namespace authority holds the GT with S permission
and the IDE validates the threshold before permitting the transfer.

### IDE threshold management

The parent IDE sets and updates the MTBF thresholds for all three tiers. Thresholds
are delivered to the CTMM as a signed configuration payload via the Home Base tunnel
(`R` permission on the Home Base GT — the CTMM receives the threshold data):

```
Threshold config payload (delivered via Home Base R):
  isolated_floor      — minimum MTBF score; below this, S is always locked
  user_tier_threshold — MTBF score required for User-regulated status
  ns_tier_threshold   — MTBF score required for Namespace-regulated status
  min_invocations     — minimum invocation_count before any tier is assigned
```

The IDE may raise thresholds (tighten quality requirements) or lower them (e.g., for
a namespace in early development). Threshold changes take effect on the next invocation
cycle — they do not retroactively revoke existing distributed copies, but do prevent
further distribution of abstractions that no longer qualify.

MTBF telemetry flows back to the IDE via the Home Base tunnel (`W` permission):
the CTMM periodically sends `invocation_count` and `failure_count` for each
abstraction so the IDE can track fleet-wide reliability and adjust thresholds
accordingly.

### Security properties

- **Counters are hardware-owned.** User code cannot inflate `invocation_count` or
  deflate `failure_count` to falsely qualify an abstraction. The hardware path is the
  only writer.
- **Fresh score on receipt.** A received abstraction starts with zero counters. It
  must earn its tier on the receiving machine — it cannot inherit a fraudulent score
  from the sender.
- **Threshold authenticity.** Threshold payloads are delivered only via the Home Base
  tunnel, which is an Abstract GT provisioned at boot. A payload arriving through any
  other path is rejected — there is no way for user code to inject a forged threshold
  config.
- **Tier demotion is immediate.** If the IDE lowers a threshold and an abstraction's
  MTBF score falls below the new threshold, the S bit is locked on the next
  invocation — no distribution can occur after that point.

---

## Secure Network Browser Abstraction

A **Secure Network Browser** is a Secure Abstraction that manages outbound network
access on behalf of user code — but operates entirely locally, without any privileged
OS network stack, shared session state, or ambient authority.

### What it is

The browser is an ordinary Secure Abstraction provisioned with a set of Abstract GTs,
one per trusted network endpoint. It holds:

- The Home Base tunnel GT (`0xFF000000`) — the outbound physical connection
- One or more IDE-allocated channel GTs (`0xFF000001+`) — named trusted services
- No other network capability

User code that wishes to reach a network resource must call the browser abstraction
(via E permission) and supply a GT identifying the desired endpoint. If the browser
holds a GT for that endpoint with the required permissions, the call proceeds through
the encrypted tunnel. If it does not hold that GT, the call FAULTs immediately —
there is no path to the network.

### Why it is secure

| Threat | Conventional browser | Secure Network Browser |
|:-------|:---------------------|:-----------------------|
| Cross-site scripting | Attacker injects code that reads cookies from another site | No shared cookies or session state — each site is a GT; code without that GT cannot reach it |
| Cross-site request forgery | Ambient session cookie sent automatically with forged request | No ambient authority — a GT must be explicitly held and passed; it cannot be exercised by code that does not hold it |
| Confused deputy | Browser extension or plugin abuses browser's network authority | No shared network privilege — the browser abstraction can only reach endpoints for which it holds a GT |
| DNS spoofing / redirect | Attacker redirects DNS to point a trusted name at a malicious server | Endpoint identity is a GT, not a name — an attacker who cannot forge the GT cannot impersonate the endpoint |
| TLS stripping | Man-in-the-middle downgrades to plain HTTP | Tunnel is Abstract GT routed — there is no fallback path; the hardware rejects operations without the GT |

### Local operation

The browser abstraction runs entirely on the local CTMM. It does not delegate security
decisions to any remote server, cloud authority, or certificate authority. The GT for
each trusted endpoint is the proof of trust — provisioned at boot, held in the
browser's c-list, unforgeable by any code the browser might invoke on behalf of the
user.

This means the browser is as secure in an offline context (local peripherals, local
services) as it is when connected to the Home Base tunnel. Security does not degrade
when the network is slow, unreliable, or absent — the capability structure is local
and hardware-enforced regardless.

### Relationship to Outform GT network transparency

The Secure Network Browser uses **Abstract GTs** (this document) for its capability
tokens and **Outform GTs** ([Network Transparency](network-transparency.md)) for the
actual remote object representation once a connection is established. The Abstract GT
is the door key; the Outform GT is the object reference fetched through the door.
Neither can be forged; neither can be used by code that was not given it.

---

## Guaranteed Crime-Free Business Services

The capability architecture described in this document is not merely a technical
improvement — it is the foundation for a new class of verifiably safe, focused
business services. Because security is structural rather than policy-enforced, the
guarantees it provides are architectural facts, not promises that can be violated by
a sufficiently determined attacker.

### Why "guaranteed" is the right word

In conventional systems, security is enforced by layers of software that can
themselves be compromised: antivirus, firewalls, content filters, age verification
forms, jurisdiction checks. Every one of these is a policy layer running on a
privileged substrate that an attacker can target. The result is that no conventional
system can truly guarantee that its filtering cannot be bypassed.

In the Church Machine architecture:
- There is **no privileged substrate** for an attacker to capture.
- There is **no ambient authority** for injected code to exploit.
- Access to any service is a **GT** — unforgeable, hardware-enforced, provisioned
  only at boot by the IDE. Code that was not given a GT for a service has no path
  to it, regardless of what it does.

This means service scoping is not a filter applied on top of access — it is the
access. A user whose abstraction holds no GT for a service cannot reach it. This
is as close to a structural guarantee as computing can provide.

### Scoping by profession

Each professional domain is a distinct set of GTs provisioned by the IDE into a
professional abstraction. A medical professional's CTMM holds GTs for medical
databases, clinical references, and regulated communication channels. A legal
professional's CTMM holds GTs for court records, legal databases, and bar-accredited
services. No code running inside a professional abstraction can reach services outside
its provisioned GT set — not because those services are filtered, but because the
abstraction was never given a GT for them.

Professional scoping is therefore enforceable at the hardware level without any
ongoing software policing.

### Scoping by language

Tunnel channel GTs (`0xFF000001–0xFF0000FE`) are allocated per service by the IDE.
A language-specific service is simply a distinct tunnel channel GT. An abstraction
provisioned for French-language services holds the French-service GT; it does not
hold the English-service GT. The language boundary is a GT boundary — it requires
no runtime translation layer, no content inspection, and no privileged filter that
could be bypassed or confused.

### Scoping by nationality and jurisdiction

Jurisdictional compliance (data residency, legal authority, regulatory boundary) is
enforced by provisioning jurisdiction-specific tunnel channels. A CTMM registered
in one jurisdiction receives GTs for the services and data stores licensed in that
jurisdiction. Cross-jurisdictional access requires a GT for the foreign service —
which is provisioned (or withheld) by the IDE in accordance with the applicable
legal framework. The hardware enforces what the IDE provisions; no software running
on the CTMM can circumvent it.

### Scoping by age group, including children

Child safety in conventional systems depends on content filters: software that
inspects traffic and blocks prohibited content. Filters can be bypassed, fooled by
encoding tricks, or circumvented by VPNs. None of these attacks are possible in the
Church Machine architecture.

A child's CTMM is provisioned at boot with GTs only for age-appropriate services.
There is no GT for adult content, no GT for unmoderated communication, no GT for
gambling or financial services. No code running on the child's CTMM — including
injected scripts, malicious links, or peer-to-peer messages — can obtain a GT it was
never given. The child's abstraction has no path to prohibited services, structurally
and permanently, for as long as the IDE controls provisioning.

This is a qualitatively stronger guarantee than any filter-based child protection
system: it does not inspect content after the fact — it prevents the capability to
reach the content from ever existing.

### Summary

| Scoping dimension | Conventional mechanism | CTMM mechanism |
|:------------------|:-----------------------|:---------------|
| Profession | Role-based access control, policy enforcement | Profession-specific GT set provisioned at boot |
| Language | Content negotiation, server-side localisation | Language-specific tunnel channel GT |
| Nationality / jurisdiction | Geolocation, legal compliance software | Jurisdiction-specific GT set; hardware enforces what IDE provisions |
| Age group / children | Content filters, age verification forms | Child GT set excludes prohibited services structurally; no filter to bypass |

In each case, the scoping is a property of the GT structure — defined by the IDE,
enforced by hardware, and inaccessible to any software running on the CTMM. This is
what makes the service guarantee structural rather than policy-based, and what
distinguishes the Church Machine from all conventional security architectures.
