# CM_MSG — Church Machine UART Messaging Protocol

**Status:** Design specification — v0.4  
**Date:** 2026-06-09  
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
│  Namespace table (each slot = one abstraction):                  │
│                                                                  │
│   slot │ label            │ token_32 │ K_enc │ K_mac │ nonce_ctr │
│  ──────┼──────────────────┼──────────┼───────┼───────┼───────────│
│     0  │ Board.Identity   │ SHA32(uid)│  ●   │  ●    │     n     │
│     2  │ Fault.Reporter   │ 0xA3F1…  │  ●   │  ●    │     n     │
│     4  │ Lump.Loader      │ 0x7B2E…  │  ●   │  ●    │     n     │
│     …  │ …                │  …       │  ●   │  ●    │     n     │
│    15  │ Browse.Client    │ 0xCC91…  │  ●   │  ●    │     n     │
│                                                                  │
│  CALLHOME (0x01): board_uid + fpga_nonce + ns_manifest           │
│  All subsequent frames: encrypted by the SOURCE ABSTRACTION      │
└──────────────────────────┬───────────────────────────────────────┘
                           │  UART  [0xCE][0xAA][type][seq][flags][len]
                           │         [nonce:4][ChaCha20(payload)][HMAC-8]
                           ▼         ↑ keyed by SOURCE ABSTRACTION's slot
┌──────────────────────────────────────────────────────────────────┐
│                  Bridge (callhome_bridge.py)                      │
│                                                                  │
│  1. Verify magic                                                 │
│  2. Map msg.type → source NS slot (via ns_manifest)              │
│  3. Load K_mac for that slot → verify HMAC (silent drop on fail) │
│  4. Verify nonce > last_seen[slot]  (silent drop on replay)      │
│  5. Decrypt with K_enc for that slot                             │
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

The board reports its **NS manifest** in every CALLHOME — the list of loaded NS slots
with their labels, tokens, and the message types each slot emits or receives. The
bridge validates the manifest against the server's authoritative NS record and builds
the `msg_type → ns_slot` lookup table for the session.

Each entry in the manifest implicitly announces: *"This abstraction is present,
holds this token, and has an encryption service active for these message types."*

| Label | Perms | Default | msg_types | Description |
|-------|-------|---------|-----------|-------------|
| `Board.Identity` | E | Always | `0x01` | Minted at first registration; token = SHA32(board_uid + slot) |
| `Heartbeat` | E | Always | `0x06` | Lowest privilege — PING only |
| `Fault.Reporter` | E | Always | `0x02 0x07` | FAULT + BOOT_LOG emission |
| `Perf.Reporter` | E | Always | `0x08` | PERF counter emission |
| `Lump.Loader` | E | Always | `0x04` | LUMP_REQ Lazy-Load access to IDE store |
| `Trace.Emitter` | E | Debug builds | `0x03` | Instruction TRACE streaming |
| `NS.Inspector` | R | Admin grant | `0x05` | Read-only namespace dump |
| `Media.Consumer` | E | On request | `0x09 0x0A` | Media asset fetch (images, audio, documents) |
| `Browse.Client` | E | Family panel | `0x10–0x14` | Web browsing; domain C-list inside the abstraction |

**NS slot assignment** is determined at boot time from the board's LUMP image.
Slot numbers are reported in the CALLHOME `ns_manifest` array and agreed with the
IDE. The bridge never hardcodes slot numbers — it always reads them from the manifest.

**Encryption service per entry** — every row in the table above has its own
`K_enc`, `K_mac`, and `nonce_ctr` stored in the FPGA's protected BRAM.
No two abstractions share a key. The keystore LUMP (Section 2.6) is indexed by
NS slot, not by GT global name.

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
  ns_manifest = [{ slot: N, label: "...", token: "0x..." }, ...]

  → Server registers each NS slot entry from the manifest:
       For each { slot, label, token_32 } in ns_manifest:
         K_enc = HKDF-SHA256(IKM=SHA256(uid||slot||token), salt="CM_ENC_v2", info=slot_info)
         K_mac = HKDF-SHA256(IKM=SHA256(uid||slot||token), salt="CM_MAC_v2", info=slot_info)

  → Default set of abstractions activated (all must be in manifest):
       Board.Identity, Heartbeat, Fault.Reporter, Perf.Reporter, Lump.Loader

  → NS keystore LUMP built: per-slot { K_enc, K_mac } for every slot in manifest
  → All records persisted in church_machine.db (keys encrypted at rest)
  → Bridge sends ACK with ide_nonce_32 + HMAC(K_mac[Board.Identity slot],
       ide_nonce || fpga_nonce)
  → Bridge builds session msg_slot_map via build_msg_slot_map(ns_manifest)
  → NS keystore LUMP deployed to FPGA as LUMP_DATA(0x80)
  → From this point all frames are keyed per source abstraction's NS slot

