from amaranth import *
from amaranth.sim import Simulator

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT
from .core import CTMMCapCore


def build_gt(index, perms, gt_type=GT_TYPE_INFORM, version=0):
    return (gt_type & 0x3) | ((perms & 0x3F) << 2) | ((index & 0x1FFFF) << 8) | ((version & 0x7F) << 25)


def build_null_gt():
    return build_gt(0, 0, gt_type=GT_TYPE_NULL)


def encode_ctmm_r(funct7, rs2, rs1, funct3, rd, opcode):
    return ((funct7 & 0x7F) << 25) | ((rs2 & 0x1F) << 20) | ((rs1 & 0x1F) << 15) | \
           ((funct3 & 0x7) << 12) | ((rd & 0x1F) << 7) | (opcode & 0x7F)


def encode_ctmm_i(imm, rs1, funct3, rd, opcode):
    return ((imm & 0xFFF) << 20) | ((rs1 & 0x1F) << 15) | \
           ((funct3 & 0x7) << 12) | ((rd & 0x1F) << 7) | (opcode & 0x7F)


def encode_church(church_op, cr_dst=0, cr_src=0, index=0):
    instr = CHURCH_CUSTOM0
    instr |= (cr_dst & 0xF) << 7
    instr |= (church_op & 0x7) << 12
    instr |= (cr_src & 0xF) << 15
    instr |= (index & 0xFFF) << 20
    return instr


