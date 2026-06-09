# CM_MSG — Church Machine UART Messaging Protocol

**Status:** Design specification — v0.1 draft  
**Date:** 2026-06-09  
**Scope:** Ti60 F225 (initial target); architecture applies to all CM-connected boards

---

## 1. Motivation

The current UART channel carries one-way callhome JSON from the FPGA to the IDE.
Extending it with a generic framed message protocol unlocks:

- LUMP deployment (IDE → FPGA, no WebSerial required)
- Lazy-Load (FPGA requests LUMPs on demand — the canonical Locator architecture)
- Execution trace (live Pipeline view from real hardware)
- Fault events with MTBF tracking
- Media delivery (images, audio, documents)
- Capability-secured HTML browsing (IDE as rendering proxy)

The design principle: **freeze the firmware once, extend forever on the IDE/bridge side.**
The FPGA emits generic frames. The bridge and IDE server add new handlers without
touching FPGA firmware. Unknown message types are logged and ignored gracefully.

---

## 2. Wire Format

Every message — in both directions — uses the same envelope:

```
[0xCE][0xAA][type:1][seq:2][len:2][payload: len bytes][crc16:2]
```

| Field | Bytes | Description |
|-------|-------|-------------|
| `0xCE 0xAA` | 2 | Magic sync bytes — re-synchronises parser after noise or reset |
| `type` | 1 | Message type (0x00–0x7F = FPGA→IDE; 0x80–0xFF = IDE→FPGA) |
| `seq` | 2 | Sequence number — pairs requests with responses (little-endian) |
| `len` | 2 | Payload length in bytes (little-endian, max 65535) |
| `payload` | len | Type-specific data (see Section 4) |
| `crc16` | 2 | CRC-16/CCITT over `type + seq + len + payload` (little-endian) |

Minimum frame size: 9 bytes (zero-length payload).  
The parser scans for `0xCE 0xAA` to re-sync after any corruption.

### Firmware API (frozen after first flash)

```c
/* Send any message. Never changes. */
void cm_send_msg(uint8_t type, uint16_t seq,
                 const uint8_t *payload, uint16_t len);

/* Receive loop — call from main loop or UART ISR. */
void cm_poll_rx(void);

/* Override this to handle incoming messages from the IDE. */
__attribute__((weak))
void cm_on_msg(uint8_t type, uint16_t seq,
               const uint8_t *payload, uint16_t len);
```

The existing CALLHOME string is re-wrapped as a `cm_send_msg(MSG_CALLHOME, ...)` call.
No other firmware changes are ever needed for new message types.

---

## 3. Bridge Router

`callhome_bridge.py` becomes a typed dispatcher:

```python
CM_HANDLERS = {
    0x01: handle_callhome,
    0x02: handle_fault,
    0x03: handle_trace,
    0x04: handle_lump_req,
    0x05: handle_ns_dump,
    0x09: handle_media_req,
    0x10: handle_browse_req,
    # Future types added here — no firmware change needed
}

def on_message(msg_type, seq, payload):
    handler = CM_HANDLERS.get(msg_type)
    if handler:
        handler(seq, payload)
    else:
        log.warning("Unknown CM_MSG type 0x%02X seq=%d len=%d", msg_type, seq, len(payload))
```

The bridge forwards IDE-bound events to the server via HTTP POST.
It listens on a local socket for IDE→FPGA messages and writes them to the UART TX.

---

## 4. Message Type Registry

### 4.1 System (FPGA → IDE)

