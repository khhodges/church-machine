# Hardware Reference — Church Machine

This document covers hardware-specific wire protocols and board profiles
that are not part of the CLOOMC ISA specification.

---

## Wukong Ethernet Protocol

The QMTECH Wukong XC7A100T communicates with the IDE server over Ethernet
using UDP (no TCP, no TLS — capability security is the CM model).  This
section defines the wire format for the two frame types.

**Port:** 5900 (both directions — board sends from an ephemeral src port;
server listens on 5900 and replies to the board's source address).

**Byte order:** big-endian (network byte order) for all multi-byte integer
fields.

**Identity rule:** abstractions are identified by their Pet-Name GT token
in every frame field.  NS slot numbers are NEVER used as identifiers in the
wire protocol.  The Ethernet abstraction that sends the callhome frame is
identified by token `0x00003300`, not by any slot number.

---

### Frame A — Wukong Callhome Broadcast (board → IDE server)

Sent by the Locator abstraction after Ethernet link comes up.  Addressed
to UDP broadcast (255.255.255.255) so the IDE server receives it on any
interface without requiring a configured server IP.

```
Offset  Bytes  Field
------  -----  -----
0       4      Magic = 0xCE110001  (identifies this as a Wukong callhome)
4       4      Sender token = 0x00003300  (Ethernet abstraction Pet-Name GT)
8       4      CM version word (u32)  — upper 16 bits: major, lower 16: minor
12      6      Board MAC address (6 octets, as presented by the RGMII MAC)
18      2      Pad = 0x0000
20      4      Link-up uptime (u32, seconds since power-on)
24      2      Request count N (u16) — number of lump tokens being requested
26      N×4    Requested lump tokens (each u32) — tokens the Locator needs served
```

Minimum frame length: 26 bytes (N = 0, no requests).

#### Notes

- The server must look up each requested token in its lump store (LUMP
  files registered in the manifest) and reply with a Frame B for each
  token it can satisfy.
- The CM version field allows the server to gate lump delivery by
  compatibility.
- Unknown tokens in the request list are silently skipped — the board
  retries on the next callhome cycle.

---

### Frame B — Lump-Serve Response (IDE server → board)

Sent by the IDE server in reply to each requested lump token in Frame A.
Addressed to the source (host, port) of the callhome broadcast.

```
Offset  Bytes  Field
------  -----  -----
0       4      Magic = 0xCE110002  (identifies this as a lump-serve response)
4       4      Lump token (u32) — Pet-Name GT token of the lump being served
8       4      Word count W (u32) — number of 32-bit LUMP words that follow
12      W×4    LUMP data words (each u32, big-endian)
```

Minimum frame length: 12 bytes (W = 0 signals "token not found").

#### Notes

- The Locator verifies the token field against the token it requested.  A
  response with an unexpected token is discarded.
- LUMP words are the raw 32-bit words of the LUMP binary (header + body),
  exactly as stored in the LUMP file.
- After receiving all words, the Locator calls `Mint.Install()` to install
  the lump, then `NSWrite.Promote()` to make the NS entry Live.

---

### Protocol Flow

```
Board (Locator)                        IDE server (WukongUdpListener)
──────────────────────────────         ──────────────────────────────
power-on: Ethernet.Status() → poll
link up detected
send Frame A (broadcast, N=2)     ──►  parse_callhome_frame()
  requests = [token_A, token_B]         log to _callhome_log
                                         for each known token:
                                ◄──      send Frame B (token_A, words)
                                ◄──      send Frame B (token_B, words)
receive Frame B (token_A)
  Mint.Install(words)
  NSWrite.Promote()
receive Frame B (token_B)
  Mint.Install(words)
  NSWrite.Promote()
... (repeat for subsequent lazy-load requests)
```

---

## Ti60 F225 Call-Home Protocol

The Ti60 F225 uses a UART-based call-home protocol via the Sapphire SoC.
See `docs/cloomc-foundation.md` for the full description of the Ti60 boot
sequence and `server/app.py` (`/api/device/register` and
`/api/device/callhome`) for the server-side handler.
