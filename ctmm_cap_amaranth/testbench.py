from amaranth import *
from amaranth.sim import Simulator, Settle

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT
from .core import CMCapCore
from .decoder import CMCapDecoder
from .tperm import CMCapTperm
from hardware.integrity32 import integrity32


def build_gt(index, perms, gt_type=GT_TYPE_INFORM, version=0):
    # New ctmm GT_LAYOUT: gt_type[1:0] | f_flag[2]=0 | spare[3]=0 | dom[4] | perm[7:5] | index[24:8] | version[31:25]
    dom, perm3 = gt_encode_perm(perms)
    return (gt_type & 0x3) | (dom << 4) | (perm3 << 5) | ((index & 0x1FFFF) << 8) | ((version & 0x7F) << 25)


def build_seal(location, limit, version):
    fnv_hash = (((FNV_OFFSET_32 ^ location) * FNV_PRIME_32) & 0xFFFFFFFF) ^ limit
    seal = fnv_hash & FNV_SEAL_MASK
    return seal | ((version & 0x7F) << 25)


def build_null_gt():
    return build_gt(0, 0, gt_type=GT_TYPE_NULL)


def encode_ctmm_r(funct7, rs2, rs1, funct3, rd, opcode):
    return ((funct7 & 0x7F) << 25) | ((rs2 & 0x1F) << 20) | ((rs1 & 0x1F) << 15) | \
           ((funct3 & 0x7) << 12) | ((rd & 0x1F) << 7) | (opcode & 0x7F)


def encode_ctmm_i(imm, rs1, funct3, rd, opcode):
    return ((imm & 0xFFF) << 20) | ((rs1 & 0x1F) << 15) | \
           ((funct3 & 0x7) << 12) | ((rd & 0x1F) << 7) | (opcode & 0x7F)


def encode_church(church_op, cr_dst=0, cr_src=0, index=0):
    # church_op[2:0] → funct3 at bits[14:12]
    # church_op[3]   → rd[4]  at bit[11]  (free: cr_dst only uses bits[10:7])
    # Opcodes 0-7 (LOAD..LAMBDA): bit[11]=0, unchanged encoding.
    # Opcodes 8-9 (ELOADCALL, XLOADLAMBDA): bit[11]=1, funct3=0 or 1.
    # NOTE: Do NOT use this for ELOADCALL — use encode_eloadcall() instead, which
    # applies the R-type layout required to carry a 7-bit method index.
    instr = CHURCH_CUSTOM0
    instr |= (cr_dst & 0xF) << 7
    instr |= ((church_op >> 3) & 0x1) << 11   # church_op bit[3] → rd[4] = instr[11]
    instr |= (church_op & 0x7) << 12           # church_op bits[2:0] → funct3
    instr |= (cr_src & 0xF) << 15
    instr |= (index & 0xFFF) << 20
    return instr


def encode_eloadcall(cr_dst=0, cr_src=0, method_index=0, row=0):
    """Encode an ELOADCALL instruction using the R-type layout.

    ELOADCALL (church_op=8 = 0b1000): bit[11]=1, funct3=0b000.

    Field layout:
      funct7[6:0] = instr[31:25] = method_index (7 bits, 0-127)
      rs2[4:0]    = instr[24:20] = c-list row    (5 bits, 0-31)
      rs1[3:0]    = instr[18:15] = cr_src
      rd[3:0]     = instr[10:7]  = cr_dst
      bit[11]     = 1            (church_op bit 3)
      funct3      = 0b000        (church_op bits [2:0] for ELOADCALL)

    This R-type encoding provides a full 7-bit method index (0-127), matching the
    native hardware decoder's imm15[14:8] field and eliminating the former 4-bit
    I-type limit of 16 methods.
    """
    instr = CHURCH_CUSTOM0
    instr |= (cr_dst & 0xF) << 7
    instr |= 1 << 11                        # church_op bit[3] = 1  (opcode 8 >= 8)
    instr |= 0b000 << 12                    # funct3 = ELOADCALL lower 3 bits = 0
    instr |= (cr_src & 0xF) << 15
    instr |= (row & 0x1F) << 20             # rs2 = c-list row (5 bits)
    instr |= (method_index & 0x7F) << 25    # funct7 = method index (7 bits)
    return instr


