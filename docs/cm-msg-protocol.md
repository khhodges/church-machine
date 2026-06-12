# CM_MSG — Church Machine UART Messaging Protocol

**Status:** V1 — Released for distribution and review  
**Date:** 2026-06-10  
**Scope:** Ti60 F225 (initial target); architecture applies to all CM-connected boards

---

## Guiding Principle

**Identity belongs to the abstraction — not the hardware.**

The Church Machine executes abstractions. An abstraction is a functional object
in a namespace slot: it has behaviour, a capability token, and a unique identity.
The hardware is the substrate it runs on. This protocol extends that model to the
UART channel: every message is sent by a named **abstraction** (a namespace entry),
received by a named **abstraction** (an IDE-side service), and secured by that
abstraction's own encryption service.

**Namespaces are application domains, not hardware descriptors.** A
`Telecommunications` namespace can have many simultaneous instances — the family
hub, a mobile handset, a tablet, a workstation — each a distinct deployment with
its own state and keys, all sharing the same abstraction structure. A `Finance`
namespace instance on one board and another on a second board are the same *kind*
of thing, independently secured and independently managed.

**Specific abstract instances are mobile.** An abstract instance like `mymother`
— a Contact abstraction in a Telecommunications namespace — carries her own GT
token and her own identity. She can migrate between substrates: from the living
room display to a pocket device to a remote server. Her token follows her. Her
capability permissions follow her. Only her per-deployment encryption keys are
re-derived for the new substrate; her identity and capability model are unchanged.

A `Fault.Reporter` abstraction in NS slot 2 has the same cryptographic identity
whether it is running on board `c0ffee01` or board `deadbeef`. A `Browse.Client`
abstraction carries its own domain C-list, its own keys, and its own permission set
— independently of the board it inhabits.

**No message is trusted unless it is authorized, authenticated, and encrypted
by the Outform Golden Token pair of its source and destination abstractions.**

- **Authorization** — The source abstraction must hold an OGT that names the
  destination service. No OGT = no capability, even over UART.
- **Authentication** — Every frame carries an HMAC-8 tag keyed by the source
  abstraction's `K_mac`. Forgeries are rejected before any handler is invoked.
- **Encryption** — Every payload is ChaCha20-encrypted with the source
  abstraction's `K_enc`. The wire reveals nothing about content or identity.
- **Encryption service in every namespace entry** — Each NS slot carries its own
  `K_enc`, `K_mac`, and nonce counter. There is no shared board-level key.
  Revoking one abstraction's keys leaves all others intact.

This is not an add-on. It is the protocol's reason for existing.

---

## 1. Trust Architecture

### 1.1 The chain of trust

```
┌──────────────────────────────────────────────────────────────────┐
│                    FPGA Board (Ti60 F225)                         │
│                                                                  │
│  Each abstraction has an encryption service (firmware-private):  │
│                                                                  │
│   OGT (global.namespace.abstraction.instance)  │ K_enc │ K_mac │ nonce_ctr  │
│  ──────────────────────────────────────────────┼───────┼───────┼──────────  │
│   global.Core.BoardIdentity.boot               │  ●    │  ●    │     n      │
│   global.Core.FaultReporter.boot               │  ●    │  ●    │     n      │
│   global.Core.LumpLoader.boot                  │  ●    │  ●    │     n      │
│   global.Telecommunications.MargaretHodges.family-hub  │  ●  │  ●  │  n  │
│   …                                            │  …    │  …    │     n      │
│                                                                  │
│  token_32 = SHA32(ogt) — hardware register value, derived only  │
│  Slot numbers: firmware-private BRAM addressing. Never in wire.  │
│                                                                  │
│  CALLHOME (0x01): board_uid + fpga_nonce + ns_manifest           │
│  All subsequent frames: encrypted by the SOURCE ABSTRACTION      │
└──────────────────────────┬───────────────────────────────────────┘
                           │  UART  [0xCE][0xAA][type][seq][flags][len]
                           │         [nonce:4][ChaCha20(payload)][HMAC-8]
                           ▼         ↑ keyed by SOURCE ABSTRACTION's token
┌──────────────────────────────────────────────────────────────────┐
│                  Bridge (callhome_bridge.py)                      │
│                                                                  │
│  1. Verify magic                                                 │
│  2. Map msg.type → source token (via ns_manifest)                │
│  3. Load K_mac for that token → verify HMAC (silent drop)        │
│  4. Verify nonce > last_seen[token]  (silent drop on replay)     │
│  5. Decrypt with K_enc for that token                            │
│  6. Validate source abstraction holds OGT for destination        │
│  7. On pass → route to handler                                   │
│  8. On protocol failure → ACK(err) to board                      │
└──────────────────────────┬───────────────────────────────────────┘
                           │  HTTP POST / SSE  (plaintext inside server)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                  IDE Server (app.py)                             │
│                                                                  │
│  Authoritative NS manifest per board                             │
│  Mints per-slot keys:  token_32 + K_enc + K_mac per NS entry     │
│  Deploys NS keystore LUMP → FPGA protected BRAM                  │
│  Revokes per-slot keys; all other slots unaffected               │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 GT validation and encryption at the bridge

GT validation and decryption are intentionally in the bridge, not the firmware. This is by design:

- **Firmware stays frozen.** New abstraction types, new revocations, new domain
  rules, new cipher algorithms — all applied on the IDE side. The FPGA never needs
  reflashing to change permissions or upgrade crypto.
- **Point-to-point channel.** The UART bridge is a 1:1 connection to one board.
  Once CALLHOME establishes the NS manifest and completes the nonce handshake, every
  subsequent message is decrypted and validated against the source abstraction's
  per-slot key pair.
- **Keys, not tokens, in the wire.** The 32-bit GT token is a hardware capability
  handle — too short for cryptography. Each NS slot is extended with a 128-bit
  `K_enc` and `K_mac` that belong exclusively to that abstraction. These keys live
  in the FPGA's protected BRAM and the IDE's NS keystore. The wire carries ciphertext
  and an HMAC tag. The bridge uses the `msg.type` → NS slot mapping from the
  ns_manifest to select the right key pair before decryption.
- **Abstraction identity is portable.** The same abstraction (same label, same
  token) can be deployed to multiple boards. Each board gets its own key pair for
  that slot (derived from `board_uid + ns_slot + token_32`), but the identity and
  permission model of the abstraction are identical. Migrating an abstraction to a
  new board means deploying its LUMP and its keystore entry — no protocol change.

### 1.3 Trust states

| State | Description | Allowed message types |
|-------|-------------|----------------------|
| **Unregistered** | CALLHOME not yet received; ns_manifest unknown | `0x01 CALLHOME`, `0x06 PING` only |
| **Registered** | ns_manifest loaded; per-slot keys active | All types for which source abstraction holds an OGT |
| **Suspended** | Admin-suspended board | `0x01 CALLHOME` only (re-registration) |
| **Revoked slot** | Specific NS slot's keys removed | All other slots still valid and independent |

### 1.4 Security properties guaranteed by this protocol

1. **Abstraction identity** — Every capability is identified by its NS slot token (`token_32`), not the board UID. The board is the execution substrate; the abstraction is the identity. A `Fault.Reporter` on any board has the same semantic identity and permission model.
2. **Encryption service per namespace entry** — Every NS slot has its own `K_enc` and `K_mac`. There is no shared board-level key. Slot 2 cannot read or forge frames from Slot 15. Revoking one slot leaves all others intact.
3. **Confidentiality** — Every payload is ChaCha20-encrypted using the source abstraction's 128-bit `K_enc`. An observer on the UART wire sees only ciphertext.
4. **Integrity + Authentication** — Every frame carries an 8-byte HMAC-SHA256 tag keyed with the source abstraction's `K_mac`. A tampered frame is silently dropped before decryption.
5. **Replay protection** — Every frame includes a 32-bit monotonic nonce counter per NS slot. The bridge rejects any frame whose nonce ≤ `last_seen_nonce[slot]`.
6. **Least privilege** — Each capability is a separate NS slot with its own key pair and its own OGT. A board doing callhome cannot browse unless the `Browse.Client` abstraction was granted and its key bundle was deployed.
7. **Capability confinement** — `CM.Browse.Client` confines browsing to a parent-approved domain C-list carried inside the abstraction itself. The token IS the permission list.
8. **Revocability** — Any NS slot and its keys are removed server-side. Takes effect on next bridge connect. No FPGA reflash needed.
9. **Unforgeability** — GT tokens are SHA-32 hashes; slot keys are 128-bit secrets derived from `board_uid + ns_slot + token_32`. A board cannot fabricate a slot it was not granted, nor derive a key it was not deployed.

---

## 2. Abstraction Identity & Namespace Encryption Services

Every UART-capable capability is a **namespace entry** — a functional object in the
NS table with its own token, its own permission set, and its own encryption service.
The namespace IS the trust domain. The board UID is routing infrastructure only.

### 2.1 FPGA-side abstractions (NS slot entries)

The board reports its **NS manifest** in every CALLHOME — the list of abstractions
present on this board, each identified by its OGT. The bridge validates the manifest
against its global abstraction registry (Section 2.7) and builds the
`msg_type → ogt` lookup for the session.

**The `token` field is the OGT** — the full hierarchical capability path:
`global.namespace.abstraction.instance`. It is a canonical name, not a number.
The 32-bit hardware register value `token_32 = SHA32(ogt)` — derived from the
name, never invented.  **Slot numbers are not in the manifest** — firmware-private.

```json
{
  "token":    "global.Core.FaultReporter.boot",
  "label":    "Fault.Reporter"
}
```

```json
{
  "token":    "global.Telecommunications.CallHistory.family-hub",
  "label":    "CallHistory",
  "resident": true
}
```

| Field | Meaning |
|-------|---------|
| `token` | The OGT — `global.<ns_type>.<canonical_name>.<ns_instance>`. Permanent global identity. The bridge keys everything by this value. |
| `label` | **Local pet name** — the user's personal name for this abstraction. Can differ between users, can be renamed without affecting the OGT. Never used for routing or crypto. |
| `resident` | `true` = this deployment is fixed to this board; the IDE will not migrate it. Absent or `false` = roaming. **All abstractions are mobile by nature** — `resident` is a deployment policy, not a capability limit. |

**Labels are pet names. OGTs use canonical names.**
The same Contact abstraction might be labelled `"mymother"` by one user, `"wife"`
by another, and `"Mum"` by a third — but all three point to the same OGT,
`global.Telecommunications.MargaretHodges.family-hub`, where `MargaretHodges` is
the formal name registered when the abstraction was created. Renaming a label never
changes the OGT. The bridge ignores labels entirely — it routes and authenticates
by OGT alone.

`ns_type` and `ns_instance` are encoded in the OGT path and need not be separate
manifest fields — the bridge parses them from position 1 and 3 of the OGT.

Each entry announces: *"This abstraction is present on this board and has an active
encryption service."* The bridge never needs to know which BRAM slot it occupies.

**Core abstractions** (ns_type=`Core`, always present in every board's manifest):

| OGT | Label | Perms | msg_types | Description |
|-----|-------|-------|-----------|-------------|
| `global.Core.BoardIdentity.boot` | `Board.Identity` | E | `0x01` | Board routing identity |
| `global.Core.Heartbeat.boot` | `Heartbeat` | E | `0x06` | Lowest privilege — PING only |
| `global.Core.FaultReporter.boot` | `Fault.Reporter` | E | `0x02 0x07` | FAULT + BOOT_LOG |
| `global.Core.PerfReporter.boot` | `Perf.Reporter` | E | `0x08` | PERF counter emission |
| `global.Core.LumpLoader.boot` | `Lump.Loader` | E | `0x04` | LUMP_REQ Lazy-Load |
| `global.Core.TraceEmitter.boot` | `Trace.Emitter` | E | `0x03` | Instruction TRACE (debug) |
| `global.Core.NSInspector.boot` | `NS.Inspector` | R | `0x05` | Read-only namespace dump |
| `global.Core.MediaConsumer.boot` | `Media.Consumer` | E | `0x09 0x0A` | Media asset fetch |
| `global.Core.BrowseClient.boot` | `Browse.Client` | E | `0x10–0x14` | Web browsing |

**Application namespace abstractions** — OGT uses canonical names, label carries the pet name:

```
ns_type="Telecommunications", ns_instance="family-hub":

  token="global.Telecommunications.MargaretHodges.family-hub"
    label="mymother"       ← one user's pet name for MargaretHodges
    label="Mum"            ← another user's pet name for the SAME OGT
    label="wife"           ← yet another — same OGT, different label
    (roaming — no resident flag)

  token="global.Telecommunications.GlobalWorkspaceLtd.family-hub"
    label="workoffice"     ← pet name for the canonical GlobalWorkspaceLtd contact
    (roaming)

  token="global.Telecommunications.CallHistory.family-hub"
    label="CallHistory"    ← canonical name and label happen to match here
    resident=true          ← fixed to this board; IDE will not migrate it
                             (its state is local — moving would be a copy, not a move)

