"""Independent, deliberately partial oracle from docs/instruction-set.md.

No implementation helpers are imported here. Unknown C/V and field policies
are not expected values. Raw words deliberately bypass both assemblers.
"""

AUTHORITY = "docs/instruction-set.md"


def word(op, dst=2, src=1, imm=0, cond=14):
    return (op << 27) | (cond << 23) | (dst << 19) | (src << 15) | imm


def condition(cond, flags):
    n, z, c, v = (bool(flags & (1 << i)) for i in range(4))
    return [z, not z, c, not c, n, not n, v, not v,
            c and not z, not c or z, n == v, n != v,
            not z and n == v, z or n != v, True, False][cond]


def vectors():
    cases = []
    # Use SHL with a zero source as a visible write/no-write predicate probe.
    # Only the destination and preserved state are asserted; shift flags are open.
    for cond in range(16):
        for flags in range(16):
            dr = [0] * 16
            dr[2] = 99
            cases.append(dict(id=f"cond-{cond:02}-{flags:02}", kind="condition",
                              section="Condition Codes", word=word(24, imm=1, cond=cond),
                              dr=dr, flags=flags, taken=condition(cond, flags)))
    for dst, src, a, b in [(2, 1, 7, 255), (2, 1, 255, 7),
                           (2, 1, 7, 7), (2, 1, 0, 0),
                           (2, 1, 0x80000000, 0x7fffffff),
                           (2, 1, 0xffffffff, 1), (2, 2, 17, 17),
                           (0, 1, 0, 7), (2, 0, 7, 0)]:
        dr = [0] * 16
        dr[dst], dr[src] = a, b
        dr[0] = 0
        cases.append(dict(id=f"mcmp-{len(cases)-256}", kind="mcmp",
                          section="MCMP (opcode 20)", word=word(20, dst, src),
                          dr=dr, flags=0, dst=dst, src=src))
    # Null authority deliberately isolates index formation from SAVE role D1,
    # Namespace seal policy and lazy resolution. All must terminate in a fault
    # without data reads/writes. The internal effective-index observation is
    # an additional assertion, NOT a claim of successful capability transfer.
    indices = [(0, 3, 0, 0), (11, 3, 0, 5), (11, 3, 1, 5),
               (15, 1023, 0, 0), (15, 1023, 1, 1024),
               (3, 0, 0, 9), (11, 5, 1, 5),
               (11, 3, 1, 2), (11, 1, 0, 0xffffffff),
               (15, 0, 0, 0xffffffff)]
    for op in (0, 1):
        for i, (reg, mag, sub, base) in enumerate(indices):
            dr = [0] * 16
            dr[reg] = base
            imm = (sub << 14) | (mag << 4) | reg
            index = dr[reg] + (-mag if sub else mag)
            cases.append(dict(id=f"{'load' if op == 0 else 'save'}-index-{i}",
                              kind="index", section="Compact indexed LOAD/SAVE operand",
                              word=word(op, 2, 1, imm), dr=dr, flags=0,
                              index=index if 0 <= index <= 0xffffffff else None))
    for op in (18, 19):
        for pos, width in [(0, 1), (31, 1), (1, 31), (0, 31),
                           (7, 9), (0, 0), (31, 2), (2, 31)]:
            for dst, src in [(2, 1), (2, 2), (0, 1), (2, 0)]:
                dr = [0] * 16
                dr[1], dr[2] = 0x89abcdef, 0x76543210
                cases.append(dict(
                    id=f"bitfield-{op}-{pos}-{width}-{dst}-{src}",
                    kind="bitfield", section="BFEXT/BFINS: bitfield contract",
                    word=word(op, dst, src, (pos << 5) | width),
                    dr=dr, flags=15, op=op, pos=pos, width=width,
                    dst=dst, src=src))
    # False predicates suppress even malformed bitfields.
    for op in (18, 19):
        dr = [0] * 16
        dr[1], dr[2] = 0x89abcdef, 0x76543210
        cases.append(dict(id=f"bitfield-false-{op}", kind="bitfield",
                          section="BFEXT/BFINS: bitfield contract",
                          word=word(op, 2, 1, 0, cond=15), dr=dr, flags=15,
                          op=op, pos=0, width=0, dst=2, src=1, skipped=True))
    return cases