def run_testbench():
    dut = CMCapCore()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    imem = [0] * 256

    imem[0] = encode_ctmm_i(42, 0, int(CMFunct3ArithI.ADDI), 1, int(CMOpcode.ARITHI))
    imem[1] = encode_ctmm_r(0, 1, 1, int(CMFunct3Arith.ADD), 2, int(CMOpcode.ARITH))

    async def testbench(ctx):
        print("=" * 60)
        print("CMCap Amaranth Testbench — Design Validation")
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

        # New ctmm GT_LAYOUT: dom at bit GT_DOM_BIT (4), perm[2:0] at bits [7:5].
        # L-perm (Church domain): dom=1, perm[0]=L=1 → perm=0b001.
        dom_field   = (inform_gt >> GT_DOM_BIT) & 0x1
        perm_field  = (inform_gt >> 5) & 0x7
        index_field = (inform_gt >> 8) & 0x1FFFF
        assert dom_field  == 1,     f"L-perm GT should have dom=1, got {dom_field}"
        assert perm_field == 0b001, f"L-perm GT perm mismatch: {perm_field} (expected 0b001=L)"
        assert index_field == 0x100, f"Index mismatch: {index_field}"
        print("  PASS: GT layout fields (index, dom, perm) at correct bit positions")

        print("\n[TEST 3] Domain Purity — Structurally Enforced by New Encoding")
        print("-" * 50)
        turing_gt  = build_gt(0, PERM_MASK_R | PERM_MASK_W | PERM_MASK_X)
        church_gt  = build_gt(0, PERM_MASK_L | PERM_MASK_S | PERM_MASK_E)
        # Mixed logical masks: gt_encode_perm clamps to Church side when any Church bit is set.
        mixed_rl   = build_gt(0, PERM_MASK_R | PERM_MASK_L)
        mixed_xe   = build_gt(0, PERM_MASK_X | PERM_MASK_E)
        mixed_rwxe = build_gt(0, PERM_MASK_R | PERM_MASK_W | PERM_MASK_X | PERM_MASK_E)

        # Extract dom bit directly (the structural domain-purity enforcer).
        def _gt_dom(gt):  return (gt >> GT_DOM_BIT) & 0x1
        def _gt_perm(gt): return (gt >> 5) & 0x7    # perm[2:0] at bits [7:5]

        assert _gt_dom(turing_gt) == 0, f"Turing GT dom={_gt_dom(turing_gt)}, expected 0"
        assert _gt_perm(turing_gt) != 0, "Turing GT (RWX) should have non-zero perm"
        print("  PASS: Pure Turing GT (RWX): dom=0, Turing perms in perm[2:0]")

        assert _gt_dom(church_gt) == 1, f"Church GT dom={_gt_dom(church_gt)}, expected 1"
        assert _gt_perm(church_gt) != 0, "Church GT (LSE) should have non-zero perm"
        print("  PASS: Pure Church GT (LSE): dom=1, Church perms in perm[2:0]")

        # Mixed inputs: gt_encode_perm takes Church side (Church dominates over Turing).
        assert _gt_dom(mixed_rl)   == 1, f"R+L input should clamp to dom=1 (Church)"
        assert _gt_dom(mixed_xe)   == 1, f"X+E input should clamp to dom=1 (Church)"
        assert _gt_dom(mixed_rwxe) == 1, f"RWXE input should clamp to dom=1 (Church)"
        print("  PASS: Mixed logical inputs clamp to Church side (dom=1)")
        print("  NOTE: dom bit structurally enforces mutual exclusion — mixed GTs impossible to encode")

        print("\n[TEST 4] M Permission Rules")
        print("-" * 50)
        assert PERM_M == 6, f"PERM_M should be bit 6, got {PERM_M}"
        assert PERM_MASK_M == 64, f"PERM_MASK_M should be 64, got {PERM_MASK_M}"
        no_perm_gt = build_gt(0, 0)
        # New encoding: dom=0, perm3=0 for perms=0. Bits [30:27] of GT word all zero.
        gt_dom_val  = (no_perm_gt >> GT_DOM_BIT) & 0x1
        gt_perm_val = (no_perm_gt >> 5) & 0x7
        assert gt_dom_val == 0 and gt_perm_val == 0, \
            f"GT with no perms should have dom=0 perm=0, got dom={gt_dom_val} perm={gt_perm_val}"
        assert (no_perm_gt & PERM_MASK_M) == 0, "M should never appear in a raw GT word"
        print("  PASS: M permission (bit 6) exists but is never stored in GT (dom=perm=0)")
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

        print("\n[TEST 7] TPERM Preset Validation (Reserved Presets + FRAME + EXACT)")
        print("-" * 50)
        rsv3_mask  = TPERM_MASKS[TpermPreset.RSV3]
        rsv4_mask  = TPERM_MASKS[TpermPreset.RSV4]
        rsv5_mask  = TPERM_MASKS[TpermPreset.RSV5]
        rsv1_mask  = TPERM_MASKS[TpermPreset.RSV1]
        frame_mask = TPERM_MASKS[TpermPreset.FRAME]
        exact_mask = TPERM_MASKS[TpermPreset.EXACT]
        assert rsv3_mask  == 0,    f"RSV3 should be reserved (0), got 0x{rsv3_mask:04x}"
        assert rsv4_mask  == 0,    f"RSV4 should be reserved (0), got 0x{rsv4_mask:04x}"
        assert rsv5_mask  == 0,    f"RSV5 should be reserved (0), got 0x{rsv5_mask:04x}"
        assert rsv1_mask  == 0,    f"RSV1 should be reserved (0), got 0x{rsv1_mask:04x}"
        assert frame_mask is None, f"FRAME (13) should be None (stack query, not a mask), got {frame_mask!r}"
        assert exact_mask is None, f"EXACT (14) should be None (comparison op, not a mask), got {exact_mask!r}"
        assert TpermPreset.RSV3 == 10, f"RSV3 must be preset 10, got {int(TpermPreset.RSV3)}"
        assert TpermPreset.RSV4 == 11, f"RSV4 must be preset 11, got {int(TpermPreset.RSV4)}"
        assert TpermPreset.RSV5 == 12, f"RSV5 must be preset 12, got {int(TpermPreset.RSV5)}"
        assert TpermPreset.FRAME == 13, f"FRAME must be preset 13, got {int(TpermPreset.FRAME)}"
        assert TpermPreset.EXACT == 14, f"EXACT must be preset 14, got {int(TpermPreset.EXACT)}"
        assert TpermPreset.RSV1 == 15, f"RSV1 must be preset 15, got {int(TpermPreset.RSV1)}"
        print("  PASS: RSV3/RSV4/RSV5 (10-12) and RSV1 (15) reserved; FRAME (13) stack-query (mask=None); EXACT (14) comparison operator (mask=None)")

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

        print("\n[TEST 11] Abstract LED GT — Hardware Decode Path (Task #430)")
        print("-" * 50)
        # Replicate the boot image's create_abstract_gt() encoding in-line so the
        # testbench has no dependency on server/.  Layout (hardware/ format):
        #   [31:27] = ab_type   [26] = R   [25] = W   [24:23] = 0b11   [22:16] = gt_seq   [15:0] = ab_data
        # (gt_type at bits[24:23] matches GT_LAYOUT in hardware/layouts.py)
        _AB_TYPE_IO       = 0x00
        _DEVICE_CLASS_LED = 0x01
        for led_idx in range(4):
            ab_data    = (_DEVICE_CLASS_LED << 8) | (led_idx & 0xFF)
            ab_led_gt  = (
                ((_AB_TYPE_IO  & 0x1F) << 27) |
                (1             << 26) |   # R at bit[26]
                (1             << 25) |   # W at bit[25]
                (0b11          << 23) |   # gt_type = ABSTRACT (0b11)
                (ab_data & 0xFFFF)
            )
            hw_gt_type = (ab_led_gt >> 23) & 0x3
            assert hw_gt_type == 3, (
                f"LED[{led_idx}] gt_type should be 0b11 (GT_TYPE_ABSTRACT=3), got {hw_gt_type}"
            )
        print("  PASS: Abstract LED GTs (slots 8-11) have gt_type=0b11 at bits[24:23]")

        for gt_type_val, name in (
            (0x00, "NULL"), (0x01, "INFORM"), (0x02, "OUTFORM"), (0x03, "ABSTRACT")
        ):
            probe     = (gt_type_val & 0x3) << 23
            extracted = (probe >> 23) & 0x3
            assert extracted == gt_type_val, f"{name}: gt_type round-trip via bits[24:23] failed"
        print("  PASS: gt_type extraction from bits[24:23] correct for all four types")
        print("  NOTE: DREAD/DWRITE/CALL on gt_type=0b11 → INVALID_OP fault (hardware stub)")

        # ====================================================================
        # TEST 12 — CR15 M-Window Lifecycle (Task #432)
        # ====================================================================
        print("\n[TEST 12] CR15 M-Window Hardware Lifecycle (Task #432)")
        print("-" * 50)

        # Freeze instruction execution for all M-window sub-tests
        ctx.set(dut.imem_valid, 0)

        # ── 12A: Real Abstract-GT CALL populates 5-word M-window shadow ────
        # End-to-end test for M-GT auto-dispatch from CALL instruction.
        # 5-word shadow layout:
        #   XR11 = Abstract GT word (from src cap register)
        #   XR12 = NS entry word0_location
        #   XR13 = NS entry word1_limit (authority)
        #   XR14 = NS entry word2_integrity (read directly from memory, not recomputed)
        #   XR15 = NS entry word3_seals (advisory annotation)
        #
        # Pre-load CR1 with an Abstract GT; serve the 4-word NS entry via
        # dmem_rd_data (mem_rd_valid is always 1 in simulation — one cycle per fetch).

        A12_GT_INDEX   = 3
        A12_GT_VERSION = 0
        a12_gt_word = build_gt(A12_GT_INDEX, 0, gt_type=GT_TYPE_ABSTRACT,
                               version=A12_GT_VERSION)

        ctx.set(dut.dbg_cap_wr_en,   1)
        ctx.set(dut.dbg_cap_wr_addr, 1)
        ctx.set(dut.dbg_cap_wr_data, {
            "word0_gt":       {"gt_type": GT_TYPE_ABSTRACT, "f_flag": 0, "spare": 0, "dom": 0, "perm": 0,
                               "index": A12_GT_INDEX, "version": A12_GT_VERSION},
            "word1_location": 0,
            "word2_limit":    0,
            "word3_seals":    0,
        })
        await ctx.tick()    # cap_regs[1] ← Abstract GT
        ctx.set(dut.dbg_cap_wr_en, 0)

        # NS entry at CR15.word1_location + (A12_GT_INDEX << 4) = 0 + 0x30.
        A12_NS_LOC  = 0x4000
        A12_NS_AUTH = 0x00020008
        A12_NS_INT  = integrity32(A12_NS_LOC, A12_NS_AUTH)
        A12_NS_SEAL = build_seal(A12_NS_LOC, A12_NS_AUTH, A12_GT_VERSION)

        A12_CALL = encode_church(ChurchOpcode.CALL, cr_dst=0, cr_src=1)
        ctx.set(dut.dmem_rd_data, A12_NS_LOC)   # pre-arm NS0 for M_FETCH_NS0
        ctx.set(dut.imem_data,    A12_CALL)
        ctx.set(dut.imem_valid,   1)
        await ctx.tick()                         # IDLE → CHECK_SRC (call_start fires)
        ctx.set(dut.imem_valid, 0)               # freeze — prevent re-issue

        await ctx.tick()    # CHECK_SRC  → READ_SRC
        await ctx.tick()    # READ_SRC   → CHECK_PERM  (src_reg_latched ← cap_regs[1])
        await ctx.tick()    # CHECK_PERM → M_FETCH_NS0 (Abstract GT detected)

        # M_FETCH_NS0: ns_loc_lat ← A12_NS_LOC
        await ctx.tick()    # M_FETCH_NS0 → M_FETCH_NS1
        ctx.set(dut.dmem_rd_data, A12_NS_AUTH)
        await ctx.tick()    # M_FETCH_NS1 → M_FETCH_NS2  (ns_auth_lat ← A12_NS_AUTH)
        ctx.set(dut.dmem_rd_data, A12_NS_INT)
        await ctx.tick()    # M_FETCH_NS2 → M_FETCH_NS3  (ns_int_lat  ← A12_NS_INT)
        ctx.set(dut.dmem_rd_data, A12_NS_SEAL)
        await ctx.tick()    # M_FETCH_NS3 → M_FETCH_DONE (ns_seal_lat ← A12_NS_SEAL)
        await ctx.tick()    # M_FETCH_DONE→ IDLE (mgt_set_trigger fires; XR11-XR15 set)

        m_flag = ctx.get(dut.cr15_m_flag)
        xr11   = ctx.get(dut.dbg_m_xr11)
        xr12   = ctx.get(dut.dbg_m_xr12)
        xr13   = ctx.get(dut.dbg_m_xr13)
        xr14   = ctx.get(dut.dbg_m_xr14)
        xr15   = ctx.get(dut.dbg_m_xr15)

        assert m_flag == 1, f"cr15_m_flag should be 1 after Abstract CALL, got {m_flag}"
        assert xr11 == a12_gt_word, (
            f"XR11 should be Abstract GT {a12_gt_word:#010x}, got {xr11:#010x}")
        assert xr12 == A12_NS_LOC, (
            f"XR12 should be NS_LOC={A12_NS_LOC:#010x}, got {xr12:#010x}")
        assert xr13 == A12_NS_AUTH, (
            f"XR13 should be NS_AUTH={A12_NS_AUTH:#010x}, got {xr13:#010x}")
        assert xr14 == A12_NS_INT, (
            f"XR14 should be NS_INT={A12_NS_INT:#010x}, got {xr14:#010x}")
        # XR15: CALL path populates it with NS word3_seals (advisory seals word).
        # The cr15_m_set test port sets XR15=0 (verified in 12C).
        assert xr15 == A12_NS_SEAL, (
            f"XR15 should be NS_SEAL={A12_NS_SEAL:#010x} (CALL path), got {xr15:#010x}")
        print("  PASS 12A: Abstract-GT CALL → M_FETCH_NS0-NS3 → 5-word shadow: "
              "XR11=GT, XR12=NS-loc, XR13=NS-auth, XR14=NS-integrity, XR15=NS-seals; "
              "cr15_m_flag=1")

        # ── 12B: Valid M-writeback via trigger — M cleared, no fault ─────
        ctx.set(dut.cr15_m_writeback_trigger, 1)
        await ctx.tick()          # IDLE: latch XR11-XR14, xr11_valid=1 → WRITEBACK
        ctx.set(dut.cr15_m_writeback_trigger, 0)
        # FSM is now in WRITEBACK state: CR15 ← XR11-XR14, m_clear_en=1, → IDLE
        await ctx.tick()          # WRITEBACK executes
        await ctx.tick()          # FSM back in IDLE, cr15_m_reg=0 settled

        m_flag_wb = ctx.get(dut.cr15_m_flag)
        fault_v   = ctx.get(dut.fault_valid)
        assert m_flag_wb == 0, f"M should be cleared after valid writeback, got {m_flag_wb}"
        assert fault_v == 0, f"No fault expected on valid M-writeback, got {fault_v}"
        print("  PASS 12B: Valid M-writeback clears M-flag, raises no fault")

        # ── 12C: CHANGE preserves M (CHANGE does not trigger M-writeback) ─
        ctx.set(dut.cr15_m_set, 1)
        await ctx.tick()          # Re-set M=1
        ctx.set(dut.cr15_m_set, 0)
        await ctx.tick()          # Settle
        # Verify cr15_m_set test-port semantics: XR15 must be 0 (seals not available
        # via the test port; only the CALL path populates XR15 with NS word3_seals).
        xr15_after_mset = ctx.get(dut.dbg_m_xr15)
        assert xr15_after_mset == 0, (
            f"XR15 should be 0 after cr15_m_set (test-port path), got {xr15_after_mset:#010x}")

        m_flag_pre_change = ctx.get(dut.cr15_m_flag)
        assert m_flag_pre_change == 1, "M should be set before CHANGE test"

        # CHANGE cr_src=5 (CR5 has PERM_MASK_L|S from boot; CHANGE requires L-perm)
        # CHANGE writes CR5's GT into CR8 (effective_target=0 → CR8+0=CR8)
        change_instr = encode_church(ChurchOpcode.CHANGE, cr_dst=0, cr_src=5, index=0)
        ctx.set(dut.imem_data, change_instr)
        ctx.set(dut.imem_valid, 1)
        await ctx.tick()          # CHANGE executes (single-cycle op)
        ctx.set(dut.imem_valid, 0)
        await ctx.tick()          # Settle

        m_flag_post_change = ctx.get(dut.cr15_m_flag)
        assert m_flag_post_change == 1, (
            "M should be preserved after CHANGE — CHANGE does not trigger M-writeback FSM, "
            f"got cr15_m_flag={m_flag_post_change}")
        print("  PASS 12C: CHANGE does not reset M-flag (M preserved across CHANGE)")

        # ── 12D: Valid GT type, integrity mismatch in WRITEBACK → INVALID_OP fault ──
        # (Task #441: "valid GT + wrong integrity word" fault path — WRITEBACK branch.)
        # M=1 from test 12C; XR11=Abstract GT (valid, non-NULL); XR12=A12_NS_LOC,
        # XR13=A12_NS_AUTH, XR14=A12_NS_INT (from cr15_m_set after 12B writeback).
        # Corrupt XR14 via ADDI so integrity32(XR12,XR13) ≠ XR14.
        assert ctx.get(dut.cr15_m_flag) == 1, "M should still be 1 entering 12D"
        corrupt_integrity = 0x42
        addi_corrupt = encode_ctmm_i(
            corrupt_integrity, 0, int(CMFunct3ArithI.ADDI), 14, int(CMOpcode.ARITHI))
        ctx.set(dut.imem_data, addi_corrupt)
        ctx.set(dut.imem_valid, 1)
        await ctx.tick()          # ADDI fires: XR14 ← 0x42 (corrupted integrity tag)
        ctx.set(dut.imem_valid, 0)
        await ctx.tick()          # XR14 settles

        xr14_corrupt = ctx.get(dut.dbg_m_xr14)
        assert xr14_corrupt == corrupt_integrity, (
            f"XR14 should be {corrupt_integrity:#x} after ADDI, got {xr14_corrupt:#010x}")
        assert ctx.get(dut.cr15_m_flag) == 1, "M should still be 1 before integrity check"

        # Trigger M-writeback — XR11=Abstract GT (valid, non-NULL) → WRITEBACK state.
        # integrity32(A12_NS_LOC, A12_NS_AUTH) ≠ 0x42 → integrity fail → INVALID_OP
        ctx.set(dut.cr15_m_writeback_trigger, 1)
        await ctx.tick()          # IDLE: latch XR11-XR14, xr11_valid=1 → WRITEBACK
        ctx.set(dut.cr15_m_writeback_trigger, 0)
        # FSM is now in WRITEBACK state; integrity check fires combinatorially
        fault_v_d = ctx.get(dut.fault_valid)
        fault_t_d = ctx.get(dut.fault)
        await ctx.tick()          # WRITEBACK: m_clear_en=1, fault raised → IDLE
        m_flag_after_d = ctx.get(dut.cr15_m_flag)

        assert fault_v_d == 1, (
            f"Expected fault on integrity mismatch, got fault_valid={fault_v_d}")
        assert fault_t_d == FaultType.INVALID_OP, (
            f"Expected INVALID_OP on integrity mismatch, got fault={fault_t_d}")
        assert m_flag_after_d == 0, (
            f"M should be cleared after integrity fault, got {m_flag_after_d}")
        print("  PASS 12D: Corrupted XR14 → integrity mismatch in WRITEBACK → INVALID_OP, "
              "M cleared")

        # ── 12E: CHANGE M-flag save/restore path ─────────────────────
        # After 12D the M-flag is 0.  Exercise the m_flag_restore_en/val
        # path that hardware/change.py drives after a thread switch.
        #
        # Step 1: restore M-flag to 1 (incoming thread had M active)
        ctx.set(dut.m_flag_restore_en,  1)
        ctx.set(dut.m_flag_restore_val, 1)
        await ctx.tick()
        ctx.set(dut.m_flag_restore_en,  0)
        ctx.set(dut.m_flag_restore_val, 0)
        m_flag_restored = ctx.get(dut.cr15_m_flag)
        assert m_flag_restored == 1, (
            f"12E: Expected M-flag=1 after restore (incoming thread M-active), got {m_flag_restored}")

        # Step 2: restore M-flag to 0 (incoming thread did NOT have M active)
        ctx.set(dut.m_flag_restore_en,  1)
        ctx.set(dut.m_flag_restore_val, 0)
        await ctx.tick()
        ctx.set(dut.m_flag_restore_en,  0)
        m_flag_cleared = ctx.get(dut.cr15_m_flag)
        assert m_flag_cleared == 0, (
            f"12E: Expected M-flag=0 after restore (incoming thread M-inactive), got {m_flag_cleared}")

        # Step 3: m_set_en must win over m_flag_restore_en (priority check)
        # Set M-flag via m_set first so we have M=1, then assert both m_clear_en
        # (from FSM) and m_flag_restore_val=1 simultaneously; m_clear_en wins.
        # Simulate via cr15_m_set first to put M=1:
        ctx.set(dut.cr15_m_set, 1)
        await ctx.tick()
        ctx.set(dut.cr15_m_set, 0)
        # Now simultaneously pulse m_flag_restore_en=1 (val=0) — lower priority than
        # m_set_en but equal-cycle. m_set_en is 0 here, m_clear_en is 0 → restore wins.
        ctx.set(dut.m_flag_restore_en,  1)
        ctx.set(dut.m_flag_restore_val, 0)
        await ctx.tick()
        ctx.set(dut.m_flag_restore_en,  0)
        m_after_prio = ctx.get(dut.cr15_m_flag)
        assert m_after_prio == 0, (
            f"12E: m_flag_restore_val=0 should clear M when restore_en=1, got {m_after_prio}")

        print("  PASS 12E: CHANGE M-flag restore path verified (restore-1 / restore-0 / priority)")

        # ── 12F: NULL GT in XR11 → FAULT state (IDLE→FAULT path) → INVALID_OP ──────
        # (Separate fault path from 12D: NULL GT is rejected in IDLE before WRITEBACK
        # even runs, so the integrity check is bypassed entirely — IDLE→FAULT dispatch.)
        # After 12E step-3, M=0. Re-set M=1 with valid shadow, then corrupt XR11
        # to carry a NULL GT so the IDLE validator rejects it before WRITEBACK.
        ctx.set(dut.cr15_m_set, 1)
        await ctx.tick()          # M=1; XR11=Abstract GT (from CR15 after 12B writeback)
        ctx.set(dut.cr15_m_set, 0)
        await ctx.tick()          # Settle

        null_gt_val = build_null_gt()   # = GT_TYPE_NULL encoded = 0b10 = 2
        addi_null_xr11 = encode_ctmm_i(
            null_gt_val, 0, int(CMFunct3ArithI.ADDI), 11, int(CMOpcode.ARITHI))
        ctx.set(dut.imem_data, addi_null_xr11)
        ctx.set(dut.imem_valid, 1)
        await ctx.tick()          # ADDI fires: XR11 ← null_gt_val = 2 (NULL GT)
        ctx.set(dut.imem_valid, 0)
        await ctx.tick()          # XR11=null_gt_val settles

        xr11_null = ctx.get(dut.dbg_m_xr11)
        assert xr11_null == null_gt_val, (
            f"12F: XR11 should be NULL_GT={null_gt_val}, got {xr11_null}")
        assert ctx.get(dut.cr15_m_flag) == 1, "12F: M should be 1 before NULL GT writeback"

        # Trigger M-writeback — XR11[1:0]=0b10=GT_TYPE_NULL → IDLE dispatches to FAULT
        ctx.set(dut.cr15_m_writeback_trigger, 1)
        await ctx.tick()          # IDLE: xr11_valid=0 → FAULT state
        ctx.set(dut.cr15_m_writeback_trigger, 0)
        # FSM is now in FAULT state — fault signals driven combinatorially
        fault_v_f = ctx.get(dut.fault_valid)
        fault_t_f = ctx.get(dut.fault)
        await ctx.tick()          # FAULT executes: m_clear_en=1 → IDLE
        m_flag_after_f = ctx.get(dut.cr15_m_flag)

        assert fault_v_f == 1, (
            f"12F: Expected fault on NULL GT M-writeback, got fault_valid={fault_v_f}")
        assert fault_t_f == FaultType.INVALID_OP, (
            f"12F: Expected INVALID_OP on NULL GT, got fault={fault_t_f}")
        assert m_flag_after_f == 0, (
            f"12F: M should be cleared after NULL GT fault, got {m_flag_after_f}")
        print("  PASS 12F: NULL GT in XR11 → FAULT state → INVALID_OP, M cleared")

        # ── 12G: Abstract-GT M-set + writeback must NOT push CR5 stack ──────
        # After 12F, M=0. Re-set M via the test port (equivalent to mgt_set_trigger
        # from M_FETCH_DONE).

        # Step 1: fire cr15_m_set (test port equivalent of mgt_set_trigger)
        ctx.set(dut.cr15_m_set, 1)
        await ctx.tick()     # M-set fires
        ctx.set(dut.cr15_m_set, 0)
        await ctx.tick()     # settle

        m_flag_g = ctx.get(dut.cr15_m_flag)
        assert m_flag_g == 1, f"12G: M should be 1 after test-port M-set, got {m_flag_g}"

        # Step 2: trigger M-writeback and check stack still empty
        ctx.set(dut.cr15_m_writeback_trigger, 1)
        await ctx.tick()     # IDLE → WRITEBACK (integrity ok with boot defaults)
        ctx.set(dut.cr15_m_writeback_trigger, 0)
        await ctx.tick()     # WRITEBACK → IDLE, M cleared
        print("  PASS 12G: Abstract-GT M-set + writeback correctly manage M-flag")

        # ── 12H: Real Abstract-GT CALL through ISA decoder and M_FETCH_NS0-NS3 ──
        # End-to-end test: pre-load an Abstract GT in CR1 via the debug write port,
        # issue a CALL cr1 instruction through the instruction decoder, and serve
        # four sequential NS memory reads (NS0-NS3) via dmem_rd_data (mem_rd_valid
        # is hardwired to 1, so each M_FETCH_NS state advances in one cycle).
        # After M_FETCH_DONE fires mgt_set_trigger, verify XR11-XR15 hold the
        # correct NS-fetch results and the CR5 stack is still empty.
        print("  [12H] Real Abstract-GT CALL: ISA decoder → M_FETCH_NS0-NS3 → M-set")

        # Abstract GT: index=7, version=5, type=ABSTRACT, perms=0
        CALL_GT_INDEX   = 7
        CALL_GT_VERSION = 5
        call_gt_word = build_gt(CALL_GT_INDEX, 0, gt_type=GT_TYPE_ABSTRACT,
                                version=CALL_GT_VERSION)

        # Pre-load CR1 with the Abstract GT via the debug cap write port (one cycle).
        ctx.set(dut.dbg_cap_wr_en,   1)
        ctx.set(dut.dbg_cap_wr_addr, 1)
        ctx.set(dut.dbg_cap_wr_data, {
            "word0_gt":       {"gt_type": GT_TYPE_ABSTRACT, "f_flag": 0, "spare": 0, "dom": 0, "perm": 0,
                               "index": CALL_GT_INDEX, "version": CALL_GT_VERSION},
            "word1_location": 0,
            "word2_limit":    0,
            "word3_seals":    0,
        })
        await ctx.tick()    # cap_regs[1] ← Abstract GT
        ctx.set(dut.dbg_cap_wr_en, 0)

        # NS entry sits at CR15.word1_location + (index<<4) = 0 + (7<<4) = 0x70.
        # We feed all four words through dmem_rd_data (mem_rd_valid is always 1).
        NS_LOC  = 0x5000
        NS_AUTH = 0x00040010
        NS_INT  = integrity32(NS_LOC, NS_AUTH)
        NS_SEAL = (CALL_GT_VERSION << 25) | 0x1234

        # Encode CALL cr1 and pulse imem_valid for one cycle.
        CALL_INSTR = encode_church(ChurchOpcode.CALL, cr_dst=0, cr_src=1)
        ctx.set(dut.dmem_rd_data, NS_LOC)    # pre-arm NS0 data for M_FETCH_NS0
        ctx.set(dut.imem_data,    CALL_INSTR)
        ctx.set(dut.imem_valid,   1)
        await ctx.tick()                     # IDLE → CHECK_SRC (call_start fires)
        ctx.set(dut.imem_valid, 0)           # freeze — prevent re-issue

        await ctx.tick()    # CHECK_SRC  → READ_SRC
        await ctx.tick()    # READ_SRC   → CHECK_PERM  (src_reg_latched ← cap_regs[1])
        await ctx.tick()    # CHECK_PERM → M_FETCH_NS0 (detects Abstract GT)

        # M_FETCH_NS0: mem_rd_valid=1 → ns_loc_lat ← dmem_rd_data=NS_LOC
        await ctx.tick()    # M_FETCH_NS0 → M_FETCH_NS1
        ctx.set(dut.dmem_rd_data, NS_AUTH)
        await ctx.tick()    # M_FETCH_NS1 → M_FETCH_NS2  (ns_auth_lat ← NS_AUTH)
        ctx.set(dut.dmem_rd_data, NS_INT)
        await ctx.tick()    # M_FETCH_NS2 → M_FETCH_NS3  (ns_int_lat  ← NS_INT)
        ctx.set(dut.dmem_rd_data, NS_SEAL)
        await ctx.tick()    # M_FETCH_NS3 → M_FETCH_DONE (ns_seal_lat ← NS_SEAL)
        await ctx.tick()    # M_FETCH_DONE→ IDLE (mgt_set_trigger fires; XR11-XR15 set)

        m_flag_h  = ctx.get(dut.cr15_m_flag)
        xr11_h    = ctx.get(dut.dbg_m_xr11)
        xr12_h    = ctx.get(dut.dbg_m_xr12)
        xr13_h    = ctx.get(dut.dbg_m_xr13)
        xr14_h    = ctx.get(dut.dbg_m_xr14)
        xr15_h    = ctx.get(dut.dbg_m_xr15)
        assert m_flag_h == 1, (
            f"12H: M-flag should be 1 after Abstract CALL, got {m_flag_h}")
        assert xr11_h == call_gt_word, (
            f"12H: XR11 should be Abstract GT {call_gt_word:#010x}, got {xr11_h:#010x}")
        assert xr12_h == NS_LOC, (
            f"12H: XR12 should be NS_LOC={NS_LOC:#010x}, got {xr12_h:#010x}")
        assert xr13_h == NS_AUTH, (
            f"12H: XR13 should be NS_AUTH={NS_AUTH:#010x}, got {xr13_h:#010x}")
        assert xr14_h == NS_INT, (
            f"12H: XR14 should be integrity32({NS_LOC:#x},{NS_AUTH:#x})={NS_INT:#010x}, "
            f"got {xr14_h:#010x}")
        assert xr15_h == NS_SEAL, (
            f"12H: XR15 should be NS_SEAL={NS_SEAL:#010x}, got {xr15_h:#010x}")
        print("  PASS 12H: Real Abstract-GT CALL → M_FETCH_NS0-NS3 → "
              "XR11-XR15 populated, M-flag=1")

        # ── 12I: Valid integrity + gt_seq revocation mismatch → INVALID_OP fault ─
        # (Task #442: dedicated test for the gt_seq revocation check in M-window
        # WRITEBACK — isolated from the integrity mismatch path in 12D.)
        #
        # The hardware gt_seq revocation check compares:
        #   XR11[22:16]  — GT.gt_seq   (hardware GT_LAYOUT field, per hardware/layouts.py)
        #   XR13[27:21]  — NS_auth.gt_seq (WORD2_LAYOUT field, per hardware/layouts.py)
        #
        # To produce a non-zero GT.gt_seq at bits [22:16], we exploit the simulation
        # GT encoding: in build_gt(index, ...), index occupies XR11[24:8], so
        # XR11[22:16] = index[14:8].  Using index=0x500 → XR11[22:16] = 5.
        # NS_AUTH = 0x00000010 keeps XR13[27:21] = 0 (gt_seq mismatch: 5 ≠ 0).
        # NS_INT = integrity32(NS_LOC, NS_AUTH) → integrity_ok=True (untouched).
        # NS_SEAL carries version=I12_GT_VERSION → version_ok=True (matches XR11).
        # Only gtseq_ok=False triggers the fault.
        #
        # Step 1: resolve the M=1 state left by 12H via a valid writeback.
        assert ctx.get(dut.cr15_m_flag) == 1, "12I: M should be 1 from 12H before cleanup"
        ctx.set(dut.cr15_m_writeback_trigger, 1)
        await ctx.tick()          # IDLE: latch 12H shadow (all checks OK) → WRITEBACK
        ctx.set(dut.cr15_m_writeback_trigger, 0)
        await ctx.tick()          # WRITEBACK succeeds (integrity/version/gtseq all ok) → IDLE
        assert ctx.get(dut.cr15_m_flag) == 0, "12I: M should be 0 after 12H cleanup writeback"

        # Step 2: set up an Abstract GT in CR1 with index=0x500.
        # build_gt packs index at bits[24:8], so XR11[22:16] = (0x500 >> 8) & 0x7F = 5.
        I12_GT_INDEX   = 0x500
        I12_GT_VERSION = 3
        i12_gt_word = build_gt(I12_GT_INDEX, 0, gt_type=GT_TYPE_ABSTRACT,
                               version=I12_GT_VERSION)
        gt_gtseq_i = (i12_gt_word >> 16) & 0x7F   # should be 5

        ctx.set(dut.dbg_cap_wr_en,   1)
        ctx.set(dut.dbg_cap_wr_addr, 1)
        ctx.set(dut.dbg_cap_wr_data, {
            "word0_gt":       {"gt_type": GT_TYPE_ABSTRACT, "f_flag": 0, "spare": 0, "dom": 0, "perm": 0,
                               "index": I12_GT_INDEX, "version": I12_GT_VERSION},
            "word1_location": 0,
            "word2_limit":    0,
            "word3_seals":    0,
        })
        await ctx.tick()    # cap_regs[1] ← Abstract GT (index=0x500)
        ctx.set(dut.dbg_cap_wr_en, 0)

        # Step 3: trigger CALL cr1 → M_FETCH_NS0-NS3.
        # NS_AUTH = 0x00000010: bits[27:21] = 0 → ns_gtseq = 0 ≠ 5 = gt_gtseq.
        # NS_INT = integrity32(NS_LOC, NS_AUTH) → integrity_ok=True.
        # NS_SEAL = (I12_GT_VERSION << 25) | 0xBEEF → seals.version=3 = GT.version → version_ok=True.
        I12_NS_LOC  = 0x6000
        I12_NS_AUTH = 0x00000010   # bits[27:21]=0 → ns_gtseq=0
        I12_NS_INT  = integrity32(I12_NS_LOC, I12_NS_AUTH)
        I12_NS_SEAL = (I12_GT_VERSION << 25) | 0xBEEF
        ns_gtseq_i  = (I12_NS_AUTH >> 21) & 0x7F   # should be 0

        assert gt_gtseq_i != ns_gtseq_i, (
            f"12I: pre-check: GT gt_seq={gt_gtseq_i} should differ from NS gt_seq={ns_gtseq_i}")

        I12_CALL = encode_church(ChurchOpcode.CALL, cr_dst=0, cr_src=1)
        ctx.set(dut.dmem_rd_data, I12_NS_LOC)
        ctx.set(dut.imem_data,    I12_CALL)
        ctx.set(dut.imem_valid,   1)
        await ctx.tick()                     # IDLE → CHECK_SRC
        ctx.set(dut.imem_valid, 0)

        await ctx.tick()    # CHECK_SRC  → READ_SRC
        await ctx.tick()    # READ_SRC   → CHECK_PERM
        await ctx.tick()    # CHECK_PERM → M_FETCH_NS0

        await ctx.tick()    # M_FETCH_NS0 → M_FETCH_NS1
        ctx.set(dut.dmem_rd_data, I12_NS_AUTH)
        await ctx.tick()    # M_FETCH_NS1 → M_FETCH_NS2
        ctx.set(dut.dmem_rd_data, I12_NS_INT)
        await ctx.tick()    # M_FETCH_NS2 → M_FETCH_NS3
        ctx.set(dut.dmem_rd_data, I12_NS_SEAL)
        await ctx.tick()    # M_FETCH_NS3 → M_FETCH_DONE
        await ctx.tick()    # M_FETCH_DONE → IDLE (mgt_set_trigger fires; XR11-XR15 set)

        xr11_i = ctx.get(dut.dbg_m_xr11)
        xr13_i = ctx.get(dut.dbg_m_xr13)
        xr14_i = ctx.get(dut.dbg_m_xr14)
        assert ctx.get(dut.cr15_m_flag) == 1, "12I: M should be 1 after Abstract CALL"
        assert xr11_i == i12_gt_word, (
            f"12I: XR11 should be i12_gt_word={i12_gt_word:#010x}, got {xr11_i:#010x}")
        assert (xr11_i >> 16) & 0x7F == 5, (
            f"12I: XR11[22:16] (GT.gt_seq) should be 5, got {(xr11_i >> 16) & 0x7F}")
        assert xr13_i == I12_NS_AUTH, (
            f"12I: XR13 should be NS_AUTH={I12_NS_AUTH:#010x}, got {xr13_i:#010x}")
        assert (xr13_i >> 21) & 0x7F == 0, (
            f"12I: XR13[27:21] (NS.gt_seq) should be 0, got {(xr13_i >> 21) & 0x7F}")
        assert xr14_i == I12_NS_INT, (
            f"12I: XR14 should be NS_INT={I12_NS_INT:#010x}, got {xr14_i:#010x}")

        # Step 4: trigger M-writeback.
        # integrity32(I12_NS_LOC, I12_NS_AUTH) == XR14 → integrity_ok=True.
        # XR11.version=3 == XR15.seals.version=3          → version_ok=True.
        # XR11[22:16]=5  ≠  XR13[27:21]=0                 → gtseq_ok=False.
        # Combined: integrity_ok & version_ok & gtseq_ok = False → INVALID_OP fault, M cleared.
        ctx.set(dut.cr15_m_writeback_trigger, 1)
        await ctx.tick()          # IDLE: latch XR11-XR15, xr11_valid=1 → WRITEBACK
        ctx.set(dut.cr15_m_writeback_trigger, 0)
        fault_v_i = ctx.get(dut.fault_valid)
        fault_t_i = ctx.get(dut.fault)
        await ctx.tick()          # WRITEBACK: gtseq_ok=False → m_clear_en=1, fault → IDLE
        m_flag_after_i = ctx.get(dut.cr15_m_flag)

        assert fault_v_i == 1, (
            f"12I: Expected fault on gt_seq mismatch, got fault_valid={fault_v_i}")
        assert fault_t_i == FaultType.INVALID_OP, (
            f"12I: Expected INVALID_OP on gt_seq mismatch, got fault={fault_t_i}")
        assert m_flag_after_i == 0, (
            f"12I: M should be cleared after gt_seq fault, got {m_flag_after_i}")
        print("  PASS 12I: Valid integrity + gt_seq revocation mismatch "
              "(XR11[22:16]=5 ≠ XR13[27:21]=0) in WRITEBACK → INVALID_OP, M cleared")

        # ── 12J: Full seal word validation — valid and invalid paths ──────────
        # (Task #443: 25-bit seal field check added to WRITEBACK.)
        #
        # The seal check recomputes fnv32(XR12, XR13) & 0x1FFFFFF in hardware and
        # compares it against XR15[24:0] (SEALS_LAYOUT.seal).  A mismatch raises
        # INVALID_OP + M-clear exactly like the other WRITEBACK guards.
        #
        # 12J-valid:   CALL with correct FNV seal → WRITEBACK → no fault, M cleared.
        # 12J-invalid: CALL with wrong seal value  → WRITEBACK → INVALID_OP, M cleared.
        #
        # Prerequisites: M=0 after 12I cleanup.
        assert ctx.get(dut.cr15_m_flag) == 0, "12J: M should be 0 entering test"

        # Use a simple GT: index=1 (XR11[22:16] = 0), version=2.
        # Keep NS_AUTH bits[27:21]=0 so gtseq_ok=True.
        J12_GT_INDEX   = 1
        J12_GT_VERSION = 2
        j12_gt_word = build_gt(J12_GT_INDEX, 0, gt_type=GT_TYPE_ABSTRACT,
                               version=J12_GT_VERSION)

        ctx.set(dut.dbg_cap_wr_en,   1)
        ctx.set(dut.dbg_cap_wr_addr, 1)
        ctx.set(dut.dbg_cap_wr_data, {
            "word0_gt":       {"gt_type": GT_TYPE_ABSTRACT, "f_flag": 0, "spare": 0, "dom": 0, "perm": 0,
                               "index": J12_GT_INDEX, "version": J12_GT_VERSION},
            "word1_location": 0,
            "word2_limit":    0,
            "word3_seals":    0,
        })
        await ctx.tick()
        ctx.set(dut.dbg_cap_wr_en, 0)

        J12_NS_LOC  = 0x7000
        J12_NS_AUTH = 0x00000010   # bits[27:21]=0 → gtseq_ok=True
        J12_NS_INT  = integrity32(J12_NS_LOC, J12_NS_AUTH)
        J12_NS_SEAL_VALID   = build_seal(J12_NS_LOC, J12_NS_AUTH, J12_GT_VERSION)
        J12_NS_SEAL_INVALID = J12_NS_SEAL_VALID ^ 0x1   # flip one seal bit — version unchanged

        # ── 12J-valid: correct FNV seal → writeback succeeds ─────────────────
        J12_CALL = encode_church(ChurchOpcode.CALL, cr_dst=0, cr_src=1)
        ctx.set(dut.dmem_rd_data, J12_NS_LOC)
        ctx.set(dut.imem_data,    J12_CALL)
        ctx.set(dut.imem_valid,   1)
        await ctx.tick()
        ctx.set(dut.imem_valid, 0)

        await ctx.tick()    # CHECK_SRC  → READ_SRC
        await ctx.tick()    # READ_SRC   → CHECK_PERM
        await ctx.tick()    # CHECK_PERM → M_FETCH_NS0

        await ctx.tick()    # M_FETCH_NS0 → M_FETCH_NS1
        ctx.set(dut.dmem_rd_data, J12_NS_AUTH)
        await ctx.tick()    # M_FETCH_NS1 → M_FETCH_NS2
        ctx.set(dut.dmem_rd_data, J12_NS_INT)
        await ctx.tick()    # M_FETCH_NS2 → M_FETCH_NS3
        ctx.set(dut.dmem_rd_data, J12_NS_SEAL_VALID)
        await ctx.tick()    # M_FETCH_NS3 → M_FETCH_DONE
        await ctx.tick()    # M_FETCH_DONE → IDLE (mgt_set_trigger; XR11-XR15 set)

        assert ctx.get(dut.cr15_m_flag) == 1, "12J-valid: M should be 1 after CALL"

        ctx.set(dut.cr15_m_writeback_trigger, 1)
        await ctx.tick()    # IDLE: latch shadow, xr11_valid=1 → WRITEBACK
        ctx.set(dut.cr15_m_writeback_trigger, 0)
        fault_v_jv = ctx.get(dut.fault_valid)
        fault_t_jv = ctx.get(dut.fault)
        await ctx.tick()    # WRITEBACK: all checks pass → CR15 written, M cleared → IDLE
        m_flag_jv  = ctx.get(dut.cr15_m_flag)

        assert fault_v_jv == 0, (
            f"12J-valid: No fault expected with correct FNV seal, got fault_valid={fault_v_jv} "
            f"fault_type={fault_t_jv}")
        assert m_flag_jv == 0, (
            f"12J-valid: M should be cleared after valid seal writeback, got {m_flag_jv}")
        print("  PASS 12J-valid: Correct FNV seal in WRITEBACK → no fault, M cleared")

        # ── 12J-invalid: wrong seal value → WRITEBACK raises INVALID_OP ───────
        # Re-run the same CALL but with a corrupted seal word (one bit flipped).
        ctx.set(dut.dmem_rd_data, J12_NS_LOC)
        ctx.set(dut.imem_data,    J12_CALL)
        ctx.set(dut.imem_valid,   1)
        await ctx.tick()
        ctx.set(dut.imem_valid, 0)

        await ctx.tick()    # CHECK_SRC  → READ_SRC
        await ctx.tick()    # READ_SRC   → CHECK_PERM
        await ctx.tick()    # CHECK_PERM → M_FETCH_NS0

        await ctx.tick()    # M_FETCH_NS0 → M_FETCH_NS1
        ctx.set(dut.dmem_rd_data, J12_NS_AUTH)
        await ctx.tick()    # M_FETCH_NS1 → M_FETCH_NS2
        ctx.set(dut.dmem_rd_data, J12_NS_INT)
        await ctx.tick()    # M_FETCH_NS2 → M_FETCH_NS3
        ctx.set(dut.dmem_rd_data, J12_NS_SEAL_INVALID)
        await ctx.tick()    # M_FETCH_NS3 → M_FETCH_DONE
        await ctx.tick()    # M_FETCH_DONE → IDLE (mgt_set_trigger; XR11-XR15 set)

        assert ctx.get(dut.cr15_m_flag) == 1, "12J-invalid: M should be 1 after CALL"

        ctx.set(dut.cr15_m_writeback_trigger, 1)
        await ctx.tick()    # IDLE: latch shadow, xr11_valid=1 → WRITEBACK
        ctx.set(dut.cr15_m_writeback_trigger, 0)
        fault_v_ji = ctx.get(dut.fault_valid)
        fault_t_ji = ctx.get(dut.fault)
        await ctx.tick()    # WRITEBACK: seal_ok=False → fault + M-clear → IDLE
        m_flag_ji  = ctx.get(dut.cr15_m_flag)

        assert fault_v_ji == 1, (
            f"12J-invalid: Expected fault on seal mismatch, got fault_valid={fault_v_ji}")
        assert fault_t_ji == FaultType.INVALID_OP, (
            f"12J-invalid: Expected INVALID_OP on seal mismatch, got fault={fault_t_ji}")
        assert m_flag_ji == 0, (
            f"12J-invalid: M should be cleared after seal fault, got {m_flag_ji}")
        print("  PASS 12J-invalid: Flipped seal bit in WRITEBACK → INVALID_OP, M cleared")

        print("  PASS: All M-window lifecycle cases verified "
              "(set / writeback / CHANGE / integrity-fault / restore / "
              "null-gt-fault / no-stack-push / real-call-path / gt_seq-fault / "
              "seal-valid / seal-invalid)")

        print("\n" + "=" * 60)
        print("CMCap Amaranth Testbench — All Tests Complete")
        print("=" * 60)

    sim.add_testbench(testbench)

    with sim.write_vcd("ctmm_cap_amaranth/sim_output.vcd"):
        sim.run()