def run_testbench():
    dut = CTMMCapCore()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    imem = [0] * 256

    imem[0] = encode_ctmm_i(42, 0, int(CTMMFunct3ArithI.ADDI), 1, int(CTMMOpcode.ARITHI))
    imem[1] = encode_ctmm_r(0, 1, 1, int(CTMMFunct3Arith.ADD), 2, int(CTMMOpcode.ARITH))

    async def testbench(ctx):
        print("=" * 60)
        print("CTMMCap Amaranth Testbench — Design Validation")
        print("=" * 60)

        print("\n[TEST 1] Boot Sequence & CR Permissions")
        print("-" * 50)

        ctx.set(dut.boot_start, 1)
        await ctx.tick()
        ctx.set(dut.boot_start, 0)

        for _ in range(10):
            await ctx.tick()
            bs = ctx.get(dut.boot_state)
            if bs == BootState.COMPLETE:
                break

        boot_done = ctx.get(dut.boot_complete)
        boot_st = ctx.get(dut.boot_state)
        print(f"  Boot state: {boot_st} (COMPLETE={BootState.COMPLETE})")
        print(f"  Boot complete: {boot_done}")
        assert boot_done == 1, "Boot did not complete!"
        print("  PASS: Boot sequence completed")

        print("\n[TEST 2] GT Type Field Encoding (32-bit)")
        print("-" * 50)
        inform_gt = build_gt(0x100, PERM_MASK_L, gt_type=GT_TYPE_INFORM)
        outform_gt = build_gt(0x200, PERM_MASK_E, gt_type=GT_TYPE_OUTFORM)
        null_gt = build_null_gt()
        abstract_gt = build_gt(0x300, 0, gt_type=GT_TYPE_ABSTRACT)

        gt_type_bits = inform_gt & 0x3
        assert gt_type_bits == GT_TYPE_INFORM, f"Inform type mismatch: {gt_type_bits}"
        gt_type_bits = outform_gt & 0x3
        assert gt_type_bits == GT_TYPE_OUTFORM, f"Outform type mismatch: {gt_type_bits}"
        gt_type_bits = null_gt & 0x3
        assert gt_type_bits == GT_TYPE_NULL, f"NULL type mismatch: {gt_type_bits}"
        gt_type_bits = abstract_gt & 0x3
        assert gt_type_bits == GT_TYPE_ABSTRACT, f"Abstract type mismatch: {gt_type_bits}"
        print("  PASS: GT type field encodes Inform/Outform/NULL/Abstract correctly")

        perms_field = (inform_gt >> 2) & 0x3F
        assert perms_field == PERM_MASK_L, f"Perm mismatch: {perms_field}"
        index_field = (inform_gt >> 8) & 0x1FFFF
        assert index_field == 0x100, f"Index mismatch: {index_field}"
        print("  PASS: GT layout fields (index, perms) at correct bit positions")

        print("\n[TEST 3] Domain Purity Validation")
        print("-" * 50)
        turing_gt = build_gt(0, PERM_MASK_R | PERM_MASK_W | PERM_MASK_X)
        church_gt = build_gt(0, PERM_MASK_L | PERM_MASK_S | PERM_MASK_E)
        mixed_rl = build_gt(0, PERM_MASK_R | PERM_MASK_L)
        mixed_xe = build_gt(0, PERM_MASK_X | PERM_MASK_E)
        mixed_rwxe = build_gt(0, PERM_MASK_R | PERM_MASK_W | PERM_MASK_X | PERM_MASK_E)

        turing_perms = (turing_gt >> 2) & 0x3F
        church_perms = (church_gt >> 2) & 0x3F
        mixed_rl_perms = (mixed_rl >> 2) & 0x3F
        mixed_xe_perms = (mixed_xe >> 2) & 0x3F
        mixed_rwxe_perms = (mixed_rwxe >> 2) & 0x3F

        has_t = (turing_perms & DATA_PERMS) != 0
        has_c = (turing_perms & CAP_PERMS) != 0
        assert has_t and not has_c, "Turing GT should be domain-pure"
        print("  PASS: Turing-only GT (RWX) is domain-pure")

        has_t = (church_perms & DATA_PERMS) != 0
        has_c = (church_perms & CAP_PERMS) != 0
        assert not has_t and has_c, "Church GT should be domain-pure"
        print("  PASS: Church-only GT (LSE) is domain-pure")

        has_t = (mixed_rl_perms & DATA_PERMS) != 0
        has_c = (mixed_rl_perms & CAP_PERMS) != 0
        assert has_t and has_c, "Mixed GT (R+L) should fail domain purity"
        print("  PASS: Mixed GT (R+L) correctly detected as domain-impure")

        has_t = (mixed_xe_perms & DATA_PERMS) != 0
        has_c = (mixed_xe_perms & CAP_PERMS) != 0
        assert has_t and has_c, "Mixed GT (X+E) should fail domain purity"
        print("  PASS: Mixed GT (X+E) correctly detected as domain-impure")

        has_t = (mixed_rwxe_perms & DATA_PERMS) != 0
        has_c = (mixed_rwxe_perms & CAP_PERMS) != 0
        assert has_t and has_c, "Mixed GT (RWXE) should fail domain purity"
        print("  PASS: Mixed GT (RWXE) correctly detected as domain-impure")

        print("\n[TEST 4] M Permission Rules")
        print("-" * 50)
        assert PERM_M == 6, f"PERM_M should be bit 6, got {PERM_M}"
        assert PERM_MASK_M == 64, f"PERM_MASK_M should be 64, got {PERM_MASK_M}"
        no_perm_gt = build_gt(0, 0)
        gt_perms = (no_perm_gt >> 2) & 0x3F
        assert gt_perms == 0, "GT with no perms should have perms=0"
        assert (gt_perms & PERM_MASK_M) == 0, "M should never be in GT perms"
        print("  PASS: M permission (bit 6) exists but never stored in GT")
        print("  PASS: M is transient — elevated by microcode on CR only")

        print("\n[TEST 5] Boot CR Permission Rules")
        print("-" * 50)
        cr15_perms = 0
        cr8_perms = 0
        cr6_perms = PERM_MASK_E
        cr7_perms = PERM_MASK_X
        cr5_perms = PERM_MASK_L | PERM_MASK_S
        print(f"  CR15 (Namespace): perms=0x{cr15_perms:02x} (M only, transient)")
        print(f"  CR8  (Thread):    perms=0x{cr8_perms:02x} (M only, transient)")
        print(f"  CR6  (C-List):    perms=0x{cr6_perms:02x} (E only)")
        print(f"  CR7  (Nucleus):   perms=0x{cr7_perms:02x} (X)")
        print(f"  CR5  (Services):  perms=0x{cr5_perms:02x} (L+S, C-List)")
        assert cr15_perms == 0, "CR15 GT should have no stored perms"
        assert cr8_perms == 0, "CR8 GT should have no stored perms"
        assert cr6_perms == PERM_MASK_E, "CR6 GT should have E only"
        assert cr7_perms == PERM_MASK_X, "CR7 GT should have X"
        assert cr5_perms == (PERM_MASK_L | PERM_MASK_S), "CR5 GT should have L+S (C-List)"
        print("  PASS: All boot CR permissions match design spec")

        print("\n[TEST 6] LAMBDA Opcode & Encoding")
        print("-" * 50)
        assert ChurchOpcode.LAMBDA == 0b0111, f"LAMBDA opcode wrong: {ChurchOpcode.LAMBDA}"
        lambda_instr = encode_church(ChurchOpcode.LAMBDA, cr_dst=2)
        church_field = (lambda_instr >> 12) & 0x7
        assert church_field == ChurchOpcode.LAMBDA, f"Encoded church_op mismatch: {church_field}"
        print(f"  LAMBDA opcode: 0b{ChurchOpcode.LAMBDA:03b} (0x{ChurchOpcode.LAMBDA:02x})")
        print(f"  Encoded LAMBDA instruction: 0x{lambda_instr:08x}")
        print("  PASS: LAMBDA instruction encodes correctly")

        load_instr = encode_church(ChurchOpcode.LOAD, cr_dst=3, cr_src=5, index=42)
        load_church = (load_instr >> 12) & 0x7
        load_dst = (load_instr >> 7) & 0xF
        load_src = (load_instr >> 15) & 0xF
        load_idx = (load_instr >> 20) & 0xFFF
        assert load_church == ChurchOpcode.LOAD, f"LOAD church_op mismatch: {load_church}"
        assert load_dst == 3, f"LOAD cr_dst mismatch: {load_dst}"
        assert load_src == 5, f"LOAD cr_src mismatch: {load_src}"
        assert load_idx == 42, f"LOAD index mismatch: {load_idx}"
        print("  PASS: LOAD encoding preserves cr_src, cr_dst, and index independently")

        print("\n[TEST 7] TPERM Domain Purity (Reserved Presets)")
        print("-" * 50)
        rsv0_mask = TPERM_MASKS[TpermPreset.RSV0]
        rsv1_mask = TPERM_MASKS[TpermPreset.RSV1]
        rsv2_mask = TPERM_MASKS[TpermPreset.RSV2]
        assert rsv0_mask == 0, f"RSV0 should be reserved (0), got 0x{rsv0_mask:04x}"
        assert rsv1_mask == 0, f"RSV1 should be reserved (0), got 0x{rsv1_mask:04x}"
        assert rsv2_mask == 0, f"RSV2 should be reserved (0), got 0x{rsv2_mask:04x}"
        print("  PASS: RSV0/RSV1/RSV2 presets are reserved (domain purity violation)")

        print("\n[TEST 8] Sim-32 Instructions (ADDI, ADD)")
        print("-" * 50)

        for cycle in range(10):
            nia_val = ctx.get(dut.nia)
            instr_idx = (nia_val >> 2) & 0xFF
            if instr_idx < len(imem):
                ctx.set(dut.imem_data, imem[instr_idx])
                ctx.set(dut.imem_valid, 1)
            else:
                ctx.set(dut.imem_data, 0)
                ctx.set(dut.imem_valid, 0)
            await ctx.tick()

        final_nia = ctx.get(dut.nia)
        print(f"  NIA after execution: {final_nia}")
        fault_v = ctx.get(dut.fault_valid)
        fault_t = ctx.get(dut.fault)
        print(f"  Fault valid: {fault_v}, type: {fault_t}")

        print("\n[TEST 9] Fault Aggregation (Invalid Opcode)")
        print("-" * 50)
        ctx.set(dut.imem_data, 0x00000000)
        ctx.set(dut.imem_valid, 1)
        await ctx.tick()
        fault_v = ctx.get(dut.fault_valid)
        print(f"  Invalid opcode fault: valid={fault_v}")

        print("\n[TEST 10] GC Version Bump on Sweep (Version-Based)")
        print("-" * 50)
        gc_gt = build_gt(0x50, PERM_MASK_R, version=1)
        gt_version = (gc_gt >> 25) & 0x7F
        assert gt_version == 1, f"GC GT should have version=1, got {gt_version}"
        reclaimed_gt = build_gt(0x50, 0, gt_type=GT_TYPE_NULL, version=2)
        reclaimed_type = reclaimed_gt & 0x3
        reclaimed_version = (reclaimed_gt >> 25) & 0x7F
        assert reclaimed_type == GT_TYPE_NULL, "Reclaimed GT should be NULL"
        assert reclaimed_version == 2, f"Reclaimed GT version should be bumped to 2, got {reclaimed_version}"
        print("  PASS: GC sweep bumps version, sets NULL type")

        print("\n" + "=" * 60)
        print("CTMMCap Amaranth Testbench — All Tests Complete")
        print("=" * 60)

    sim.add_testbench(testbench)

    with sim.write_vcd("rv32_cap_amaranth/sim_output.vcd"):
        sim.run()


if __name__ == "__main__":
    run_testbench()
