"""CLOOMC IDE — a local service over the Lump store.

Runs standalone: python3 server.py [--port 8420] [--store ~/.cloomc]

Independent of the existing Flask app. It calls /api/compile over HTTP and
does nothing else with the old server, so either can be replaced without the
other noticing. Standard library only.

Copyright (c) 2024-2026 CLOOMC Technologies LLC. GPL-3.0.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from compile_client import CompileClient, CompileError, DEFAULT_ENDPOINT
from node_compiler import NodeCompiler
from store import Identity, LumpStore, LumpError, parse_header, verify_seal

UI = Path(__file__).parent / "ui.html"


class FakeCompiler(CompileClient):
    """Offline stand-in. Produces a structurally valid Lump from source shape.

    Used with --offline so the IDE can be demonstrated without the compile
    server. It is not a compiler: it counts declared capabilities to size the
    c-list and leaves them null, which is exactly the state the real compiler
    produces for a declared-but-unbound capability.
    """

    def __init__(self):
        super().__init__(endpoint="offline://fake")

    def compile(self, source, language=None, abstraction_name=None,
                namespace_hint=None):
        if not source.strip():
            raise CompileError("source is empty")

        lowered = source.lower()
        if "syntax error" in lowered:
            return {"ok": False, "language": language or "english",
                    "error": "Line 1: deliberate failure for demonstration"}

        # capabilities { A, B, C } → three slots, all null
        caps: list[str] = []
        if "capabilities" in lowered:
            seg = source[lowered.index("capabilities"):]
            if "{" in seg and "}" in seg:
                inner = seg[seg.index("{") + 1:seg.index("}")]
                caps = [c.strip() for c in inner.replace("\n", ",").split(",")
                        if c.strip()]

        bound = sum(1 for c in caps if c.startswith("+"))  # "+Name" = pre-bound
        cc = len(caps)
        code_lines = [l for l in source.splitlines() if l.strip()]
        cw = max(4, len(code_lines))

        n = 6
        while (1 << n) < cw + cc + 8 + (len(source) // 8):
            n += 1

        header = (0x1F << 27) | ((n - 6) << 23) | (cw << 10) | (0 << 8) | cc
        words = [header] + [0] * ((1 << n) - 1)

        # a deterministic body, so identical source gives identical bytes
        for i in range(1, cw + 1):
            words[i] = 0x78000000 | (hash(source) + i) & 0xFFFF

        if cc:
            clist = [0] * cc
            for i in range(bound):
                clist[i] = 0xAAAA0000 | i
            words[-cc:] = clist

        return {"ok": True, "language": language or "english",
                "words": words, "warnings": []}


class Handler(BaseHTTPRequestHandler):
    store: LumpStore
    identity: Identity
    compiler: CompileClient

    def log_message(self, fmt, *args):
        sys.stderr.write(f"  {self.address_string()} {fmt % args}\n")

    # ---- plumbing ----

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj).encode(), "application/json")

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n)) if n else {}

    # ---- routes ----

    def do_GET(self):
        try:
            if self.path in ("/", "/index.html"):
                return self._send(200, UI.read_bytes(), "text/html; charset=utf-8")
            if self.path == "/api/names":
                return self._json(self._names())
            if self.path.startswith("/api/name/"):
                return self._json(self._name(self.path[len("/api/name/"):]))
            if self.path == "/api/resolve":
                return self._json(self._resolve_view())
            if self.path.startswith("/api/siblings/"):
                h = self.path[len("/api/siblings/"):]
                return self._json({
                    "hash": h,
                    "genotype": self.store.genotype_of(h),
                    "siblings": self.store.trace_home(h),
                })
            if self.path == "/api/identity":
                return self._json({
                    "signer": self.identity.name,
                    "public_key": self.identity.public_key_hex,
                    "endpoint": self.compiler.endpoint,
                    "offline": isinstance(self.compiler, FakeCompiler),
                })
            self._json({"error": "no such route"}, 404)
        except Exception as e:
            traceback.print_exc()
            self._json({"error": str(e)}, 500)

    def do_POST(self):
        try:
            if self.path == "/api/compile":
                return self._json(self._compile(self._read_json()))
            if self.path == "/api/bind":
                return self._json(self._bind(self._read_json()))
            if self.path == "/api/rollback":
                return self._json(self._rollback(self._read_json()))
            self._json({"error": "no such route"}, 404)
        except Exception as e:
            traceback.print_exc()
            self._json({"error": str(e)}, 500)

    # ---- handlers ----

    def _names(self) -> list[dict]:
        out = []
        for name in self.store.names():
            b = self.store.resolve(name)
            entry = {"name": name, "hash": b.hash, "bound_at": b.bound_at,
                     "signer": b.signer, "note": b.note,
                     "versions": len(self.store.history(name))}
            try:
                entry["pending"] = self.store.pending(b.hash)
                entry["header"] = parse_header(self._words(b.hash))
            except (KeyError, LumpError):
                entry["pending"] = []
                entry["header"] = None
            out.append(entry)
        return out

    def _words(self, hash_hex: str) -> list[int]:
        binary = self.store.get(hash_hex)
        return list(struct.unpack(f">{len(binary) // 4}I", binary))

    def _name(self, name: str) -> dict:
        history = self.store.history(name)
        if not history:
            return {"error": f"{name} is not bound"}

        versions = []
        for i, b in enumerate(history):
            v = {"index": i + 1, "hash": b.hash, "bound_at": b.bound_at,
                 "signer": b.signer, "note": b.note, "current": i == len(history) - 1}
            try:
                v["header"] = parse_header(self._words(b.hash))
                v["pending"] = self.store.pending(b.hash)
                v["clist"] = [f"0x{g:08X}" for g in self.store.clist_slots(b.hash)]
                seal = self.store.get_seal(b.hash)
                v["seal_ok"] = verify_seal(seal) if seal else False
                src, fmt = self.store.source(b.hash)
                v["source"], v["source_format"] = src, fmt
            except (KeyError, LumpError) as e:
                v["error"] = str(e)
            versions.append(v)
        return {"name": name, "versions": versions}

    def _resolve_view(self) -> dict:
        pending = self.store.pending_by_name()
        return {
            "waiting": [{"name": n, "slots": s} for n, s in pending.items()],
            "complete": [n for n in self.store.names() if n not in pending],
        }

    def _compile(self, body: dict) -> dict:
        source = body.get("source", "")
        name = (body.get("name") or "").strip()
        note = body.get("note", "")
        language = body.get("language") or None
        mode = (body.get("source_mode") or "full").lower()

        # Only the real Node compiler carries source_mode; the fake/HTTP
        # clients ignore it. Pass it when the compiler accepts it.
        import inspect
        kw = {}
        if "source_mode" in inspect.signature(
                self.compiler.compile_and_store).parameters:
            kw["source_mode"] = mode

        try:
            if name:
                r = self.compiler.compile_bind(
                    source, name, self.store, self.identity,
                    note=note, language=language, **kw)
            else:
                r = self.compiler.compile_and_store(
                    source, self.store, self.identity, language=language, **kw)
        except CompileError as e:
            return {"ok": False, "error": str(e), "transport": True}

        return {"ok": r.ok, "error": r.error, "rejected": r.rejected,
                "language": r.language, "hash": r.hash, "header": r.header,
                "genotype": getattr(r, "genotype", None),
                "source_mode": mode,
                "pending": r.pending, "warnings": r.warnings,
                "source_note": r.source_note,
                "words": len(r.words), "bound": bool(name and r.stored),
                "summary": r.summary()}

    def _bind(self, body: dict) -> dict:
        try:
            b = self.store.bind(body["name"], body["hash"], self.identity,
                                note=body.get("note", ""))
            return {"ok": True, "name": b.name, "hash": b.hash}
        except (KeyError, ValueError) as e:
            return {"ok": False, "error": str(e)}

    def _rollback(self, body: dict) -> dict:
        try:
            b = self.store.rollback(body["name"], self.identity,
                                    steps=int(body.get("steps", 1)))
            return {"ok": True, "name": b.name, "hash": b.hash}
        except KeyError as e:
            return {"ok": False, "error": str(e)}


def main() -> int:
    ap = argparse.ArgumentParser(description="CLOOMC IDE")
    ap.add_argument("--port", type=int, default=8420)
    ap.add_argument("--store", default="~/.cloomc/store")
    ap.add_argument("--identity", default="~/.cloomc/identity.json")
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    ap.add_argument("--token", default=None)
    ap.add_argument("--offline", action="store_true",
                    help="use the built-in fake compiler")
    ap.add_argument("--repo", default=None,
                    help="path to church-machine checkout; uses the real "
                         "Node compiler (server/compile_worker.js)")
    ap.add_argument("--signer", default="cloomc.lab.ide")
    args = ap.parse_args()

    store_path = Path(args.store).expanduser()
    id_path = Path(args.identity).expanduser()
    id_path.parent.mkdir(parents=True, exist_ok=True)

    if id_path.exists():
        identity = Identity.load(id_path)
    else:
        identity = Identity.generate(args.signer)
        identity.save(id_path)
        print(f"  new signing identity: {args.signer}")
        print(f"  public key {identity.public_key_hex[:32]}…")

    Handler.store = LumpStore(store_path)
    Handler.identity = identity
    if args.offline:
        Handler.compiler = FakeCompiler()
    elif args.repo:
        Handler.compiler = NodeCompiler(args.repo)
    else:
        Handler.compiler = CompileClient(args.endpoint, args.token)

    print(f"\n  CLOOMC IDE  http://localhost:{args.port}")
    print(f"  store       {store_path}")
    print(f"  signer      {identity.name}")
    _mode = ("offline (fake)" if args.offline
             else f"node worker · {args.repo}" if args.repo
             else args.endpoint)
    print(f"  compiler    {_mode}\n")

    ThreadingHTTPServer(("", args.port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
