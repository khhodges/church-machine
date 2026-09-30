"""Read-only capacity accounting for the committed generic boot image.

This report never proposes installation or treats a saved library artifact as
resident. An unverified binding makes free-space figures unavailable.
"""
import hashlib
import json
import os
import struct
import zlib

try:
    from . import boot_image
except ImportError:
    import boot_image


def _confirmed_frame_padding(saved_words, cw, cc):
    """Only identify padding following a complete framed content section."""
    end = len(saved_words) - cc
    first = cw + 1
    if first >= end or saved_words[first] >> 24 != 0xAB:
        return None
    frame = saved_words[first]
    flags, api_len = (frame >> 16) & 255, frame & 65535
    if flags not in (0, 1, 3, 5, 7) or api_len == 0:
        return None
    after = first + 1 + (api_len + 3) // 4
    if after > end:
        return None
    api_bytes = struct.pack(">%dI" % ((api_len + 3) // 4),
                            *saved_words[first + 1:after])[:api_len]
    try:
        if not isinstance(json.loads(api_bytes.decode("utf-8")), dict):
            return None
    except (UnicodeDecodeError, ValueError):
        return None
    if flags & 1:
        if after >= end:
            return None
        source_len = saved_words[after]
        source_words = (source_len + 3) // 4
        if after + 1 + source_words > end:
            return None
        packed = struct.pack(">%dI" % source_words,
                             *saved_words[after + 1:after + 1 + source_words])[:source_len]
        try:
            if flags & 4:
                decoder = zlib.decompressobj(wbits=-15)
                decoded = decoder.decompress(packed, (1 << 18) + 1)
                if (len(decoded) > 1 << 18 or not decoder.eof or
                        decoder.unconsumed_tail or decoder.unused_data):
                    return None
            else:
                decoded = packed
            decoded.decode("utf-8")
        except (UnicodeDecodeError, zlib.error):
            return None
        after += 1 + source_words
    if after > end or any(saved_words[after:end]):
        return None
    return end - after


def _saved_cost(row, lumps_dir):
    """Exact saved source cost; deliberately independent of image validity."""
    filename, expected = row.get("filename"), row.get("binary_hash")
    if (not isinstance(filename, str) or not filename or
            filename != os.path.basename(filename) or
            not isinstance(expected, str) or len(expected) != 64 or
            not row.get("token")):
        return None, "Exact saved artifact binding is missing"
    try:
        with open(os.path.join(lumps_dir, filename), "rb") as source:
            saved = source.read()
    except OSError:
        return None, "Exact selected artifact is missing"
    if hashlib.sha256(saved).hexdigest() != expected.lower() or len(saved) < 4 or len(saved) % 4:
        return None, "Exact selected artifact hash or length is invalid"
    header = struct.unpack_from(">I", saved)[0]
    size = 1 << (((header >> 23) & 15) + 6)
    typ = (header >> 8) & 3
    cw, cc = (header >> 10) & 8191, header & 255
    if header >> 27 != 31 or typ != 0 or len(saved) != size * 4 or 1 + cw + cc > size:
        return None, "Selected saved executable header or geometry is invalid"
    known_padding = _confirmed_frame_padding(struct.unpack(">%dI" % size, saved), cw, cc)
    return {
        "size": size, "header": header, "padding": known_padding,
        "unclassified": 0 if known_padding is not None else size - 1 - cw - cc,
    }, None


def capacity_report(rows, image_bytes, lumps_dir, *, target_board=None):
    total = len(image_bytes) // 4 if image_bytes is not None else None
    report = {
        "layout": "committed generic Namespace image (not Wukong upload)",
        "totalWords": total,
        "denseBytes": len(image_bytes) if image_bytes is not None else None,
        "physicalTarget": {
            "name": "wukong-uart-upload-v2", "words": 16384,
            "namespaceSlots": 64, "namespaceEntryWords": 4,
            "factoryBodyBaseWord": 1280, "maxThreads": 3,
            "note": "Separate physical projection; generic allocations and addresses cannot be added to factory-resident bodies.",
        },
        "advisory": {
            "applies": target_board == "wukong-xc7a100t" and total == 16384,
            "bootBudgetWords": 12288,
            "runtimeReserveWords": 4096,
            "note": "Proposed 48 KiB/16 KiB split, not an enforced limit. Runtime heap within Thread bodies is accounted separately.",
        },
        "rows": [], "reservedRanges": [], "warnings": [], "trusted": False,
        "allocatedWords": None, "freeWords": None,
        "largestFreeWords": None, "unclassifiedWords": None,
    }
    warnings = report["warnings"]
    if not isinstance(rows, list):
        warnings.append("Authoritative Namespace rows are unavailable.")
        return report
    report["namespaceFingerprint"] = boot_image.namespace_fingerprint(rows)
    report["imageMatchesNamespaceRevision"] = False
    if image_bytes is not None:
        try:
            with open(os.path.join(lumps_dir, "boot-image.provenance.json"), encoding="utf-8") as source:
                provenance = json.load(source)
            report["imageMatchesNamespaceRevision"] = (
                isinstance(provenance, dict) and
                provenance.get("namespace_fingerprint") == report["namespaceFingerprint"] and
                provenance.get("image_sha256") == hashlib.sha256(image_bytes).hexdigest())
        except (OSError, ValueError, TypeError):
            pass
        if not report["imageMatchesNamespaceRevision"]:
            warnings.append("Stored image is not proven to implement this approved Namespace revision; image ranges are diagnostic evidence only.")
    try:
        boot_image.validate_resident_boot_profile(rows)
        boot_image.namespace_boot_marker_slot(rows)
    except (ValueError, TypeError) as error:
        warnings.append(str(error))
    words = None
    table_start = None
    claims = []
    if image_bytes is None:
        warnings.append("No committed boot image exists. No installed footprint can be verified.")
    else:
        try:
            if len(image_bytes) % 4:
                raise ValueError("Boot image length is not word aligned")
            # Forensic reporting needs intact descriptors and known saved
            # allocations even when the composite placement is invalid.
            boot_image.validate_boot_image(image_bytes, check_layout=False)
            try:
                boot_image.validate_boot_image(image_bytes)
            except ValueError as layout_error:
                warnings.append("Committed image layout invalid: " + str(layout_error))
            header = boot_image.read_namespace_header_info(image_bytes)
            table_start = header["table_offset_words"]
            if header["slot_count"] < max(
                    (r.get("slot", -1) for r in rows if isinstance(r, dict)
                     and type(r.get("slot")) is int), default=-1) + 1:
                raise ValueError("Namespace row exceeds committed image slot count")
            words = struct.unpack("<%dI" % total, image_bytes)
            claims = [(0, boot_image.NAMESPACE_HEADER_V2_WORDS, "Namespace header"),
                      (table_start, total, "Namespace table")]
            report["reservedRanges"] = [
                {"name": name, "locationWord": start, "allocatedWords": end - start}
                for start, end, name in claims
            ]
            report["reservedWords"] = (
                boot_image.NAMESPACE_HEADER_V2_WORDS + total - table_start)
        except (ValueError, TypeError, struct.error) as error:
            warnings.append("Committed image validation failed: " + str(error))
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            warnings.append("Non-object Namespace row")
            continue
        slot = row.get("slot")
        if type(slot) is not int or slot < 0 or slot in seen:
            warnings.append("Duplicate or invalid Namespace slot: " + str(slot))
            continue
        seen.add(slot)
        item = {
            "slot": slot, "name": str(row.get("name") or ""),
            "policy": row.get("load_policy"),
            "entryKind": "ram",
            "version": row.get("lump_version")
            if type(row.get("lump_version")) is int else None,
            "status": "unverified", "allocatedWords": None,
            "savedAllocationWords": None, "savedPaddingWords": None,
            "savedUnclassifiedWords": None,
            "paddingWords": None, "threadHeapWords": None,
            "threadStackWords": None, "unclassifiedWords": None,
        }
        report["rows"].append(item)
        def fail(reason):
            item["status"] = reason
            warnings.append("NS[%d] %s: %s" % (slot, item["name"], reason))

        if slot == 0:
            item.update(entryKind="namespace", status="Namespace descriptor table — reserved storage")
            continue
        try:
            selected_address = int(str(row.get("location")), 0)
        except (ValueError, TypeError):
            selected_address = None
        if selected_address is not None and selected_address >= 0xFFFF0000:
            expected_address = boot_image._MMIO_SLOT_SPECS.get(slot, (None, None))[0]
            item.update(entryKind="mmio", ramWords=0,
                        status="Memory-mapped I/O — no LUMP RAM body")
            try:
                item["physicalByteAddress"] = int(str(row.get("location")), 0)
            except (ValueError, TypeError):
                fail("Memory-mapped I/O assignment has no valid physical byte address")
            else:
                if item["physicalByteAddress"] != expected_address:
                    fail("Memory-mapped I/O assignment differs from architecture address")
            continue
        # Preserve forensic image evidence independently of selected artifact
        # validity. It is never promoted to validated installation or free RAM.
        if words is not None and slot < (total - table_start) // 4:
            observed_location = words[total - (slot + 1) * 4]
            if boot_image.NAMESPACE_HEADER_V2_WORDS <= observed_location < table_start:
                observed_header = words[observed_location]
                observed_size = 1 << (((observed_header >> 23) & 15) + 6)
                if observed_header >> 27 == 31 and observed_location + observed_size <= table_start:
                    item["imageEvidence"] = {
                        "locationWord": observed_location, "allocatedWords": observed_size,
                        "codeWords": (observed_header >> 10) & 8191,
                        "clistWords": observed_header & 255,
                        "verifiedSelection": False,
                    }
        cost_binding = row
        if row.get("symbolic") is True and isinstance(row.get("selection"), dict):
            selection = row["selection"]
            cost_binding = dict(selection, binary_hash=selection.get("binaryHash"))
        saved_cost, saved_error = _saved_cost(cost_binding, lumps_dir) if cost_binding.get("filename") else (
            None, "Exact saved artifact binding is missing")
        item["savedIssue"] = saved_error
        item["designOnly"] = row.get("symbolic") is True or row.get("implementationMissing") is True
        if saved_cost:
            item["savedAllocationWords"] = saved_cost["size"]
            item["savedPaddingWords"] = saved_cost["padding"]
            item["savedUnclassifiedWords"] = saved_cost["unclassified"]
        if row.get("symbolic") is True or row.get("implementationMissing") is True:
            item["entryKind"] = "design"
            if any(row.get(key) not in (None, "", False) for key in (
                    "token", "filename", "binary_hash", "resident", "boot_resident")):
                fail("Contradictory Namespace assignment: design-only flags coexist with executable binding or resident policy")
            else:
                item["status"] = "Design-only symbolic placement; not installed"
            continue
        if words is None or slot >= (total - table_start) // 4:
            fail("No validated committed image descriptor" +
                 ("; " + saved_error if row.get("filename") and saved_error else ""))
            continue
        base = total - (slot + 1) * 4
        location = words[base]
        try:
            selected_location = int(row.get("location"), 0)
        except (ValueError, TypeError):
            selected_location = None
        if selected_location != location:
            fail("Committed Namespace location differs from installed image descriptor")
            continue
        try:
            selected_limit = int(row.get("limit"), 0)
        except (ValueError, TypeError):
            selected_limit = None
        if selected_limit != boot_image._ns_word1_get(
                words[base + 1], "limit_offset"):
            fail("Committed Namespace limit differs from installed image descriptor")
            continue
        if location == 0 or location < boot_image.NAMESPACE_HEADER_V2_WORDS or location >= table_start:
            fail("Missing or invalid committed image location")
            continue
        head = words[location]
        size = 1 << (((head >> 23) & 15) + 6)
        typ = (head >> 8) & 3
        if head >> 27 != 31 or location + size > table_start or typ not in (0, 2):
            fail("Invalid or out-of-range installed LUMP header")
            continue
        if typ == 2:
            layout = boot_image.thread_layout(size, (head >> 10) & 8191)
            if not layout["valid"] or (head & 255) != boot_image.THREAD_CAP_WORDS:
                fail("Invalid installed Thread layout")
                continue
            item["threadHeapWords"] = layout["heap_words"]
            item["threadStackWords"] = layout["stack_words"]
            item["paddingWords"] = 0
            item["unclassifiedWords"] = 0
        else:
            if not saved_cost:
                fail(saved_error)
                continue
            saved_header = saved_cost["header"]
            if (saved_header >> 27 != 31 or
                    saved_cost["size"] != size or
                    ((saved_header >> 8) & 3) != typ or
                    ((saved_header >> 10) & 8191) != ((head >> 10) & 8191) or
                    (saved_header & 255) != (head & 255)):
                fail("Selected saved artifact geometry differs from installed header: "
                     "saved size=%d, type=%d, code words=%d, C-list words=%d; "
                     "image size=%d, type=%d, code words=%d, C-list words=%d" % (
                         saved_cost["size"], (saved_header >> 8) & 3,
                         (saved_header >> 10) & 8191, saved_header & 255,
                         size, typ, (head >> 10) & 8191, head & 255))
                continue
            item["paddingWords"] = saved_cost["padding"]
            item["unclassifiedWords"] = saved_cost["unclassified"]
        item["allocatedWords"] = size
        item["locationWord"] = location
        if "imageEvidence" in item:
            item["imageEvidence"]["verifiedSelection"] = report["imageMatchesNamespaceRevision"]
        item["status"] = "verified against selected geometry" if typ == 0 else "installed Thread geometry"
        claims.append((location, location + size, "NS[%d]" % slot))
    if words is not None:
        evidence = [(item["imageEvidence"]["locationWord"],
                     item["imageEvidence"]["locationWord"] + item["imageEvidence"]["allocatedWords"],
                     item) for item in report["rows"] if "imageEvidence" in item]
        for index, (start, end, item) in enumerate(evidence):
            for other_start, other_end, other in evidence[index + 1:]:
                if start < other_end and other_start < end:
                    message = ("Image allocation overlap: NS[%d] %s and NS[%d] %s "
                               "at word addresses 0x%X–0x%X (unverified image evidence)" % (
                                   item["slot"], item["name"], other["slot"], other["name"],
                                   max(start, other_start), min(end, other_end) - 1))
                    warnings.append(message)
                    item.setdefault("issues", []).append(message)
                    other.setdefault("issues", []).append(message)
        # Every other live in-RAM descriptor also consumes space. It must not
        # silently inflate the reported free pool if it lacks a resident row.
        for slot in range((total - table_start) // 4):
            if slot in seen or slot == 0:
                continue
            base = total - (slot + 1) * 4
            loc = words[base]
            if boot_image.NAMESPACE_HEADER_V2_WORDS <= loc < table_start:
                warnings.append("Unaccounted installed image descriptor NS[%d]" % slot)
        for row in rows:
            if not isinstance(row, dict) or type(row.get("slot")) is not int:
                continue
            slot = row["slot"]
            if slot <= 0 or slot >= (total - table_start) // 4:
                continue
            loc = words[total - (slot + 1) * 4]
            if boot_image.NAMESPACE_HEADER_V2_WORDS <= loc < table_start and not any(
                    item["slot"] == slot for item in report["rows"]):
                warnings.append("Installed NS[%d] is not selected resident in Namespace state" % slot)
        ordered = sorted(claims)
        for left, right in zip(ordered, ordered[1:]):
            if left[1] > right[0]:
                warnings.append("%s overlaps %s" % (left[2], right[2]))
        if not warnings:
            gaps = [ordered[0][0]] + [
                b[0] - a[1] for a, b in zip(ordered, ordered[1:])
            ] + [total - ordered[-1][1]]
            report["trusted"] = True
            report["allocatedWords"] = sum(end - start for start, end, _ in claims)
            report["freeWords"] = total - report["allocatedWords"]
            report["largestFreeWords"] = max(gaps)
            report["unclassifiedWords"] = sum(
                item["unclassifiedWords"] or 0 for item in report["rows"])
    return report