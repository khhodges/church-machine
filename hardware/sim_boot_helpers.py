"""Fault-aware boot handshake for isolated ChurchCore simulations."""


async def boot_core(ctx, core, *, max_cycles=64):
    """Keep instruction input idle and await completion; never mask a fault."""
    if max_cycles < 1:
        raise ValueError("max_cycles must be positive")
    ctx.set(core.imem_valid, 0)
    ctx.set(core.imem_data, 0)
    ctx.set(core.boot_start, 1)
    for cycle in range(1, max_cycles + 1):
        await ctx.tick()
        ctx.set(core.boot_start, 0)
        state = ctx.get(core.boot_state)
        fault = ctx.get(core.fault)
        assert not ctx.get(core.fault_valid), (
            f"Boot fault at cycle {cycle}: state={state}, fault={fault}")
        if ctx.get(core.boot_complete):
            return cycle
    raise AssertionError(
        f"Boot did not complete within {max_cycles} cycles: "
        f"state={state}, fault={fault}")