CAPABILITY EXPANSION (admin panel)
  Admin enables tracing  → mints CM.Trace.Emitter (new K_enc, K_mac)
  Admin grants media     → mints CM.Media.Consumer (new K_enc, K_mac)
  → New GT bundle (token + keys) queued for LUMP_DATA deploy

FAMILY BROWSE SETUP (Family panel)
  Parent adds "bbc.co.uk"
  → Server mints CM.Domain.BBCNews (token = SHA32("bbc.co.uk"))
  → Server builds/updates CM.Browse.Client with new domain in C-list
  → Full GT bundle redeployed to FPGA via LUMP_DATA (0x80) at next connect

REVOCATION
  Admin removes a GT from device record
  → Keys for that GT deleted from server DB immediately
  → Next bridge connect: bridge sends GT_REVOKED for messages of that type
  → FPGA logs rejection; gracefully disables the capability
  → No firmware change, no reflash required
```

### 2.6 OGT-Encryption — encryption service per namespace slot

Each NS slot is a **quad**: the hardware token, an encryption key, an
authentication key, and a nonce counter. This is the slot's **encryption service** —
its private, dedicated cryptographic identity on the UART channel.

```
NS_SLOT_ENC = {
    ns_slot:   2,                         // namespace table index (runtime-assigned)
    label:     "Fault.Reporter",          // human-readable abstraction name
    token_32:  0xA3F1C28E,                // 32-bit hardware capability handle
    K_enc:     <128-bit secret>,          // ChaCha20 stream cipher key (this slot only)
    K_mac:     <128-bit secret>,          // HMAC-SHA256 authentication key (this slot only)
    nonce_ctr: 0,                         // monotonic counter, per-slot, per-session
    msg_types: [0x02, 0x07],              // FAULT + BOOT_LOG
}
```

No slot shares a key with any other slot. No slot can read or forge frames
belonging to a different slot. The slot number is known to both FPGA and bridge
via the ns_manifest agreed in CALLHOME; it never appears in the frame itself.

**Key derivation** (at NS slot grant time, server-side only):

The IKM is bound to three factors: the board, the slot's position in the namespace,
and the slot's token. All three must match for a key to be valid.

```python
import hashlib
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

def mint_slot_keys(board_uid: bytes,
                   ns_slot: int,
                   token_32: int) -> tuple[bytes, bytes]:
    # IKM binds board + slot position + token — all three factors required
    ikm = hashlib.sha256(
        board_uid
        + ns_slot.to_bytes(2, "little")
        + token_32.to_bytes(4, "little")
    ).digest()
    slot_info = f"slot{ns_slot}".encode()
    K_enc = HKDF(hashes.SHA256(), 16,
                 salt=b"CM_ENC_v2", info=slot_info).derive(ikm)
    K_mac = HKDF(hashes.SHA256(), 16,
                 salt=b"CM_MAC_v2", info=slot_info).derive(ikm)
    return K_enc, K_mac
