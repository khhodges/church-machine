import sqlite3
import pytest
from amaranth.sim import Simulator
from candidate_test_support import module


@pytest.mark.parametrize("failure", [None, "missing", "rejected", "stale", "disabled"])
def test_acknowledgement_is_exact_bounded_and_fail_closed(failure):
    gate = module("candidate_audit").AuditGate(timeout_cycles=8)
    sim = Simulator(gate)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(gate.enabled, 1)
        ctx.set(gate.namespace, 123)
        ctx.set(gate.thread, 456)
        ctx.set(gate.execution, 789)
        ctx.set(gate.start, 1)
        await ctx.tick()
        ctx.set(gate.start, 0)
        ctx.set(gate.namespace, 999)
        assert ctx.get(gate.record_namespace) == 123
        assert ctx.get(gate.sequence) == 1
        if failure != "missing":
            ctx.set(gate.ack_sequence, 0 if failure == "stale" else 1)
            ctx.set(gate.ack_failed, failure == "rejected")
            ctx.set(gate.ack_valid, failure != "disabled")
        if failure == "disabled":
            ctx.set(gate.enabled, 0)
        await ctx.tick().repeat(12)
        assert ctx.get(gate.state) == (gate.ACKED if failure is None else gate.FAILED)
        if failure:
            # A late successful receipt cannot revive a failed request.
            ctx.set(gate.enabled, 1)
            ctx.set(gate.ack_sequence, 1)
            ctx.set(gate.ack_valid, 1)
            ctx.set(gate.ack_failed, 0)
            await ctx.tick()
            assert ctx.get(gate.state) == gate.FAILED
        else:
            # The prior receipt cannot authorize the next operation.
            ctx.set(gate.start, 1)
            await ctx.tick()
            ctx.set(gate.start, 0)
            await ctx.tick().repeat(12)
            assert ctx.get(gate.sequence) == 2
            assert ctx.get(gate.state) == gate.FAILED

    sim.add_testbench(bench)
    sim.run()


def test_home_ide_receipt_follows_commit_and_rejects_conflicting_replay(tmp_path):
    receiver = module("home_ide_audit").HomeIDEAudit(
        tmp_path / "audit.sqlite", session="qualification", image_sha256="a"*64)
    intent = dict(sequence=1, namespace=123, thread=456, execution=789)
    try:
        assert receiver.receive(**intent) == 1
        with sqlite3.connect(tmp_path / "audit.sqlite") as independent:
            assert independent.execute("SELECT count(*) FROM audit_intents").fetchone()[0] == 1
        assert receiver.receive(**intent) == 1
        with pytest.raises(ValueError, match="different intent"):
            receiver.receive(**dict(intent, execution=999))
        # A failed storage operation cannot return an acknowledgement.
        receiver.close()
        with pytest.raises(sqlite3.ProgrammingError):
            receiver.receive(**dict(intent, sequence=2))
    finally:
        receiver.close()
