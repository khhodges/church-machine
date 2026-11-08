"""Pin the synthetic profile independently of the guarded readers."""
from current_guarded_thread_fixture import current_guarded_thread_fixture
from hardware.integrity32 import integrity32


def test_current_guarded_thread_profile_and_all_referenced_descriptors():
    words, config = current_guarded_thread_fixture()
    assert config == dict(name="guarded-thread-current-v1",
                          namespaceVersion=46, threadVersion=419, guard18=23971)
    assert len(words) == 16384
    expected = {
        1: (0, 255, 46), 2: (256, 255, 419),
        3: (0x40000000, 4, 0), 20: (512, 255, 73),
    }
    for slot in range(1, 64):
        row = words[4 * slot:4 * slot + 4]
        if slot not in expected:
            assert row == [0, 0, 0, 0]
            continue
        base, limit, version = expected[slot]
        assert row == [base, limit | (version << 21),
                       integrity32(base, limit | (version << 21)), 0]
    # All typed stored references match their original sealed authority.
    for at in [256 + 242, 256 + 244, 256 + 245]:
        gt = words[at]
        assert (gt >> 25) & 3 == 1
        assert (gt >> 16) & 511 == words[(gt & 65535) * 4 + 1] >> 21
    words[9] = 0
    assert current_guarded_thread_fixture()[0][9] == 255 | (419 << 21)
