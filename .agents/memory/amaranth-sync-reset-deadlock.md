---
name: Amaranth sync-domain self-deadlocking reset
description: A shift-register in the sync domain driving ResetSignal("sync") from its own any() signal locks reset HIGH forever on Artix-7.
---

# Amaranth sync-domain self-deadlocking reset (Wukong / Artix-7)

## The Rule
Never drive `ResetSignal("sync")` from a Signal that lives *in* the sync domain.

## Why
Under Amaranth's elaboration, a sync-domain register gets a reset pin wired to
`ResetSignal("sync")`.  If that same register's value drives `ResetSignal("sync")`,
you have a cycle:

```
rst_sr = Signal(4, init=0xF)          # init=0xF  →  all-ones
m.d.sync += rst_sr.eq(Cat(0, rst_sr[:-1]))
m.d.comb += ResetSignal("sync").eq(rst_sr.any())
```

Under reset → rst_sr gets reset to 0xF → rst_sr.any()=1 → reset stays HIGH →
rst_sr gets reset to 0xF → … loop forever.

Symptom on active-LOW LED board: all LEDs solid ON because boot_triggered=0 and
hb_blink=0 (both held in reset state).  Diagnosed: "4 solid red forever."

## How to Apply
For Artix-7 (and most FPGA families): use `reset_less=True` on the ClockDomain.
GSR (Global Set/Reset) fires as part of bitstream load and initialises every FF
and BRAM to its `init` value before user logic starts — no soft POR needed.

```python
# CORRECT — Artix-7 GSR handles initialisation
m.domains += ClockDomain("sync", reset_less=True)
m.d.comb += ClockSignal("sync").eq(self.clk)

# WRONG — self-deadlock: reset register resets itself to init every cycle
m.domains += ClockDomain("sync")
rst_sr = Signal(4, init=0xF)
m.d.sync += rst_sr.eq(Cat(0, rst_sr[:-1]))
m.d.comb += ResetSignal("sync").eq(rst_sr.any())
```

If you need a soft reset (e.g. from a button), drive ResetSignal from an
*asynchronous* source (rst_n pin) not from a sync register:
```python
m.d.comb += ResetSignal("sync").eq(~self.rst_n)
```