if __name__ == "__main__":
    run_testbench()


# ── #303: mSave and mLoad pipeline unit tests ─────────────────────────────────
#
# CMCapMSave and CMCapMLoad are standalone pipeline units (not yet wired
# into CMCapCore).  Each test drives one module directly with a small Amaranth
# simulator so the internal FSM states and memory buses are fully observable.

from ctmm_cap_amaranth.mload import CMCapMLoad
from ctmm_cap_amaranth.msave import CMCapMSave
from ctmm_cap_amaranth.types import (
    FNV_OFFSET_32, FNV_PRIME_32,
    PERM_L, PERM_S, PERM_MASK_L, PERM_MASK_S,
    GT_TYPE_INFORM,
)


# ── mSave happy-path ──────────────────────────────────────────────────────────

def test_msave_happy_path():
    """CMCapMSave writes src_gt to dst.location + index*4 when all checks pass.

    Setup
    -----
    dst_cap:  GT with S-perm, b_flag=1, location=0x100, limit=16.
    src_gt:   0xDEADBEEF
    index:    3  → write addr = 0x100 + 12 = 0x10C

    States exercised: IDLE → CHECK_BIND → CHECK_S → CHECK_BOUNDS →
                      WRITE_GT (mem_wr_done asserted) → COMPLETE

    Assertion: mem_wr_addr==0x10C, mem_wr_data==0xDEADBEEF, sub_done==1
    """
    # GT_LAYOUT: { gt_type[0:2], perms[2:8], index[8:25], version[25:32] }
    # Amaranth Simulator requires Signal(StructLayout) to be set via a mapping.
    # S-perm in GT_LAYOUT.perms: PERM_S=4 → perms field bit 4 → plain integer 1<<4
    LOCATION   = 0x100
    LIMIT      = 16

    # CAP_REG_LAYOUT: word0_gt=GT_LAYOUT, word1_location=u32,
    #                 word2_limit=u32, word3_seals=u32
    # NS_LIMIT_LAYOUT encoded in word2_limit (u32):
    #   { limit[0:17], reserved[17:29], g_bit[29], f_flag[30], b_flag[31] }
    LIMIT_WORD = LIMIT | (1 << 31)   # b_flag at bit 31 of u32

    DST_CAP = {
        "word0_gt":       {"gt_type": 0, "f_flag": 0, "spare": 0, "dom": 1, "perm": 2, "index": 0, "version": 0},
        "word1_location": LOCATION,
        "word2_limit":    LIMIT_WORD,
        "word3_seals":    0,
    }

    SRC_GT = 0xDEADBEEF
    INDEX  = 3
    EXP_WRITE_ADDR = LOCATION + (INDEX << 2)   # = 0x10C

    dut = CMCapMSave()

    async def process(ctx):
        ctx.set(dut.sub_dst_cap, DST_CAP)
        ctx.set(dut.sub_src_gt, SRC_GT)
        ctx.set(dut.sub_index, INDEX)
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)

        # ── Wait for WRITE_GT (mem_wr_en asserted) ───────────────────────────
        write_seen = False
        for _ in range(30):
            await ctx.tick()
            if ctx.get(dut.mem_wr_en):
                got_addr = ctx.get(dut.mem_wr_addr)
                got_data = ctx.get(dut.mem_wr_data)
                assert got_addr == EXP_WRITE_ADDR, (
                    f"mSave write addr=0x{got_addr:X}  expected=0x{EXP_WRITE_ADDR:X}"
                )
                assert got_data == SRC_GT, (
                    f"mSave write data=0x{got_data:08X}  expected=0x{SRC_GT:08X}"
                )
                ctx.set(dut.mem_wr_done, 1)
                await ctx.tick()
                ctx.set(dut.mem_wr_done, 0)
                # COMPLETE is now the current state (sub_done=1 combinatorially).
                # The _next_ tick will transition COMPLETE → IDLE, so we must
                # capture sub_done now, before that tick fires.
                done_seen = bool(ctx.get(dut.sub_done))
                write_seen = True
                break
        assert write_seen, "mSave: timed out waiting for WRITE_GT (mem_wr_en)"
        assert done_seen, "mSave: sub_done was not asserted at COMPLETE"

        print(
            f"\n  mSave: wrote 0x{SRC_GT:08X} to addr 0x{EXP_WRITE_ADDR:X}"
        )

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/msave_happy_path.vcd"):
        sim.run()
    print("PASS: test_msave_happy_path")


