"""Review-only image geometry and publication-order checks."""
import struct
from prepare_combined_review import build, seal


def test_review_images_and_publication_intermediates():
    inputs, images = build()
    assert images["user-b"]["sha256"] == "1d2417387397d64640ab976322232158db60de8b61483fd52a27b010eac302eb"
    assert images["all-waiting"]["sha256"] == "bfd60b47f5346768a81a53276876634f8b87b52d05f4ffa9a986a232d6ffc3d7"
    old, old_caller, new, new_caller = inputs["records"]
    for image in images.values():
        assert len(image["bytes"]) == 65536
        words = struct.unpack("<16384I", image["bytes"])
        assert not any(words[0xa000 // 4:0xa400 // 4])
        assert not any(words[new["baseByte"] // 4:new["baseByte"] // 4 + new["sizeWords"]])
        assert words[old["baseByte"] // 4] >> 10 & 0x1fff == 0
        assert not any(words[old["baseByte"] // 4 + 1:old["baseByte"] // 4 + old["sizeWords"]])
        for caller in (old_caller, new_caller):
            assert list(words[caller["baseByte"] // 4:caller["baseByte"] // 4 + caller["sizeWords"]]) == caller["words"]
        # W alias is limited to the new descriptor, never the whole Namespace.
        assert words[46 * 4] == new["slot"] * 4
        assert words[46 * 4 + 1] == 3
        descriptor = list(words[new["slot"] * 4:new["slot"] * 4 + 4])
        for offset in (0, 1, 3, 2):
            assert descriptor[2] != seal(descriptor[0], descriptor[1])
            descriptor[offset] = new["descriptor"][offset]
        assert descriptor[2] == seal(descriptor[0], descriptor[1])
    # Freeze exact received identities separately from the whole-image identities.
    assert old["localizedSha256LE"] == "9b12981b124ed17e671bdaf56263b81a5e60eacdc95dd3e58df15589d6fb0d7b"
    assert new["localizedSha256LE"] == "01820b0618859d7151a56f8f6f4b9a8e0d77ee729b82545ab22806d4b241aca9"