ns_type="Telecommunications", ns_instance="mums-mobile":
  token="global.Telecommunications.MargaretHodges.mums-mobile"
    label="mymother"       ← same canonical person, different namespace instance
    (roaming)
```

**All abstractions are mobile.** The OGT identity survives any substrate migration.
`resident: true` is a deployment policy annotation, not a capability limit. A
resident abstraction can still be migrated by an authorised administrator — `resident`
simply tells the IDE not to do so automatically.

The OGT `global.Telecommunications.MargaretHodges.family-hub` is stable and globally
unique. It uses `MargaretHodges` — her real name — not any single user's pet name
for her. When this abstraction migrates to a new board, the OGT is unchanged;
only the deployment (board_uid, K_enc, K_mac) changes.

**Encryption service per abstraction** — every OGT has its own `K_enc`, `K_mac`,
and `nonce_ctr`. No two abstractions share a key. The keystore LUMP (Section 2.6)
is indexed by OGT path.

#### sha32 identity primitive — CALLHOME worked example

Every namespace entry announced in `ns_manifest` carries a `token_32` field.
`token_32 = sha32(ogt)` — the first 4 bytes of SHA-256 over the OGT string,
interpreted big-endian. This is the 32-bit hardware register value the Church
Machine uses to match a LUMP or C-list entry to a namespace slot. It is
**derived from the name** — never invented, never negotiated.

```
sha32("global.Core.FaultReporter.boot")

  Step 1 — encode OGT to raw UTF-8 bytes (30 bytes):
    67 6c 6f 62 61 6c 2e 43 6f 72 65 2e
    46 61 75 6c 74 52 65 70 6f 72 74 65
    72 2e 62 6f 6f 74

  Step 2 — SHA-256 over those 30 bytes (full 32-byte digest):
    677d36a7 dfccf13f ecfd1c4e 15ffadf1
    bc48b352 c01296a5 9ac4684b db680b40

  Step 3 — take first 4 bytes, interpret big-endian:
    token_32 = 0x677d36a7
```

Full ns_manifest CALLHOME JSON fragment (firmware v1.2+):

```json
CALLHOME:{
  "board":"Ti60F225",
  "uid":"c0ffee0100000001",
  "boot_ok":1,
  "fw_major":1,"fw_minor":2,
  "ns_manifest":[
    {"ogt":"global.Core.BoardIdentity.boot", "token_32":"0x68706247","label":"Board.Identity","resident":true},
    {"ogt":"global.Core.Heartbeat.boot",      "token_32":"0x416d6848","label":"Heartbeat",     "resident":true},
    {"ogt":"global.Core.FaultReporter.boot", "token_32":"0x677d36a7","label":"Fault.Reporter","resident":true},
    {"ogt":"global.Core.PerfReporter.boot",  "token_32":"0xeb2b7554","label":"Perf.Reporter", "resident":true},
    {"ogt":"global.Core.LumpLoader.boot",    "token_32":"0xd728290d","label":"Lump.Loader",   "resident":true},
    {"ogt":"global.Core.TraceEmitter.boot",  "token_32":"0xa7ce2b32","label":"Trace.Emitter", "resident":true},
    {"ogt":"global.Core.NSInspector.boot",   "token_32":"0x404c79d5","label":"NS.Inspector",  "resident":true},
    {"ogt":"global.Core.MediaConsumer.boot", "token_32":"0xe400ec35","label":"Media.Consumer","resident":true},
    {"ogt":"global.Core.BrowseClient.boot",  "token_32":"0xe7eed989","label":"Browse.Client", "resident":true}
  ]
}
```

**Bridge processing** (`_handle_callhome_json` in `callhome_bridge.py`):

1. For each entry the bridge independently recomputes `sha32(ogt)` and
   cross-checks it against the firmware-provided `token_32`.  A mismatch is
   logged as a warning (firmware/bridge version skew or bit-flip).
2. The bridge populates `_token32_to_ogt` — a session-scoped dict mapping
   `token_32 (int) → ogt (str)`.  T0.4 key derivation reads this dict to
   look up which OGT to derive keys for.
3. Collision detection: if two OGTs hash to the same `token_32`, the bridge
   logs `COLLISION` and drops the duplicate.  The canonical collision scan is
   `scripts/check_sha32_collisions.py`; it must exit 0 before any release.

**C implementation** (`hardware/sha256.h`):

```c
#include "sha256.h"
uint32_t t = sha32("global.Core.FaultReporter.boot");
// t == 0x677d36a7u
```

**Python implementation** (`callhome_bridge.py`):

```python
from callhome_bridge import sha32
assert sha32("global.Core.FaultReporter.boot") == 0x677d36a7
```

Both implementations are tested against the same hard-coded vector table
in `scripts/test_sha32_vectors.py`.

### 2.2 IDE-side GTs (held by bridge/server)

These GTs never leave the server. They name the services the FPGA invokes.

| Global Name | Perms | Description |
|-------------|-------|-------------|
| `CM.IDE.CallhomeService` | X | Receives CALLHOME; validates Board.Identity |
| `CM.IDE.HeartbeatService` | X | Returns PONG with server timestamp |
| `CM.IDE.FaultReceiver` | X | Logs faults; triggers MTBF recalc + alert emails |
| `CM.IDE.TraceReceiver` | X | Feeds live Pipeline view in IDE |
| `CM.IDE.LumpServer` | RX | Serves LUMP_DATA; checks Lump.Loader on every request |
| `CM.IDE.NSAuthority` | RX | Namespace source of truth |
| `CM.IDE.MediaServer` | RX | Serves chunked media; checks Media.Consumer |
| `CM.IDE.BrowseProxy` | RX | Fetches + renders URLs; enforces Browse.Client C-list |
| `CM.IDE.Deployer` | X | Pushes LUMP_DATA to FPGA; signs each frame |
| `CM.IDE.Commander` | X | CMD (pause/step/resume/reset); requires admin session |

### 2.3 Browse GT — capability-secured web access

`CM.Browse.Client` is a **per-device GT**. Its C-list slots hold domain GTs that a
parent explicitly approves via the IDE Family panel. This is capability-secured
parental control — no accounts, no passwords, no third-party app. The token IS the
permission.

```
CM.Browse.Client  (device c0ffee0100000001)  [E]
  C-list slot 0:  CM.Domain.BBCNews      [E]  →  bbc.co.uk
  C-list slot 1:  CM.Domain.Wikipedia    [E]  →  wikipedia.org
  C-list slot 2:  CM.Domain.KhanAcademy  [E]  →  khanacademy.org
