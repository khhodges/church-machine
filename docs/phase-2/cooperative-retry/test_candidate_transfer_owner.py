import pytest
from amaranth.sim import Simulator
from candidate_test_support import module

Owner = module("candidate_transfer_owner").TransferOwner


@pytest.mark.parametrize("cancel", ["finish", "owner_fault", "disable", "epoch"])
def test_owner_is_stable_and_stale_completion_cannot_release_next_request(cancel):
    d = Owner()
    sim = Simulator(d)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(d.epoch, 7)
        ctx.set(d.enabled, 1)
        await ctx.tick()
        a, b = 0x02000001 | (0x1000 << 32), 0x02000001 | (0x18000 << 32)
        ctx.set(d.request_namespace, a)
        ctx.set(d.request_thread, 0x02070004)
        ctx.set(d.request_target, 0x4a03000a)
        ctx.set(d.request, 1)
        assert ctx.get(d.rejected)  # no trusted record selection
        ctx.set(d.selection_valid, 1)
        assert ctx.get(d.accepted)
        await ctx.tick()
        assert ctx.get(d.active) and ctx.get(d.transaction) == 1
        ctx.set(d.request_namespace, b)  # same target slot, different root
        assert ctx.get(d.rejected) and not ctx.get(d.accepted)
        await ctx.tick()
        assert ctx.get(d.owner_namespace) == a
        assert ctx.get(d.owner_thread) == 0x02070004
        assert ctx.get(d.owner_target) == 0x4a03000a
        ctx.set(d.request, 0)
        ctx.set(d.fault, 1)
        ctx.set(d.fault_namespace, b)
        ctx.set(d.fault_thread, 0x02070004)
        await ctx.tick()
        assert ctx.get(d.active), "unrelated Namespace fault cancelled owner"
        ctx.set(d.fault, 0)
        ctx.set(d.finish, 1)
        ctx.set(d.finish_epoch, 6)
        ctx.set(d.finish_transaction, 1)
        await ctx.tick()
        assert ctx.get(d.active)
        ctx.set(d.finish, 0)
        if cancel == "finish":
            ctx.set(d.finish, 1)
            ctx.set(d.finish_epoch, 7)
            assert ctx.get(d.finished)
        elif cancel == "owner_fault":
            ctx.set(d.fault, 1)
            ctx.set(d.fault_namespace, a)
            assert ctx.get(d.cancelled)
        elif cancel == "disable":
            ctx.set(d.enabled, 0)
        else:
            ctx.set(d.epoch, 8)
        await ctx.tick()
        assert not ctx.get(d.active)
        ctx.set(d.finish, 0)
        ctx.set(d.fault, 0)
        ctx.set(d.enabled, 1)
        ctx.set(d.request, 1)
        assert ctx.get(d.accepted)
        await ctx.tick()
        ctx.set(d.request, 0)
        assert ctx.get(d.owner_namespace) == b
        assert ctx.get(d.transaction) == (1 if cancel == "epoch" else 2)
        ctx.set(d.finish, 1)
        ctx.set(d.finish_epoch, 7)
        ctx.set(d.finish_transaction, 1)
        await ctx.tick()
        assert ctx.get(d.active), "stale completion released a different request"

    sim.add_testbench(bench)
    sim.run()