BLOCKED = {
    "save-register-roles": "D1: conflicting SAVE source/destination roles; no transfer oracle.",
    "mcmp-carry-overflow": "D9: exact subtraction C/V and unused-field validity unresolved.",
    "shift-flags": "D9: no exact shift NZCV oracle; predicate probe asserts writes only.",
    "false-invalid-op": "D9: malformed/retired encoding versus predication precedence unresolved.",
    "remaining-fields": "D2–D8: bitfields, TPERM, CALL, LAMBDA/RETURN, other index fields, bounds/fault order.",
}


def judge(vector, observation):
    """Return named violations, never compare implementations to each other."""
    initial, final = observation["initial"], observation["final"]
    failures = []
    def check(ok, label):
        if not ok:
            failures.append(label)
    check(initial["dr"] == vector["dr"], "fixture DR state")
    check(initial["flags"] == vector["flags"], "fixture flags")
    check(initial["pc_word"] == 0, "fixture PC")
    check(all(not any(cr) for i, cr in enumerate(initial["cr"]) if i != 14),
          "fixture NULL data authorities")
    check(initial["cr"][14][0] == 0x5200001e, "fixture code identity")
    check(not any(initial["m"]) if isinstance(initial["m"], list) else initial["m"] == 0,
          "fixture M bits")
    check(observation["terminal"] != "timeout", "bounded completion")
    expected_dr = vector["dr"].copy()
    bf_invalid = False
    bf_result = 0
    if vector["kind"] == "bitfield":
        p, w = vector["pos"], vector["width"]
        bf_invalid = not vector.get("skipped") and (w == 0 or p + w > 32)
        if not bf_invalid and not vector.get("skipped"):
            mask = (1 << w) - 1
            source = initial["dr"][vector["src"]]
            old = initial["dr"][vector["dst"]]
            bf_result = ((source >> p) & mask) if vector["op"] == 18 else (
                (old & ~(mask << p)) | ((source & mask) << p))
            bf_result &= 0xffffffff
            if vector["dst"]:
                expected_dr[vector["dst"]] = bf_result
    if vector["kind"] == "condition" and vector["taken"]:
        expected_dr[2] = 0
    check(final["dr"] == expected_dr, "DR result/preservation")
    check(final["cr"] == initial["cr"], "forbidden CR change")
    check(final["m"] == initial["m"], "forbidden M change")
    check(not observation["data_reads"], "forbidden data read")
    check(not observation["writes"], "forbidden memory write")
    if vector["kind"] == "bitfield" and bf_invalid:
        check(observation["terminal"] == "fault", "invalid bitfield must fault")
        check(observation["fault"] in ("BOUNDS", 8), "bitfield BOUNDS fault")
        check(final["flags"] == initial["flags"], "fault flag preservation")
    elif vector["kind"] == "index":
        check(observation["terminal"] == "fault", "NULL authority/arithmetic must reject")
        check(observation["index"] == vector["index"], "compact effective index")
        if vector["index"] is None and "index_accepted" in observation:
            check(observation["index_arithmetic_fault"], "missing arithmetic rejection")
            check(not observation["index_accepted"], "rejected index started consumer")
        check(final["flags"] == initial["flags"], "fault flag preservation")
        # Fault priority and diagnostic PC/recovery changes deliberately not inferred.
    else:
        check(observation["terminal"] == "retire", "must retire")
        if "retire_count" in observation:
            check(observation["retire_count"] == 1, "exactly one retirement")
        check(final["pc_word"] == 1, "exactly one instruction advance")
        if vector["kind"] == "bitfield":
            check(final["flags"] == (initial["flags"] if vector.get("skipped") else
                                    ((bf_result >> 31) | (2 if bf_result == 0 else 0))),
                  "bitfield NZCV")
        if vector["kind"] == "condition" and not vector["taken"]:
            check(final["flags"] == initial["flags"], "false predicate flag preservation")
        if vector["kind"] == "mcmp":
            a, b = vector["dr"][vector["dst"]], vector["dr"][vector["src"]]
            # Z tests the settled compare operand rule, without inventing C/V.
            check(bool(final["flags"] & 2) == (a == b), "MCMP two-register equality/Z")
    return failures