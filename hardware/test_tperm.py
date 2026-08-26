"""Focused hardware regressions for strict ordinary TPERM checks.

The standalone TPERM unit is exercised directly so these tests can observe
the architectural result and write-enable without involving the full boot
ladder.  A same-domain mismatch must complete with Z=0 and no CR write;
cross-domain requests must instead enter the DOMAIN_PURITY fault path.
"""

from amaranth.sim import Simulator

from .hw_types import FaultType, GT_TYPE_INFORM
from .tperm import ChurchTperm


def _gt(dom, perm):
    """Build a v2 GT word with Inform type, sequence 0, and slot 1."""
    return (
        1
        | (GT_TYPE_INFORM << 25)
        | ((dom & 1) << 27)
        | ((perm & 0x7) << 28)
    )


def _run(target_gt, preset):
    dut = ChurchTperm()
    result = {"complete": False, "fault": False, "fault_type": None, "writes": 0}

    async def testbench(ctx):
        ctx.set(dut.preset, preset)
        ctx.set(dut.cr_target, 0)
        ctx.set(dut.cr_rd_data, {
            "word0_gt": {
                "slot_id": target_gt & 0xFFFF,
                "gt_seq": (target_gt >> 16) & 0x1FF,
                "gt_type": (target_gt >> 25) & 0x3,
                "dom": (target_gt >> 27) & 1,
                "perm": (target_gt >> 28) & 0x7,
                "b_flag": (target_gt >> 31) & 1,
            },
            "word1_location": 0,
            "word2_w2": 0,
        })
        ctx.set(dut.tperm_start, 1)
        await ctx.tick()  # IDLE -> READ_CR
        ctx.set(dut.tperm_start, 0)

        for _ in range(6):
            await ctx.tick()
            result["writes"] += int(ctx.get(dut.cr_wr_en))
            if ctx.get(dut.tperm_complete):
                result["complete"] = True
                result["z"] = int(ctx.get(dut.tperm_z_result))
            if ctx.get(dut.tperm_fault):
                result["fault"] = True
                result["fault_type"] = ctx.get(dut.fault_type)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()
    return result


def test_exact_r_passes_without_rewriting():
    result = _run(_gt(0, 0b001), 1)  # R
    assert result == {
        "complete": True,
        "fault": False,
        "fault_type": None,
        "writes": 1,
        "z": 1,
    }


def test_same_domain_extra_permission_is_z0_without_write():
    result = _run(_gt(0, 0b011), 1)  # RW target, R request
    assert result["complete"] and result["z"] == 0
    assert not result["fault"]
    assert result["writes"] == 0


def test_same_domain_missing_permission_is_z0_without_write():
    result = _run(_gt(0, 0b001), 2)  # R target, RW request
    assert result["complete"] and result["z"] == 0
    assert not result["fault"]
    assert result["writes"] == 0


def test_exact_church_multi_permission_passes():
    result = _run(_gt(1, 0b011), 9)  # LS
    assert result["complete"] and result["z"] == 1
    assert not result["fault"]


def test_cross_domain_request_faults_before_permission_mismatch():
    result = _run(_gt(1, 0b100), 3)  # Church E target, Turing X request
    assert result["fault"]
    assert result["fault_type"] == FaultType.DOMAIN_PURITY
    assert not result["complete"]
    assert result["writes"] == 0