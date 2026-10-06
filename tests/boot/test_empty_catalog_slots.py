"""Saved Namespace membership outranks legacy hardware catalog positions."""
import json
from pathlib import Path

from server.boot_image import generate_boot_image, parse_ns_table_raw


def test_omitted_catalog_slots_remain_empty(isolated_boot_lumps):
    catalog = Path(isolated_boot_lumps)
    state_path = catalog / "ns-state.json"
    state = json.loads(state_path.read_text())
    state["abstractions"] = [
        row for row in state["abstractions"] if row["slot"] not in (8, 9)
    ]
    state_path.write_text(json.dumps(state))
    config = json.loads(Path("server/boot-config.json").read_text())
    image = generate_boot_image(config, str(catalog))
    raw = {row["slot"]: row for row in parse_ns_table_raw(image)["entries"]}
    for slot in (8, 9):
        assert slot not in raw or all(
            raw[slot][word] == 0 for word in ("w0", "w1", "w2", "w3"))
    for slot in (0, 1, 6, 7, 10):
        assert slot in raw
