"""Report why a copied catalog omits CapabilityTest; never grant admission."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path("/root/B1.2-source-KFV9dB")
OLD_ROOT = Path("/root/B1-build-a8UYvjXS")
GEN_ROOT = ROOT / "B12-generate-5wD6p0"
CHILD = r"""
import json, os, sys
sys.path.insert(0, sys.argv[1])
os.environ["CHURCH_LUMPS_DIR"] = sys.argv[2]
from hardware import boot_rom as b
print(json.dumps({
 "code_origin": b.__file__,
 "catalog": str(b._lumps_dir),
 "status": getattr(b, "WUKONG_CAPABILITY_TEST_STATUS", None),
 "bound": getattr(b, "WUKONG_CAPABILITY_TEST_BOUND", None),
 "filename": getattr(b, "WUKONG_CAPABILITY_TEST_FILENAME", None),
 "allocation_words": getattr(b, "WUKONG_CAPABILITY_TEST_ALLOC", None),
 "payload_words": len(getattr(b, "WUKONG_CAPABILITY_TEST_WORDS", ())),
}, indent=2))
"""


def inspect(catalog):
    ns = catalog / "ns-state.json"
    print("CATALOG:", catalog)
    result = {"catalog": str(catalog), "namespace_exists": ns.is_file()}
    if ns.is_file():
        raw = ns.read_bytes()
        result["namespace_sha256"] = hashlib.sha256(raw).hexdigest()
        state = json.loads(raw)
        entries = state.get("abstractions", [])
        if not isinstance(entries, list):
            raise ValueError("Namespace abstractions is not a list")
        rows = [row for row in entries if isinstance(row, dict)
                and (row.get("slot") == 10 or row.get("name") == "CapabilityTest")]
        result["selection"] = [
            {key: row.get(key) for key in
             ("name", "slot", "filename", "binary_hash", "location", "limit")}
            for row in rows]
        for row in result["selection"]:
            name = row.get("filename")
            if isinstance(name, str) and name and Path(name).name == name:
                binary = catalog / name
                row["file_exists"] = binary.is_file()
                if binary.is_file():
                    data = binary.read_bytes()
                    row["actual_sha256"] = hashlib.sha256(data).hexdigest()
                    row["bytes"] = len(data)
                    row["matches_selected_hash"] = (
                        row["actual_sha256"] == row.get("binary_hash"))
    print(json.dumps(result, indent=2))
    return result


def main():
    report = Path(sys.argv[1])
    script_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    print("DIAGNOSTIC_SCRIPT_SHA256:", script_sha)
    catalogs = [OLD_ROOT / "server/lumps", GEN_ROOT / "server/lumps",
                GEN_ROOT / "lumps", ROOT / "server/lumps"]
    evidence = []
    seen = set()
    for catalog in catalogs:
        if not catalog.is_dir() or catalog.resolve() in seen:
            continue
        seen.add(catalog.resolve())
        item = {"catalog": str(catalog)}
        try:
            item.update(inspect(catalog))
        except Exception as error:
            item["inspection_error"] = str(error)
            print("CATALOG_INSPECTION_ERROR:", error)
        item["loaders"] = []
        # Fresh child processes prevent Python import caching between catalogs.
        for source in (ROOT, OLD_ROOT):
            if not (source / "hardware/boot_rom.py").is_file():
                print("SOURCE_MISSING:", source)
                continue
            print("LOADER_SOURCE:", source)
            loader_sha = hashlib.sha256(
                (source / "hardware/boot_rom.py").read_bytes()).hexdigest()
            print("BOOT_ROM_SHA256:", loader_sha)
            try:
                proc = subprocess.run(
                    [str(ROOT / ".venv/bin/python"), "-B", "-c", CHILD,
                     str(source), str(catalog)],
                    cwd=str(source), capture_output=True, text=True, timeout=30)
                entry = {"source": str(source), "exit_status": proc.returncode,
                         "boot_rom_sha256": loader_sha,
                         "stdout": proc.stdout, "stderr": proc.stderr}
                print("LOADER_EXIT_STATUS:", proc.returncode)
                print(proc.stdout + proc.stderr)
            except Exception as error:
                entry = {"source": str(source), "boot_rom_sha256": loader_sha,
                         "error": str(error)}
                print("LOADER_DIAGNOSTIC_ERROR:", error)
            item["loaders"].append(entry)
        evidence.append(item)
    if not evidence:
        raise RuntimeError("No expected catalog directories exist")
    with report.open("x") as output:
        json.dump({"diagnostic_sha256": script_sha, "catalogs": evidence},
                  output, indent=2)
        output.write("\n")
    print("SAVED_DIAGNOSTIC:", report)
    print("DIAGNOSTIC_COMPLETE_NO_BUILD_NO_ADMISSION_CHANGE")


if __name__ == "__main__":
    main()