```

Every NS slot for a given board gets a unique key pair. Revoking a slot
invalidates only that slot's keys — all other abstractions on the same board
are completely unaffected.

**Key deployment** — the NS keystore LUMP:

The IDE packages all active NS slot keys for a board into a protected LUMP
(type=`ns_keystore`, NULL policy, no NS slot of its own — it is never callable).
The keystore is indexed by slot number:

```json
{
  "type": "ns_keystore",
  "board_uid": "c0ffee0100000001",
  "slots": {
    "0":  { "label": "Board.Identity",  "token": "0xC0FFEE01", "K_enc": "…", "K_mac": "…" },
    "2":  { "label": "Fault.Reporter",  "token": "0xA3F1C28E", "K_enc": "…", "K_mac": "…" },
    "4":  { "label": "Lump.Loader",     "token": "0x7B2E91F4", "K_enc": "…", "K_mac": "…" },
    "15": { "label": "Browse.Client",   "token": "0xCC9144D0", "K_enc": "…", "K_mac": "…",
            "browse_domains": ["bbc.co.uk", "wikipedia.org"] }
  }
}
```

The keystore LUMP is transmitted as a `LUMP_DATA (0x80)` frame encrypted
with `CM.IDE.Deployer`'s key. The FPGA writes the bundle to protected BRAM.
Firmware reads per-slot keys from BRAM via `cm_get_key(ns_slot)`.

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
4. Verify `nonce > last_nonce[board_uid][gt_name]` (reject → `GT_REPLAY`)
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

The bridge no longer hardcodes slot numbers. Instead, it builds the
`msg_type → ns_slot` map dynamically from the ns_manifest received in CALLHOME.
The `STATIC_MSG_LABELS` dict maps message type bytes to their canonical abstraction
label — the bridge uses this to look up the slot number from the manifest.

```python
# Maps message type → canonical abstraction label (never hardcoded slot numbers)
# Slot numbers come from the ns_manifest in CALLHOME and are per-board, per-boot.
STATIC_MSG_LABELS = {
    0x01: "Board.Identity",
    0x02: "Fault.Reporter",
    0x03: "Trace.Emitter",
    0x04: "Lump.Loader",
    0x05: "NS.Inspector",
    0x06: "Heartbeat",
    0x07: "Fault.Reporter",   # BOOT_LOG shares the Fault.Reporter slot
    0x08: "Perf.Reporter",
    0x09: "Media.Consumer",
    0x0A: "Media.Consumer",
    0x10: "Browse.Client",
    0x11: "Browse.Client",
    0x12: "Browse.Client",
    0x13: "Browse.Client",
    0x14: "Browse.Client",
}

def build_msg_slot_map(ns_manifest: list[dict]) -> dict[int, int]:
    """
    Build msg_type → ns_slot from the ns_manifest agreed in CALLHOME.
    ns_manifest is a list of { "slot": N, "label": "...", "token": "0x..." }.
    Called once per CALLHOME; result stored on the board session object.
    """
    label_to_slot = {entry["label"]: entry["slot"] for entry in ns_manifest}
    msg_slot_map = {}
    for msg_type, label in STATIC_MSG_LABELS.items():
        slot = label_to_slot.get(label)
        if slot is not None:
            msg_slot_map[msg_type] = slot
        # If label not in manifest: abstraction not loaded on this board.
        # Frames of that type will fail GT authorization (GT_NOT_HELD).
    return msg_slot_map
```

The session's `msg_slot_map` replaces the old `CM_MSG_TYPE_GT` dict.
In `on_raw_frame`, Step 2 becomes:

```python
    # Step 2: resolve source NS slot from the session's msg_slot_map
    ns_slot = session.msg_slot_map.get(msg_type)
    if ns_slot is None:
        _silent_drop(board_uid, "GT_UNKNOWN", msg_type)  # abstraction not in manifest
        return

    # Steps 3–5: HMAC, replay, decrypt — all keyed by (board_uid, ns_slot)
    # Step 6: validate_gt uses (board_uid, ns_slot) not (board_uid, gt_name)
```

And last_nonce tracking changes from `(board_uid, gt_name)` → `(board_uid, ns_slot)`:

```python
    last_nonce[(board_uid, ns_slot)] = nonce   # per-abstraction, not per-board
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
| `0x01` | `CALLHOME` | `Board.Identity` | `CM.IDE.CallhomeService` | ✅ Done | JSON: board, uid, nia, fw, boot_ok, fault, proto, enc, ns_manifest[{slot,label,token}] |
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
| CALLHOME (1 Hz) | ~200 B/s | ✅ |
| FAULT events | burst only | ✅ |
| TRACE (sampled 10 Hz) | ~130 B/s | ✅ |
| Speech µ-law 8kHz | 8 KB/s | ✅ just fits |
| ADPCM 22 kHz | ~5.5 KB/s | ✅ comfortable |
| LUMP deploy 16 KB | ~1.6 s one-shot | ✅ |
| JPEG image 100 KB | ~10 s one-shot | ✅ with tile cache |
| HTML TEXT page | <1 s | ✅ |
| HiFi music 44.1kHz | 176 KB/s | ❌ needs 921600 baud |

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