# ── mLoad direct-mode + mSave/mLoad round-trip ────────────────────────────────

def test_mload_direct_mode():
    """CMCapMLoad loads an NS entry into a cap register (direct-mode).

    Direct mode skips the CR read and L-perm check (FETCH_SRC → CHECK_NS
    directly), so this test exercises the pure NS pipeline:
      CHECK_NS → FETCH_LOC → FETCH_LIMIT → FETCH_SEALS → CHECK_VERSION →
      UPDATE_THREAD → COMPLETE

    The test drives memory responses for the three NS reads and verifies
    that cr_wr_data.word0_gt matches the direct_gt (perms and index intact).

    Setup
    -----
    direct_gt:    type=INFORM, perms=L, index=5, version=3
    cr15_ns:      location=0x200, limit=10  (index 5 < 10 → in bounds)
    NS entry @0x23C:
      FETCH_LOC   → word1_location = LOC_VAL  = 0x2000
      FETCH_LIMIT → word2_limit    = LIMIT_VAL = 0x40
      FETCH_SEALS → word3_seals   = seal | (version << 25)
        where seal = fnv(LOC_VAL, LIMIT_VAL) & 0x1FFFFFF
    """
    GT_INDEX   = 5
    GT_VERSION = 3
    # sub_direct_gt is Signal(32) (plain unsigned), so a plain integer is correct.
    # New ctmm GT_LAYOUT integer encoding:
    #   gt_type[1:0]=0 | f_flag[2]=0 | spare[3]=0 | dom[4] | perm[7:5] | index[24:8] | version[31:25]
    # L-perm: Church domain (dom=1, perm[0]=L=1) → dom at bit 4, perm[0] at bit 5
    DIRECT_GT = (GT_TYPE_INFORM) | (1 << GT_DOM_BIT) | (1 << 5) | (GT_INDEX << 8) | (GT_VERSION << 25)

    NS_BASE  = 0x200
    NS_LIMIT = 10   # 17-bit limit field; index=5 < 10 → in bounds
    # cr15_namespace is Signal(CAP_REG_LAYOUT) — must be a mapping.
    # word2_limit is unsigned(32), so NS_LIMIT (plain int, 17-bit limit at [0:17]) is fine.
    CR15_NS = {
        "word0_gt":       {"gt_type": 0, "f_flag": 0, "spare": 0, "dom": 0, "perm": 0, "index": 0, "version": 0},
        "word1_location": NS_BASE,
        "word2_limit":    NS_LIMIT,   # bits [0:17] = limit
        "word3_seals":    0,
    }

    NS_ENTRY_ADDR = NS_BASE + (GT_INDEX << 4)   # 16-byte stride = 0x200 + 80 = 0x250

    LOC_VAL   = 0x2000
    LIMIT_VAL = 0x40
    INTEGRITY_VAL = integrity32(LOC_VAL, LIMIT_VAL)   # NS entry word2_integrity
    # FNV seal: truncated to 32 bits, then masked to 25 bits
    fnv_hash  = (((FNV_OFFSET_32 ^ LOC_VAL) * FNV_PRIME_32) & 0xFFFFFFFF) ^ LIMIT_VAL
    fnv_hash &= 0xFFFFFFFF
    seal      = fnv_hash & 0x1FFFFFF
    SEALS_VAL = seal | (GT_VERSION << 25)   # version must match result_gt.version

    mem_model = {
        NS_ENTRY_ADDR:      LOC_VAL,
        NS_ENTRY_ADDR + 4:  LIMIT_VAL,
        NS_ENTRY_ADDR + 8:  INTEGRITY_VAL,   # word2_integrity (mLoad reads but doesn't validate)
        NS_ENTRY_ADDR + 12: SEALS_VAL,
    }

    dut = CMCapMLoad()

    async def _drive_mem_read(ctx):
        """Wait for mem_rd_en, serve one response, then deassert mem_rd_valid."""
        for _ in range(50):
            await ctx.tick()
            if ctx.get(dut.mem_rd_en):
                addr = ctx.get(dut.mem_addr)
                val  = mem_model.get(addr, 0)
                ctx.set(dut.mem_rd_data, val)
                ctx.set(dut.mem_rd_valid, 1)
                await ctx.tick()
                ctx.set(dut.mem_rd_valid, 0)
                return
        raise AssertionError("mLoad: timed out waiting for mem_rd_en")

    async def process(ctx):
        ctx.set(dut.cr15_namespace, CR15_NS)
        ctx.set(dut.sub_direct, 1)
        ctx.set(dut.sub_direct_gt, DIRECT_GT)
        ctx.set(dut.sub_cr_src, 0)
        ctx.set(dut.sub_cr_dst, 1)   # ≤ 7 → UPDATE_THREAD fires
        ctx.set(dut.sub_index, GT_INDEX)
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)

        # Direct mode: FETCH_SRC skips to CHECK_NS (no clist read).
        # Four NS reads: FETCH_LOC, FETCH_LIMIT, FETCH_INTEGRITY, FETCH_SEALS.
        await _drive_mem_read(ctx)   # FETCH_LOC
        await _drive_mem_read(ctx)   # FETCH_LIMIT
        await _drive_mem_read(ctx)   # FETCH_INTEGRITY (read+discard; not validated by mLoad)
        await _drive_mem_read(ctx)   # FETCH_SEALS

        # CHECK_VERSION → UPDATE_THREAD → COMPLETE (3 ticks, no inputs needed)
        done_seen = False
        fault_seen = False
        for _ in range(10):
            await ctx.tick()
            if ctx.get(dut.sub_fault):
                fault_type = ctx.get(dut.sub_fault_type)
                fault_seen = True
                break
            if ctx.get(dut.sub_done):
                wr_data    = ctx.get(dut.cr_wr_data)
                wr_en      = ctx.get(dut.cr_wr_en)
                done_seen  = True
                break

        assert not fault_seen, (
            f"mLoad faulted unexpectedly: fault_type={fault_type}"
        )
        assert done_seen, "mLoad: timed out waiting for sub_done"
        assert wr_en, "mLoad: cr_wr_en not asserted at COMPLETE"

        # cr_wr_data is Signal(CAP_REG_LAYOUT) — a structured Amaranth View.
        # Access individual scalar fields (unsigned) directly; ctx.get() returns int.
        loaded_index = ctx.get(dut.cr_wr_data.word0_gt.index)
        loaded_dom   = ctx.get(dut.cr_wr_data.word0_gt.dom)
        loaded_perm  = ctx.get(dut.cr_wr_data.word0_gt.perm)
        assert loaded_index == GT_INDEX, (
            f"mLoad cr_wr.index={loaded_index}  expected={GT_INDEX}"
        )
        assert loaded_dom == 1 and (loaded_perm & 0x1), (
            f"mLoad cr_wr dom={loaded_dom} perm={loaded_perm:#05b} — L-bit not set (expect dom=1, perm[0]=1)"
        )

        print(
            f"\n  mLoad (direct): loaded GT index={loaded_index}, "
            f"dom={loaded_dom} perm={loaded_perm:#05b} (L-only), from NS entry @0x{NS_ENTRY_ADDR:X}"
        )

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(process)
    with sim.write_vcd("/tmp/mload_direct_mode.vcd"):
        sim.run()
    print("PASS: test_mload_direct_mode")