| Type | Name | Priority | Payload |
|------|------|----------|---------|
| `0x01` | `CALLHOME` | ✅ Done | JSON: board, uid, nia, fw_major, fw_minor, boot_ok, fault |
| `0x02` | `FAULT` | P1 | JSON: code, mnemonic, nia, gt, pipeline_stage, tier, catch_invoked |
| `0x03` | `TRACE` | P2 | Binary: nia(4) + opcode(1) + dr0(4) + dr1(4) — 13 bytes |
| `0x04` | `LUMP_REQ` | P2 | token(8) + hint_ns_slot(2) — Lazy-Load request |
| `0x05` | `NS_DUMP` | P3 | Binary array: slot(2)+token(8)+perms(1) per entry |
| `0x06` | `PING` | P1 | No payload — keep-alive / latency check |
| `0x07` | `BOOT_LOG` | P3 | UTF-8 string: boot step description |
| `0x08` | `PERF` | P3 | uptime_ms(4) + instr_count(4) + fault_count(2) + boot_count(2) |

### 4.2 Media Requests (FPGA → IDE)

| Type | Name | Priority | Payload |
|------|------|----------|---------|
| `0x09` | `MEDIA_REQ` | P3 | token(8) + offset(4) + chunk_len(2) — chunked pull |
| `0x0A` | `MEDIA_ACK` | P3 | token(8) + offset(4) — buffer consumed, send next |

### 4.3 Browse (FPGA → IDE)

| Type | Name | Priority | Payload |
|------|------|----------|---------|
| `0x10` | `BROWSE_REQ` | P4 | url_len(2) + url + width(2) + height(2) + mode(1) |
| `0x11` | `BROWSE_NAV` | P4 | direction(1): 0=back, 1=forward, 2=reload |
| `0x12` | `BROWSE_CLICK` | P4 | x(2) + y(2) |
| `0x13` | `BROWSE_SCROLL` | P4 | delta_lines(2) |
| `0x14` | `BROWSE_INPUT` | P4 | element_id(2) + text_len(2) + utf8_text |

### 4.4 LUMP / Commands (IDE → FPGA)

| Type | Name | Priority | Payload |
|------|------|----------|---------|
| `0x80` | `LUMP_DATA` | P2 | token(8) + bram_addr(4) + BEEF-framed binary |
| `0x81` | `CMD` | P2 | cmd(1): 0=pause, 1=step, 2=resume, 3=reset, 4=query_ns |
| `0x82` | `ACK` | P1 | Mirrors seq of message being acknowledged |
| `0x83` | `PONG` | P1 | Response to PING — includes server_time_ms(8) |

### 4.5 Media Delivery (IDE → FPGA)

| Type | Name | Priority | Payload |
|------|------|----------|---------|
| `0x84` | `MEDIA_META` | P3 | token(8) + media_type(1) + fmt(1) + total_size(4) + meta_json |
| `0x85` | `MEDIA_CHUNK` | P3 | token(8) + offset(4) + data[...] |
| `0x86` | `AUDIO_STREAM` | P3 | token(8) + fmt(1) + chunk[...] |

### 4.6 Browse Responses (IDE → FPGA)

| Type | Name | Priority | Payload |
|------|------|----------|---------|
| `0x88` | `BROWSE_META` | P4 | page_id(2) + url + title |
| `0x89` | `BROWSE_FRAME` | P4 | page_id(2) + tile_x(2) + tile_y(2) + rgb565[...] |
| `0x8A` | `BROWSE_TEXT` | P4 | page_id(2) + structured_text |
| `0x8B` | `BROWSE_LINKS` | P4 | page_id(2) + array of {x(2),y(2),w(2),h(2),url_hash(4)} |
| `0x8C` | `BROWSE_STATUS` | P4 | page_id(2) + status(1): 0=loading, 1=ready, 2=error |

---

## 5. Media Format Codes

### 5.1 Documents (`media_type = 0x01`)

| fmt | Name | Description |
|-----|------|-------------|
| `0x01` | `DOC_UTF8` | Plain text, paginated by FPGA |
| `0x02` | `DOC_LINES` | Pre-wrapped fixed-width lines |
| `0x03` | `DOC_PDF_RASTER` | Page pre-rasterized to RGB565 by IDE |

### 5.2 Images (`media_type = 0x02`)

