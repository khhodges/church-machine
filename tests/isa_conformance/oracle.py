"""Independent, deliberately limited master-ISA oracle. No production imports."""


def condition(code, flags):
    n, z, c, v = (bool(flags & (1 << i)) for i in range(4))
    return [z, not z, c, not c, n, not n, v, not v, c and not z,
            not c or z, n == v, n != v, not z and n == v,
            z or n != v, True, False][code]


def vectors():
    rows = []
    for opcode, name in [(0, "LOAD"), (1, "SAVE")]:
        for r in range(16):
            for subtract, magnitude, base in [(False, 3, 0), (True, 3, 6),
                                              (False, 0, 3), (True, 1023, 1026),
                                              (False, 1, 0xffffffff), (True, 1, 0)]:
                actual_base = base if r else 0
                index = actual_base + (-magnitude if subtract else magnitude)
                operand = (int(subtract) << 14) | (magnitude << 4) | r
                rows.append(dict(
                    id=f"{name}-r{r}-{'minus' if subtract else 'plus'}-{magnitude}-{base}",
                    kind="index", opcode=opcode, register=r, base=actual_base,
                    word=(opcode << 27) | (14 << 23) | (2 << 19) | (6 << 15) | operand,
                    source=f"{name} CR2, CR6, DR{r} {'-' if subtract else '+'} {magnitude}",
                    expected=dict(index=index, arithmetic_fault=not 0 <= index <= 0xffffffff),
                ))
    for left, right in [(7, 255), (255, 7), (7, 7), (0, 1), (1, 0)]:
        rows.append(dict(id=f"MCMP-{left}-{right}", kind="mcmp",
                         word=0xa7108000, left=left, right=right,
                         source="MCMP DR2, DR1",
                         expected=dict(z=int(left == right), dr_unchanged=True)))
    return rows


def judge(vector, observed):
    """Return explicit failures. Never infer expected values from adapters."""
    if vector["kind"] == "mcmp":
        issues = []
        if observed["z"] != vector["expected"]["z"]:
            issues.append("Z does not reflect equality of DRdst and DRsrc")
        if observed["before"]["dr"] != observed["after"]["dr"]:
            issues.append("MCMP modified a DR")
        if observed.get("fault") or not observed.get("retired"):
            issues.append("MCMP did not retire successfully")
        if observed["after"]["pc"] != observed["before"]["pc"] + 1:
            issues.append("PC did not advance one normalized word")
        if observed.get("writes"):
            issues.append("MCMP wrote memory")
        if observed.get("reads"):
            issues.append("MCMP attempted an operand memory read")
        if observed["before"].get("cr") != observed["after"].get("cr"):
            issues.append("MCMP modified a capability register")
        if observed.get("retire_word", vector["word"]) != vector["word"]:
            issues.append("wrong instruction retired")
        return issues
    if observed["arithmetic_fault"] != vector["expected"]["arithmetic_fault"]:
        return ["wrong index arithmetic overflow/underflow outcome"]
    if not observed["arithmetic_fault"] and observed["index"] != vector["expected"]["index"]:
        return ["wrong effective index"]
    return []