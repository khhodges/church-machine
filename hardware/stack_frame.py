"""hardware/stack_frame.py — stack frame address arithmetic helpers.

Single source of truth for the Thread-Lump stack slot byte-address formula
used by call.py and ret.py.

Stack layout (byte addresses relative to thread_base):
    slot  STO+0   frame word  (SZ=1 | return_PC[15] | prev_STO[16])
    slot  STO-1   callee E-GT word 0

The Stack Top Offset (STO) is a *word* index stored in Heap[0]
(= Mem[CR5.word1_location + 0]).  The byte address of a slot is:

    thread_base + (sto + word_offset) * 4

where word_offset is a signed Python integer constant (-1, 0, +1, +2, …).

call.py writes:
    thread_base + (sto - 1) * 4  ← callee E-GT   (word_offset = -1)
    thread_base + (sto + 0) * 4  ← frame word     (word_offset =  0)

ret.py reads:
    thread_base + (sto + 2) * 4  ← frame word     (word_offset = +2)
    thread_base + (sto + 1) * 4  ← callee E-GT    (word_offset = +1)
"""

__all__ = ["stack_slot_addr"]


def stack_slot_addr(thread_base, sto, word_offset: int):
    """Return an Amaranth expression for the byte address of a stack slot.

    Args:
        thread_base : Amaranth signal/expression for the thread lump base address.
        sto         : Amaranth signal holding the Stack Top Offset (word index).
        word_offset : Signed Python int constant — slot offset from STO.

    Returns an Amaranth combinatorial expression (no clock dependency).
    """
    if word_offset == 0:
        return thread_base + (sto << 2)
    elif word_offset > 0:
        return thread_base + ((sto + word_offset) << 2)
    else:
        return thread_base + ((sto - (-word_offset)) << 2)