| fmt | Name | Description |
|-----|------|-------------|
| `0x01` | `IMG_RGB565` | Raw 16bpp — width×height in MEDIA_META |
| `0x02` | `IMG_RGB888` | Raw 24bpp |
| `0x03` | `IMG_JPEG` | JPEG compressed — FPGA needs decoder |
| `0x04` | `IMG_RLE` | Run-length encoded — good for diagrams |
| `0x05` | `IMG_1BPP` | 1-bit monochrome — e-ink, OLED |
| `0x06` | `IMG_TILE` | Tiled RGB565 for large displays |

### 5.3 Audio (`media_type = 0x03`)

| fmt | Name | Rate | Notes |
|-----|------|------|-------|
| `0x01` | `AUD_MULAW_8K` | 8 kHz | Telephony / speech — 8 KB/s, fits 115200 baud |
| `0x02` | `AUD_PCM_8K16` | 8 kHz 16-bit | Clear speech — 16 KB/s |
| `0x03` | `AUD_ADPCM_22K` | 22 kHz ADPCM | 4:1 compression — 5.5 KB/s, comfortable |
| `0x04` | `AUD_PCM_44K16` | 44.1 kHz 16-bit | HiFi music — 176 KB/s, requires 921600 baud |
| `0x05` | `AUD_PCM_48K16` | 48 kHz 16-bit | Studio HiFi |
| `0x06` | `AUD_OPUS` | Variable | Best quality/bandwidth for speech |
| `0x07` | `AUD_TTS_REQ` | — | FPGA sends UTF-8 text; IDE returns audio |
| `0x08` | `AUD_SPEECH_16K` | 16 kHz 16-bit | Speech recognition quality |

### 5.4 HTML Browse render modes

| mode | Name | Bridge tool | Bandwidth |
|------|------|------------|-----------|
| `0x00` | TEXT | `requests` + BeautifulSoup | ~1–5 KB per page |
| `0x01` | SIMPLE | BS4 structured DOM | ~5–20 KB |
| `0x02` | RASTER | Playwright headless screenshot | ~300 KB (tiled) |
| `0x03` | WIKI | Dedicated Wikipedia extractor | ~3 KB |

---

## 6. Bandwidth Budget

At 115200 baud the usable payload throughput is approximately **10 KB/s**.

| Use case | Bandwidth | Fits? |
|----------|-----------|-------|
| CALLHOME (1 Hz) | ~200 B/s | ✅ |
| FAULT events | burst only | ✅ |
| TRACE (sampled 10 Hz) | ~130 B/s | ✅ |
| Speech audio (µ-law 8kHz) | 8 KB/s | ✅ just fits |
| ADPCM 22 kHz audio | ~5.5 KB/s | ✅ comfortable |
| LUMP deploy (16 KB lump) | ~1.6 s | ✅ |
| Image (100 KB JPEG) | ~10 s | ✅ with tile cache |
| HTML TEXT page | <1 s | ✅ |
| HiFi music (44.1kHz PCM) | 176 KB/s | ❌ needs 921600 baud |

To enable HiFi audio: `UART_CLOCKDIV = 25_000_000 / (8 × 921600) ≈ 3`.
A `CMD` message (`0x81`) with sub-command `5=set_baud` can negotiate higher rates
at runtime without firmware changes.

---

## 7. Capability Security — Browse GT

Web browsing is capability-gated. Each device holds a **Browse GT** whose C-list
contains the permitted domains:

```
Browse GT (type=Inform)
  C-list slot 0:  bbc.co.uk   [E]
  C-list slot 1:  wikipedia.org [E]
  C-list slot 2:  khanacademy.org [E]
```

When the FPGA sends `BROWSE_REQ`, the bridge:
1. Looks up the device's Browse GT (fetched from the IDE server on registration)
2. Checks whether the requested domain is in the C-list
3. Serves the page → or → returns `BROWSE_STATUS(error: domain not permitted)`

This is the canonical Church Machine security model applied to the internet:
**capability token = permission. No accounts, no parental-control apps, no passwords.**
Parents manage the C-list via the IDE's Family & Friends panel.

---