```

Bridge enforcement on `BROWSE_REQ (0x10)`:
1. Extract hostname from URL in payload
2. Check for `CM.Domain.<X>` GT matching that hostname in Browse.Client C-list
3. **Match** → fetch and render
4. **No match** → `BROWSE_STATUS(GT_DOMAIN_NOT_PERMITTED)`, log attempt

### 2.4 Response policy — attacks vs. protocol failures

The best network security is **no reply on error** for attack indicators.
Responding to a cryptographic failure gives an attacker:

- Confirmation their frame was received and parsed
- Knowledge of which check failed (an oracle)
- A timing signal distinguishing accepted from rejected frames

Legitimate boards with valid keys **never** trigger cryptographic failures. Any
frame that fails HMAC, replay, or decryption is either an attack or catastrophic
hardware corruption. Either way, silence is the correct response.

Authorization failures are different — they happen to legitimate boards that simply
lack a capability. The board needs the error code to degrade gracefully (disable the
feature, wait for a key bundle, show the user a "not permitted" message). Silence
there would cause the board to hang waiting for a response that never comes.

#### Attack indicators — SILENT DROP (no ACK, no error, no response of any kind)

| Code | Name | Trigger | Bridge action |
|------|------|---------|---------------|
| `0x07` | `GT_HMAC_FAIL` | HMAC-8 tag mismatch | Drop + `log.critical` + rate-alert |
| `0x08` | `GT_REPLAY` | Nonce ≤ last_seen | Drop + `log.critical` + rate-alert |
| `0x09` | `GT_DECRYPT_FAIL` | ChaCha20 failed | Drop + `log.critical` + rate-alert |
| `0x01` | `GT_UNKNOWN` | board_uid not in DB | Drop silently (don't confirm existence) |
| —      | Bad magic | Bytes ≠ `0xCE 0xAA` | Drop silently (noise or probe) |
| —      | Bad CRC (Tier 0) | CRC-16 mismatch | Drop silently |
| —      | Frame oversize | `len` > max | Drop silently (buffer overflow probe) |

Rate alerting: if any attack indicator from the same `board_uid` (or same source
IP for the bridge HTTP side) exceeds **5 events in 60 seconds**, the bridge sends
an alert email and logs a server-side `SECURITY_ALERT` event. The board is never
told it has been flagged — it continues receiving silence.

Timing consistency: the silent drop path must return in **constant time** relative
to the HMAC check, regardless of which byte failed. Vary-on-failure timing leaks
the index of the first bad byte, enabling byte-at-a-time key recovery.

#### Protocol failures — ACK with error code (board can handle gracefully)

| Code | Name | Trigger | Board action |
|------|------|---------|--------------|
| `0x00` | `GT_OK` | All checks passed | Normal operation |
| `0x02` | `GT_NOT_HELD` | GT type not in board's record | Log + disable capability |
| `0x03` | `GT_REVOKED` | GT was revoked, keys gone | Log + disable + await re-grant |
| `0x04` | `GT_DOMAIN_NOT_PERMITTED` | Browse domain not in C-list | Show "not permitted" to user |
| `0x05` | `GT_INSUFFICIENT_PERMS` | GT lacks required R/W/X/E | Log + disable capability |
| `0x06` | `GT_TYPE_MISMATCH` | GT type wrong for msg type | Log + firmware bug report |
| `0x0A` | `GT_NO_KEY` | GT held but key bundle pending | Wait for next LUMP_DATA deploy |

### 2.5 Abstraction lifecycle

```
REGISTRATION (first CALLHOME from new board)
  Bridge receives CALLHOME with board_uid + fpga_nonce_32 + ns_manifest[]
  ns_manifest = [{ slot, ns_type, ns_instance, label, token, mobile }, ...]

  → For each entry: look up token in global abstraction registry (Section 2.7)
       Known token:  abstraction is already registered; derive new deployment keys
                     (board_uid changed → new K_enc, K_mac); update registry
       Unknown token: new abstraction; register it + derive first deployment keys

  → For each entry in manifest:
       K_enc = HKDF-SHA256(IKM=SHA256(uid||slot||token), salt="CM_ENC_v2", info=slot_info)
       K_mac = HKDF-SHA256(IKM=SHA256(uid||slot||token), salt="CM_MAC_v2", info=slot_info)

  → Verify Core abstractions present: Board.Identity, Heartbeat, Fault.Reporter,
       Perf.Reporter, Lump.Loader (these must always be in the manifest)

  → NS keystore LUMP built: per-slot { ns_type, ns_instance, label, K_enc, K_mac }
  → All records persisted in church_machine.db (keys encrypted at rest)
  → Bridge sends ACK with ide_nonce_32 + HMAC(K_mac[Board.Identity slot],
       ide_nonce || fpga_nonce)
  → Bridge builds session msg_slot_map via build_msg_slot_map(ns_manifest)
  → NS keystore LUMP deployed to FPGA as LUMP_DATA(0x80)
  → From this point all frames are keyed per source abstraction's NS slot

ABSTRACTION MIGRATION (mobile=true abstraction arrives on a new board)
  New board sends CALLHOME including { slot: N, token: 0xDEAD1234, mobile: true, ... }
  → Bridge finds token 0xDEAD1234 in global registry; was on board X, now on board Y
  → Re-derive keys for new deployment: IKM = SHA256(new_board_uid || new_slot || token)
  → Update registry: current_board = board Y, current_slot = N
  → Deploy updated keystore LUMP to board Y
  → If exclusive residency: notify board X via LUMP_DATA that token has migrated away
       Board X removes slot from its keystore; frames from that slot are now GT_REVOKED
  → If replicated presence: both boards hold valid keys; bridge routes by board_uid

CAPABILITY EXPANSION (admin panel)
  Admin enables tracing  → mints Trace.Emitter (new K_enc, K_mac for this deployment)
  Admin grants media     → mints Media.Consumer (new K_enc, K_mac for this deployment)
  → New slot entry queued for LUMP_DATA deploy

FAMILY BROWSE SETUP (Family panel)
  Parent adds "bbc.co.uk"
  → Server mints CM.Domain.BBCNews (token = SHA32("bbc.co.uk"))
  → Server builds/updates Browse.Client C-list with new domain GT
  → Full NS keystore redeployed to FPGA via LUMP_DATA (0x80) at next connect

REVOCATION (specific slot on specific board)
  Admin removes a slot from board record
  → Keys for that slot deleted from server DB immediately
  → Next bridge connect: bridge sends GT_REVOKED for messages from that slot
  → FPGA logs rejection; gracefully disables the capability
  → If mobile: token itself is NOT revoked — abstraction can re-register on another board
  → If permanently revoked: token blacklisted in global registry; rejected everywhere
```

### 2.6 OGT-Encryption — encryption service per abstraction token

Each abstraction's **encryption service** is a triple: an encryption key, an
authentication key, and a nonce counter. It belongs to the abstraction's token —
not to any physical slot in the namespace table.

```
ABSTRACTION_ENC = {
    ogt:       "global.Core.FaultReporter.boot",  // THE identity — name, not a number
    token_32:  SHA32(ogt),                        // hardware register value, derived only
    label:     "Fault.Reporter",                  // display name (UI only)
    K_enc:     <128-bit secret>,                  // ChaCha20 key — this OGT only
    K_mac:     <128-bit secret>,                  // HMAC key — this OGT only
    nonce_ctr: 0,                                 // monotonic counter, per-OGT, per-session
    msg_types: [0x02, 0x07],                      // FAULT + BOOT_LOG
    // ns_slot: firmware-private BRAM address — never present at protocol layer
}
```

No abstraction can read or forge frames belonging to another. The OGT path is the
source of truth — `token_32` is a convenience hash for the hardware capability
registers, not an identity in its own right. Slot numbers are internal firmware
addressing; the bridge and the wire never see them.

**Key derivation** (at abstraction grant time, server-side only):

The IKM binds the board to the OGT — the full canonical name, not a derived hash.
Slot numbers are absent. `token_32` is absent from the IKM — it is a hash of the
OGT and carries no additional information.

When a **mobile abstraction migrates** to a new board, `mint_abstraction_keys` is
called with the new `board_uid`. The keys change (per-deployment), but the OGT is
unchanged — that is the portable identity.

```python
import hashlib
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

def mint_abstraction_keys(board_uid: bytes,
                          ogt: str) -> tuple[bytes, bytes]:
    """
    Derive K_enc and K_mac for one abstraction on one board.
    ogt  = full OGT path, e.g. "global.Core.FaultReporter.boot"
           = global.namespace.abstraction.instance
    IKM  = SHA256(board_uid || ogt_bytes)
    Slot is absent — firmware-private BRAM addressing, never used here.
    token_32 = SHA32(ogt) is the hardware register value; it is NOT the IKM.
    """
    ogt_bytes = ogt.encode("utf-8")
    ikm = hashlib.sha256(board_uid + ogt_bytes).digest()
    K_enc = HKDF(hashes.SHA256(), 16,
                 salt=b"CM_ENC_v3", info=ogt_bytes).derive(ikm)
    K_mac = HKDF(hashes.SHA256(), 16,
                 salt=b"CM_MAC_v3", info=ogt_bytes).derive(ikm)
    return K_enc, K_mac
```

Every abstraction on a given board gets a unique key pair. Revoking one abstraction
invalidates only its keys — all other abstractions on the same board are unaffected.

**Key deployment** — the NS keystore LUMP:

The IDE packages all active abstraction keys for a board into a protected LUMP
(type=`ns_keystore`, NULL policy, never callable). The keystore is indexed by the
full OGT path — not by slot, not by opaque hex.

```json
{
  "type": "ns_keystore",
  "board_uid": "c0ffee0100000001",
  "abstractions": {
    "global.Core.BoardIdentity.boot":                              { "label": "Board.Identity", "K_enc": "…", "K_mac": "…" },
    "global.Core.FaultReporter.boot":                              { "label": "Fault.Reporter", "K_enc": "…", "K_mac": "…" },
    "global.Core.LumpLoader.boot":                                 { "label": "Lump.Loader",    "K_enc": "…", "K_mac": "…" },
    "global.Core.BrowseClient.boot":                               { "label": "Browse.Client",  "K_enc": "…", "K_mac": "…",
                                                                     "browse_domains": ["bbc.co.uk", "wikipedia.org"] },
    "global.Telecommunications.MargaretHodges.family-hub":         { "label": "mymother",       "K_enc": "…", "K_mac": "…" },
    "global.Telecommunications.GlobalWorkspaceLtd.family-hub":     { "label": "workoffice",     "K_enc": "…", "K_mac": "…" },
    "global.Telecommunications.CallHistory.family-hub":            { "label": "CallHistory",    "K_enc": "…", "K_mac": "…", "resident": true }
  }
}
```

The FPGA firmware receives this LUMP and maps each OGT to its internal BRAM slot.
`token_32 = SHA32(ogt)` is computed locally — it never travels in the keystore.
That mapping is entirely private to the firmware; the bridge never sees slot numbers.

The keystore LUMP is transmitted as a `LUMP_DATA (0x80)` frame encrypted with
`CM.IDE.Deployer`'s key. Firmware reads keys from BRAM via `cm_get_key(ogt)`.

**Session nonce handshake** (on every bridge connect):

```
FPGA  →  CALLHOME(fpga_nonce)  →  Bridge
FPGA  ←  ACK(ide_nonce, HMAC(K_mac, ide_nonce||fpga_nonce))  ←  Bridge