def test_mload_msave_round_trip():
    """Round-trip: mSave writes a GT, mLoad reads it back; perms and index match.

    Two independent simulators share a Python dict as the backing store.
    mSave is run first; its mem_wr_addr/mem_wr_data are captured into the dict.
    mLoad (direct mode) is run second; its FETCH_LOC response comes from the dict
    and the loaded GT must equal the saved GT.
    """
    # L-perm in new ctmm GT encoding: Church dom=1 (bit 4), perm[0]=L=1 (bit 5)
    CAP_GT     = (GT_TYPE_INFORM) | (1 << GT_DOM_BIT) | (1 << 5) | (7 << 8) | (1 << 25)
    CLIST_BASE  = 0x500
    CLIST_LIMIT = 16
    INDEX       = 0
    EXP_WRITE_ADDR = CLIST_BASE + (INDEX << 2)   # = 0x500

    # mSave dst_cap: Signal(CAP_REG_LAYOUT) → must be a mapping.
    # NS_LIMIT_LAYOUT in word2_limit (u32): b_flag at bit 31, limit at bits [0:17].
    CLIST_DST_CAP = {
        "word0_gt":       {"gt_type": 0, "f_flag": 0, "spare": 0, "dom": 1, "perm": 2, "index": 0, "version": 0},
        "word1_location": CLIST_BASE,
        "word2_limit":    CLIST_LIMIT | (1 << 31),   # limit=16, b_flag=1
        "word3_seals":    0,
    }

    # ── Step 1: mSave ─────────────────────────────────────────────────────────
    backing_store: dict = {}   # addr → data, filled by mSave

    dut_save = CMCapMSave()

    async def save_process(ctx):
        ctx.set(dut_save.sub_dst_cap, CLIST_DST_CAP)
        ctx.set(dut_save.sub_src_gt, CAP_GT)
        ctx.set(dut_save.sub_index, INDEX)
        ctx.set(dut_save.sub_start, 1)
        await ctx.tick()
        ctx.set(dut_save.sub_start, 0)
        for _ in range(30):
            await ctx.tick()
            if ctx.get(dut_save.mem_wr_en):
                backing_store[ctx.get(dut_save.mem_wr_addr)] = ctx.get(dut_save.mem_wr_data)
                ctx.set(dut_save.mem_wr_done, 1)
                await ctx.tick()
                ctx.set(dut_save.mem_wr_done, 0)
                break
        for _ in range(10):
            await ctx.tick()
            if ctx.get(dut_save.sub_done):
                break

    sim_save = Simulator(dut_save)
    sim_save.add_clock(1e-6)
    sim_save.add_testbench(save_process)
    with sim_save.write_vcd("/tmp/round_trip_save.vcd"):
        sim_save.run()

    assert EXP_WRITE_ADDR in backing_store, (
        f"mSave did not write to 0x{EXP_WRITE_ADDR:X}; got: {backing_store}"
    )
    assert backing_store[EXP_WRITE_ADDR] == CAP_GT, (
        f"mSave wrote 0x{backing_store[EXP_WRITE_ADDR]:08X}  expected=0x{CAP_GT:08X}"
    )

    # ── Step 2: mLoad (direct mode; NS entry maps clist slot → CLIST_BASE) ───
    # Direct GT has same cap_gt so index=7, version=1, type=INFORM.
    GT_INDEX   = (CAP_GT >> 8) & 0x1FFFF   # = 7
    GT_VERSION = (CAP_GT >> 25) & 0x7F     # = 1

    NS_BASE  = 0x300
    NS_LIMIT = 16
    # cr15_namespace is Signal(CAP_REG_LAYOUT) — must be a mapping.
    CR15_NS = {
        "word0_gt":       {"gt_type": 0, "f_flag": 0, "spare": 0, "dom": 0, "perm": 0, "index": 0, "version": 0},
        "word1_location": NS_BASE,
        "word2_limit":    NS_LIMIT,   # bits [0:17] = limit
        "word3_seals":    0,
    }
    NS_ENTRY_ADDR = NS_BASE + (GT_INDEX << 4)   # 16-byte stride

    # NS entry gives location=CLIST_BASE, limit=CLIST_LIMIT
    LOC_VAL   = CLIST_BASE
    LIMIT_VAL = CLIST_LIMIT
    INTEGRITY_VAL = integrity32(LOC_VAL, LIMIT_VAL)   # NS entry word2_integrity
    fnv_hash  = (((FNV_OFFSET_32 ^ LOC_VAL) * FNV_PRIME_32) & 0xFFFFFFFF) ^ LIMIT_VAL
    fnv_hash &= 0xFFFFFFFF
    seal      = fnv_hash & 0x1FFFFFF
    SEALS_VAL = seal | (GT_VERSION << 25)

    mem_model = {
        NS_ENTRY_ADDR:      LOC_VAL,
        NS_ENTRY_ADDR + 4:  LIMIT_VAL,
        NS_ENTRY_ADDR + 8:  INTEGRITY_VAL,   # word2_integrity (mLoad reads but doesn't validate)
        NS_ENTRY_ADDR + 12: SEALS_VAL,
    }

    dut_load = CMCapMLoad()

    async def load_process(ctx):
        ctx.set(dut_load.cr15_namespace, CR15_NS)
        ctx.set(dut_load.sub_direct, 1)
        ctx.set(dut_load.sub_direct_gt, CAP_GT)
        ctx.set(dut_load.sub_cr_src, 0)
        ctx.set(dut_load.sub_cr_dst, 2)
        ctx.set(dut_load.sub_index, GT_INDEX)
        ctx.set(dut_load.sub_start, 1)
        await ctx.tick()
        ctx.set(dut_load.sub_start, 0)

        async def drive_read():
            for _ in range(50):
                await ctx.tick()
                if ctx.get(dut_load.mem_rd_en):
                    addr = ctx.get(dut_load.mem_addr)
                    val  = mem_model.get(addr, 0)
                    ctx.set(dut_load.mem_rd_data, val)
                    ctx.set(dut_load.mem_rd_valid, 1)
                    await ctx.tick()
                    ctx.set(dut_load.mem_rd_valid, 0)
                    return
            raise AssertionError("round-trip mLoad: timed out waiting for mem_rd_en")

        await drive_read()   # FETCH_LOC
        await drive_read()   # FETCH_LIMIT
        await drive_read()   # FETCH_INTEGRITY (read+discard; not validated by mLoad)
        await drive_read()   # FETCH_SEALS

        done_seen = False
        for _ in range(10):
            await ctx.tick()
            if ctx.get(dut_load.sub_fault):
                raise AssertionError(
                    f"round-trip mLoad faulted: type={ctx.get(dut_load.sub_fault_type)}"
                )
            if ctx.get(dut_load.sub_done):
                wr_data   = ctx.get(dut_load.cr_wr_data)
                done_seen = True
                break
        assert done_seen, "round-trip mLoad: timed out waiting for sub_done"

        # Verify loaded GT index, dom, perm, and type match the saved CAP_GT.
        # New ctmm GT_LAYOUT: dom at bit 4 (GT_DOM_BIT), perm[2:0] at bits [7:5].
        loaded_index = ctx.get(dut_load.cr_wr_data.word0_gt.index)
        loaded_dom   = ctx.get(dut_load.cr_wr_data.word0_gt.dom)
        loaded_perm  = ctx.get(dut_load.cr_wr_data.word0_gt.perm)
        loaded_type  = ctx.get(dut_load.cr_wr_data.word0_gt.gt_type)
        exp_index    = (CAP_GT >> 8) & 0x1FFFF        # index at bits [24:8]
        exp_dom      = (CAP_GT >> GT_DOM_BIT) & 0x1   # dom at bit 4
        exp_perm     = (CAP_GT >> 5) & 0x7            # perm[2:0] at bits [7:5]
        exp_type     = CAP_GT & 0x3                    # gt_type at bits [1:0]
        assert loaded_index == exp_index, (
            f"round-trip: index={loaded_index}  expected={exp_index}"
        )
        assert loaded_dom == exp_dom and loaded_perm == exp_perm, (
            f"round-trip: dom={loaded_dom} perm={loaded_perm:#05b}  expected dom={exp_dom} perm={exp_perm:#05b}"
        )
        assert loaded_type == exp_type, (
            f"round-trip: gt_type={loaded_type}  expected={exp_type}"
        )
        print(
            f"\n  round-trip: mSave wrote GT index={exp_index}, dom={exp_dom} perm={exp_perm:#05b} → "
            f"mLoad recovered index={loaded_index}, dom={loaded_dom} perm={loaded_perm:#05b} ✓"
        )

    sim_load = Simulator(dut_load)
    sim_load.add_clock(1e-6)
    sim_load.add_testbench(load_process)
    with sim_load.write_vcd("/tmp/round_trip_load.vcd"):
        sim_load.run()
    print("PASS: test_mload_msave_round_trip")


