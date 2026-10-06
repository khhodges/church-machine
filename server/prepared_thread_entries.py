"""Explicit release preparation; never import mutable Thread private state."""
import struct


def preserve_prepared_entries(candidate, prepared, cfg, lumps_dir):
    from server.boot_image import (
        validate_boot_image, validate_resident_artifact_bindings,
        configured_thread_count, generated_thread_slots, thread_layout,
        _ns_word1_get, _locate_namespace_header, create_gt,
    )
    if not isinstance(prepared, bytes) or not prepared:
        raise ValueError("prepared Thread image is required; no default entry was substituted")
    validate_resident_artifact_bindings(prepared, lumps_dir)
    validate_boot_image(candidate)
    old = struct.unpack(f"<{len(prepared) // 4}I", prepared)
    new = list(struct.unpack(f"<{len(candidate) // 4}I", candidate))
    slots = (1, *generated_thread_slots(configured_thread_count(cfg["step1"])))

    def inventory(words):
        physical = _locate_namespace_header(words, "prepared Thread inventory")
        result = []
        for slot in range(physical["slots"]):
            at = len(words) - (slot + 1) * 4
            location = words[at]
            if not 0 < location < physical["table_base"]:
                continue
            header = words[location]
            if (header >> 27) == 31 and ((header >> 8) & 3) == 2:
                result.append(slot)
        return tuple(result)

    if inventory(old) != slots or inventory(new) != slots:
        raise ValueError(
            "prepared Thread inventory differs from destination Thread count; "
            "no prepared Threads may be dropped or added")

    def descriptor(words, slot):
        at = len(words) - (slot + 1) * 4
        if at < 0:
            raise ValueError(f"prepared Thread entry NS[{slot}] is missing")
        return words[at:at + 4]

    for slot in slots:
        od, nd = descriptor(old, slot), descriptor(new, slot)
        ob, nb = od[0], nd[0]
        # Word 2 authenticates placement and legitimately changes on relocation.
        if (od[1], od[3]) != (nd[1], nd[3]) or old[ob] != new[nb]:
            raise ValueError(f"prepared Thread NS[{slot}] binding or geometry changed")
        size = 1 << (((old[ob] >> 23) & 15) + 6)
        layout = thread_layout(size, (old[ob] >> 10) & 8191)
        sto = layout["stack_end"] - 2
        gt = old[ob + layout["caps_start"]]
        root = (0x7FFF << 13) | (1 << 12) | layout["stack_end"]
        has_root = old[ob + sto + 1] == gt and old[ob + sto + 2] == root
        fresh = old[ob + 17] == (4096 | sto)
        initial = (slot != 1 and old[ob + 17] == (4096 | (sto - 2))
                   and old[ob + sto - 1] == gt and old[ob + sto] == (4096 | sto))
        if not has_root or not (fresh or initial):
            raise ValueError(f"prepared Thread NS[{slot}] requires an exact fresh canonical root frame")
        target = gt & 65535
        source_target = descriptor(old, target)
        dest_target = descriptor(new, target)
        expected = create_gt(_ns_word1_get(dest_target[1], "gt_seq"), target, {"E": 1}, 1)
        if gt != expected or (source_target[1], source_target[3]) != (
                dest_target[1], dest_target[3]):
            raise ValueError(f"prepared Thread NS[{slot}] entry permission or identity is stale")
        a, b = source_target[0], dest_target[0]
        header = new[b]
        allocation = 1 << (((header >> 23) & 15) + 6)
        if ((header >> 8) & 3) != 0 or not ((header >> 10) & 8191):
            raise ValueError(f"prepared Thread NS[{slot}] entry is not selected executable code")
        if old[a:a + allocation] != tuple(new[b:b + allocation]):
            raise ValueError(f"prepared Thread NS[{slot}] selected entry bytes changed")
        if slot == 1 and new[nb + layout["caps_start"]] != gt:
            raise ValueError("prepared Boot.Thread entry disagrees with selected boot entry")
        # Fresh generated data, stack, flags and all other homes remain untouched.
        new[nb + layout["caps_start"]] = gt
        new[nb + sto + 1] = gt
        if slot != 1:
            new[nb + sto - 1] = gt
    result = struct.pack(f"<{len(new)}I", *new)
    validate_boot_image(result)
    return result