Session nonce base = SHA32(fpga_nonce XOR ide_nonce)
Per-frame nonce    = session_nonce_base + frame_counter (monotonically increasing)
```

The XOR-then-hash of both nonces means neither party can pre-determine nonces,
preventing an attacker who controls one side from forcing nonce reuse.

**Implementation tiers** (phased rollout):

| Tier | Frame protection | When | Notes |
|------|-----------------|------|-------|
| 0 — Plain | CRC-16 only | Phase 1 | Today's format; no encryption |
| 1 — Authenticated | HMAC-8, no encryption | Phase 2 | Add `flags` byte; HMAC replaces CRC |
| 2 — Encrypted | ChaCha20 + HMAC-8 | Phase 3 | Full OGT-Encryption |

Tier is negotiated in the CALLHOME payload (`"enc":0/1/2`). The bridge accepts
the highest tier the FPGA supports. Old firmware always sends `"enc":0` (Tier 0)
and the bridge falls back gracefully.

### 2.7 Namespace instances and mobile abstractions — the global registry

#### Namespaces as application domains

A **namespace type** is an application domain — a structural template defining
which abstractions exist and what they do. Any number of **instances** of that type
can be deployed simultaneously across any number of boards:

```
Namespace type: "Telecommunications"
  Abstraction types: Contact, CallHistory, MessageBox, VoiceChannel

  Instance: "family-hub"     → deployed on board c0ffee01 (living room)
  Instance: "mums-mobile"    → deployed on board deadbeef (pocket device)
  Instance: "office-desk"    → deployed on board 12345678 (workstation)

Namespace type: "Education"
  Abstraction types: Lesson, Exercise, Progress, Tutor

  Instance: "alice-year3"    → deployed on board aabbccdd
  Instance: "bob-year5"      → deployed on board 99887766
```

Each instance has independent state, independent keys, and independent capability
grants. Adding a second `Telecommunications` instance never affects the first.
The IDE treats each `(ns_type, ns_instance)` pair as a distinct managed entity.

#### Roaming and resident deployments

All abstractions are mobile — the OGT identity is substrate-independent by design.
Within an instance, individual deployments may be **roaming** (the default) or
**resident** (`"resident": true` in the manifest).
A mobile abstraction carries its `token_32` identity with it when it moves:

```
token_32 = 0xDEAD1234  →  label "mymother"  (Contact in Telecommunications)

Board c0ffee01:  slot 20  ← mymother is HERE; has K_enc/K_mac for this deployment
Board deadbeef:  slot 20  ← (empty, or a different Contact)

After migration:
Board c0ffee01:  slot 20  ← keys revoked; GT_REVOKED for frames from this slot
Board deadbeef:  slot 20  ← mymother is HERE; new K_enc/K_mac derived for this board
```

The token is the portable identity. The keys are ephemeral per deployment.

#### The bridge global abstraction registry

The bridge maintains one registry entry **per token** (not per board+slot):

```python
# Global registry — keyed by OGT string (the canonical name)
ABSTRACTION_REGISTRY: dict[str, AbstractionRecord] = {}

@dataclass
class AbstractionRecord:
    ogt:          str    # global.namespace.abstraction.instance — THE identity
    token_32:     int    # SHA32(ogt) — hardware register value, derived, never stored as identity
    label:        str    # local pet name — user-specific, changeable, never used for routing or crypto
    resident:     bool   # True = fixed to one board; IDE will not auto-migrate
                         # False (default) = roaming. All OGTs are mobile by nature.
    spread:       str    # "exclusive" (one board at a time) or "replicated" (many boards)

    # Current deployment(s) — updated on every CALLHOME
    deployments:  list[Deployment]

@dataclass
class Deployment:
    board_uid:  bytes
    K_enc:      bytes   # 128-bit — mint_abstraction_keys(board_uid, ogt)
    K_mac:      bytes   # 128-bit
    active:     bool    # False once abstraction has migrated away
    # ns_slot is firmware-private — not stored here, not sent over the wire
```

Bridge operations — all keyed directly by OGT:

| Operation | Key used |
|-----------|----------|
| Verify HMAC on incoming frame | `msg_type` → ogt → load K_mac for (board_uid, ogt) |
| Decrypt payload | Same → load K_enc |
| Route to handler | ogt → label → ns_type (ogt[1]) → handler |
| Track migration | ogt seen on new board → new Deployment with fresh keys |
| Revoke abstraction | ogt blacklisted → all its Deployments set `active=False` |

#### Namespace instance management in the IDE

The IDE's Device panel shows not just boards but **namespace instances**:

```
Boards                         Namespace Instances
──────────────────             ───────────────────────────────────────
c0ffee01  (living room)        Telecommunications/family-hub
  ├─ Telecommunications          ├─ mymother      [mobile] ● here
  │   └─ family-hub              ├─ workoffice    [mobile] ● here
  └─ Core/boot                   └─ CallHistory   [static] ● here
                               Education/alice-year3
