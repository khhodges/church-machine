"""Synthetic guarded-thread-current-v1, not a translated archived image.

Only local Amaranth tests consume these words. No instructions are executed
from the entry object: the tests stop before the final CALL. Stored and cached
authority use limit[20:0], version[29:21], G[30], F[31].
"""
from hardware.integrity32 import integrity32

NAMESPACE_VERSION = 46
THREAD_VERSION = 419
ENTRY_VERSION = 73
LIMIT_MASK = 0x1fffff
VERSION_SHIFT = 21


def current_guarded_thread_fixture():
    """Return independent words and pinned configuration for each test."""
    words = [0] * 16384
    config = dict(name="guarded-thread-current-v1",
                  namespaceVersion=NAMESPACE_VERSION,
                  threadVersion=THREAD_VERSION,
                  guard18=(NAMESPACE_VERSION << 9) | THREAD_VERSION)
    words[:4] = [0xf8810100, 0, 3, 0]  # 64 slots, three non-self entries

    def descriptor(slot, base, limit, version):
        authority = limit | (version << VERSION_SHIFT)
        words[4 * slot:4 * slot + 4] = [
            base, authority, integrity32(base, authority), 0]

    descriptor(1, 0, 255, NAMESPACE_VERSION)
    descriptor(2, 256, 255, THREAD_VERSION)
    descriptor(3, 0x40000000, 4, 0)  # MMIO uses byte addresses
    descriptor(20, 512, 255, ENTRY_VERSION)
    base = 256
    entry_gt = 0x4a000014 | (ENTRY_VERSION << 16)
    words[base] = 0xf900820c  # Thread: 256 words, stack 32, twelve homes
    words[base + 17] = 0x10f1
    words[base + 242] = entry_gt
    words[base + 243] = 0x0ffff0f3
    words[base + 244] = entry_gt
    # A versioned Thread home exercises reference validation on the happy path.
    words[base + 245] = 0x02000002 | (THREAD_VERSION << 16)
    words[512] = 0xf9000000  # inert 256-word abstraction, no c-list
    return words, config
