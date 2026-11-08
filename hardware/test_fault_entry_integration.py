"""Disposable exact-byte inputs; no retained/live artifact selection."""
import hashlib
import struct
import pytest
from amaranth.sim import Simulator
from hardware.fault_entry import FaultBootBinding
from hardware.core import ChurchCore
from hardware.integrity32 import integrity32
from hardware.test_phase2_guarded_llr import guarded_fixture, GUARD


def fault_fixture(boot_fault=False):
    mem = guarded_fixture()
    mem[0x4008] = 0xf7000000
    root, thread, code = 0x8000, 0x9000, 0xa000
    def desc(slot, base, words, version):
        a = words - 1 | version << 21
        mem.update({root + slot * 16: base // 4, root + slot * 16 + 4: a,
                    root + slot * 16 + 8: integrity32(base // 4, a),
                    root + slot * 16 + 12: 0})
    desc(1, root, 256, 3)
    desc(2, thread, 256, 5)
    desc(3, code, 64, 7)
    desc(4, 0xb000, 256, 9)
    desc(5, 0xc000, 64, 11)
    mem[thread] = 0xf900820c
    mem[code] = (31 << 27) | (2 << 10) | 2
    mem[code + 4] = 0x070b0010  # LOAD CR1, CR6[1]
    if boot_fault:
        mem[code + 4] = 0xf7000000
    mem[code + 8] = 0x27008000  # CHANGE CR1, explicitly selecting healthy work
    mem[code + 62 * 4] = 0x4a070003
    mem[code + 63 * 4] = 0x02090004
    mem[0xb000] = 0xf900820c
    mem[0xb044] = 0x10f1
    mem[0xb000 + 242 * 4] = 0x4a0b0005
    mem[0xb000 + 243 * 4] = 0x10f3
    mem[0xb000 + 244 * 4] = 0x4a0b0005
    mem[0xc000] = (31 << 27) | (12 << 10) | 1
    from hardware.boot_rom import encode_turing
    from hardware.hw_types import TuringOpcode, CondCode
    mem[0xc004] = encode_turing(TuringOpcode.IADD, CondCode.AL, dr_dst=10, dr_src=10, imm=1)
    mem[0xc008] = encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=-1)
    mem[0xc000 + 63 * 4] = 0x4a0b0005
    words = tuple(mem.get(i * 4, 0) for i in range(16384))
    digest = hashlib.sha256(struct.pack("<16384I", *words)).hexdigest()
    binding = FaultBootBinding.from_image(
        words, namespace=0x02030001 | root << 32 | (255 | 3 << 21) << 64,
        thread_gt=0x02050002, handler_gt=0x4a070003, image_sha256=digest,
        resident_words=True, boot_guard=GUARD)
    return mem, words, binding


@pytest.mark.parametrize("failure", [None, "save_grant", "stash_grant",
                                    "stash_response", "stash_mismatch",
                                    "status_grant", "activation_response", "delayed",
                                    "pending_m6", "bad_binding", "bad_original"])