deadbeef  (mum's phone)          ├─ Lesson-04     [static] ● here
  ├─ Telecommunications          └─ Progress      [static] ● here
  │   └─ mums-mobile
  └─ Core/boot
```

Any roaming abstraction (no `resident` flag) can be dragged from one board to another
in the IDE — the IDE deploys the LUMP and updated keystore to the target board and
revokes the source board's deployment. Resident abstractions show a lock icon; they
require explicit administrator action to migrate.

#### Key invariants — all abstractions are mobile

1. **OGT permanence** — `global.namespace.abstraction.instance` is minted once and
   never changes. The `abstraction` segment is the canonical formal name — never a
   local pet name. Different users may hold different labels for the same OGT; the
   OGT itself is independent of all of them. Renaming a label does not change the
   OGT. `token_32 = SHA32(ogt)` is a derived hardware convenience value — not the
   identity.
2. **Per-deployment keys** — `K_enc` and `K_mac` are derived from
   `SHA256(board_uid || ogt_bytes)`. They are specific to one board. Migrating =
   re-deriving on the new substrate with the new `board_uid`. Slot assignments on
   either board are irrelevant.
3. **No key reuse across deployments** — if an abstraction returns to a board it
   previously inhabited, `mint_abstraction_keys(board_uid, ogt)` is called fresh.
   No stale keys are ever reused.
4. **Exclusive vs. replicated spread** — the IDE declares spread policy at grant time.
   Exclusive: one active deployment at a time; migration is atomic.
   Replicated: simultaneous deployments on multiple boards; bridge routes by `board_uid`.
5. **Resident is a deployment policy, not a capability limit** — `resident: true`
   means the IDE will not automatically migrate this abstraction. The OGT is still a
   full mobile identity. `CallHistory` is a typical example: its state is board-local,
   so moving it would produce a copy, not a migration. An authorised admin can still
   explicitly migrate it if needed.

---

## 3. Wire Format

### 3.1 Tier 0 — Plain (Phase 1, no encryption)

Used only for the initial `CALLHOME (0x01)` and `PING (0x06)` before the key
bundle has been deployed. This is the bootstrap frame format.

```
[0xCE][0xAA][type:1][seq:2][len:2][payload: len bytes][crc16:2]
```

| Field | Bytes | Description |
|-------|-------|-------------|
| `0xCE 0xAA` | 2 | Magic sync bytes — re-synchronises parser after noise |
| `type` | 1 | Message type (0x00–0x7F = FPGA→IDE; 0x80–0xFF = IDE→FPGA) |
| `seq` | 2 | Sequence number, little-endian |
| `len` | 2 | Payload length, little-endian |
| `payload` | len | Plaintext type-specific data |
| `crc16` | 2 | CRC-16/CCITT over `type+seq+len+payload` |

### 3.2 Tier 1 — Authenticated (Phase 2, HMAC only)

Tier 0 with CRC replaced by an 8-byte HMAC-SHA256 tag. Payload still plaintext.
Used when the key bundle has been deployed but the firmware hasn't enabled ChaCha20.

```
[0xCE][0xAA][type:1][seq:2][flags:1][len:2][payload: len bytes][hmac8:8]
```

| Field | Bytes | Description |
|-------|-------|-------------|
| `flags` | 1 | Bit 0=AUTH, Bit 1=ENC, Bits 2–7 reserved (0) |
| `hmac8` | 8 | First 8 bytes of HMAC-SHA256(K_mac, type\|\|seq\|\|flags\|\|len\|\|payload) |

### 3.3 Tier 2 — OGT-Encrypted (Phase 3, full protection)

The canonical secure frame. Every payload is encrypted with ChaCha20 keyed by
the source GT's `K_enc`. The HMAC covers the ciphertext, not the plaintext
(encrypt-then-MAC). The nonce is the per-GT-pair monotonic counter, preventing
replay.

```
[0xCE][0xAA][type:1][seq:2][flags:1][len:2][nonce:4][ciphertext: len bytes][hmac8:8]
```

| Field | Bytes | Description |
|-------|-------|-------------|
| `flags` | 1 | `0x03` = AUTH\|ENC |
| `nonce` | 4 | Per-GT-pair counter (little-endian, monotonically increasing) |
| `ciphertext` | len | ChaCha20(K_enc, nonce\|\|seq, plaintext_payload) |
| `hmac8` | 8 | HMAC-SHA256(K_mac, type\|\|seq\|\|flags\|\|len\|\|nonce\|\|ciphertext)[0:8] |

**Decryption order at bridge:**
1. Verify magic `0xCE 0xAA`
2. Read `flags` — determine tier
3. Verify HMAC-8 over ciphertext (reject immediately on failure → `GT_HMAC_FAIL`)
4. Verify `nonce > last_nonce[board_uid][token_32]` (reject → `GT_REPLAY`)
5. Decrypt ciphertext → plaintext payload
6. Validate Source GT for `type` → route to handler

**The HMAC check always comes before decryption.** This is the standard
encrypt-then-MAC ordering: it prevents padding oracle and length-extension attacks.

Minimum Tier 2 frame size: 9 + 4 + 8 = **21 bytes** (zero-length payload).

### 3.4 Tier negotiation

The `CALLHOME (0x01)` payload includes `"enc": N` where N = 0, 1, or 2:
- N=0 → Tier 0 only (old firmware, no keys)
- N=1 → Tier 1 (keys deployed, no ChaCha20)
- N=2 → Tier 2 (full OGT-Encryption)

The bridge responds with `ACK` carrying the agreed tier. Both sides use that tier
for all subsequent frames in the session.

### 3.5 Firmware API (frozen after first flash)

The entire protocol surface exposed to firmware — encryption included — is four
functions. Encryption is transparent to the caller:

```c
/* Send a message. Encryption tier selected automatically from BRAM key bundle. */
void cm_send_msg(uint8_t type, uint16_t seq,
                 const uint8_t *payload, uint16_t len);

/* Receive loop — call from main loop or UART ISR. Decrypts transparently. */
void cm_poll_rx(void);

/* Called with decrypted plaintext payload after auth + replay checks pass. */
__attribute__((weak))
void cm_on_msg(uint8_t type, uint16_t seq,
               const uint8_t *payload, uint16_t len);

/* Internal — reads K_enc/K_mac for a GT from protected BRAM keystore. */
static void cm_get_key(uint8_t msg_type, uint8_t *k_enc, uint8_t *k_mac);
```

The firmware never handles key derivation, HMAC verification, or nonce management.
Those are `cm_send_msg` / `cm_poll_rx` internals. Application code calls
`cm_send_msg` and receives decrypted plaintext in `cm_on_msg`. Encryption is
invisible to every layer above it — exactly as capability enforcement is invisible
to application code in the Church Machine ISA.

---

## 4. Bridge — Trusted Router

`callhome_bridge.py` is the **only** trust enforcement point. No message reaches the
IDE server without passing through its full verification pipeline:
**magic → HMAC → replay → decrypt → GT check → handler**.

The bridge builds a `msg_type → token_32` map from the ns_manifest received in
CALLHOME. Slot numbers are never used — the token is the identity.

```python
# Maps message type → canonical abstraction label (slot numbers never appear here)
STATIC_MSG_LABELS = {
    0x01: "Board.Identity",
    0x02: "Fault.Reporter",
    0x03: "Trace.Emitter",
    0x04: "Lump.Loader",
    0x05: "NS.Inspector",
    0x06: "Heartbeat",
    0x07: "Fault.Reporter",   # BOOT_LOG shares Fault.Reporter's token
    0x08: "Perf.Reporter",
    0x09: "Media.Consumer",
    0x0A: "Media.Consumer",
    0x10: "Browse.Client",
    0x11: "Browse.Client",
    0x12: "Browse.Client",
    0x13: "Browse.Client",
    0x14: "Browse.Client",
}

def build_msg_token_map(ns_manifest: list[dict]) -> dict[int, str]:
    """
    Build msg_type → ogt from the ns_manifest agreed in CALLHOME.
    ns_manifest entries: { "token": "global.ns.abstraction.instance",
                           "label": "Fault.Reporter", "mobile": false }
    "token" IS the OGT — the full hierarchical capability path.
    "label" is UI-only. No "slot" field — firmware-private.
    Called once per CALLHOME; stored on the board session object.
    """
    label_to_ogt = {
        entry["label"]: entry["token"]   # token field is the OGT string
        for entry in ns_manifest
    }
    msg_token_map: dict[int, str] = {}
    for msg_type, label in STATIC_MSG_LABELS.items():
        ogt = label_to_ogt.get(label)
        if ogt is not None:
            msg_token_map[msg_type] = ogt
        # Label absent from manifest → abstraction not loaded on this board.
        # Frames of that type → GT_NOT_HELD (Step 4).
    return msg_token_map
```

The session's `msg_token_map` (type `dict[int, str]`) replaces the old
`CM_MSG_TYPE_GT` dict. In `on_raw_frame`, Step 2 becomes:

```python
    # Step 2: resolve source OGT from the session's msg_token_map
    ogt = session.msg_token_map.get(msg_type)
    if ogt is None:
        _silent_drop(board_uid, "GT_UNKNOWN", msg_type)  # abstraction not in manifest
        return

    # Steps 3–5: HMAC, replay, decrypt — all keyed by (board_uid, ogt)
    # Step 6: validate_gt uses ogt directly
```

`last_nonce` keyed by `(board_uid, ogt)` — per-abstraction, portable across boots:

```python
    last_nonce[(board_uid, ogt)] = nonce
```

CM_HANDLERS = {
    0x01: handle_callhome,
    0x02: handle_fault,
    0x03: handle_trace,
    0x04: handle_lump_req,
    0x05: handle_ns_dump,
    0x06: handle_ping,
    0x08: handle_perf,
    0x09: handle_media_req,
    0x10: handle_browse_req,
    # New types added here — no firmware change ever needed
}

def on_raw_frame(msg_type, seq, flags, nonce, raw_payload):
    """
    Full OGT verification pipeline. Called with raw (possibly encrypted) bytes.
    Steps run in this exact order — never rearranged.

    RESPONSE POLICY (see Section 2.4):
      Attack indicators  → SILENT DROP.  No ACK, no error, no response at all.
      Protocol failures  → ACK(err).     Board can degrade gracefully.

    Returning None from this function = silent drop (caller sends nothing).
    Calling send_ack_error() = explicit protocol error to a legitimate board.
    Never call send_ack_error() from Steps 1–3.
    """
    gt_name = CM_MSG_TYPE_GT.get(msg_type)

    # --- Step 1: HMAC verification (encrypt-then-MAC — always before decrypt) ---
    # ATTACK INDICATOR: silent drop + rate-alert. No ACK ever.
    # Constant-time comparison mandatory — timing difference leaks key bytes.
    if flags & FLAG_AUTH:
        if not verify_hmac_constant_time(board_uid, gt_name,
                                         msg_type, seq, flags, nonce, raw_payload):
            _silent_drop(board_uid, "GT_HMAC_FAIL", msg_type)
            return   # ← nothing sent to the wire

    # --- Step 2: Replay protection ---
    # ATTACK INDICATOR: silent drop. Telling attacker their nonce was "too old"
    # confirms the replay window and helps them calibrate the next attempt.
    if flags & FLAG_AUTH:
        if nonce <= last_nonce.get((board_uid, gt_name), -1):
            _silent_drop(board_uid, "GT_REPLAY", msg_type, nonce=nonce)
            return   # ← nothing sent to the wire
        last_nonce[(board_uid, gt_name)] = nonce

    # --- Step 3: Decrypt ---
    # ATTACK INDICATOR: silent drop. A decrypt failure with a valid HMAC is
    # impossible for a legitimate board — it signals key tampering or corruption.
    if flags & FLAG_ENC:
        payload = chacha20_decrypt(board_uid, gt_name, nonce, raw_payload)
        if payload is None:
            _silent_drop(board_uid, "GT_DECRYPT_FAIL", msg_type)
            return   # ← nothing sent to the wire
    else:
        payload = raw_payload  # Tier 0 / Tier 1 — plaintext

    # --- Step 4: GT authorization ---
    # PROTOCOL FAILURE: ACK with code. Legitimate board missing a capability.
    # It needs the error code to disable the feature and wait for a grant.
    if gt_name:
        err = validate_gt(board_uid, gt_name, msg_type)
        if err != GT_OK:
            send_ack_error(seq, err)   # ← only place send_ack_error is called
            log.warning("GT protocol failure: type=0x%02X board=%s err=%s",
                        msg_type, board_uid, err)
            return

    # --- Step 5: Dispatch ---
    handler = CM_HANDLERS.get(msg_type)
    if handler:
        handler(seq, payload)
    else:
        # Future type — unknown to this bridge version.
        # Has already passed crypto checks so it came from a legitimate board.
        # Log and ignore; do not ACK (board doesn't expect one for unknown types).
        log.info("Unknown CM_MSG type=0x%02X seq=%d len=%d "
                 "(future type, ignored safely)", msg_type, seq, len(payload))


def _silent_drop(board_uid, reason, msg_type, **extra):
    """
    Log a security event and return without sending anything to the wire.
    Rate-alert if the same board exceeds the threshold.
    Never call send_ack_error() from here.
    """
    log.critical("SILENT DROP %s type=0x%02X board=%s %s",
                 reason, msg_type, board_uid, extra)
    _rate_alert(board_uid, reason)
```

**The pipeline order is not negotiable:** HMAC → replay → decrypt → GT → dispatch.
Swapping any two steps opens an attack vector.

**`send_ack_error` is called in exactly one place** — Step 4 (GT authorization).
Every other exit path is a silent drop. Code review should treat any
`send_ack_error` call outside Step 4 as a security defect.

**Constant-time HMAC comparison is mandatory** in Step 1. Python's `hmac.compare_digest`
satisfies this. A byte-by-byte `==` comparison leaks the index of the first wrong
byte via timing and enables iterative key recovery at UART speeds.

Unknown type bytes that **pass** the crypto pipeline are logged and ignored — a
future firmware type arriving at an older bridge is handled safely without
revealing anything to a potential attacker on the wire.

---

## 5. Message Type Registry

### 5.1 System — FPGA → IDE

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x01` | `CALLHOME` | `Board.Identity` | `CM.IDE.CallhomeService` | Done | JSON: board, uid, nia, fw, boot_ok, fault, proto, enc, ns_manifest[{slot,label,token}] |
| `0x02` | `FAULT` | `CM.Fault.Reporter` | `CM.IDE.FaultReceiver` | P1 | JSON: code, mnemonic, nia, gt, stage, tier, catch_invoked |
| `0x03` | `TRACE` | `CM.Trace.Emitter` | `CM.IDE.TraceReceiver` | P2 | Binary: nia(4)+opcode(1)+dr0(4)+dr1(4) |
| `0x04` | `LUMP_REQ` | `CM.Lump.Loader` | `CM.IDE.LumpServer` | P2 | token(8)+hint_ns_slot(2) |
| `0x05` | `NS_DUMP` | `CM.NS.Inspector` | `CM.IDE.NSAuthority` | P3 | Binary array: slot(2)+token(8)+perms(1) |
| `0x06` | `PING` | `CM.Heartbeat` | `CM.IDE.HeartbeatService` | P1 | No payload |
| `0x07` | `BOOT_LOG` | `CM.Fault.Reporter` | `CM.IDE.FaultReceiver` | P3 | UTF-8 string: boot step |
| `0x08` | `PERF` | `CM.Perf.Reporter` | `CM.IDE.FaultReceiver` | P3 | uptime_ms(4)+instr(4)+faults(2)+boots(2) |

### 5.2 Media — FPGA → IDE

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x09` | `MEDIA_REQ` | `CM.Media.Consumer` | `CM.IDE.MediaServer` | P3 | token(8)+offset(4)+chunk_len(2) |
| `0x0A` | `MEDIA_ACK` | `CM.Media.Consumer` | `CM.IDE.MediaServer` | P3 | token(8)+offset(4) — buffer ready |

### 5.3 Browse — FPGA → IDE

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x10` | `BROWSE_REQ` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | url_len(2)+url+width(2)+height(2)+mode(1) |
| `0x11` | `BROWSE_NAV` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | direction(1): 0=back,1=fwd,2=reload |
| `0x12` | `BROWSE_CLICK` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | x(2)+y(2) |
| `0x13` | `BROWSE_SCROLL` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | delta_lines(2) |
| `0x14` | `BROWSE_INPUT` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | element_id(2)+text_len(2)+utf8 |

### 5.4 LUMP / Commands — IDE → FPGA

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x80` | `LUMP_DATA` | `CM.IDE.Deployer` | `CM.Lump.Loader` | P2 | token(8)+bram_addr(4)+BEEF-framed binary |
| `0x81` | `CMD` | `CM.IDE.Commander` | `CM.Board.Identity` | P2 | cmd(1): 0=pause,1=step,2=resume,3=reset,4=query_ns |
| `0x82` | `ACK` | *(mirrors source of acked msg)* | *(mirrors dest)* | P1 | seq(2)+gt_err(1)+detail |
| `0x83` | `PONG` | `CM.IDE.HeartbeatService` | `CM.Heartbeat` | P1 | server_time_ms(8) |

### 5.5 Media Delivery — IDE → FPGA

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x84` | `MEDIA_META` | `CM.IDE.MediaServer` | `CM.Media.Consumer` | P3 | token(8)+media_type(1)+fmt(1)+total_size(4)+meta_json |
| `0x85` | `MEDIA_CHUNK` | `CM.IDE.MediaServer` | `CM.Media.Consumer` | P3 | token(8)+offset(4)+data[...] |
| `0x86` | `AUDIO_STREAM` | `CM.IDE.MediaServer` | `CM.Media.Consumer` | P3 | token(8)+fmt(1)+chunk[...] |

### 5.6 Browse Responses — IDE → FPGA

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x88` | `BROWSE_META` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+url+title |
| `0x89` | `BROWSE_FRAME` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+tile_x(2)+tile_y(2)+rgb565[...] |
| `0x8A` | `BROWSE_TEXT` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+structured_text |
| `0x8B` | `BROWSE_LINKS` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+{x(2),y(2),w(2),h(2),url_hash(4)}[] |
| `0x8C` | `BROWSE_STATUS` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+status(1)+gt_err(1) |

---

## 6. Media Format Codes

### 6.1 Documents (`media_type = 0x01`)

| fmt | Name | Description |
|-----|------|-------------|
| `0x01` | `DOC_UTF8` | Plain text, paginated by FPGA |
| `0x02` | `DOC_LINES` | Pre-wrapped fixed-width lines |
| `0x03` | `DOC_PDF_RASTER` | Page pre-rasterized to RGB565 by IDE |

### 6.2 Images (`media_type = 0x02`)

| fmt | Name | Description |
|-----|------|-------------|
| `0x01` | `IMG_RGB565` | Raw 16bpp — width×height in MEDIA_META |
| `0x02` | `IMG_RGB888` | Raw 24bpp |
| `0x03` | `IMG_JPEG` | JPEG compressed |
| `0x04` | `IMG_RLE` | Run-length encoded — good for diagrams |
| `0x05` | `IMG_1BPP` | 1-bit monochrome — e-ink, OLED |
| `0x06` | `IMG_TILE` | Tiled RGB565 for large displays |

### 6.3 Audio (`media_type = 0x03`)

| fmt | Name | Rate | Notes |
|-----|------|------|-------|
| `0x01` | `AUD_MULAW_8K` | 8 kHz µ-law | Telephony / speech; 8 KB/s — fits 115200 |
| `0x02` | `AUD_PCM_8K16` | 8 kHz 16-bit | Clear speech; 16 KB/s |
| `0x03` | `AUD_ADPCM_22K` | 22 kHz ADPCM | 4:1 compression; 5.5 KB/s |
| `0x04` | `AUD_PCM_44K16` | 44.1 kHz 16-bit | HiFi music; 176 KB/s — needs 921600 baud |
| `0x05` | `AUD_PCM_48K16` | 48 kHz 16-bit | Studio HiFi |
| `0x06` | `AUD_OPUS` | Variable | Best quality/bandwidth ratio |
| `0x07` | `AUD_TTS_REQ` | — | FPGA sends UTF-8 text; IDE returns audio |
| `0x08` | `AUD_SPEECH_16K` | 16 kHz 16-bit | Speech recognition quality |

### 6.4 HTML Browse render modes

| mode | Name | Bridge tool | Bandwidth |
|------|------|------------|-----------|
| `0x00` | TEXT | `requests` + BeautifulSoup | ~1–5 KB per page |
| `0x01` | SIMPLE | BS4 structured DOM | ~5–20 KB |
| `0x02` | RASTER | Playwright headless screenshot | ~300 KB tiled |
| `0x03` | WIKI | Dedicated Wikipedia extractor | ~3 KB |

---

## 7. Bandwidth Budget

At 115200 baud the usable payload throughput is approximately **10 KB/s**.

| Use case | Bandwidth | Fits at 115200? |
|----------|-----------|-----------------|
| CALLHOME (1 Hz) | ~200 B/s | Yes |
| FAULT events | burst only | Yes |
| TRACE (sampled 10 Hz) | ~130 B/s | Yes |
| Speech µ-law 8kHz | 8 KB/s | Yes — just fits |
| ADPCM 22 kHz | ~5.5 KB/s | Yes — comfortable |
| LUMP deploy 16 KB | ~1.6 s one-shot | Yes |
| JPEG image 100 KB | ~10 s one-shot | Yes — with tile cache |
| HTML TEXT page | <1 s | Yes |
| HiFi music 44.1kHz | 176 KB/s | No — needs 921600 baud |

For HiFi: `UART_CLOCKDIV = 25_000_000 / (8 × 921600) ≈ 3`.  
A `CMD (0x81)` sub-command `5=set_baud` negotiates higher rates at runtime without
firmware changes.

---

## 8. Implementation Priorities

### Phase 1 — Foundation (one firmware flash, then frozen)

| Item | Files |
|------|-------|
| `cm_send_msg` / `cm_poll_rx` / `cm_on_msg` in firmware | `hardware/soc_minimal/firmware/main.c` |
| Re-wrap existing CALLHOME as `MSG_CALLHOME (0x01)` | firmware |
| Bridge parser: framing + CRC + GT dispatch | `hardware/soc_combined/callhome_bridge.py` |
| `handle_callhome (0x01)` — existing behaviour, new path | bridge |
| `handle_ping (0x06)` + `PONG (0x83)` round-trip | bridge |
| GT validation layer: `validate_gt()` + `send_ack_error()` | bridge |

**Outcome:** Protocol live. GT enforcement active. All future work is IDE/bridge only.

### Phase 2 — Deploy + Fault

| Item | Files |
|------|-------|
| `LUMP_DATA (0x80)` — IDE pushes LUMP over UART | bridge + server + FPGA UART RX |
| `FAULT (0x02)` — full event with tier/GT/NIA | firmware + bridge + server |
| IDE fault popup from hardware fault events | `simulator/app-misc.js` |
| MTBF chart in Dashboard per NIA (hardware source) | server + IDE |

### Phase 3 — Trace + Lazy-Load

| Item | Files |
|------|-------|
| `TRACE (0x03)` — emit on CALL/RETURN | firmware |
| Pipeline view live from hardware TRACE | IDE |
| `LUMP_REQ (0x04)` + `LUMP_DATA (0x80)` Lazy-Load | firmware + bridge + server |
| `NS_DUMP (0x05)` — namespace agreement check | firmware + bridge |

### Phase 4 — Media

| Item | Files |
|------|-------|
| `MEDIA_REQ/CHUNK` chunked delivery | bridge + server |
| Audio: µ-law 8kHz → DAC/PWM output | firmware + hardware |
| `AUD_TTS_REQ` — text-to-speech via bridge | bridge |
| Image: RGB565 tiles → FPGA framebuffer | bridge + firmware |

### Phase 5 — Browse

| Item | Files |
|------|-------|
| `BROWSE_REQ` TEXT mode (BeautifulSoup) | bridge |
| `BROWSE_REQ` RASTER mode (Playwright) | bridge |
| Browse GT C-list enforcement in bridge | bridge + server |
| Click / scroll / input messages | bridge + firmware input handler |
| Parent domain-list management in IDE Family panel | IDE + server |

---

## 9. File Inventory

| File | Role |
|------|------|
| `hardware/soc_minimal/firmware/main.c` | Firmware — add `cm_send_msg`, `cm_poll_rx` |
| `hardware/soc_combined/callhome_bridge.py` | Bridge — GT validation + typed dispatch |
| `server/app.py` | Server — GT records, fault/trace/media endpoints |
| `server/models.py` | DB — `gt_records`, `fault_events`, `trace_log`, `media_cache` |
| `simulator/app-misc.js` | IDE — fault popups, trace view, browse UI |
| `docs/cm-msg-protocol.md` | This document — authoritative spec |

---

## 10. Versioning

Protocol version is carried in the `CALLHOME` payload as `"proto":N`.

| proto | Key changes |
|-------|-------------|
| 1 | Initial Tier 0 (CRC only); `gt_manifest` = list of GT global name strings |
| 2 | Tier 1/2 (HMAC + ChaCha20); **`gt_manifest` replaced by `ns_manifest`** — list of `{slot, label, token}` objects; per-slot encryption services; key derivation upgraded from `CM_ENC/MAC_v1` → `v2` (IKM now binds `board_uid + ns_slot + token_32`); `last_nonce` keyed by `(board_uid, ns_slot)` not `(board_uid, gt_name)` |

Boards on proto=1 send `gt_manifest` (list of strings); the bridge falls back to
the old `CM_MSG_TYPE_GT` lookup for those sessions and does not attempt OGT-encryption.
Boards on proto=2 send `ns_manifest` (list of objects); the bridge builds
`msg_slot_map` via `build_msg_slot_map()` and enforces per-slot encryption.

Old bridges receiving `proto:2` see an unknown `ns_manifest` key — they log and
fall back to `proto:1` behaviour (Tier 0, name-based GT lookup). This preserves
interoperability during the transition window.

Old FPGA firmware receiving unknown IDE→FPGA types calls `cm_on_msg` which is a
no-op by default. Firmware never changes for protocol updates.

---

*The security model in Sections 1–4 is not optional infrastructure — it is the
point of this protocol. Every implementation decision must preserve the nine
security properties in Section 1.4.*

*Three invariants that must never be violated:*

*1. **Pipeline order** (Section 4): HMAC → replay → decrypt → GT → dispatch.
   Swapping any two steps opens an attack vector.*

*2. **Silent drop for attack indicators** (Section 2.4): Steps 1–3 never send
   anything to the wire on failure. `send_ack_error` is called in exactly one
   place — Step 4. Any deviation is a security defect.*

*3. **Constant-time HMAC** (Section 4, Step 1): Use `hmac.compare_digest`.
   Never use `==` on MAC tags. Timing side-channels enable iterative key recovery.*

*When adding a new GT: mint K_enc and K_mac at the same time as token_32 — a GT
without keys is incomplete and will block the board with GT_NO_KEY.*

---

## Appendix A — Security Overhead and Dynamic Creation

### A.1 What K_enc and K_mac are

Every abstraction has two independent 128-bit keys derived from a shared root:

```
IKM    = SHA256( board_uid ‖ ogt_bytes )
K_enc  = HKDF-SHA256( IKM, salt="CM_ENC_v3", info=ogt_bytes )   — AES-128-CTR
K_mac  = HKDF-SHA256( IKM, salt="CM_MAC_v3", info=ogt_bytes )   — HMAC-SHA256
```

**K_enc** encrypts the payload. Nobody on the wire can read the message without it.

**K_mac** authenticates the message. Nobody can forge, tamper with, or replay a
frame without breaking the tag. The bridge checks the tag before touching the
plaintext — a bad tag is a silent drop, not an error response.

**Why two separate keys from one root?** Using the same key for both encryption
and authentication opens a class of attacks where MAC observations leak information
about the cipher. The two HKDF derivations with different salts produce
cryptographically independent keys from the same IKM, closing that gap at no extra
secret-management cost.

**Why per-abstraction keys?** If all abstractions on a board shared one key pair,
compromising any one abstraction would compromise every message on that board.
Per-abstraction keys contain the blast radius: revoking `CallHistory` touches
nothing belonging to `MargaretHodges`.

---

### A.2 Security overhead per operation

#### Per-session (one CALLHOME handshake)

For each abstraction in the `ns_manifest`:

| Step | Operation | IDE-side cost | Firmware-side cost |
|---|---|---|---|
| OGT → token_32 | SHA-256 truncated to 32 bits | ~1 μs | ~100 μs (VexRiscv SW SHA-256) |
| IKM derivation | `SHA256(board_uid ‖ ogt_bytes)` | ~1 μs | ~100 μs |
| K_enc derivation | HKDF-SHA256, salt `CM_ENC_v3` | ~2 μs | ~100 μs |
| K_mac derivation | HKDF-SHA256, salt `CM_MAC_v3` | ~2 μs | ~100 μs |
| **Per abstraction total** | | **~6 μs** | **~400 μs** |

Ten abstractions: ~60 μs IDE-side, ~4 ms firmware-side. This runs once at connect
time, not per message — completely invisible in practice.

#### Per-message (every UART frame)

| Step | Operation | Cost |
|---|---|---|
| msg_type → OGT lookup | dictionary lookup | nanoseconds |
| Nonce check | compare + increment | nanoseconds |
| AES-128-CTR decrypt | ~1 cycle/byte | ~1 μs (64-byte payload) |
| HMAC-SHA256 tag verify | ~1 cycle/byte | ~2 μs |
| **Per message total** | | **~3–5 μs IDE-side** |

At 115,200 baud a 64-byte frame takes ~5.6 ms to arrive on the wire. The crypto
is invisible — the wire is always the bottleneck.

At 3 Mbaud (Ti60 Sapphire SoC capability): ~170 μs per frame. Crypto still
invisible.

#### Fail-safe drop policy

Every dropped message — bad tag, replayed nonce, unknown OGT — costs the same as
an accepted message. The HMAC check runs to completion before the decision to drop
is made. This is intentional: constant-time rejection prevents timing oracles where
an attacker iteratively recovers K_mac by measuring how long the bridge takes to
reject forged frames.

There is no cheaper path for bad messages. The overhead is identical whether the
frame is legitimate or an attack.

---

### A.3 Dynamic creation overhead

A dynamic abstraction (`ns_slot_policy: "dynamic"`) is created at runtime. The
full creation sequence:

```
1. IDE mints new OGT                         →  ~6 μs   (HKDF, IDE-side)
2. IDE packages keystore update LUMP         →  encrypt + MAC the payload
3. IDE sends LUMP_UPDATE over UART           →  wire bottleneck (see below)
4. Firmware validates LUMP seal              →  ~200 μs  (CRC + bounds, VexRiscv)
5. Firmware runs HKDF, installs K_enc/K_mac  →  ~400 μs  (two SHA-256, VexRiscv)
6. Firmware allocates next free BRAM slot    →  nanoseconds
7. Firmware sends LUMP_ACK with token_32     →  ~1 ms   (UART round-trip)
```

Wire cost dominates everything:

| Baud rate | 64-byte LUMP delivery | Full round-trip (with ACK) |
|---|---|---|
| 115,200 | ~5.6 ms | ~12–15 ms |
| 3 Mbaud | ~170 μs | ~500 μs |

At 115,200 baud, creating one dynamic abstraction costs roughly **15 ms** — almost
entirely wire latency, with ~600 μs of firmware crypto in the middle. After
creation, calling it is a nanosecond BRAM lookup — exactly the same as any
compile-time abstraction.

---

### A.4 Compile-time vs. dynamic creation — cost structure

**Compile-time abstractions** (resident and lazy-load LUMPs) pay their creation
cost exactly once — at build time, off the critical path. Their OGTs are known,
K_enc/K_mac are pre-derived, and everything is packaged into the boot keystore
LUMP delivered at first connection. After that, calling one is a BRAM slot lookup.
Zero runtime creation overhead.

**Dynamic abstractions** pay a one-time creation spike on first use: one HKDF
round on the firmware (~400 μs) plus one UART round-trip (~15 ms at 115,200 baud).
After that first payment the abstraction is as cheap to call as any compile-time one.
The creation cost is a spike, not an ongoing tax.

The system's cost structure is correct by design: **pay once to establish the
secure channel, then use it for free.**

---

### A.5 Pool pre-allocation — eliminating creation spikes under pressure

Pre-allocating a pool of dynamic slots at boot time moves the creation cost off
the hot path entirely.

**How it works:**

At startup — when there is no latency pressure — the IDE provisions a batch of
pool slots using *ephemeral OGTs*:

```
global.Pool.Ephemeral.session-0
global.Pool.Ephemeral.session-1
…
global.Pool.Ephemeral.session-N
```

Keys are derived and the entire batch is delivered in a single LUMP. Under
pressure, issuing an abstraction from the pool requires no UART round-trip and no
HKDF delay — the slot is already warm. Only the OGT binding needs to happen, which
is a local registry update on both sides.

**The one constraint:** pool slots use pre-minted ephemeral OGTs — they are not
globally stable canonical identities. They suit short-lived or session-scoped
abstractions: active connections, temporary working contexts, transient state.
Long-lived abstractions with durable identity (a Contact, a CallHistory, a Lesson)
should always be compile-time provisioned with their real canonical OGT.

**When to pool and when not to:**

| Abstraction type | Creation cost | Call cost | Pool candidate? |
|---|---|---|---|
| Resident / lazy-load | At build time — zero runtime | Nanoseconds | No — already free |
| Dynamic, latency-tolerant | ~15 ms first use (wire + HKDF) | Nanoseconds after | Only if creation is in a hot path |
| Dynamic, latency-sensitive | ~15 ms first use | Nanoseconds after | Yes — pre-warm pool at boot |
| Session-scoped ephemeral | ~15 ms first use (or pooled) | Nanoseconds after | Yes — natural fit |

**Batch creation at boot** — if a set of dynamic abstractions is predictable at
startup, request them all in one LUMP payload. One UART round-trip, not N. Even
without a pool, batching reduces total creation time from `N × 15 ms` to
approximately `15 ms + N × 600 μs` (one wire round-trip, then N firmware HKDF
rounds overlapped with the next batch segment).

---

### A.6 Summary

The security overhead of CM_MSG is almost entirely front-loaded:

- **Key derivation:** paid once per abstraction at session establishment. Negligible
  in absolute terms (microseconds IDE-side, low milliseconds firmware-side).
- **Per-message crypto:** invisible — the wire is 100–1000× slower than the
  AES+HMAC operations on every frame.
- **Fail-safe drops:** constant-time by design. No cheaper path for attackers.
- **Dynamic creation:** the only meaningful runtime cost — a one-time ~15 ms spike
  per abstraction at 115,200 baud, dropping to ~500 μs at 3 Mbaud.
- **Pool pre-allocation:** eliminates creation spikes from the hot path for
  session-scoped abstractions by paying the cost at boot time when margin exists.

---

## Appendix B — Design Critique Q&A

This appendix addresses the questions a hostile reviewer, security auditor, or
protocol implementor is most likely to raise. Each question is answered honestly:
some critiques are wrong; some identify genuine gaps; some identify deliberate
trade-offs that deserve explicit acknowledgement.

---

### B.1 "SHA32 is not a standard primitive — what exactly is it?"

**The critic is right.**

The spec uses `token_32 = SHA32(ogt)` without defining SHA32. This is ambiguous.

**Definition:** `token_32` is the first four bytes of `SHA-256(ogt_bytes)`,
interpreted as a big-endian unsigned 32-bit integer.

**Additional concern:** The 32-bit token space holds ~4 billion values. With N
abstractions on one board, collision probability is `N² / 2³²`. At N=100 this is
~0.1%. Two abstractions sharing the same `token_32` would cause the bridge to
route messages to the wrong handler. **The bridge must detect and reject
`token_32` collisions at manifest load time** — if any two entries in an
`ns_manifest` produce the same `token_32`, the CALLHOME must be rejected with
an error.

---

### B.2 "Compromising board_uid breaks every key on the board"

**The critic is right.**

`IKM = SHA256(board_uid ‖ ogt_bytes)`. If `board_uid` leaks, an attacker
derives IKM for every abstraction on that board, then derives all K_enc and
K_mac. One value lost = every secure channel on that board broken.

The spec does not state where `board_uid` lives or how it is protected.

**Required statement:** `board_uid` must be a write-once hardware secret (eFuse
or equivalent). It must never appear in UART output, never in a readable firmware
variable, and never in any diagnostic endpoint. If `board_uid` is ever exposed,
every abstraction on that board must be treated as compromised — all deployments
must be revoked and re-provisioned with a new `board_uid`.

---

### B.3 "There is no key rotation without full revocation"

**The critic is right — this is a deliberate limitation.**

`mint_abstraction_keys(board_uid, ogt)` is deterministic. The same inputs always
produce the same K_enc and K_mac. The spec describes revocation (destroy the
deployment, reissue a new one) but not rotation (new keys, same abstraction,
same board, same OGT, live continuity).

**Acknowledged constraint:** Key rotation without revocation would require
introducing a per-abstraction epoch counter into the IKM. This is not in v1.

**Recommended workaround:** If a key is suspected compromised, revoke the
abstraction (broadcast `GT_REVOKED`), re-provision it as a new deployment with
the same OGT. The keystore LUMP is re-derived and re-delivered. Callers holding
the OGT experience a brief interruption; they resume transparently after
re-provisioning because the OGT is unchanged.

---

### B.4 "The HKDF construction is non-standard"

**The critic has a technical point — the construction is sound but should be
documented as deliberate.**

Standard HKDF usage: `HKDF(IKM=raw_secret, salt=random_or_fixed, info=context)`.
This spec uses `HKDF(IKM=SHA256(board_uid ‖ ogt_bytes), salt="CM_ENC_v3",
info=ogt_bytes)`. The IKM is pre-mixed via SHA-256 before being passed to HKDF,
which bypasses the intended HKDF Extract phase.

**Why this is sound:** SHA-256 is a collision-resistant PRF. Pre-mixing
`board_uid` and `ogt_bytes` through SHA-256 produces a uniformly distributed
32-byte value with no detectable structure. Passing this to HKDF Expand is
cryptographically equivalent to a compliant Extract-then-Expand construction.

**Equivalent standard construction:** `IKM = board_uid`, `salt = SHA-256(ogt_bytes)`,
`info = ogt_bytes`. The current construction binds both inputs at the IKM stage
instead; the resulting output keys are indistinguishable.

**Why the current construction was chosen:** The firmware does not perform a
separate Extract phase; the SHA-256 pre-mix is the Extract. This reduces the
number of distinct SHA-256 invocations in constrained firmware without weakening
security.

---

### B.5 "Proto=1 fallback is a downgrade attack vector"

**The critic is right.**

An active attacker between the board and the IDE can strip the `proto` field from
a CALLHOME message and force a proto=2-capable bridge into proto=1 mode — which
uses weaker security (no per-abstraction encryption, name-based GT lookup only).

**Required rule:** A bridge that has previously observed `proto: 2` from a given
`board_uid` must never accept `proto: 1` from that same `board_uid`. Downgrade
is treated as an attack indicator: the CALLHOME is silently dropped and an alert
is raised. The bridge should persist a `min_proto[board_uid]` table across
sessions.

---

### B.6 "There is no forward secrecy — recorded traffic can be decrypted later"

**The critic is correct. This is a deliberate, scoped trade-off.**

K_enc is static per deployment. An adversary who records all UART traffic and
later obtains K_enc (for example, via `board_uid` exposure) can decrypt every
past message. No ephemeral session keys are negotiated.

**Why forward secrecy is out of scope for v1:** Forward secrecy requires an
ephemeral key exchange (ECDH or equivalent) on every session establishment. The
firmware target is a VexRiscv at ~50 MHz with ~32 KB ROM — a full ECDH
handshake is feasible but consumes a significant fraction of the firmware budget.
More importantly, the threat model for this protocol is a physical-access USB
UART connection. An adversary with sufficient physical access to record UART
traffic over an extended period also has sufficient access to extract `board_uid`
from the hardware directly. Forward secrecy does not meaningfully raise the
attacker's cost in this threat model.

**If the threat model changes** (e.g. the UART is routed over a network), forward
secrecy must be added and this statement revisited.

---

### B.7 "Nonce size is not defined — overflow enables replay"

**The critic is right.**

The spec mentions `nonce_ctr` and `last_nonce[(board_uid, ogt)]` but never states
the nonce width. A 32-bit nonce exhausts in approximately `2³² × 5.6 ms ≈ 277 days`
of continuous traffic at 115,200 baud — after which it wraps and every subsequent
message is a replay.

**Required definition:** `nonce_ctr` is a **64-bit unsigned integer**. Wrap at
2⁶⁴ is physically unreachable at any UART baud rate within any plausible hardware
lifetime. The bridge must reject any frame where `nonce ≤ last_nonce[(board_uid,
ogt)]` — strict greater-than only, not equality-only.

---

### B.8 "Who mints OGTs? There is no canonical name authority"

**The critic is right — this is the deepest architectural gap.**

The spec states that the OGT abstraction segment uses the canonical formal name
(`MargaretHodges`, `GlobalWorkspaceLtd`). But it does not specify who decides
what that canonical name is, who prevents two systems from independently minting
the same OGT for different entities, or how naming disputes are resolved.

**Scope boundary for v1:** CM_MSG v1 operates within a single IDE instance with a
single Namespace Authority (NS[8] / `CM.IDE.NSAuthority`). Within that scope,
OGT uniqueness is enforced by the NS Authority at mint time — the Authority
registers the OGT on first creation and rejects duplicates. Cross-IDE OGT
collision (two independent IDE instances minting the same OGT path) is
**out of scope for v1**.

**Note:** The `ns_instance` component (`family-hub`, `mums-mobile`, `alice-year3`)
already provides practical namespace isolation between independent deployments.
Cross-IDE collision requires deliberately choosing the same `ns_type`,
`canonical_name`, and `ns_instance` — accidental collision is unlikely in
practice.

**Future work:** A global OGT registry or a self-sovereign naming scheme (e.g.
`global.<did>.<abstraction>.<instance>` where `<did>` is a decentralised
identifier) would close this gap.

---

### B.9 "Replicated spread — nonce handling across boards is ambiguous"

**The critic is right.**

For `spread: "replicated"` (same abstraction deployed on multiple boards
simultaneously), the spec does not explicitly state whether boards share a nonce
space. Two boards sending `nonce = 5` for the same OGT would produce two frames
with the same (ogt, nonce) tuple at the bridge.

**Explicit rule:** For replicated deployments, `nonce_ctr` is tracked per
`(board_uid, ogt)` pair. Each board has its own fully independent nonce counter.
The bridge never cross-checks nonces between different `board_uid` values for the
same OGT. `last_nonce[(board_uid, ogt)]` is the authoritative key — board_uid is
always part of the lookup.

---

### B.10 "Ephemeral pool OGTs have no defined lifecycle — keys persist indefinitely"

**The critic is right.**

Appendix A.5 describes pre-allocating pool slots with ephemeral OGTs at boot.
It does not specify when those keys are destroyed, what happens on board reboot,
or whether an attacker who knows the ephemeral OGT naming pattern can pre-compute
keys across sessions.

**Required rules:**

1. **Session-scoped revocation:** The IDE must broadcast `GT_REVOKED` for all
   pool deployments on board disconnect or board reboot. Pool keys must be
   destroyed server-side at the same time.

2. **Session nonce in ephemeral OGTs:** Ephemeral OGT names must include a fresh
   random session nonce generated at each boot:
   `global.Pool.Ephemeral.<session_nonce>.session-N`
   This ensures that an attacker who observes one session's pool OGTs cannot
   pre-compute keys for future sessions. The `session_nonce` should be a 64-bit
   random value formatted as a hex string.

---

### B.11 Critiques that are wrong — and why

| Critique | Why it is wrong |
|---|---|
| "AES without authentication" | Wrong — the pipeline is MAC-first (Section 4: HMAC → replay → decrypt). Authentication is verified before any decryption occurs. |
| "Shared keys mean one breach breaks everything" | Wrong — every abstraction has independent K_enc and K_mac. Revoking `CallHistory` touches nothing belonging to `MargaretHodges`. |
| "8-byte HMAC tag is too short" | 64-bit MACs are standard practice (TLS uses truncated MACs). Combined with strict nonce-ctr replay rejection, the forgery attack surface is negligible. |
| "AES-CTR produces distinguishable traffic patterns" | AES-CTR with a monotone nonce produces effectively random ciphertext. Traffic analysis can reveal frame timing and size, but not content or abstraction identity. |
| "`resident` flag can be bypassed by the firmware" | True — but the firmware is in the Trusted Security Base. `resident` is an IDE deployment policy, not a hardware capability constraint. The spec is explicit about this distinction. |
| "Per-abstraction keys are expensive to manage" | Key management cost is paid once at session establishment (~6 μs per abstraction IDE-side). There is no per-message key management overhead. See Appendix A.2. |

---

### B.12 Summary of gaps requiring spec additions

| Gap | Severity | Fix location |
|---|---|---|
| SHA32 undefined | Must fix | Section 2.1 — define as SHA-256 first 4 bytes, big-endian |
| token_32 collision detection absent | Must fix | Section 2.1 — bridge rejects manifest on collision |
| board_uid confidentiality not stated | Must fix | Section 2.6 — add hardware secret requirement |
| Nonce size not specified | Must fix | Section 3/4 — 64-bit, strict greater-than check |
| Proto downgrade not prevented | Must fix | Section 5 — min_proto rule per board_uid |
| Replicated nonce semantics ambiguous | Must fix | Section 2.7 — per-(board_uid, ogt) explicit |
| Ephemeral pool lifecycle undefined | Must fix | Appendix A.5 — session revocation + session nonce |
| No key rotation path | Acknowledged | Appendix A or B — deliberate limitation, workaround stated |
| Forward secrecy absent | Acknowledged | Section 1.4 / Appendix B — explicit out-of-scope |
| HKDF construction non-standard | Acknowledged | Section 2.6 — document as deliberate |
| OGT minting authority undefined | Scoped | Section 2.1 / future work — v1 scope boundary stated |
