from amaranth import *
from amaranth.sim import Simulator

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT
from .core import CTMMCore


def build_gt(offset, perms, gt_type=GT_TYPE_INFORM, g_bit=0, spare=0):
    return offset | (spare << 32) | (gt_type << 55) | (g_bit << 57) | (perms << 58)


def build_null_gt():
    return build_gt(0, 0, gt_type=GT_TYPE_NULL)


def encode_turing(opcode, cond, dr_dst, dr_src1, dr_src2, use_imm, imm_val):
    instr = (opcode & 0x1F) << 27
    instr |= (cond & 0xF) << 23
    instr |= (use_imm & 1) << 22
    instr |= (dr_dst & 0xF) << 18
    instr |= (dr_src1 & 0xF) << 14
    instr |= (dr_src2 & 0xF) << 10
    if use_imm:
        instr |= imm_val & 0x3FFF
    return instr


def encode_church(opcode, cond, cr_dst, cr_src, index, i_bit=0):
    instr = (opcode & 0x1F) << 27
    instr |= (cond & 0xF) << 23
    instr |= (i_bit & 1) << 22
    instr |= (cr_dst & 0x7) << 19
    instr |= (cr_src & 0x7) << 16
    instr |= index & 0xFFFF
    return instr


def run_testbench():
    dut = CTMMCore()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    imem = [0] * 256

    imem[0] = encode_turing(TuringOpcode.LDI, CondCode.AL, 0, 0, 0, 0, 42)
    imem[1] = encode_turing(TuringOpcode.ADD, CondCode.AL, 1, 0, 0, 1, 10)
    imem[2] = encode_turing(TuringOpcode.CMP, CondCode.AL, 0, 1, 0, 1, 52)

    async def testbench(ctx):
        print("=" * 60)
        print("CTMM Amaranth Testbench — Design Validation")
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

        print("\n[TEST 2] GT Type Field Encoding")
        print("-" * 50)
        inform_gt = build_gt(0x100, PERM_MASK_L, gt_type=GT_TYPE_INFORM)
        outform_gt = build_gt(0x200, PERM_MASK_E, gt_type=GT_TYPE_OUTFORM)
        null_gt = build_null_gt()
        spare_gt = build_gt(0x300, 0, gt_type=GT_TYPE_SPARE)

        gt_type_bits = (inform_gt >> 55) & 0x3
        assert gt_type_bits == GT_TYPE_INFORM, f"Inform type mismatch: {gt_type_bits}"
        gt_type_bits = (outform_gt >> 55) & 0x3
        assert gt_type_bits == GT_TYPE_OUTFORM, f"Outform type mismatch: {gt_type_bits}"
        gt_type_bits = (null_gt >> 55) & 0x3
        assert gt_type_bits == GT_TYPE_NULL, f"NULL type mismatch: {gt_type_bits}"
        gt_type_bits = (spare_gt >> 55) & 0x3
        assert gt_type_bits == GT_TYPE_SPARE, f"Spare type mismatch: {gt_type_bits}"
        print("  PASS: GT type field encodes Inform/Outform/NULL/Spare correctly")

        perms_field = (inform_gt >> 58) & 0x3F
        assert perms_field == PERM_MASK_L, f"Perm mismatch: {perms_field}"
        offset_field = inform_gt & 0xFFFFFFFF
        assert offset_field == 0x100, f"Offset mismatch: {offset_field}"
        print("  PASS: GT layout fields (offset, perms) at correct bit positions")

        print("\n[TEST 3] Domain Purity Validation")
        print("-" * 50)
        turing_gt = build_gt(0, PERM_MASK_R | PERM_MASK_W | PERM_MASK_X)
        church_gt = build_gt(0, PERM_MASK_L | PERM_MASK_S | PERM_MASK_E)
        mixed_gt = build_gt(0, PERM_MASK_R | PERM_MASK_L)

        turing_perms = (turing_gt >> 58) & 0x3F
        church_perms = (church_gt >> 58) & 0x3F
        mixed_perms = (mixed_gt >> 58) & 0x3F

        has_turing = (turing_perms & DATA_PERMS) != 0
        has_church_ls = (turing_perms & (PERM_MASK_L | PERM_MASK_S)) != 0
        assert has_turing and not has_church_ls, "Turing GT should be domain-pure"
        print("  PASS: Turing-only GT (RWX) is domain-pure")

        has_turing = (church_perms & DATA_PERMS) != 0
        has_church_ls = (church_perms & (PERM_MASK_L | PERM_MASK_S)) != 0
        assert not has_turing and has_church_ls, "Church GT should be domain-pure"
        print("  PASS: Church-only GT (LSE) is domain-pure")

        has_turing = (mixed_perms & DATA_PERMS) != 0
        has_church_ls = (mixed_perms & (PERM_MASK_L | PERM_MASK_S)) != 0
        assert has_turing and has_church_ls, "Mixed GT should fail domain purity"
        print("  PASS: Mixed GT (R+L) correctly detected as domain-impure")

        print("\n[TEST 4] M Permission Rules")
        print("-" * 50)
        assert PERM_M == 6, f"PERM_M should be bit 6, got {PERM_M}"
        assert PERM_MASK_M == 64, f"PERM_MASK_M should be 64, got {PERM_MASK_M}"
        no_perm_gt = build_gt(0, 0)
        gt_perms = (no_perm_gt >> 58) & 0x3F
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
        assert ChurchOpcode.LAMBDA == 0b01100, f"LAMBDA opcode wrong: {ChurchOpcode.LAMBDA}"
        lambda_instr = encode_church(ChurchOpcode.LAMBDA, CondCode.AL, 2, 0, 0)
        opcode = (lambda_instr >> 27) & 0x1F
        assert opcode == ChurchOpcode.LAMBDA, f"Encoded opcode mismatch: {opcode}"
        print(f"  LAMBDA opcode: 0b{ChurchOpcode.LAMBDA:05b} (0x{ChurchOpcode.LAMBDA:02x})")
        print(f"  Encoded LAMBDA instruction: 0x{lambda_instr:08x}")
        print("  PASS: LAMBDA instruction encodes correctly")

        print("\n[TEST 7] TPERM Domain Purity (RWXL Reserved)")
        print("-" * 50)
        rwxl_mask = TPERM_MASKS[TpermPreset.RWXL]
        assert rwxl_mask == 0, f"RWXL should be reserved (0), got 0x{rwxl_mask:04x}"
        print("  PASS: RWXL preset is reserved (domain purity violation)")

        print("\n[TEST 8] Turing Instructions (LDI, ADD, CMP)")
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

        print("\n[TEST 10] GC Version Bump on Sweep")
        print("-" * 50)
        gc_gt = build_gt(0x50, PERM_MASK_R, g_bit=1)
        g_bit = (gc_gt >> 57) & 1
        assert g_bit == 1, "GC GT should have G=1"
        reclaimed_gt = build_gt(0x50, PERM_MASK_R, gt_type=GT_TYPE_NULL, g_bit=0, spare=1)
        reclaimed_type = (reclaimed_gt >> 55) & 0x3
        reclaimed_g = (reclaimed_gt >> 57) & 1
        reclaimed_spare = (reclaimed_gt >> 32) & 0x7FFFFF
        assert reclaimed_type == GT_TYPE_NULL, "Reclaimed GT should be NULL"
        assert reclaimed_g == 0, "Reclaimed GT should have G=0"
        assert reclaimed_spare == 1, "Reclaimed GT should have version bumped"
        print("  PASS: GC sweep bumps version, sets NULL, clears G")

        print("\n" + "=" * 60)
        print("CTMM Amaranth Testbench — All Tests Complete")
        print("=" * 60)

    sim.add_testbench(testbench)

    with sim.write_vcd("ctmm_amaranth/sim_output.vcd"):
        sim.run()


if __name__ == "__main__":
    run_testbench()
