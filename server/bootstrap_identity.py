"""Frozen-resident bootstrap identity contract.

Bootstrap has one local identifier: the complete runtime SELF GT in c-list
row zero.  Portable identity and dynamic-slot binding deliberately live in
their own modules; callers must opt in to this narrow resident-only rule.
"""

_U32_MAX = 0xFFFFFFFF


def resident_inform_egt(binding):
    """Derive the sole legal bootstrap SELF GT from its owning descriptor."""
    frozen_resident_bootstrap(binding)
    slot, seq = binding.get("slot"), binding.get("seq", 0)
    if isinstance(slot, bool) or not isinstance(slot, int) or not 0 <= slot <= 0xFFFF:
        raise ValueError("bootstrap binding has invalid Namespace slot")
    if isinstance(seq, bool) or not isinstance(seq, int) or not 0 <= seq <= 0x1FF:
        raise ValueError("bootstrap binding has invalid Namespace sequence")
    # Inform type=1, Church domain, E-only permission=4 in the architectural
    # v2 GT layout.
    return 0x4A000000 | (seq << 16) | slot


def frozen_resident_bootstrap(binding):
    """Reject every binding that is not an explicitly frozen resident row."""
    if not isinstance(binding, dict):
        raise ValueError("bootstrap identity requires a resident Namespace binding")
    if binding.get("resident") is not True or binding.get("boot_resident") is not True:
        raise ValueError("bootstrap identity is only valid for frozen resident bindings")
    if binding.get("type") not in ("Inform", "Resident"):
        raise ValueError("bootstrap identity requires a resident Inform binding")
    if binding.get("load_policy") != "Resident":
        raise ValueError("bootstrap identity rejects nonresident load policy")
    if binding.get("ns_slot_policy") != "static":
        raise ValueError("bootstrap identity requires a static Namespace binding")
    return True


def bootstrap_t_from_self_gt(binding, self_gt):
    """Return canonical serialized T after proving it is a frozen resident GT."""
    frozen_resident_bootstrap(binding)
    if isinstance(self_gt, bool) or not isinstance(self_gt, int) or not 0 <= self_gt <= _U32_MAX:
        raise ValueError("bootstrap SELF GT must be one unsigned 32-bit word")
    return f"{self_gt:08x}"


def bootstrap_identity_record(binding, self_gt):
    """Serialize bootstrap T without a hash, projection, or second identity."""
    token = bootstrap_t_from_self_gt(binding, self_gt)
    return {"bootstrap_t": token, "bootstrap_runtime_gt": int(self_gt)}


def verify_bootstrap_self_gt(binding, row0, serialized_t=None):
    """Fail closed unless row zero and serialized T are the exact same word."""
    token = bootstrap_t_from_self_gt(binding, row0)
    if row0 != resident_inform_egt(binding):
        raise ValueError("bootstrap SELF GT differs from owning Namespace descriptor")
    if binding.get("token") != token:
        raise ValueError("bootstrap Namespace token differs from SELF GT")
    if serialized_t is not None and serialized_t != token:
        raise ValueError("bootstrap T must equal c-list row-0 SELF GT bit-for-bit")
    return token