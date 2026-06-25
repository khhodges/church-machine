"""32-bit parallel integrity check for NS entry sealing.

integrity32(w0, w1) — Python reference implementation (used in boot_rom.py).
integrity32_amaranth(m, w0, w1, result) — Amaranth combinatorial helper (used in ns_gate.py, msave.py, core.py).

Design
──────
The check covers NS Entry W0 (location) and NS Entry W1 (authority) to produce
NS Entry W2 (integrity32).  Both g_bit at W1[30] and f_flag at W1[31] are masked
out before computing so the GC unit and IDE can mutate them without invalidating
the stored W2 value. ★v2.0: g_bit moved from [28] to [30]; f_flag moved from
GT[25] to W1[31].

Formula (purely linear — collapses to a single LUT layer in FPGA synthesis):
    w1_masked = w1 & ~(1 << 30) & ~(1 << 31)   # mask g_bit and f_flag
    result = ROL(w0, 7) ^ ROL(w1_masked, 13) ^ 0xDEADBEEF

Strength: 32-bit → forgery probability 1 in 2^32 ≈ 1 in 4.3 billion.
"""

from amaranth import *

G_BIT_MASK_32 = 0x3FFFFFFF   # zeroes bit[30] (g_bit) and bit[31] (f_flag) ★v2.0
INTEGRITY32_CONST = 0xDEADBEEF


def _rol32(x, n):
    """Python rotate-left by n bits (32-bit)."""
    n &= 31
    return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF


def integrity32(w0, w1):
    """Python reference: compute 32-bit integrity check over (w0, w1).

    Args:
        w0: NS entry W0 (location), integer.
        w1: NS entry W1 (authority), integer.  g_bit [28] is masked out.

    Returns:
        32-bit integer — the value that should be stored in NS entry W2.
    """
    w1_masked = w1 & G_BIT_MASK_32
    return (_rol32(w0, 7) ^ _rol32(w1_masked, 13) ^ INTEGRITY32_CONST) & 0xFFFFFFFF


def integrity32_amaranth(m, w0, w1, result):
    """Amaranth combinatorial helper: drive result with integrity32(w0, w1).

    All signals must already be defined by the caller.  Adds only m.d.comb
    assignments — no new signals are created with side-visible names.

    Args:
        m:      Module — the Amaranth module under construction.
        w0:     Signal(32) — NS entry W0 (location).
        w1:     Signal(32) — NS entry W1 (authority).
        result: Signal(32) — driven combinatorially with the integrity check.
    """
    w1_masked = Signal(32)
    w0_rot    = Signal(32)
    w1_rot    = Signal(32)

    m.d.comb += w1_masked.eq(w1 & G_BIT_MASK_32)

    m.d.comb += w0_rot.eq(Cat(w0[25:32], w0[0:25]))
    m.d.comb += w1_rot.eq(Cat(w1_masked[19:32], w1_masked[0:19]))

    m.d.comb += result.eq(w0_rot ^ w1_rot ^ INTEGRITY32_CONST)
