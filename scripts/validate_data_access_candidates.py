"""Normal Factory Build admission in disposable storage, never a live server."""
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "tests/server"), str(ROOT / "scripts")]
OUT = ROOT / "generated-artifacts/data-access-validation"


def digest_live():
    paths = [ROOT / "server/boot-config.json", ROOT / "server/ide-hierarchy.json",
             *sorted((ROOT / "server/lumps").rglob("*"))]
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in paths if p.is_file()}


def main():
    before = digest_live()
    from bootstrap_test_support import isolate_application
    private = isolate_application()
    for path in (private / "lumps").rglob("*"):
        if path.is_symlink() and not path.resolve().is_relative_to(private):
            raise RuntimeError(f"Escaping catalog symlink: {path}")

    def guard(event, args):
        if event == "open" and isinstance(args[0], (str, bytes)):
            path = Path(args[0].decode() if isinstance(args[0], bytes) else args[0]).resolve()
            writing = bool(args[2] & (1 | 2 | 64 | 512 | 1024))
            if writing and (path.is_relative_to(ROOT / "server/lumps") or
                            path in (ROOT / "server/boot-config.json",
                                     ROOT / "server/ide-hierarchy.json")):
                raise RuntimeError(f"Live write prohibited: {path}")
    sys.addaudithook(guard)
    from server.app import app
    import publish_factory_build as publisher
    client = app.test_client()

    class Transport:
        def open(self, req, timeout=None):
            path = urlsplit(req.full_url).path
            if not path.startswith(("/api/lumps/", "/api/compile",
                                    "/api/namespace/design-v1", "/api/simulation/design/")):
                raise RuntimeError(f"Non-validation endpoint prohibited: {path}")
            response = client.open(path, method=req.get_method(),
                                   data=req.data, headers=dict(req.header_items()))
            if response.status_code >= 400:
                raise HTTPError(req.full_url, response.status_code, "private response",
                                response.headers, io.BytesIO(response.data))
            return io.BytesIO(response.data)

    OUT.mkdir(parents=True, exist_ok=True)
    # Historical Boot.Thread reference used by the existing execution checker.
    shutil.copyfile(ROOT / "generated-artifacts/factory-build/before.bin", OUT / "before.bin")
    try:
        with patch.object(publisher, "OUT", OUT), patch.object(
                publisher.urllib.request, "build_opener", return_value=Transport()):
            with patch.object(sys, "argv", ["private-review"]):
                publisher.main()
            review = json.loads((OUT / "review.json").read_text())
            prepared = json.loads((ROOT / "generated-artifacts/data-access-candidates/review.json").read_text())
            for candidate in prepared["candidates"]:
                assert review["sources"][candidate["name"]]["sourceHash"] == candidate["sourceHash"]
                expected = json.loads((ROOT / "generated-artifacts/data-access-candidates" /
                                      (candidate["name"] + ".json")).read_text())["words"]
                assert review["sources"][candidate["name"]]["codeWords"] == expected[1:1+((expected[0]>>10)&8191)]
            with patch.object(sys, "argv", ["private-apply", "--apply", "--fingerprint",
                                           review["before"]["fingerprint"]]):
                publisher.main()
    finally:
        unchanged = digest_live() == before
        (OUT / "isolation.json").write_text(json.dumps({"liveFilesUnchanged":unchanged,
            "transport":"Flask test client; no network", "physicalHardwareAccessed":False},indent=2))
        assert unchanged, "Live catalog/configuration changed"
    print("PASS isolated compilation, reviewed save, binding and admission; live files unchanged")


if __name__ == "__main__":
    main()
