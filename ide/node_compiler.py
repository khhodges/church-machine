"""
node_compiler.py — drive the real CLOOMC compiler via compile_worker.js.

The compiler is JavaScript. It runs three ways in this project — in the
browser, as a Node stdin/stdout worker (server/compile_worker.js), and behind
an HTTP endpoint. This client uses the worker directly: it is the real
compiler and the real lump_builder, with no HTTP layer to add its own
language-strictness or drift.

Protocol (from compile_worker.js):
    stdin  : {"source": "...", "language": "assembly"}
    stdout : {"ok": true, "language": "...", "words": [...],
              "lump_binary": "<base64>", "warnings": [...]}
             or {"ok": false, "language": "...", "error": "..."}
    exit   : always 0 — errors live in the JSON

Copyright (c) 2024-2026 CLOOMC Technologies LLC. GPL-3.0.
"""

from __future__ import annotations

import base64
import json
import struct
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from store import (Identity, LumpStore, LumpError, parse_header,
                   embed_source as _embed, SRC_MODE_FULL, SRC_MODES)

LANGUAGES = ("english", "javascript", "haskell", "symbolic", "lambda", "assembly")


@dataclass
class CompileResult:
    """What the real compiler returned, and what became of it in the store."""
    ok: bool
    language: str = ""
    error: str = ""
    warnings: list[dict] = field(default_factory=list)
    words: list[int] = field(default_factory=list)
    hash: str | None = None
    genotype: str | None = None
    header: dict | None = None
    rejected: str = ""
    pending: list[int] = field(default_factory=list)
    source_note: str = ""

    @property
    def stored(self) -> bool:
        return self.hash is not None

    @property
    def lazy(self) -> list[dict]:
        """Warnings the worker marked as lazy-resolvable — unresolved names
        that are pending work, not errors."""
        return [w for w in self.warnings
                if w.get("resolve_via") == "lazy_resolve"]

    def summary(self) -> str:
        if not self.ok:
            return f"compile failed: {self.error}"
        if self.rejected:
            return f"compiled, but rejected: {self.rejected}"
        bits = [f"{self.header['typ_name']} lump", f"{len(self.words)}w"]
        if self.pending:
            bits.append(f"{len(self.pending)} capability slot(s) unbound")
        if self.lazy:
            bits.append(f"{len(self.lazy)} name(s) awaiting lazy-resolve")
        return ", ".join(bits)


class CompileError(RuntimeError):
    """The worker could not be run, or returned something unusable. Distinct
    from a failed compile, which is carried in CompileResult."""


class NodeCompiler:
    """Runs the real compiler through server/compile_worker.js."""

    def __init__(self, repo_root: str | Path, node: str = "node",
                 timeout: int = 35):
        self.repo = Path(repo_root).expanduser()
        self.worker = self.repo / "server" / "compile_worker.js"
        self.node = node
        self.timeout = timeout
        self.endpoint = f"node:{self.worker}"
        if not self.worker.exists():
            raise CompileError(
                f"compile_worker.js not found at {self.worker} — "
                "point repo_root at your church-machine checkout"
            )

    def compile(self, source: str, language: str) -> dict:
        """Raw call. Returns the worker's JSON response unchanged."""
        if not source.strip():
            raise CompileError("source is empty")
        if language not in LANGUAGES:
            raise CompileError(
                f"unknown language '{language}' — one of {', '.join(LANGUAGES)}"
            )

        req = json.dumps({"source": source, "language": language})
        try:
            proc = subprocess.run(
                [self.node, str(self.worker)],
                input=req, capture_output=True, text=True,
                timeout=self.timeout,
            )
        except FileNotFoundError as e:
            raise CompileError(
                f"could not run '{self.node}' — is Node installed?"
            ) from e
        except subprocess.TimeoutExpired as e:
            raise CompileError(f"compile timed out after {self.timeout}s") from e

        if proc.returncode != 0:
            # The worker always exits 0; nonzero means Node itself failed.
            raise CompileError(
                f"worker crashed (exit {proc.returncode}): "
                f"{proc.stderr.strip()[:400]}"
            )
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError as e:
            raise CompileError(
                f"worker returned non-JSON: {proc.stdout.strip()[:200]}"
            ) from e

    def compile_and_store(self, source: str, store: LumpStore,
                          identity: Identity, language: str | None = None,
                          source_mode: str = SRC_MODE_FULL) -> CompileResult:
        """compile → hash → seal. The Lump acquires an identity here or not
        at all."""
        if not language:
            return CompileResult(ok=False,
                error="no language selected — choose one in Compose")
        body = self.compile(source, language)

        if not body.get("ok"):
            return CompileResult(ok=False, language=body.get("language", ""),
                                 error=body.get("error", "compile failed"))

        # Prefer the base64 the worker already built — it is the canonical
        # binary — and fall back to the word array if absent.
        words = self._words(body)
        if not words:
            return CompileResult(ok=False, language=body.get("language", ""),
                                 error="compiler returned no words")

        r = CompileResult(ok=True, language=body.get("language", ""),
                          warnings=list(body.get("warnings") or []),
                          words=words)

        try:
            from store import (build_api_definition, extract_content,
                               MODE_TIER)
            # The worker binary may already carry the V1.3 frame (the JS
            # emitter runs inside compile_worker.js).  Its embedded API is
            # authoritative — it has the real dispatch offsets and public
            # methods only — so never rebuild it; reuse it, and only
            # re-embed when the caller asked for a different tier.
            existing = extract_content(words)
            if existing is not None:
                if existing["tier"] == MODE_TIER.get(source_mode):
                    r.source_note = (f"self-definition already embedded "
                                     f"(tier {existing['tier']})")
                else:
                    # Pass the exact embedded API bytes, not a reserialised
                    # dict — guarantees the worker's API frame is preserved
                    # byte-for-byte across a tier change.
                    words, r.source_note = _embed(words, source,
                                                  mode=source_mode,
                                                  api=existing["api_bytes"])
            else:
                api = build_api_definition(body.get("abstractionName") or "",
                                           body.get("methods") or [],
                                           words=words)
                words, r.source_note = _embed(words, source,
                                              mode=source_mode, api=api)
            r.words = words
        except LumpError as e:
            r.source_note = f"source not embedded: {e}"

        try:
            h, header = store.put(words, identity)
            r.hash, r.header = h, header
            r.genotype = header.get("genotype")
            r.pending = store.pending(h)
        except LumpError as e:
            r.rejected = str(e)

        return r

    def compile_bind(self, source: str, name: str,
                     store: LumpStore, identity: Identity,
                     note: str = "", language: str | None = None,
                     source_mode: str = SRC_MODE_FULL) -> CompileResult:
        r = self.compile_and_store(source, store, identity, language=language,
                                   source_mode=source_mode)
        if r.stored:
            store.bind(name, r.hash, identity, note=note)
        return r

    @staticmethod
    def _words(body: dict) -> list[int]:
        """The lump words, preferring the worker's base64 binary."""
        b64 = body.get("lump_binary")
        if b64:
            raw = base64.b64decode(b64)
            return list(struct.unpack(f">{len(raw)//4}I", raw))
        return list(body.get("words") or [])
