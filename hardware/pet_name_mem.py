"""PetNameMemory — 64-entry single-bit register file associating c-list slot
indices with "this slot has a pet name" annotations.

Architecture
------------
The LAZY_RESOLVE IRQ path (Task #1523 / Task #1526) fires when a NULL GT is
found in a c-list slot during ELOADCALL or XLOADLAMBDA.  Without this memory,
*any* NULL GT — including ones in anonymous slots that were never given a name
by the assembler — would trigger the IRQ.  That leaks the IRQ path into hard
faults that should remain hard faults.

The rule enforced here:
  NULL GT + slot has pet name  →  LAZY_RESOLVE_ABORT (IRQ, transparent suspend)
  NULL GT + slot has no name   →  NULL_CAP hard fault  (existing behaviour)

Implementation
--------------
* 64 single-bit registers (one per c-list slot, indices 0–63).
* Combinatorial read: rd_data is valid the same cycle rd_addr is presented.
* Synchronous write: wr_en / wr_addr (6-bit) / wr_data (1-bit).
* Initialisation: pass a list of pre-named slot indices to __init__; these are
  wired as reset values so synthesis sees constants (no boot-cycle cost).
* Out-of-range read (rd_addr >= 64) returns 0 (no pet name → hard fault).

MMIO write path (Task #1526)
----------------------------
core.py intercepts DWRITE writes to IO_PORT_PET_NAME_WR (0xFFFFFF38) and feeds
the lower 6 bits of the written value into wr_addr with wr_data=1.  Writing
slot index N marks slot N as having a pet name.  The assembled boot program
(or any CLOOMC abstraction with sufficient authority) can use:

    DWRITE  DR_slot, CR_io_cap, #PET_NAME_WR_OFFSET

to populate the table at runtime.

Run-time constants are exported:
  PET_NAME_MEM_DEPTH   = 64   — number of tracked slots
  PET_NAME_ADDR_WIDTH  = 6    — bits needed to index them
"""

from amaranth import *


PET_NAME_MEM_DEPTH  = 64
PET_NAME_ADDR_WIDTH = 6


class PetNameMemory(Elaboratable):
    """Single-bit register file: slot index → has_pet_name flag.

    Ports
    -----
    rd_addr : Signal(16), in  — c-list slot index to query (out-of-range → 0)
    rd_data : Signal(1),  out — 1 if slot rd_addr has a pet name

    wr_en   : Signal(1),  in  — synchronous write enable
    wr_addr : Signal(6),  in  — slot to write (must be < PET_NAME_MEM_DEPTH)
    wr_data : Signal(1),  in  — 1 = mark as named; 0 = unmark

    Parameters
    ----------
    init_named : list[int]
        Slot indices to mark as named at reset.  Slots not in the list reset
        to 0 (no pet name).  Boot ROM population via DWRITE can supplement
        or override these at runtime.
    """

    def __init__(self, init_named=None):
        self._init_named = set(init_named or [])

        self.rd_addr = Signal(16)
        self.rd_data = Signal(1)

        self.wr_en   = Signal()
        self.wr_addr = Signal(PET_NAME_ADDR_WIDTH)
        self.wr_data = Signal(1)

    def elaborate(self, platform):
        m = Module()

        bits = Array(
            Signal(1, reset=(1 if i in self._init_named else 0), name=f"pn_{i}")
            for i in range(PET_NAME_MEM_DEPTH)
        )

        in_range = Signal()
        m.d.comb += in_range.eq(self.rd_addr < PET_NAME_MEM_DEPTH)

        m.d.comb += self.rd_data.eq(
            Mux(in_range, bits[self.rd_addr[:PET_NAME_ADDR_WIDTH]], 0)
        )

        with m.If(self.wr_en & (self.wr_addr < PET_NAME_MEM_DEPTH)):
            m.d.sync += bits[self.wr_addr].eq(self.wr_data)

        return m