## 8. Implementation Priorities

### Phase 1 — Foundation (unblocks everything else)

| Item | Work | Where |
|------|------|-------|
| `cm_send_msg` / `cm_poll_rx` in firmware | ~100 lines C | `hardware/soc_minimal/firmware/main.c` |
| Re-wrap CALLHOME as `MSG_CALLHOME (0x01)` | trivial | firmware |
| Bridge parser rewrite — framing + CRC + dispatch | ~150 lines Python | `hardware/soc_combined/callhome_bridge.py` |
| `handle_callhome` — existing behaviour, new path | trivial | bridge |
| `handle_fault (0x02)` stub | ~20 lines | bridge + server |
| `PING/PONG (0x06/0x83)` round-trip | ~30 lines | bridge |

**Outcome:** Protocol live. One firmware flash. All future work is IDE/bridge only.

### Phase 2 — Deploy + Fault (closes the callhome milestone)

| Item | Work | Where |
|------|------|-------|
| `LUMP_DATA (0x80)` — IDE pushes LUMP over UART | medium | bridge + server + FPGA UART RX |
| `FAULT (0x02)` — full event with tier/GT/NIA | medium | firmware + bridge + server |
| IDE fault popup from hardware events | small | `simulator/app-misc.js` |
| MTBF chart in Dashboard per NIA | small | server + `simulator/app-misc.js` |

### Phase 3 — Trace + Lazy-Load (educational showpiece)

| Item | Work | Where |
|------|------|-------|
| `TRACE (0x03)` — emit on every CALL/RETURN | medium | firmware |
| Pipeline view live from hardware | medium | `simulator/app-misc.js` |
| `LUMP_REQ (0x04)` + `LUMP_DATA (0x80)` — Lazy-Load | high | firmware + bridge + server |
| `NS_DUMP (0x05)` — hardware/IDE namespace agreement check | medium | firmware + bridge |

### Phase 4 — Media

| Item | Work | Where |
|------|------|-------|
| `MEDIA_REQ/CHUNK` — chunked LUMP delivery | medium | bridge + server |
| Audio playback: µ-law 8kHz → DAC/PWM | medium | firmware + hardware |
| `AUD_TTS_REQ` — text-to-speech via bridge | medium | bridge (calls espeak or cloud API) |
| Image delivery: RGB565 tiles | medium | bridge + firmware framebuffer |

### Phase 5 — Browse

| Item | Work | Where |
|------|------|-------|
| `BROWSE_REQ` TEXT mode — BeautifulSoup | small | bridge |
| `BROWSE_REQ` RASTER mode — Playwright | medium | bridge |
| Browse GT C-list enforcement | medium | bridge + server |
| Click / scroll / input messages | medium | bridge + firmware input handler |
| Parent domain-list management in IDE | small | `simulator/index.html` + server |

---

## 9. File Inventory

| File | Role |
|------|------|
| `hardware/soc_minimal/firmware/main.c` | Firmware — add `cm_send_msg`, `cm_poll_rx` |
| `hardware/soc_combined/callhome_bridge.py` | Bridge — rewrite parser, add dispatchers |
| `server/app.py` | Server — new endpoints for fault/trace/media events |
| `server/models.py` | DB — `fault_events`, `trace_log`, `media_cache` tables |
| `simulator/app-misc.js` | IDE — fault popups, trace live view, browse UI |
| `docs/cm-msg-protocol.md` | This document |

---

## 10. Versioning

The protocol version is negotiated at connection time via the `CALLHOME` payload:
`"proto":1` field. If the IDE receives a `proto` field it doesn't recognise, it
falls back to legacy JSON line parsing. Old bridges receiving unknown type bytes
skip the frame (CRC mismatch or unknown type → log and continue).

**Protocol version 1** covers all types defined in this document.  
Future versions increment the `proto` field; the firmware never changes.

---

*This document is the authoritative spec for CM_MSG. All bridge and IDE implementation
decisions should reference it. Update Section 4 when adding new type codes.*
