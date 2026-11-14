"""Native qualified loading, header-last publication and normal target CALL."""
from collections import deque
from amaranth import Elaboratable, Module
from amaranth.sim import Simulator
import pytest
from candidate_test_support import module
from test_candidate_core import _install_amaranth_elaboration_caches


@pytest.mark.parametrize("cross_namespace,corrupt,deny_m,audit_failure", [
    (False, False, False, None), (False, True, False, None),
    (True, False, False, None), (True, False, True, None),
    (True, False, False, "missing"), (True, False, False, "rejected"),
    (True, False, False, "stale")])
def test_exact_native_loader_publishes_only_after_verified_body(
        cross_namespace, corrupt, deny_m, audit_failure, tmp_path):
    words, binding, record, compiled = module("candidate_mediated_fixture" if cross_namespace
                                     else "candidate_amoeba_fixture").prepare()
    class Fixture(Elaboratable):
        def __init__(self):
            self.mem = module("candidate_memory").CandidateMemory(init=words)
            self.d = module("candidate_qualified_delivery").QualifiedDelivery(
                self.mem, [record], clock_hz=1000)
            self.audit = module("candidate_audit").AuditGate(timeout_cycles=64) if cross_namespace else None
            self.svc = module("candidate_service").CandidateService(self.d, audit=self.audit)
            self.bridge = module("candidate_core").CandidateCoreBridge(
                self.mem, binding, self.svc,
                m_control_recipients=(() if deny_m else compiled.get("m_control_recipients"))
                    if cross_namespace else None)

        def elaborate(self, platform):
            m = Module()
            m.submodules.memory = self.mem
            m.submodules.delivery = self.d
            m.submodules.bridge = self.bridge
            m.d.comb += [self.mem.cpu_enabled.eq(~self.bridge.held),
                         self.d.enabled.eq(~self.bridge.held), self.d.epoch.eq(7)]
            return m

    dut = Fixture()
    home = module("home_ide_audit").HomeIDEAudit(
        tmp_path / "home-ide-audit.sqlite", session="local-native-qualification",
        image_sha256=binding.image_sha256)
    host = module("candidate_host_delivery").CandidateHostDelivery([record], 7)
    _install_amaranth_elaboration_caches()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        core, mem, rx = dut.bridge.core, dut.mem, dut.d.receiver
        await ctx.tick().repeat(3)
        ctx.set(dut.bridge.held, 0)
        ctx.set(rx.tx_ack, 1)
        pending = deque()
        copied, publications, returns, faults = {}, 0, 0, []
        states = []
        roots, last_root, completion_written = [], 0, False
        bus_trace = deque(maxlen=16)
        acknowledged = set()
        for cycle in range(60000):
            audit = dut.audit
            if audit is not None:
                ctx.set(audit.ack_valid, 0)
                sequence = ctx.get(audit.sequence)
                if ctx.get(audit.state) == audit.PENDING:
                    if audit_failure in ("rejected", "stale"):
                        ctx.set(audit.ack_sequence, sequence if audit_failure == "rejected" else sequence-1)
                        ctx.set(audit.ack_failed, audit_failure == "rejected")
                        ctx.set(audit.ack_valid, 1)
                    elif audit_failure is None and sequence not in acknowledged:
                        receipt = home.receive(sequence=sequence,
                            namespace=ctx.get(audit.record_namespace),
                            thread=ctx.get(audit.record_thread),
                            execution=ctx.get(audit.record_execution))
                        acknowledged.add(receipt)
                        ctx.set(audit.ack_sequence, receipt)
                        ctx.set(audit.ack_valid, 1)
            if ctx.get(core.dmem_rd_en) or ctx.get(core.ns_rd_en) or ctx.get(core.clist_rd_en):
                bus_trace.append((cycle, ctx.get(core.dmem_addr), ctx.get(core.ns_addr),
                                  ctx.get(core.clist_addr), ctx.get(core.dmem_rd_data),
                                  ctx.get(core.boot_state)))
            if ctx.get(rx.tx_req):
                for response in host.feed(bytes([ctx.get(rx.tx_byte)])):
                    if corrupt:
                        response = bytearray(response)
                        response[28] ^= 1
                    pending.extend(response)
            ctx.set(rx.valid, 0)
            if pending and cycle % 64 == 0:
                ctx.set(rx.byte, pending.popleft())
                ctx.set(rx.valid, 1)
            state = ctx.get(rx.state)
            if not states or states[-1][1] != state:
                states.append((cycle, state, ctx.get(mem.commit_source)))
            if state == rx.FAILED and not corrupt:
                pytest.fail(f"Receiver rejected native delivery: states={states}, remaining={len(pending)}")
            if ctx.get(core.fault_valid) and not ctx.get(core.fault_entry_active):
                faults.append((cycle, ctx.get(core.nia), ctx.get(core.fault),
                               ctx.get(core.dmem_addr), ctx.get(core.debug_dr_words[1])))
                if audit_failure:
                    assert ctx.get(dut.audit.state) == dut.audit.FAILED
                    assert ctx.get(core.debug_cr_words[14][0]) & 0xffff == 23
                    assert not ctx.get(core.dbg_m_bit_state) & (1 << 15)
                    assert not roots and not copied and publications == 0
                    assert not acknowledged
                    return
                if deny_m:
                    assert ctx.get(core.fault) == 5
                    assert ctx.get(core.debug_cr_words[14][0]) & 0xffff == 23
                    assert not ctx.get(core.dbg_m_bit_state) & (1 << 15)
                    assert not roots and not copied and publications == 0
                    return
                if corrupt:
                    assert publications == 0 and not copied
                    assert ctx.get(dut.d.failure_latched)
                    assert not ctx.get(dut.d.owner.active)
                    return
                pytest.fail(f"Unexpected native loader fault: {faults}; "
                            f"CR14={[hex(ctx.get(w)) for w in core.debug_cr_words[14]]}; "
                            f"CR15={[hex(ctx.get(w)) for w in core.debug_cr_words[15]]}; "
                            f"recipients={compiled.get('m_control_recipients')}; bus={list(bus_trace)}")
            if ctx.get(mem.commit):
                address, value = ctx.get(mem.commit_address), ctx.get(mem.commit_data)
                if address == 0x5418 and value == 1:
                    completion_written = True
                if record["baseByte"] <= address < record["baseByte"] + record["sizeWords"]*4:
                    offset = (address-record["baseByte"])//4
                    assert ctx.get(mem.commit_source) == 2, "host wrote executable memory"
                    assert value == record["words"][offset]
                    if offset == 0:
                        assert len(copied) == record["sizeWords"]-1
                        publications += 1
                    else:
                        copied[offset] = value
            if ctx.get(core.retire_valid) and record["baseByte"] <= ctx.get(
                    core.retire_nia) < record["baseByte"] + 16:
                returns += 1
            root = ctx.get(core.debug_cr_words[15][1])
            if root != last_root:
                roots.append(root)
                last_root = root
            completed = (completion_written and roots == [0x10000, 0, 0x10000, 0]
                         if cross_namespace else ctx.get(core.debug_dr_words[1]) == 37)
            if returns >= 2 and completed:
                assert not corrupt and not deny_m
                assert publications == 1
                assert not pending
                assert not ctx.get(dut.d.owner.active)
                assert host.last_transaction == 1
                if cross_namespace:
                    assert acknowledged == {1, 2, 3, 4}
                return
            await ctx.tick()
        pytest.fail(f"No target completion; publication={publications}, body={len(copied)}, "
                    f"NIA={ctx.get(core.nia):x}, receiver={ctx.get(rx.state)}, txn={host.last_transaction}, roots={roots}")

    sim.add_testbench(bench)
    try:
        sim.run()
    finally:
        home.close()