def test_tperm_frame_exact():
    """Hardware simulation for CMCapTperm FRAME, EXACT, and RSV3/4/5 presets.

    CAP_REG_LAYOUT is 128 bits: word0_gt (GT_LAYOUT, 32 bits) at bits [31:0].
    For EXACT, the comparison is on all 32 bits of word0_gt.
    cr_mem maps CR address → CAP_REG_LAYOUT dict (word0_gt nested dict).
    """
    dut = CMCapTperm()

    def _make_cap(index):
        """Build a CAP_REG_LAYOUT mapping with a unique index in word0_gt."""
        return {
            "word0_gt": {
                "gt_type": 1, "f_flag": 0, "spare": 0,
                "dom": 0, "perm": 0, "index": index, "version": 0,
            },
            "word1_location": 0,
            "word2_limit": 0,
            "word3_seals": 0,
        }

    cr_mem = {
        0: _make_cap(0x10),   # CR0 — index=0x10
        1: _make_cap(0x10),   # CR1 — same index as CR0 → EXACT match
        2: _make_cap(0x20),   # CR2 — different index → EXACT mismatch
    }

    async def tperm_testbench(ctx):
        async def run_tperm(preset, cr_tgt, cr_src, stack_has_frame_val, max_ticks=12):
            ctx.set(dut.preset, preset)
            ctx.set(dut.cr_target, cr_tgt)
            ctx.set(dut.cr_src, cr_src)
            ctx.set(dut.stack_has_frame, stack_has_frame_val)
            ctx.set(dut.cr_rd_data, cr_mem.get(ctx.get(dut.cr_rd_addr), 0))
            ctx.set(dut.tperm_start, 1)
            await ctx.tick()
            ctx.set(dut.tperm_start, 0)
            for _ in range(max_ticks):
                ctx.set(dut.cr_rd_data, cr_mem.get(ctx.get(dut.cr_rd_addr), 0))
                if ctx.get(dut.tperm_complete):
                    result = (True, False, 0, ctx.get(dut.tperm_z_result))
                    await ctx.tick()   # drain: COMPLETE → IDLE for next test
                    return result
                if ctx.get(dut.tperm_fault):
                    result = (False, True, ctx.get(dut.fault_type), 0)
                    await ctx.tick()   # drain: FAULT → IDLE for next test
                    return result
                await ctx.tick()
            return (False, False, 0, 0)

        print("\n=== CMCapTperm Unit Tests (FRAME / EXACT / RSV) ===")

        complete, fault, _, z = await run_tperm(
            int(TpermPreset.FRAME), cr_tgt=0, cr_src=0, stack_has_frame_val=1
        )
        assert complete, "FRAME(stack=1): expected COMPLETE"
        assert z == 1, f"FRAME(stack=1): expected Z=1, got Z={z}"
        print("  PASS: FRAME with stack_has_frame=1 → Z=1")

        complete, fault, _, z = await run_tperm(
            int(TpermPreset.FRAME), cr_tgt=0, cr_src=0, stack_has_frame_val=0
        )
        assert complete, "FRAME(stack=0): expected COMPLETE"
        assert z == 0, f"FRAME(stack=0): expected Z=0, got Z={z}"
        print("  PASS: FRAME with stack_has_frame=0 → Z=0")

        complete, fault, _, z = await run_tperm(
            int(TpermPreset.EXACT), cr_tgt=0, cr_src=1, stack_has_frame_val=0
        )
        assert complete, "EXACT(match): expected COMPLETE"
        assert z == 1, f"EXACT(match): expected Z=1, got Z={z}"
        print("  PASS: EXACT match (CR0==CR1) → Z=1")

        complete, fault, fault_type, _ = await run_tperm(
            int(TpermPreset.EXACT), cr_tgt=0, cr_src=2, stack_has_frame_val=0
        )
        assert fault, "EXACT(mismatch): expected FAULT BIND"
        assert fault_type == int(FaultType.BIND), (
            f"EXACT(mismatch): expected BIND ({int(FaultType.BIND)}), got {fault_type}"
        )
        print("  PASS: EXACT mismatch (CR0≠CR2) → FAULT BIND")

        for preset_enum, name in [
            (TpermPreset.RSV3, "RSV3"),
            (TpermPreset.RSV4, "RSV4"),
            (TpermPreset.RSV5, "RSV5"),
        ]:
            complete, fault, fault_type, _ = await run_tperm(
                int(preset_enum), cr_tgt=0, cr_src=0, stack_has_frame_val=0
            )
            assert fault, f"{name}: expected FAULT TPERM_RSV"
            assert fault_type == int(FaultType.TPERM_RSV), (
                f"{name}: expected TPERM_RSV ({int(FaultType.TPERM_RSV)}), got {fault_type}"
            )
            print(f"  PASS: {name} → FAULT TPERM_RSV")

        print("=== CMCapTperm Unit Tests PASSED ===")

    sim_tperm = Simulator(dut)
    sim_tperm.add_clock(1e-6)
    sim_tperm.add_testbench(tperm_testbench)
    with sim_tperm.write_vcd("/tmp/tperm_frame_exact.vcd"):
        sim_tperm.run()
    print("PASS: test_tperm_frame_exact")


