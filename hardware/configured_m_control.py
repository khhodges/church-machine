"""Image-bound M-control recipients for explicitly configured candidates.

This is trusted image configuration, not an instruction, an issuer or a name
lookup. A grant identifies one exact executable view under one Namespace root.
Historical cores keep their existing gate when no configuration is supplied.
"""
from dataclasses import dataclass
import hashlib
import struct

from amaranth import Const
from amaranth.lib.data import View

from .layouts import CAP_REG_LAYOUT, WORD2_LAYOUT
from .integrity32 import integrity32


@dataclass(frozen=True)
class MControlRecipient:
    image_sha256: str
    namespace_base: int
    namespace_limit: int
    namespace_sequence: int
    execution_gt: int
    execution_base: int
    execution_limit: int

    @classmethod
    def from_image(cls, words, *, namespace_base, slot):
        """Derive a trusted recipient from exact word-addressed candidate bytes."""
        if (len(words) != 32768 or type(namespace_base) is not int
                or namespace_base < 0 or namespace_base % 4
                or type(slot) is not int or slot < 3):
            raise ValueError("Expected a 128 KiB candidate, aligned Namespace and executable slot")
        root = namespace_base // 4
        if root + 8 > len(words):
            raise ValueError("Namespace lies outside the candidate")
        header = words[root]
        count = (header >> 10) & 8191
        if header >> 27 != 31 or (header >> 8) & 3 != 1 or not slot < count:
            raise ValueError("Invalid Namespace header or recipient slot")

        def descriptor(index):
            address = root + index * 4
            if address + 4 > len(words):
                raise ValueError("Descriptor lies outside the candidate")
            location, authority, seal, _ = words[address:address+4]
            if authority >> 30 or integrity32(location, authority) != seal:
                raise ValueError("Recipient requires a sealed local descriptor")
            return location * 4, authority & ((1 << 21)-1), (authority >> 21) & 511

        ns_base, ns_limit, ns_sequence = descriptor(1)
        if ns_base != namespace_base or ns_limit < count * 4 - 1:
            raise ValueError("Namespace self does not enclose its table")
        code_base, code_limit, sequence = descriptor(slot)
        if code_base + (code_limit + 1)*4 > len(words)*4:
            raise ValueError("Recipient body lies outside the candidate")
        code_header = words[code_base // 4]
        cw = (code_header >> 10) & 8191
        if (code_header >> 27 != 31 or (code_header >> 8) & 3
                or not cw or cw > code_limit):
            raise ValueError("Recipient must be a resident executable LUMP")
        # An E-only CALL becomes Inform X; it does not invent R permission.
        execution_gt = (0b100 << 28) | (1 << 25) | (sequence << 16) | slot
        return cls(hashlib.sha256(struct.pack("<32768I", *words)).hexdigest(),
                   ns_base, ns_limit, ns_sequence, execution_gt, code_base + 4, cw - 1)


def recipient_matches(namespace_cap, execution_cap, recipients):
    ns = View(CAP_REG_LAYOUT, namespace_cap)
    code = View(CAP_REG_LAYOUT, execution_cap)
    ns_words = View(WORD2_LAYOUT, ns.word2_w2)
    code_words = View(WORD2_LAYOUT, code.word2_w2)
    matched = Const(0)
    for recipient in recipients:
        matched = matched | (
            (ns.word0_gt.gt_type == 1)
            # CR15's normalized root view may carry D/S; those are not
            # the identity of the Namespace allocation.
            & ~ns.word0_gt.b_flag
            & (ns.word1_location == recipient.namespace_base)
            & (ns_words.limit_offset == recipient.namespace_limit)
            & (ns_words.gt_seq == recipient.namespace_sequence)
            & ~ns_words.f_flag
            & (code.word0_gt.as_value() == recipient.execution_gt)
            & (code.word1_location == recipient.execution_base)
            & (code_words.limit_offset == recipient.execution_limit)
            & (code_words.gt_seq == ((recipient.execution_gt >> 16) & 511))
            & ~code_words.f_flag)
    return matched
