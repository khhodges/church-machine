"""hardware/mload_seq.py — shared mLoad-sequencer FSM helper.

Single source of truth for the "issue start → wait for done/fault → transition"
pattern that appears in call.py (PHASE1/PHASE2), ret.py (RESTORE_CR5), and
fused_unit.py (LOAD_PHASE/CALL_P1/CALL_P2).

Usage
-----
Inside a ``with m.State("MY_WAIT"):`` block, call::

    mload_wait_body(
        m,
        sub_start_reg       = sub_start_reg,
        done_sig            = self.mload_done,
        fault_sig           = self.mload_fault,
        fault_type_sig      = self.mload_fault_type,
        sub_done_latched    = sub_done_latched,
        sub_fault_latched   = sub_fault_latched,
        fault_latched       = fault_latched,
        fault_type_latched  = fault_type_latched,
        done_next           = "NEXT_STATE",
    )

The function emits the standard sync/comb assignments inside the current FSM
state.  ``fault_next`` defaults to ``"FAULT"`` and can be overridden.
"""

__all__ = ["mload_wait_body"]


def mload_wait_body(
    m,
    *,
    sub_start_reg,
    done_sig,
    fault_sig,
    fault_type_sig,
    sub_done_latched,
    sub_fault_latched,
    fault_latched,
    fault_type_latched,
    done_next: str,
    fault_next: str = "FAULT",
):
    """Emit the standard mLoad-wait FSM body inside the current state.

    Args:
        m               : Amaranth Module being elaborated.
        sub_start_reg   : Registered start strobe signal (cleared here after one cycle).
        done_sig        : One-cycle done pulse from the mLoad sub-unit.
        fault_sig       : One-cycle fault pulse from the mLoad sub-unit.
        fault_type_sig  : Fault-type signal from the mLoad sub-unit.
        sub_done_latched: Sticky latch for done (set when done_sig fires).
        sub_fault_latched: Sticky latch for fault (set when fault_sig fires).
        fault_latched   : Parent module's fault flag (set on fault).
        fault_type_latched: Parent module's fault-type register.
        done_next       : FSM state name to enter when done.
        fault_next      : FSM state name to enter when faulted (default ``"FAULT"``).
    """
    m.d.sync += sub_start_reg.eq(0)
    with m.If(done_sig):
        m.d.sync += sub_done_latched.eq(1)
    with m.If(fault_sig):
        m.d.sync += sub_fault_latched.eq(1)
        m.d.sync += [
            fault_latched.eq(1),
            fault_type_latched.eq(fault_type_sig),
        ]
    with m.If(sub_fault_latched):
        m.next = fault_next
    with m.Elif(sub_done_latched):
        m.next = done_next