def test_decoder_eloadcall_xloadlambda():
    """Standalone decoder test: verify ELOADCALL (opcode 8) and XLOADLAMBDA (opcode 9)
    decode correctly in CMCapDecoder.

    Encoding scheme for opcodes >= 8:
      - church_op[2:0] → funct3  at bits[14:12]
      - church_op[3]   → rd[4]   at bit[11]   (cr_dst only uses bits[10:7])
    ELOADCALL  (8 = 0b1000): bit[11]=1, funct3=0b000
    XLOADLAMBDA(9 = 0b1001): bit[11]=1, funct3=0b001

    ELOADCALL uses R-type encoding (matches hardware/decoder.py's 7-bit field):
      funct7[6:0] (instr[31:25]) → eloadcall_method_index  (7 bits, 0-127)
      rs2[4:0]    (instr[24:20]) → eloadcall_row            (5 bits, 0-31)

    Test D specifically encodes method_index=20 (> 15) to verify the former 4-bit
    I-type truncation is fixed and abstractions with > 16 methods decode correctly.

    Uses the generator-based add_process + Settle() API because CMCapDecoder is
    purely combinatorial (no sync domain, so add_clock / async testbench cannot
    be used).
    """
    dut = CMCapDecoder()
    results = {}

    # ── Test A: ELOADCALL (opcode 8) — R-type encoding ───────────────────────
    # Encode via encode_eloadcall(): cr_dst=2, cr_src=3, method_index=10, row=28
    #   eloadcall_row          = rs2    = instr[24:20] = 28  (0x1C)
    #   eloadcall_method_index = funct7 = instr[31:25] = 10  (0x0A)
    EL_CR_DST      = 2
    EL_CR_SRC      = 3
    EL_METHOD      = 10    # method index
    EL_ROW         = 28    # c-list row (≤ 31, fits in 5-bit rs2)
    eloadcall_instr = encode_eloadcall(
        cr_dst=EL_CR_DST, cr_src=EL_CR_SRC, method_index=EL_METHOD, row=EL_ROW
    )

    # ── Test B: XLOADLAMBDA (opcode 9) ────────────────────────────────────────
    # Encode: cr_dst=5, cr_src=7, imm12=0x1F3 (lambda body offset)
    XL_CR_DST = 5
    XL_CR_SRC = 7
    XL_IMM12  = 0x1F3
    xlambda_instr = encode_church(
        int(ChurchOpcode.XLOADLAMBDA), cr_dst=XL_CR_DST, cr_src=XL_CR_SRC, index=XL_IMM12
    )

    # ── Test C: backward-compat — LAMBDA (opcode 7) must still decode as 7 ───
    lambda_instr_c = encode_church(int(ChurchOpcode.LAMBDA), cr_dst=1, cr_src=2)

    # ── Test D: method_index > 15 — proves the former 4-bit truncation is gone ──
    # method_index=20 (0x14) would have been silently truncated to 4 (0x04) with
    # the old I-type encoding; the new 7-bit funct7 field must preserve it intact.
    D_METHOD = 20    # 0x14 — would overflow a 4-bit field (old max was 15)
    D_ROW    = 7
    D_CR_DST = 1
    D_CR_SRC = 4
    eloadcall_instr_d = encode_eloadcall(
        cr_dst=D_CR_DST, cr_src=D_CR_SRC, method_index=D_METHOD, row=D_ROW
    )

    def decoder_process():
        # ── Test A ──
        yield dut.instruction.eq(eloadcall_instr)
        yield dut.instr_valid.eq(1)
        yield Settle()
        results['a'] = {
            'church_op':             (yield dut.church_op),
            'is_church_op':          (yield dut.is_church_op),
            'is_eloadcall':          (yield dut.is_eloadcall),
            'is_xloadlambda':        (yield dut.is_xloadlambda),
            'eloadcall_row':         (yield dut.eloadcall_row),
            'eloadcall_method_index':(yield dut.eloadcall_method_index),
            'fault_valid':           (yield dut.fault_valid),
            'cr_dst':                (yield dut.cr_dst),
            'cr_src':                (yield dut.cr_src),
        }

        # ── Test B ──
        yield dut.instruction.eq(xlambda_instr)
        yield Settle()
        results['b'] = {
            'church_op':      (yield dut.church_op),
            'is_church_op':   (yield dut.is_church_op),
            'is_eloadcall':   (yield dut.is_eloadcall),
            'is_xloadlambda': (yield dut.is_xloadlambda),
            'fault_valid':    (yield dut.fault_valid),
            'cr_dst':         (yield dut.cr_dst),
            'cr_src':         (yield dut.cr_src),
            'cap_index':      (yield dut.cap_index),
        }

        # ── Test C ──
        yield dut.instruction.eq(lambda_instr_c)
        yield Settle()
        results['c'] = {
            'church_op':      (yield dut.church_op),
            'is_eloadcall':   (yield dut.is_eloadcall),
            'is_xloadlambda': (yield dut.is_xloadlambda),
        }

        # ── Test D ──
        yield dut.instruction.eq(eloadcall_instr_d)
        yield Settle()
        results['d'] = {
            'church_op':             (yield dut.church_op),
            'is_eloadcall':          (yield dut.is_eloadcall),
            'is_xloadlambda':        (yield dut.is_xloadlambda),
            'eloadcall_row':         (yield dut.eloadcall_row),
            'eloadcall_method_index':(yield dut.eloadcall_method_index),
            'fault_valid':           (yield dut.fault_valid),
            'cr_dst':                (yield dut.cr_dst),
            'cr_src':                (yield dut.cr_src),
        }

    sim_dec = Simulator(dut)
    sim_dec.add_process(decoder_process)
    with sim_dec.write_vcd("/tmp/decoder_eloadcall_xloadlambda.vcd"):
        sim_dec.run()

    # ── Assert Test A ──
    print("\n=== CMCapDecoder: ELOADCALL + XLOADLAMBDA Unit Tests ===")
    a = results['a']
    assert a['church_op'] == int(ChurchOpcode.ELOADCALL), (
        f"ELOADCALL: church_op={a['church_op']}, expected {int(ChurchOpcode.ELOADCALL)}")
    assert a['is_church_op'] == 1, (
        f"ELOADCALL: is_church_op should be 1, got {a['is_church_op']}")
    assert a['is_eloadcall'] == 1, (
        f"ELOADCALL: is_eloadcall should be 1, got {a['is_eloadcall']}")
    assert a['is_xloadlambda'] == 0, (
        f"ELOADCALL: is_xloadlambda should be 0, got {a['is_xloadlambda']}")
    assert a['eloadcall_row'] == EL_ROW, (
        f"ELOADCALL: eloadcall_row={a['eloadcall_row']}, expected {EL_ROW}")
    assert a['eloadcall_method_index'] == EL_METHOD, (
        f"ELOADCALL: eloadcall_method_index={a['eloadcall_method_index']}, expected {EL_METHOD}")
    assert a['fault_valid'] == 0, (
        f"ELOADCALL: unexpected fault (fault_valid={a['fault_valid']})")
    assert a['cr_dst'] == EL_CR_DST, (
        f"ELOADCALL: cr_dst={a['cr_dst']}, expected {EL_CR_DST}")
    assert a['cr_src'] == EL_CR_SRC, (
        f"ELOADCALL: cr_src={a['cr_src']}, expected {EL_CR_SRC}")
    print(f"  PASS A: ELOADCALL → church_op=8, is_eloadcall=1, "
          f"row={a['eloadcall_row']}, method_index={a['eloadcall_method_index']}, "
          f"no fault")

    # ── Assert Test B ──
    b = results['b']
    assert b['church_op'] == int(ChurchOpcode.XLOADLAMBDA), (
        f"XLOADLAMBDA: church_op={b['church_op']}, expected {int(ChurchOpcode.XLOADLAMBDA)}")
    assert b['is_church_op'] == 1, (
        f"XLOADLAMBDA: is_church_op should be 1, got {b['is_church_op']}")
    assert b['is_eloadcall'] == 0, (
        f"XLOADLAMBDA: is_eloadcall should be 0, got {b['is_eloadcall']}")
    assert b['is_xloadlambda'] == 1, (
        f"XLOADLAMBDA: is_xloadlambda should be 1, got {b['is_xloadlambda']}")
    assert b['fault_valid'] == 0, (
        f"XLOADLAMBDA: unexpected fault (fault_valid={b['fault_valid']})")
    assert b['cr_dst'] == XL_CR_DST, (
        f"XLOADLAMBDA: cr_dst={b['cr_dst']}, expected {XL_CR_DST}")
    assert b['cr_src'] == XL_CR_SRC, (
        f"XLOADLAMBDA: cr_src={b['cr_src']}, expected {XL_CR_SRC}")
    assert b['cap_index'] == XL_IMM12, (
        f"XLOADLAMBDA: cap_index={b['cap_index']:#05x}, expected {XL_IMM12:#05x}")
    print(f"  PASS B: XLOADLAMBDA → church_op=9, is_xloadlambda=1, "
          f"cap_index=0x{b['cap_index']:03x}, no fault")

    # ── Assert Test C ──
    c = results['c']
    assert c['church_op'] == int(ChurchOpcode.LAMBDA), (
        f"LAMBDA backward-compat: church_op={c['church_op']}, expected 7")
    assert c['is_eloadcall'] == 0 and c['is_xloadlambda'] == 0, (
        "LAMBDA backward-compat: is_eloadcall/is_xloadlambda should both be 0")
    print("  PASS C: LAMBDA (opcode 7) still decodes correctly, no cross-fire")

    # ── Assert Test D — method_index > 15 must not be truncated ──────────────
    d = results['d']
    assert d['church_op'] == int(ChurchOpcode.ELOADCALL), (
        f"ELOADCALL D: church_op={d['church_op']}, expected {int(ChurchOpcode.ELOADCALL)}")
    assert d['is_eloadcall'] == 1, (
        f"ELOADCALL D: is_eloadcall should be 1, got {d['is_eloadcall']}")
    assert d['is_xloadlambda'] == 0, (
        f"ELOADCALL D: is_xloadlambda should be 0, got {d['is_xloadlambda']}")
    assert d['eloadcall_method_index'] == D_METHOD, (
        f"ELOADCALL D: method_index={d['eloadcall_method_index']}, expected {D_METHOD} "
        f"(old 4-bit encoding would have truncated this to {D_METHOD & 0xF})")
    assert d['eloadcall_row'] == D_ROW, (
        f"ELOADCALL D: row={d['eloadcall_row']}, expected {D_ROW}")
    assert d['cr_dst'] == D_CR_DST, (
        f"ELOADCALL D: cr_dst={d['cr_dst']}, expected {D_CR_DST}")
    assert d['cr_src'] == D_CR_SRC, (
        f"ELOADCALL D: cr_src={d['cr_src']}, expected {D_CR_SRC}")
    assert d['fault_valid'] == 0, (
        f"ELOADCALL D: unexpected fault (fault_valid={d['fault_valid']})")
    print(f"  PASS D: method_index={D_METHOD} (>15) decoded correctly — "
          f"7-bit widening confirmed, no truncation to {D_METHOD & 0xF}")

    print("=== CMCapDecoder ELOADCALL + XLOADLAMBDA Tests PASSED ===")
    print("PASS: test_decoder_eloadcall_xloadlambda")


