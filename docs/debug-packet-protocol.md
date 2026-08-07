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

## Hardware TraceUnit requirement

The TraceUnit in `hardware/wukong_top.py` must retire one packet per event
in the table above, not one packet per instruction.  The current 11-byte
`0xAA` packet covers one retired instruction; the format must be extended or
multiplexed to carry per-event data for multi-packet instructions (LOAD,
CHANGE, CALL, RETURN).

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