def test_core_enters_exact_boot_after_real_fault(failure):
    mem, _, binding = fault_fixture()
    if failure == "delayed":
        mem[0x4008] = 0x07130070  # real LOAD, out-of-bounds C-list index
    if failure == "bad_binding":
        mem[0x8028] ^= 1
    core = ChurchCore(expected_boot_guard=GUARD, fault_boot_binding=binding)
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(core.fault_memory_safe, 1)
        ctx.set(core.boot_start, 1)
        writes, fault = [], None
        for cycle in range(5000):
            pc = ctx.get(core.imem_addr)
            ctx.set(core.imem_fetch_address, pc)
            ctx.set(core.imem_from_reset_rom, pc < 12)
            ctx.set(core.imem_data, {4: 0x27000001, 8: 0x17000001}.get(pc, mem.get(pc, 0)))
            ctx.set(core.imem_valid, not ctx.get(core.fault_entry_active))
            ctx.set(core.fault_evidence_captured, ctx.get(core.fault_evidence_ready))
            address = ctx.get(core.dmem_addr)
            denied = ((failure == "save_grant" and 0x3000 <= address < 0x3400) or
                      (failure == "stash_grant" and address == 0x93d4) or
                      (failure == "status_grant" and address == 0x9010 and
                       ctx.get(core.dmem_wr_data) == 1))
            ctx.set(core.dmem_write_granted, ctx.get(core.dmem_wr_en) and not denied)
            if ctx.get(core.retire_fault_valid) and not ctx.get(core.fault_entry_active):
                fault = (pc, ctx.get(core.fault), ctx.get(core.imem_data))
                if failure == "pending_m6":
                    ctx.set(core.thread_switch_req, 1)
                    ctx.set(core.thread_switch_index, 5)
                if failure == "bad_original":
                    mem[0x48] ^= 1  # original slot-4 seal, never Boot slot-4
            rd = ctx.get(core.dmem_addr) if ctx.get(core.dmem_rd_en) else None
            data = mem.get(rd, 0)
            if ctx.get(core.dmem_wr_en):
                a, v = ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data)
                if fault:
                    writes.append((a, v))
                if not denied:
                    mem[a] = v
            if ctx.get(core.fault_entry_active):
                assert not (ctx.get(core.model_change.cr_wr_en) and
                            ctx.get(core.model_change.cr_wr_addr) == 13)
            if ctx.get(core.fault_catastrophic):
                assert failure not in (None, "save_grant", "delayed", "pending_m6"), (cycle, fault, writes[-8:])
                for _ in range(5):
                    await ctx.tick()
                    assert not ctx.get(core.dmem_wr_en)
                    assert not ctx.get(core.dmem_rd_en)
                    assert ctx.get(core.fault_catastrophic)
                return
            if ctx.get(core.fault_entry_done):
                assert pc == 0xa004
                assert ctx.get(core.debug_cr_words[12][0]) == 0x02050002
                assert ctx.get(core.debug_cr_words[15][0]) == 0x02030001
                assert ctx.get(core.debug_dr_words[1]) == fault[1]
                assert ctx.get(core.debug_dr_words[2]) == fault[0]
                assert ctx.get(core.debug_dr_words[4]) == (0x07130070 if failure == "delayed" else 0xf7000000)
                assert ctx.get(core.debug_dr_words[3]) == (2 if failure == "save_grant" else 1)
                assert ctx.get(core.debug_dr_words[5]) == (29 if failure == "save_grant" else 0)
                assert ctx.get(core.debug_cr_words[1][0]) == 0x02070004
                assert ctx.get(core.debug_cr_words[1][1]) == 0x3000
                assert ctx.get(core.debug_cr_words[2][1]) == 0
                assert writes[0][0] == 0x9000 + 245 * 4
                outgoing = [a for a, _ in writes if 0x3000 <= a < 0x3400]
                assert len(outgoing) == len(set(outgoing))
                return
            await ctx.tick()
            ctx.set(core.boot_start, 0)
            missing = (failure == "stash_response" and rd == 0x93d4 or
                       failure == "activation_response" and
                       ctx.get(core.fault_entry_active) and
                       not ctx.get(core.fault_source_frozen))
            ctx.set(core.dmem_rd_valid, rd is not None and not missing)
            ctx.set(core.dmem_rd_data, data ^ (1 if failure == "stash_mismatch" and rd == 0x93d4 else 0))
        raise AssertionError(("no Boot entry", fault, hex(pc), writes[-8:]))
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("control", ["none", "debug", "upload_race", "catastrophic", "breakpoint"])
def test_full_wrapper_continues_without_bridge(control):
    from hardware.wukong_top import ChurchWukongXC7A100T
    from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches
    _, words, binding = fault_fixture(control == "catastrophic")
    _install_amaranth_elaboration_caches()
    top = ChurchWukongXC7A100T(
        clk_freq=80, baud=10, sim_mode=True, sim_dmem_init=False,
        expected_boot_guard=GUARD, sim_boot_image_words=words, fault_boot_binding=binding)
    sim = Simulator(top)
    sim.add_clock(1e-6)
    async def bench(ctx):
        core = top.model_core
        fault_seen, boot_seen, progress = False, False, []
        serial = list(b"b\x00\x00\x40\x08") if control == "breakpoint" else []
        held_checked = False
        evidence_captured = False
        async def send(byte):
            for bit in [0] + [(byte >> i) & 1 for i in range(8)] + [1]:
                ctx.set(top.uart_rx_pin, bit)
                for _ in range(8):
                    await ctx.tick()
        # Commands use the physical serial input, never by forcing a
        # register, NIA, trace bypass, skip, reset or bridge-g approval.
        for _ in range(60000):
            evidence_captured |= bool(ctx.get(core.fault_evidence_captured))
            if ctx.get(core.retire_valid):
                pc = ctx.get(core.retire_nia)
                if ctx.get(core.retire_fault_valid):
                    assert not fault_seen or control == "catastrophic", (hex(pc), ctx.get(core.fault))
                    fault_seen = True
                    if control in ("debug", "upload_race"):
                        serial.extend([ord("h"), 0x55] if control == "debug" else [ord("u")])
                if 0xa004 <= pc <= 0xa008:
                    boot_seen = True
                if pc == 0xc004:
                    progress.append(pc)
                    if len(progress) == 3:
                        assert fault_seen and boot_seen
                        assert ctx.get(core.active_thread_slot) == 4
                        assert ctx.get(core.debug_dr_words[10]) >= 2
                        assert evidence_captured
                        if control in ("debug", "breakpoint"):
                            assert held_checked
                        return
            if ctx.get(core.fault_entry_done) and control in ("debug", "breakpoint"):
                assert ctx.get(top.step_halted)
                for _ in range(200):
                    await ctx.tick()
                    assert ctx.get(top.step_halted)
                    assert not ctx.get(core.retire_valid)
                held_checked = True
                await send(ord("r"))
            if control == "upload_race":
                assert ctx.get(top.dbg_upload_state) == 0
            if ctx.get(core.fault_catastrophic):
                assert control == "catastrophic"
                levels = set()
                for _ in range(240):
                    levels.add(ctx.get(top.led[1]))
                    assert not ctx.get(core.retire_valid)
                    assert not ctx.get(core.dmem_wr_en)
                    await ctx.tick()
                assert levels == {0, 1}
                return
            if serial:
                await send(serial.pop(0))
            await ctx.tick()
        raise AssertionError((fault_seen, boot_seen, progress, hex(ctx.get(core.nia))))
    sim.add_testbench(bench)
    sim.run()