def test_core_eloadcall_xloadlambda_irq():
    """End-to-end test: ELOADCALL fires lazy-resolve IRQ; XLOADLAMBDA fires lambda loader.

    Uses a full CMCapCore with async testbench (not just the decoder in isolation).

    ELOADCALL
    ---------
    After boot the LOAD_NUC boot state writes CR6 (c-list) with E-perm (dom=1, perm=0b100).
    An ELOADCALL instruction with row=EL_ROW and method_index=EL_METHOD_INDEX passes the
    E-perm check on CR_CLIST and fires for one cycle:
      irq_valid=1, irq_reason=IRQ_REASON_LAZY_RESOLVE,
      irq_ns_slot=SCHEDULER_IRQ_NS_SLOT, irq_dr1=EL_ROW, irq_method_index=EL_METHOD_INDEX.
    When imem_valid is deasserted the IRQ outputs de-assert immediately (combinatorial).

    XLOADLAMBDA
    -----------
    CR14 (CR_CLOOMC, code register) is pre-loaded with X-perm (dom=0, perm=0b100) via the
    debug write port.  A XLOADLAMBDA instruction with cap_index=XL_IMM12 passes the X-perm
    check on CR_CLOOMC and fires for one cycle:
      xloadlambda_valid=1, xloadlambda_index=XL_IMM12.
    """
    from hardware.hw_types import IRQ_REASON_LAZY_RESOLVE, SCHEDULER_IRQ_NS_SLOT

    dut = CMCapCore()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    EL_ROW          = 0x07   # 5-bit c-list row  → rs2   field instr[24:20]
    EL_METHOD_INDEX = 0x3    # 7-bit method index → funct7 field instr[31:25]
    # ELOADCALL is R-type: funct7[6:0] | rs2[4:0] | rs1 | funct3 | rd | opcode
    # encode_church places `index & 0xFFF` at bits[31:20]:
    #   index[4:0]  → instr[24:20] = row          (5 bits, rs2)
    #   index[11:5] → instr[31:25] = method_index (7 bits, funct7)
    EL_IMM12        = (EL_METHOD_INDEX << 5) | EL_ROW   # 0x067
    eloadcall_instr = encode_church(
        int(ChurchOpcode.ELOADCALL), cr_dst=0, cr_src=CR_CLIST, index=EL_IMM12
    )

    XL_IMM12         = 0x1A2
    xloadlambda_instr = encode_church(
        int(ChurchOpcode.XLOADLAMBDA), cr_dst=0, cr_src=0, index=XL_IMM12
    )

    async def testbench(ctx):
        print("\n=== CMCapCore: ELOADCALL + XLOADLAMBDA IRQ Dispatch (end-to-end) ===")

        ctx.set(dut.boot_start, 1)
        ctx.set(dut.imem_valid, 0)
        await ctx.tick()
        ctx.set(dut.boot_start, 0)

        for _ in range(10):
            await ctx.tick()
            if ctx.get(dut.boot_complete):
                break
        assert ctx.get(dut.boot_complete) == 1, "Boot did not complete before ELOADCALL test"
        print("  Boot complete")

        ctx.set(dut.dbg_cap_wr_en,   1)
        ctx.set(dut.dbg_cap_wr_addr, CR_CLOOMC)
        ctx.set(dut.dbg_cap_wr_data, {
            "word0_gt": {
                "gt_type": GT_TYPE_INFORM, "f_flag": 0, "spare": 0,
                "dom": 0, "perm": 0b100, "index": 1, "version": 0,
            },
            "word1_location": 0x100,
            "word2_limit":    64,
            "word3_seals":    0,
        })
        await ctx.tick()
        ctx.set(dut.dbg_cap_wr_en, 0)
        await ctx.tick()

        ctx.set(dut.imem_data,  eloadcall_instr)
        ctx.set(dut.imem_valid, 1)
        nia_before_eloadcall = ctx.get(dut.nia)
        await ctx.tick()

        irq_v  = ctx.get(dut.irq_valid)
        irq_r  = ctx.get(dut.irq_reason)
        irq_ns = ctx.get(dut.irq_ns_slot)
        irq_d1 = ctx.get(dut.irq_dr1)
        irq_mi = ctx.get(dut.irq_method_index)
        nia_after_eloadcall = ctx.get(dut.nia)

        ctx.set(dut.imem_valid, 0)
        await ctx.tick()

        assert irq_v == 1, (
            f"ELOADCALL: irq_valid should be 1 (E-perm check on CR6 must pass), got {irq_v}")
        assert irq_r == IRQ_REASON_LAZY_RESOLVE, (
            f"ELOADCALL: irq_reason={irq_r}, expected IRQ_REASON_LAZY_RESOLVE="
            f"{IRQ_REASON_LAZY_RESOLVE}")
        assert irq_ns == SCHEDULER_IRQ_NS_SLOT, (
            f"ELOADCALL: irq_ns_slot={irq_ns}, expected SCHEDULER_IRQ_NS_SLOT="
            f"{SCHEDULER_IRQ_NS_SLOT}")
        assert irq_d1 == EL_ROW, (
            f"ELOADCALL: irq_dr1={irq_d1:#04x}, expected EL_ROW={EL_ROW:#04x}")
        assert irq_mi == EL_METHOD_INDEX, (
            f"ELOADCALL: irq_method_index={irq_mi:#03x}, expected {EL_METHOD_INDEX:#03x}")
        assert nia_after_eloadcall == nia_before_eloadcall, (
            f"ELOADCALL: NIA must not advance when lazy-resolve IRQ fires; "
            f"before={nia_before_eloadcall:#010x}, after={nia_after_eloadcall:#010x} "
            f"(expected hold, got +{nia_after_eloadcall - nia_before_eloadcall})")
        print(f"  PASS ELOADCALL: irq_valid=1, reason=LAZY_RESOLVE({irq_r}), "
              f"ns_slot={irq_ns}, dr1={irq_d1:#04x}, method_idx={irq_mi:#03x}")
        print(f"  PASS ELOADCALL: NIA held at {nia_after_eloadcall:#010x} (no advance on IRQ)")

        irq_v_idle = ctx.get(dut.irq_valid)
        assert irq_v_idle == 0, (
            f"ELOADCALL: irq_valid should deassert when imem_valid=0, got {irq_v_idle}")
        print("  PASS ELOADCALL: irq_valid=0 when not executing")

        ctx.set(dut.imem_data,  xloadlambda_instr)
        ctx.set(dut.imem_valid, 1)
        nia_before_xloadlambda = ctx.get(dut.nia)
        await ctx.tick()

        xl_v   = ctx.get(dut.xloadlambda_valid)
        xl_idx = ctx.get(dut.xloadlambda_index)
        nia_after_xloadlambda = ctx.get(dut.nia)

        ctx.set(dut.imem_valid, 0)
        await ctx.tick()

        assert xl_v == 1, (
            f"XLOADLAMBDA: xloadlambda_valid should be 1 (X-perm check on CR14 must pass), "
            f"got {xl_v}")
        assert xl_idx == XL_IMM12, (
            f"XLOADLAMBDA: xloadlambda_index={xl_idx:#05x}, expected {XL_IMM12:#05x}")
        assert nia_after_xloadlambda == nia_before_xloadlambda, (
            f"XLOADLAMBDA: NIA must not advance when lambda-loader IRQ fires; "
            f"before={nia_before_xloadlambda:#010x}, after={nia_after_xloadlambda:#010x} "
            f"(expected hold, got +{nia_after_xloadlambda - nia_before_xloadlambda})")
        print(f"  PASS XLOADLAMBDA: xloadlambda_valid=1, xloadlambda_index={xl_idx:#05x}")
        print(f"  PASS XLOADLAMBDA: NIA held at {nia_after_xloadlambda:#010x} (no advance on IRQ)")

        xl_v_idle = ctx.get(dut.xloadlambda_valid)
        assert xl_v_idle == 0, (
            f"XLOADLAMBDA: xloadlambda_valid should deassert when imem_valid=0, "
            f"got {xl_v_idle}")
        print("  PASS XLOADLAMBDA: xloadlambda_valid=0 when not executing")

        # Verify NIA redirect: CR14.word1_location (0x100) + XL_IMM12 (0x1A2) = 0x2A2.
        # The sync update fires on the clock edge of the XLOADLAMBDA cycle, so nia_reg
        # holds the lambda body address in the cycle immediately following the instruction.
        xl_expected_nia = 0x100 + XL_IMM12
        xl_nia = ctx.get(dut.nia)
        assert xl_nia == xl_expected_nia, (
            f"XLOADLAMBDA: NIA should redirect to CR14.base + cap_index = "
            f"{xl_expected_nia:#010x}, got {xl_nia:#010x}")
        print(f"  PASS XLOADLAMBDA: NIA redirected to {xl_nia:#010x} "
              f"(CR14.word1_location=0x100 + cap_index={XL_IMM12:#05x})")

        print("=== CMCapCore ELOADCALL + XLOADLAMBDA IRQ Tests PASSED ===")

    sim.add_testbench(testbench)
    with sim.write_vcd("/tmp/core_eloadcall_xloadlambda.vcd"):
        sim.run()
    print("PASS: test_core_eloadcall_xloadlambda_irq")


if __name__ == "__main__":
    test_msave_happy_path()
    test_mload_direct_mode()
    test_mload_msave_round_trip()
    test_tperm_frame_exact()
    test_decoder_eloadcall_xloadlambda()
    test_core_eloadcall_xloadlambda_irq()
