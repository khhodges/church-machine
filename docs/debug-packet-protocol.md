# Church Machine Debug Packet Protocol

## Purpose

Every instruction the Church Machine executes that changes observable state
must emit a debug packet.  This is the complete contract:

- The **FPGA** implements it in silicon via the TraceUnit UART port.
- The **simulator** must emit the identical packet stream in software.
- The **IDE** renders the stream.  When an FPGA is connected the IDE is a
  pure display slave — it reads packets and renders them; it has no
  independent view of machine state.
- When no FPGA is connected the simulator generates the same packets so the
  IDE behaves identically.

There is no fourth party.  If the IDE cannot see it in a packet, it does not
know it happened.

---

## Packet table

The total number of packets per instruction is fixed by the hardware.  The
IDE must consume exactly this many packets before moving to the next
instruction.

| Instruction | Packets | Events — in order |
|---|:---:|---|
| **LOAD** | 2 | 1. Thread shadows old CR_dst GT (displaced capability recorded) |
| | | 2. CR_dst ← new GT from c-list[n] |
| **SAVE** | 1 | c-list[n] ← CR_src written to thread memory |
| **CHANGE** | 3 | 1. Stack push (current context saved) |
| | | 2. CR12 ← new thread GT |
| | | 3. CR5 ← heap GT restored from thread.caps |
| **CALL** | 3 | 1. CR6 ← abstraction GT |
| | | 2. CR14 ← return GT |
| | | 3. Stack push (caller frame saved) |
| **RETURN** | 3 | 1. Stack pop (caller frame restored) |
| | | 2. CR6 ← restored from frame |
| | | 3. CR14 ← restored from frame |
| **DR→DR + Function** | 1 | Single result packet |
| *(IADD, ISUB, BRANCH,* | | |
| *DWRITE, DREAD, TPERM)* | | |

Total distinct packet types: **16** across 6 instruction classes.

---

## Boot sentinel

Before the first trace packet the board sends a boot sentinel over the same
UART so the bridge can detect stale bitstreams immediately.

### Current format (3 bytes)

| Byte | Value | Meaning |
|------|-------|---------|
| 0 | `0xBC` | Sentinel magic — new-format (3 bytes) |
| 1 | `N_INIT & 0xFF` | Non-zero DMEM word count baked in at synthesis time |
| 2 | `TU_VERSION` | TraceUnit FSM capability version |

`TU_VERSION` constants:

| Value | Meaning |
|-------|---------|
| `0x02` | TraceUnit emits 3-packet CALL sequence (`CALL_CR6`+`CALL_CR14`+`CALL_PUSH`) for ELOADCALL and XLOADLAMBDA — **current minimum required** |

### Old format (stale bitstreams, 2 bytes)

Bitstreams built before the 3-packet ELOADCALL/XLOADLAMBDA TraceUnit FSM was
introduced emit a 2-byte sentinel with magic `0xBB`:

| Byte | Value | Meaning |
|------|-------|---------|
| 0 | `0xBB` | Sentinel magic — old/stale 2-byte format |
| 1 | `N_INIT & 0xFF` | Non-zero DMEM word count |

When the bridge receives `0xBB` it prints a **BITSTREAM WARNING**: those
bitstreams emit a single `TRACE_EV_RESULT` (0x00) for ELOADCALL and
XLOADLAMBDA instead of the 3-packet CALL sequence, so the IDE will display
wrong CR6/CR14 state after any such instruction executes.  Rebuild and
reflash the bitstream to resolve this.

---

## Boot sequence

The 3-instruction boot ROM is the complete boot contract:

```
[0]  LOAD   CR15, CR15[0]   →  2 packets  (namespace GT loaded)
[1]  CHANGE CR12, CR15, #1  →  3 packets  (stack push, CR12, CR5)
[2]  CALL   CR0,  CR0       →  3 packets  (CR6, CR14, stack push)
```

After packet 8 the next packet is the first instruction of the abstraction
the programmer placed at the Lightning Bolt (⚡) boot entry.  Nothing runs
between BOOT_PROGRAM[2] and that instruction.

