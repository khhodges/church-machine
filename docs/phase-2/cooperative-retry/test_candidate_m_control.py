"""Exact configured recipients, not a code name or a transferable M bit."""
from dataclasses import replace

from amaranth import Elaboratable, Module, Signal
from amaranth.sim import Simulator
import pytest

from hardware.configured_m_control import MControlRecipient, recipient_matches
from hardware.integrity32 import integrity32
from hardware.layouts import CAP_REG_LAYOUT


def image():
    words = [0] * 32768
    for root, code in ((0, 0x8000), (0x10000, 0x18000)):
        words[root//4] = 0xf8810100
        for slot, base, size, seq in ((1, root, 256, 46), (23, code, 64, 19)):
            loc, auth = base//4, size-1 | seq << 21
            words[root//4+slot*4:root//4+slot*4+4] = [loc, auth, integrity32(loc, auth), 0]
        words[code//4] = (31 << 27) | (5 << 10) | 2
    return words


def test_two_local_recipients_and_negative_identity_cases():
    recipients = tuple(MControlRecipient.from_image(
        image(), namespace_base=root, slot=23) for root in (0, 0x10000))

    class Probe(Elaboratable):
        def __init__(self):
            self.ns = Signal(CAP_REG_LAYOUT)
            self.code = Signal(CAP_REG_LAYOUT)
            self.allowed = Signal()
            self.empty = Signal()

        def elaborate(self, platform):
            m = Module()
            m.d.comb += [
                self.allowed.eq(recipient_matches(self.ns, self.code, recipients)),
                self.empty.eq(recipient_matches(self.ns, self.code, ()))]
            return m

    dut = Probe()
    sim = Simulator(dut)

    async def bench(ctx):
        for r in recipients:
            ns = 0x022e0001 | r.namespace_base << 32 | (
                r.namespace_limit | r.namespace_sequence << 21) << 64
            code = r.execution_gt | r.execution_base << 32 | (
                r.execution_limit | 19 << 21) << 64
            cases = [(ns, code, True), (ns | 1 << 27, code, True),
                     (ns ^ 1 << 32, code, False),
                     (ns ^ 1 << 85, code, False), (ns & ~0xffffffff, code, False),
                     (ns, code ^ 1, False), (ns, code ^ 1 << 16, False),
                     (ns, code ^ 1 << 32, False), (ns, code ^ 1 << 64, False),
                     (ns, code ^ 1 << 85, False), (ns, code ^ 1 << 27, False),
                     (ns, code ^ 1 << 31, False)]
            for namespace, execution, allowed in cases:
                ctx.set(dut.ns.as_value(), namespace)
                ctx.set(dut.code.as_value(), execution)
                await ctx.delay(1e-9)
                assert bool(ctx.get(dut.allowed)) is allowed
                assert not ctx.get(dut.empty)

    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("mutate", [
    lambda w: w.__setitem__(23*4+2, 0),
    lambda w: w.__setitem__(0x8000//4, 0),
    lambda w: w.__setitem__(0, 0),
])
def test_corrupt_image_cannot_derive_recipient(mutate):
    words = image()
    mutate(words)
    with pytest.raises(ValueError):
        MControlRecipient.from_image(words, namespace_base=0, slot=23)


def test_recipient_is_tied_to_exact_image_bytes():
    before = image()
    first = MControlRecipient.from_image(before, namespace_base=0, slot=23)
    before[-1] = 1
    second = MControlRecipient.from_image(before, namespace_base=0, slot=23)
    assert first.image_sha256 != second.image_sha256
    assert replace(first, image_sha256=second.image_sha256) == second


def test_core_rejects_recipient_from_another_image():
    from types import SimpleNamespace
    from hardware.core import ChurchCore
    recipient = MControlRecipient.from_image(image(), namespace_base=0, slot=23)
    binding = SimpleNamespace(memory_bytes=131072, image_sha256="0"*64)
    with pytest.raises(ValueError, match="exact trusted candidate image"):
        ChurchCore(checked_memory=True, memory_bytes=131072,
                   fault_boot_binding=binding, m_control_recipients=(recipient,))