def test_full_wrapper_has_no_combinational_acceptance_cycle():
    from amaranth.back import rtlil
    from hardware.wukong_top import ChurchWukongXC7A100T
    from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches
    _, words, binding = fault_fixture()
    _install_amaranth_elaboration_caches()
    top = ChurchWukongXC7A100T(
        clk_freq=80, baud=10, sim_mode=True, sim_dmem_init=False,
        expected_boot_guard=GUARD, sim_boot_image_words=words, fault_boot_binding=binding)
    # Local Amaranth netlist only: no vendor synthesis, files or board access.
    assert "module" in rtlil.convert(top, ports=[top.uart_tx_pin, top.uart_rx_pin, *top.led])


def test_halt_nonce_on_initial_fault_edge_keeps_reason_two_evidence():
    """Calibrate timing, then drive actual RX bits to the same fault edge."""
    from hardware.uart_rx import UartRx
    from hardware.wukong_top import ChurchWukongXC7A100T
    from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches
    _install_amaranth_elaboration_caches()
    _, words, binding = fault_fixture()

    def bit_at(cycle, start, byte):
        bit = (cycle - start) // 8
        return ([0] + [(byte >> i) & 1 for i in range(8)] + [1])[bit] if 0 <= bit < 10 else 1

    latency = []
    receiver = UartRx(clk_freq=80, baud=10)
    sim = Simulator(receiver)
    sim.add_clock(1e-6)
    async def calibrate_uart(ctx):
        for cycle in range(100):
            ctx.set(receiver.rx, bit_at(cycle, 0, 0x55))
            if ctx.get(receiver.valid):
                assert ctx.get(receiver.data) == 0x55
                latency.append(cycle)
                return
            await ctx.tick()
        raise AssertionError("UART did not decode calibration nonce")
    sim.add_testbench(calibrate_uart)
    sim.run()

    fault_cycles = []
    for race in (False, True):
        top = ChurchWukongXC7A100T(
            clk_freq=80, baud=10, sim_mode=True, sim_dmem_init=False,
            expected_boot_guard=GUARD, sim_boot_image_words=words, fault_boot_binding=binding)
        sim = Simulator(top)
        sim.add_clock(1e-6)
        async def bench(ctx):
            core = top.model_core
            coincident = captured = False
            for cycle in range(30000):
                if race:
                    nonce_start = fault_cycles[0] - latency[0]
                    ctx.set(top.uart_rx_pin,
                            bit_at(cycle, nonce_start - 100, ord("h")) &
                            bit_at(cycle, nonce_start, 0x55))
                if ctx.get(core.retire_valid) and ctx.get(core.retire_fault_valid):
                    if not race:
                        fault_cycles.append(cycle)
                        return
                    assert cycle == fault_cycles[0]
                    assert ctx.get(top.sim_uart_rx.valid)
                    assert ctx.get(top.sim_uart_rx.data) == 0x55
                    assert not ctx.get(core.fault_entry_active)
                    coincident = True
                captured |= bool(ctx.get(core.fault_evidence_captured))
                assert not ctx.get(core.fault_catastrophic)
                if ctx.get(core.fault_entry_done):
                    assert coincident and captured
                    assert ctx.get(core.nia) == 0xa004
                    assert ctx.get(core.debug_dr_words[2]) == 0x4008
                    assert ctx.get(core.debug_dr_words[4]) == 0xf7000000
                    assert ctx.get(top.step_halted)
                    for _ in range(100):
                        await ctx.tick()
                        assert ctx.get(top.step_halted)
                        assert not ctx.get(core.retire_valid)
                    return
                await ctx.tick()
            raise AssertionError(("fault evidence capture/activation stalled", race, coincident, captured))
        sim.add_testbench(bench)
        sim.run()