The IDE must not run any independent boot logic when an FPGA is connected.
The 8 boot packets above are all it knows about the boot sequence.

---

## Simulator requirement

When no FPGA is connected the simulator's `_exec*` functions must:

1. Emit packets in the exact order given in the packet table above.
2. Emit no additional messages that the hardware would not produce.
3. Use the same packet format and field names as the hardware TraceUnit.

The current `[BOOT]` composite messages in `simulator.js` (B:00–B:07) are a
placeholder.  They must be replaced with the per-packet stream defined here.

The CALL_HOME boot step (`[BOOT] CALL_HOME`) has no hardware counterpart and
must be removed.

---

## Packet format

Each packet is **12 bytes**, big-endian, starting with magic byte `0xAA`:

| Byte(s) | Field        | Description |
|---------|--------------|-------------|
| 0       | `magic`      | `0xAA` — packet start marker |
| 1–4     | `nia`        | Retiring instruction NIA (uint32 big-endian) |
| 5       | `ev_type`    | `TRACE_EV_*` constant — which CR changed, or stack push/pop |
| 6–9     | `payload`    | GT word0 (uint32 big-endian); `0` for push/pop events |
| 10      | `flags`      | bits\[3:0\]=NZCV; bits\[7:4\]=0 |
| 11      | `fault`      | bits\[4:0\]=fault\_code; bit\[6\]=fault\_valid; bit\[7\]=bp\_hit |

### Event type constants

| Constant              | Value | Instruction | Meaning |
|-----------------------|-------|-------------|---------|
| `TRACE_EV_RESULT`     | 0x00  | any         | Single-packet result (DR→DR, SAVE, Function, etc.) |
| `TRACE_EV_LOAD_SHADOW`| 0x01  | LOAD        | Old CR\_dst GT displaced (payload = old GT word0) |
| `TRACE_EV_LOAD_NEW`   | 0x02  | LOAD        | New GT installed in CR\_dst (payload = new GT word0) |
| `TRACE_EV_CHANGE_PUSH`| 0x03  | CHANGE      | Context stack push (payload = 0) |
| `TRACE_EV_CHANGE_CR12`| 0x04  | CHANGE      | CR12 ← new thread GT (payload = new GT word0) |
| `TRACE_EV_CHANGE_CR5` | 0x05  | CHANGE      | CR5 ← heap GT (payload = new GT word0) |
| `TRACE_EV_CALL_CR6`   | 0x06  | CALL        | CR6 ← abstraction GT (payload = new GT word0) |
| `TRACE_EV_CALL_CR14`  | 0x07  | CALL        | CR14 ← code/return GT (payload = new GT word0) |
| `TRACE_EV_CALL_PUSH`  | 0x08  | CALL        | Caller frame stack push (payload = 0) |
| `TRACE_EV_RETURN_POP` | 0x09  | RETURN      | Caller frame stack pop (payload = 0) |
| `TRACE_EV_RETURN_CR6` | 0x0A  | RETURN      | CR6 ← restored from frame (payload = E-GT word0) |
| `TRACE_EV_RETURN_CR14`| 0x0B  | RETURN      | CR14 ← restored from frame (payload = caller CR14 word0) |

---

## Hardware TraceUnit requirement

The TraceUnit in `hardware/wukong_top.py` emits one 12-byte packet per event
(per table above), using the format and event type constants defined in this
document.

**Backpressure guarantee**: the TraceUnit asserts `trace_stall` while events
are pending.  `trace_stall` is OR-ed into `core.halt_req` so the CM cannot
retire the next instruction until all event packets for the current instruction
have been transmitted.  No retire event is silently dropped.

---

## IDE slave mode

When `/dev/ttyUSB*` is present and the Wukong bridge is active:

1. IDE disables its own simulation clock.
2. IDE reads packets from the bridge and renders each one in the step view.
3. IDE does not infer, predict, or cache state between packets.
4. If the packet stream stops, the IDE shows "waiting for hardware" — it does
   not attempt to continue independently.

When the bridge disconnects, the IDE may offer to switch back to simulator
mode.  It must not silently continue simulating.
