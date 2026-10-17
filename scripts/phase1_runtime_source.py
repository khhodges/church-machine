"""Explicit isolated corrections, separately identified from naming-only inputs.

No instruction bytes or registers are patched during execution. Every corrected
source goes through the same compiler, attestation and private admission path.
"""


def correct(source, name):
    if name != "CapabilityTest":
        return source, []
    replacements = [
        ("    ide.Boot.Thread\n", "    ide.Boot.NS\n",
         "CR15 requires a Namespace, not a Thread capability; both have zero permissions."),
        ("IADD   DR1, #0b0010000000000000", "IADD   DR1, #0b0010000001000000",
         "Retain CALL-established CR6.M while setting CR13.M."),
        ("SHL    DR1, DR1, 15\nDWRITE", "SHL    DR1, DR1, 15\nIADD   DR1, DR1, #64\nDWRITE",
         "Retain CALL-established CR6.M while setting CR15.M."),
        ("SWITCH CR15, ide.Boot.Thread", "SWITCH CR15, ide.Boot.NS",
         "Switch to the same approved Namespace root without changing slot assignments."),
    ]
    changes = []
    for old, new, reason in replacements:
        if source.count(old) != 1:
            raise ValueError(f"Pinned CapabilityTest correction anchor changed: {old}")
        source = source.replace(old, new)
        changes.append(dict(before=old, after=new, reason=reason))
    return source, changes
