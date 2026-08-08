---
name: Wukong IRQ arm gate
description: IRQ dispatch stays disabled until first good CALL→method→RETURN; two state bits in core.py gate irq_dispatch_start
---

## Rule

IRQ dispatch (`timer_alarm | lazy_load_irq | lazy_resolve_irq`) is gated on `irq_armed_reg`.
Both `irq_armed_reg` and `first_call_done_reg` are cleared on `clear_all` (FAULT_RST / boot).
- First clean CALL completion (COMPLETE, no fault) → sets `first_call_done_reg`
- First clean RETURN after that (complete, no fault, no reboot) → sets `irq_armed_reg`
- Dispatch can only fire after both bits are set.

**Why:** At boot, Scheduler.IRQ (NS slot 8) does not exist. Without the gate, `irq_dispatch_start` fires mid-boot CALL → `IRQ_NULL_BASE` (fault 20) kills the boot jump before NIA reaches WukongCallHome. The gate also protects the IDE single-step function from being hijacked by dispatch during bring-up.

**How to apply:** Any new IRQ source that routes through `irq_dispatch_start` in `core.py` is automatically gated. Do NOT bypass `irq_armed_reg` for timer or lazy-load/resolve IRQs; add them inside the existing `irq_dispatch_start` combinator.
